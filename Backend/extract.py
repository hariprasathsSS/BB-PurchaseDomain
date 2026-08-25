"""Extraction and mapping.

The OCR engine is not chosen yet, so it lives behind exactly one function —
`run_engine`. Everything else here (date parsing, material and vendor mapping,
duplicate detection, persistence) is engine-agnostic and already testable.

Run `python extract.py` for the self-check.
"""

from __future__ import annotations

import base64
import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel

import media
from db import BASE_DIR, DOC_TYPES, db, new_id

try:
    import anthropic
except ImportError:          # the rest of this module is engine-agnostic and
    anthropic = None         # stays importable — and testable — without the SDK.

try:
    import openai
except ImportError:
    openai = None


class EngineNotConfigured(RuntimeError):
    """Raised until an OCR engine is wired in."""


# ── dates ────────────────────────────────────────────────────────────────────
# Indian documents print dates day-first. The samples alone carry three shapes:
# "08.08.2023" (UltraTech) and "05-Mar-2020" (the PO and challan).
#
# The trap: "05/03/2026" is 5 March here and 3 May in the US. A model trained on
# US data flips it silently, landing the invoice in the wrong month and the wrong
# GST period with nothing appearing broken. So day-first is not a preference, it
# is the rule, and %m/%d is never attempted.

_DATE_FORMATS = (
    "%Y-%m-%d",     # ISO, in case the engine already normalised it
    "%d.%m.%Y",     # 08.08.2023
    "%d/%m/%Y",     # 08/08/2023
    "%d-%m-%Y",     # 08-08-2023
    "%d-%b-%Y",     # 05-Mar-2020
    "%d %b %Y",     # 05 Mar 2020
    "%d-%B-%Y",     # 05-March-2020
    "%d %B %Y",     # 05 March 2020
    "%d.%m.%y",     # 08.08.23
    "%d/%m/%y",
    "%d-%m-%y",
)


def parse_date(raw: str | None) -> str | None:
    """Printed date to ISO YYYY-MM-DD, day-first. None if unparseable.

    Unparseable is not an error — the raw string is stored alongside and a human
    fixes it in review.
    """
    if not raw:
        return None
    text = " ".join(str(raw).split())
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


# ── text normalisation ───────────────────────────────────────────────────────

def normalise(text: str | None) -> str:
    """Lowercase, collapse whitespace, drop surrounding punctuation."""
    if not text:
        return ""
    return " ".join(str(text).lower().split()).strip(" .,:;-")


# 2-digit state code + 10-character PAN (5 letters, 4 digits, 1 letter) + entity
# digit + 'Z' + checksum.
GSTIN_RE = re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z0-9]{2}\b")

# Fallback: anything 15 characters starting with two digits. A single OCR slip
# breaks the strict pattern, and returning None there would throw away the only
# vendor identifier on the page. Better to surface a suspect value a human can
# fix than to silently lose it.
GSTIN_LOOSE_RE = re.compile(r"\b\d{2}[A-Z0-9]{13}\b")


def find_gstin(text: str | None) -> str | None:
    """Pull a GSTIN out of free text. Strict shape first, loose shape second."""
    if not text:
        return None
    upper = str(text).upper()
    match = GSTIN_RE.search(upper) or GSTIN_LOOSE_RE.search(upper)
    return match.group(0) if match else None


def is_valid_gstin(value: str | None) -> bool:
    """True only for the strict shape — drives the confidence flag in review."""
    return bool(value and GSTIN_RE.fullmatch(str(value).upper()))


# ── mapping ──────────────────────────────────────────────────────────────────

def match_material(con: sqlite3.Connection, description: str | None, unit: str | None = None) -> str | None:
    """Description to material_id via the alias table, creating one if needed.

    Line descriptions carry spec sub-lines — the samples show "Electric Drill
    Machine / 10mm / 300W" as one cell. The first line is the material name, so
    try the whole block first and then just that line.
    """
    text = normalise(description)
    if not text:
        return None

    candidates = [text]
    first_line = normalise(str(description).splitlines()[0])
    if first_line and first_line != text:
        candidates.append(first_line)

    for candidate in candidates:
        row = con.execute(
            "SELECT material_id FROM material_aliases WHERE alias = ?", (candidate,)
        ).fetchone()
        if row:
            return row["material_id"]

    # Never block on a masters gap: create it unverified and let review confirm.
    # The line's own unit wins when the document printed one; "Nos" is only a
    # fallback for lines that carry no unit at all (a PO or RA bill line).
    material_id = new_id("MAT")
    label = str(description).splitlines()[0].strip()[:120]
    con.execute(
        "INSERT INTO materials (id, code, name, category, unit, verified)"
        " VALUES (?, NULL, ?, NULL, ?, 0)",
        (material_id, label, (unit or "").strip() or "Nos"),
    )
    con.execute(
        "INSERT OR IGNORE INTO material_aliases (alias, material_id) VALUES (?, ?)",
        (candidates[-1], material_id),
    )
    return material_id


def learn_material_alias(con: sqlite3.Connection, description: str, material_id: str) -> None:
    """Called when a human corrects a mapping in review.

    This is the whole learning mechanism: the next document using that wording is
    an exact hit. No model involved — an INSERT.
    """
    alias = normalise(description)
    if not alias:
        return
    con.execute(
        "INSERT INTO material_aliases (alias, material_id) VALUES (?, ?)"
        " ON CONFLICT(alias) DO UPDATE SET material_id = excluded.material_id",
        (alias, material_id),
    )


def match_vendor(con: sqlite3.Connection, name: str | None, gstin: str | None) -> str | None:
    """GSTIN is canonical; fall back to an exact name match, else auto-create.

    Vendors need no alias table — the government already assigned every
    registered supplier a unique identifier.
    """
    gstin = find_gstin(gstin) or find_gstin(name)

    if gstin:
        row = con.execute("SELECT id FROM vendors WHERE gstin = ?", (gstin,)).fetchone()
        if row:
            return row["id"]

    clean_name = (name or "").strip()
    if clean_name:
        row = con.execute(
            "SELECT id FROM vendors WHERE lower(name) = ?", (clean_name.lower(),)
        ).fetchone()
        if row:
            # Learn the GSTIN so the next document is an exact identifier hit.
            if gstin:
                con.execute(
                    "UPDATE vendors SET gstin = COALESCE(gstin, ?) WHERE id = ?",
                    (gstin, row["id"]),
                )
            return row["id"]

    if not clean_name and not gstin:
        return None

    vendor_id = new_id("VEN")
    con.execute(
        "INSERT INTO vendors (id, name, gstin, verified) VALUES (?, ?, ?, 0)",
        (vendor_id, clean_name or gstin, gstin),
    )
    return vendor_id


def find_duplicate(
    con: sqlite3.Connection, gstin: str | None, doc_number: str | None, exclude_id: str
) -> str | None:
    """Same vendor, same document number, different scan.

    Invoice numbers are per-vendor sequences — "136" and "32" in the samples — so
    the number alone collides constantly. Vendor plus number is the real key.
    """
    if not gstin or not doc_number:
        return None
    row = con.execute(
        "SELECT document_id FROM doc_headers"
        " WHERE vendor_gstin = ? AND doc_number = ? AND document_id != ?"
        " ORDER BY rowid LIMIT 1",
        (gstin, doc_number, exclude_id),
    ).fetchone()
    return row["document_id"] if row else None


# ── the engine ───────────────────────────────────────────────────────────────
# One Claude vision call per document does classification and extraction
# together. A separate classifier pass would read the same pixels twice to
# answer a question the extraction already answers.

PROVIDER = os.environ.get("EXTRACT_PROVIDER", "anthropic").strip().lower()
_DEFAULT_MODELS = {"anthropic": "claude-opus-5", "openai": "gpt-4o-mini"}
MODEL = os.environ.get("EXTRACT_MODEL", _DEFAULT_MODELS.get(PROVIDER, "claude-opus-5"))



class Line(BaseModel):
    """One row of the line-item table.

    Every field is nullable: an RA bill has no quantity and no rate, and a
    delivery challan has no amount.
    """
    description_raw: str | None
    hsn_code: str | None
    quantity: float | None
    unit: str | None
    rate: float | None
    amount: float | None
    tax_rate: float | None
    dc_number: str | None
    dc_date_raw: str | None


class Extraction(BaseModel):
    """The engine's contract. Mirrors doc_headers + doc_lines."""
    doc_kind: Literal["INVOICE", "PO", "DELIVERY", "OTHER"]

    doc_number: str | None
    po_number: str | None
    dc_number: str | None
    doc_date_raw: str | None

    vendor_name_raw: str | None
    vendor_gstin: str | None
    buyer_gstin: str | None

    place_of_supply: str | None
    delivery_address_raw: str | None

    basic_value: float | None
    tax_type: Literal["IGST", "CGST_SGST"] | None
    igst_amount: float | None
    cgst_amount: float | None
    sgst_amount: float | None
    tcs_amount: float | None
    rounding_off: float | None
    total_value: float | None

    irn: str | None
    lines: list[Line]


# Every rule below exists because a real sample page broke the naive reading of
# it. Findings 1-6 in Implementation_Plan_Phasewise.md § 3 are the source.
SYSTEM = """You read photographs and scans of Indian construction purchase documents \
and transcribe them. You are a transcriber, not an analyst.

Classify the document as doc_kind:
  INVOICE   a tax invoice for supplied materials — has quantities and unit rates
  PO        a purchase order the buyer issued
  DELIVERY  a delivery challan or goods-received note
  OTHER     anything else, including works-contract / RA bills. An RA bill is a
            lump sum against a BOQ or Work Order with no quantity and no unit
            rate — that absence is how you recognise it. Never force one into
            INVOICE.

Rules:
- Transcribe what is printed. Never infer, calculate or complete a value. If a
  field is not on the page, return null. A wrong value is far worse than null:
  null is visibly missing and gets fixed in review, a wrong value is not.
- Dates: copy the characters exactly as printed ("08.08.2023", "05-Mar-2020")
  into the *_raw fields. Do not reformat or reorder them. Indian documents are
  day-first and the server parses them; reordering here corrupts the date
  silently.
- Amounts: digits only. No currency symbol, no thousands separator. Keep the
  decimals as printed.
- doc_number is this document's own number — the invoice number on an invoice,
  the PO number on a PO, the challan number on a challan.
- po_number is a *referenced* order number. "Recipient PO No." is often blank
  while "Order No." is filled; use whichever carries the buyer's order number,
  preferring "Recipient PO No." when both are present.
- Tax comes in two shapes. Inter-state: one IGST amount, tax_type is IGST.
  Intra-state: CGST and SGST split roughly evenly, tax_type is CGST_SGST.
  Never report the same tax under both shapes.
- Totals usually reconcile as basic_value + tax + tcs_amount + rounding_off.
  Capture TCS and rounding off even when they are tiny — without them the total
  will not reconcile against the purchase order.
- delivery_address_raw is the "Name & Address of Delivery" block. On a
  construction document this identifies the site, so copy it in full.
- Line items: one entry per row of the item table. Invoice line tables often
  carry their own D.C.No and D.C.Date columns — capture them per line.
- Ignore terms and conditions, bank details, declarations and signature blocks.

If a value is genuinely unreadable — blur, glare, a fold across the digits —
return null rather than a guess."""


def _blocks(image_paths: list[str]) -> list[dict]:
    """Every page of the document as base64 content blocks, in order."""
    blocks: list[dict] = []
    for path in image_paths:
        full = BASE_DIR / path
        if not full.exists():
            raise FileNotFoundError(f"page missing from disk: {path}")
        media_type = media.media_type_for(full)
        data = base64.standard_b64encode(full.read_bytes()).decode()
        blocks.append({
            # A PDF page goes in as a document block, an image as an image block.
            "type": "document" if media_type == "application/pdf" else "image",
            "source": {"type": "base64", "media_type": media_type, "data": data},
        })
    return blocks


def run_engine(image_paths: list[str], document_type: str) -> dict:
    """All pages of one document in, structured fields out.

    `document_type` is only the operator's hint; the model classifies the page
    itself and its answer wins. Someone filing a challan as an invoice on the
    phone must not make the extraction wrong.

    Dispatches to whichever provider EXTRACT_PROVIDER names — both share this
    schema and prompt, so switching providers doesn't change what gets stored.
    """
    if not image_paths:
        raise ValueError("a document with no pages cannot be extracted")

    hint = (
        f"The operator filed this as {document_type}, which may be wrong — classify it yourself."
        if document_type and document_type != "UNCLASSIFIED"
        else "Classify this document."
    )
    prompt = (
        f"{hint} Transcribe every field you can read. This is one document,"
        f" {len(image_paths)} page(s), in order."
    )

    if PROVIDER == "openai":
        return _run_openai(image_paths, prompt)
    return _run_anthropic(image_paths, prompt)


def _run_anthropic(image_paths: list[str], prompt: str) -> dict:
    if anthropic is None:
        raise EngineNotConfigured(
            "The anthropic package is not installed — pip install -r requirements.txt"
        )
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        raise EngineNotConfigured(
            "No Claude credentials found. Set ANTHROPIC_API_KEY (or run `ant auth login`) "
            "and restart the server."
        )

    client = anthropic.Anthropic()
    # Streamed: a dense multi-page invoice at high effort can outrun the
    # non-streaming HTTP timeout.
    with client.messages.stream(
        model=MODEL,
        max_tokens=16000,
        system=SYSTEM,
        thinking={"type": "adaptive"},
        messages=[{
            "role": "user",
            "content": [*_blocks(image_paths), {"type": "text", "text": prompt}],
        }],
        output_format=Extraction,
    ) as stream:
        response = stream.get_final_message()

    if response.stop_reason == "refusal":
        raise RuntimeError("the model declined to read this document")
    if response.parsed_output is None:
        raise RuntimeError("the model returned no structured output")
    return response.parsed_output.model_dump()


def _image_data_urls(image_paths: list[str]) -> list[dict]:
    """Pages as OpenAI image_url content blocks.

    ponytail: gpt-4o-mini's vision input takes images only, not the native PDF
    blocks Claude reads — add PDF-to-image conversion if a document actually
    needs the openai provider and arrives as a PDF.
    """
    blocks = []
    for path in image_paths:
        full = BASE_DIR / path
        if not full.exists():
            raise FileNotFoundError(f"page missing from disk: {path}")
        media_type = media.media_type_for(full)
        if media_type == "application/pdf":
            # Unreachable for anything uploaded since PDFs started being
            # rendered to pages at intake; rows stored before that still hold a
            # .pdf path, and this says so honestly rather than pointing at a
            # provider the deployment may have no key for.
            raise RuntimeError(
                "this document was stored as a PDF before pages were rendered at upload —"
                " re-run the PDF backfill, or re-upload it"
            )
        data = base64.standard_b64encode(full.read_bytes()).decode()
        blocks.append({
            "type": "image_url",
            "image_url": {"url": f"data:{media_type};base64,{data}"},
        })
    return blocks


def _run_openai(image_paths: list[str], prompt: str) -> dict:
    if openai is None:
        raise EngineNotConfigured(
            "The openai package is not installed — pip install -r requirements.txt"
        )
    if not os.environ.get("OPENAI_API_KEY"):
        raise EngineNotConfigured(
            "No OpenAI credentials found. Set OPENAI_API_KEY and restart the server."
        )

    client = openai.OpenAI()
    response = client.chat.completions.parse(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM},
            {
                "role": "user",
                "content": [{"type": "text", "text": prompt}, *_image_data_urls(image_paths)],
            },
        ],
        response_format=Extraction,
    )
    message = response.choices[0].message
    if message.refusal:
        raise RuntimeError("the model declined to read this document")
    if message.parsed is None:
        raise RuntimeError("the model returned no structured output")
    return message.parsed.model_dump()


# ── persistence ──────────────────────────────────────────────────────────────

_HEADER_FIELDS = (
    "doc_kind", "doc_number", "po_number", "dc_number", "doc_date", "doc_date_raw",
    "vendor_id", "vendor_name_raw", "vendor_gstin", "buyer_gstin",
    "place_of_supply", "delivery_address_raw",
    "basic_value", "tax_type", "igst_amount", "cgst_amount", "sgst_amount",
    "tcs_amount", "rounding_off", "total_value", "irn", "qr_verified",
)


def save_extraction(con: sqlite3.Connection, document_id: str, data: dict) -> None:
    """Persist engine output into doc_headers + doc_lines, mapping as it goes."""
    gstin = find_gstin(data.get("vendor_gstin"))
    vendor_id = match_vendor(con, data.get("vendor_name_raw"), data.get("vendor_gstin"))

    header = {field: data.get(field) for field in _HEADER_FIELDS}
    header["doc_date"] = parse_date(data.get("doc_date_raw"))
    header["vendor_id"] = vendor_id
    header["vendor_gstin"] = gstin
    header["buyer_gstin"] = find_gstin(data.get("buyer_gstin"))
    header["qr_verified"] = 1 if data.get("qr_verified") else 0

    columns = ", ".join(("document_id", *_HEADER_FIELDS))
    placeholders = ", ".join(["?"] * (len(_HEADER_FIELDS) + 1))
    con.execute(f"DELETE FROM doc_headers WHERE document_id = ?", (document_id,))
    con.execute(
        f"INSERT INTO doc_headers ({columns}) VALUES ({placeholders})",
        (document_id, *(header[field] for field in _HEADER_FIELDS)),
    )

    con.execute("DELETE FROM doc_lines WHERE document_id = ?", (document_id,))
    for index, line in enumerate(data.get("lines") or [], start=1):
        description = line.get("description_raw") or ""
        con.execute(
            "INSERT INTO doc_lines (document_id, line_no, description_raw, material_id,"
            " hsn_code, quantity, unit, rate, amount, tax_rate, dc_number, dc_date)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                document_id, index, description,
                match_material(con, description, line.get("unit")),
                line.get("hsn_code"), line.get("quantity"), line.get("unit"),
                line.get("rate"), line.get("amount"), line.get("tax_rate"),
                line.get("dc_number"), parse_date(line.get("dc_date_raw")),
            ),
        )

    duplicate = find_duplicate(con, gstin, header["doc_number"], document_id)
    # The classifier's answer is what files the document. An unrecognised kind
    # leaves it UNCLASSIFIED rather than writing a value the CHECK would reject.
    doc_kind = data.get("doc_kind")
    document_type = doc_kind if doc_kind in DOC_TYPES else "UNCLASSIFIED"
    con.execute(
        "UPDATE documents SET status = 'EXTRACTED', document_type = ?, extracted_json = ?,"
        " duplicate_of = ?, error = NULL WHERE id = ?",
        (document_type, json.dumps(data), duplicate, document_id),
    )


def process(document_id: str) -> None:
    """Background task: PENDING -> PROCESSING -> EXTRACTED, or FAILED with a reason.

    The PROCESSING flip is conditioned in the UPDATE's WHERE clause, not just
    checked beforehand: this is the one place every extraction (initial or a
    manual re-extract) actually runs, so it is where a decision made between
    the request and this task running must be protected — a document that is
    already APPROVED/REJECTED must not be silently kicked back into the
    extraction pipeline.
    """
    with db() as con:
        row = con.execute(
            "SELECT file_paths, document_type FROM documents WHERE id = ?", (document_id,)
        ).fetchone()
        if row is None:
            return
        cur = con.execute(
            "UPDATE documents SET status = 'PROCESSING'"
            " WHERE id = ? AND status NOT IN ('APPROVED', 'REJECTED')",
            (document_id,),
        )
        if cur.rowcount == 0:
            return
        paths = json.loads(row["file_paths"])
        document_type = row["document_type"]

    try:
        data = run_engine(paths, document_type)
    except Exception as exc:
        with db() as con:
            con.execute(
                "UPDATE documents SET status = 'FAILED', error = ? WHERE id = ?",
                (str(exc)[:500], document_id),
            )
        return

    with db() as con:
        save_extraction(con, document_id, data)


# ── review: edit, approve, reject ───────────────────────────────────────────
# Approve/reject here is an accuracy gate on the OCR read — "did this transcribe
# correctly" — not a business validation verdict. The 3-way match against a PO
# and delivery challan is a separate, later capability. See Deviation.md §1.

EDITABLE_HEADER_FIELDS = (
    "doc_kind", "doc_number", "po_number", "dc_number", "doc_date_raw",
    "vendor_name_raw", "vendor_gstin", "buyer_gstin",
    "place_of_supply", "delivery_address_raw",
    "basic_value", "tax_type", "igst_amount", "cgst_amount", "sgst_amount",
    "tcs_amount", "rounding_off", "total_value", "irn",
)

EDITABLE_LINE_FIELDS = (
    "description_raw", "material_id", "hsn_code",
    "quantity", "unit", "rate", "amount", "tax_rate", "dc_number", "dc_date",
)


def apply_edits(con: sqlite3.Connection, document_id: str, header: dict, lines: list[dict]) -> None:
    """Persist reviewer corrections to already-extracted fields, before a decision."""
    edits = {f: header[f] for f in header if f in EDITABLE_HEADER_FIELDS}
    if "doc_date_raw" in edits:
        con.execute(
            "UPDATE doc_headers SET doc_date_raw = ?, doc_date = ? WHERE document_id = ?",
            (edits.pop("doc_date_raw"), parse_date(header["doc_date_raw"]), document_id),
        )
    if edits:
        assignments = ", ".join(f"{field} = ?" for field in edits)
        con.execute(
            f"UPDATE doc_headers SET {assignments} WHERE document_id = ?",
            (*edits.values(), document_id),
        )
    if header.get("doc_kind") in DOC_TYPES:
        con.execute(
            "UPDATE documents SET document_type = ? WHERE id = ?",
            (header["doc_kind"], document_id),
        )

    for line in lines:
        line_no = line.get("line_no")
        if not line_no:
            raise ValueError("each line edit needs line_no")
        line_edits = {f: line[f] for f in line if f in EDITABLE_LINE_FIELDS}
        if not line_edits:
            continue
        if line_edits.get("material_id") and line.get("description_raw"):
            learn_material_alias(con, line["description_raw"], line_edits["material_id"])
        assignments = ", ".join(f"{field} = ?" for field in line_edits)
        con.execute(
            f"UPDATE doc_lines SET {assignments} WHERE document_id = ? AND line_no = ?",
            (*line_edits.values(), document_id, line_no),
        )


def claim_for_edit(con: sqlite3.Connection, document_id: str) -> bool:
    """Atomically confirms the document is still EXTRACTED right before
    applying reviewer edits — a value-preserving UPDATE used purely to take
    SQLite's write lock conditionally, so an edit can't land on a document a
    concurrent request just approved or rejected."""
    cur = con.execute(
        "UPDATE documents SET status = 'EXTRACTED' WHERE id = ? AND status = 'EXTRACTED'",
        (document_id,),
    )
    return cur.rowcount > 0


def mark_approved(con: sqlite3.Connection, document_id: str, approved_by: str) -> bool:
    """EXTRACTED -> APPROVED, atomically. False (no write at all) if the
    document was not EXTRACTED — already decided, or not yet extracted."""
    cur = con.execute(
        "UPDATE documents SET status = 'APPROVED' WHERE id = ? AND status = 'EXTRACTED'",
        (document_id,),
    )
    if cur.rowcount == 0:
        return False
    con.execute(
        "UPDATE doc_headers SET reviewed_by = ?, reviewed_at = ? WHERE document_id = ?",
        (approved_by, datetime.now(timezone.utc).isoformat(timespec="seconds"), document_id),
    )
    return True


def mark_rejected(con: sqlite3.Connection, document_id: str, rejected_by: str, reason: str) -> bool:
    """EXTRACTED -> REJECTED, atomically. False (no write at all) if the
    document was not EXTRACTED — already decided, or not yet extracted."""
    cur = con.execute(
        "UPDATE documents SET status = 'REJECTED' WHERE id = ? AND status = 'EXTRACTED'",
        (document_id,),
    )
    if cur.rowcount == 0:
        return False
    con.execute(
        "UPDATE doc_headers SET reviewed_by = ?, reviewed_at = ?, rejection_reason = ?"
        " WHERE document_id = ?",
        (rejected_by, datetime.now(timezone.utc).isoformat(timespec="seconds"), reason, document_id),
    )
    return True


# ── self-check ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import db as _db

    # Dates: every shape the three samples actually print, plus the ambiguous one.
    assert parse_date("08.08.2023") == "2023-08-08"
    assert parse_date("05-Mar-2020") == "2020-03-05"
    assert parse_date("08/08/2023") == "2023-08-08"
    assert parse_date("2023-08-08") == "2023-08-08"
    assert parse_date("08-08-23") == "2023-08-08"
    assert parse_date("5 March 2020") == "2020-03-05"
    # The one that matters: day-first, never month-first.
    assert parse_date("05/03/2026") == "2026-03-05", "must read 5 March, not 3 May"
    assert parse_date("") is None
    assert parse_date("not a date") is None
    assert parse_date(None) is None

    # GSTINs taken off the sample documents. These two are the valid shape.
    assert find_gstin("Recipient GSTIN/UIN No.:07AABCN7057J1Z8") == "07AABCN7057J1Z8"
    assert find_gstin("GSTIN 24AAACC1206D1ZG") == "24AAACC1206D1ZG"
    assert is_valid_gstin("07AABCN7057J1Z8")
    # The template sample prints a made-up one. The loose pattern still catches
    # it so the reviewer sees something, but it is not treated as trustworthy.
    assert find_gstin("GSTIN : 24HDE7487RE5RT4") == "24HDE7487RE5RT4"
    assert not is_valid_gstin("24HDE7487RE5RT4")
    assert find_gstin("no identifier here") is None

    assert normalise("  OPC   Cement 53 Grade. ") == "opc cement 53 grade"

    _db.init()
    with _db.db() as con:
        seeded = match_material(con, "OPC 53")
        assert seeded == "MAT-OPC-CEMENT-53-GRADE", seeded
        # Spec sub-lines: the whole block misses, the first line hits.
        assert match_material(con, "Ready Mix Concrete M30\n20mm aggregate\nslump 100") \
            == "MAT-READY-MIX-CONCRETE-M30"
        # Unknown material is created rather than blocking.
        invented = match_material(con, "Zircon Fibre Mesh 400gsm")
        assert invented and invented.startswith("MAT-")
        assert con.execute(
            "SELECT verified FROM materials WHERE id = ?", (invented,)
        ).fetchone()["verified"] == 0
        # And it is remembered.
        assert match_material(con, "Zircon Fibre Mesh 400gsm") == invented

        # A newly created material takes the line's own unit when there is one...
        with_unit = match_material(con, "Galvanised Roofing Sheet 0.5mm", "Sheets")
        assert con.execute(
            "SELECT unit FROM materials WHERE id = ?", (with_unit,)
        ).fetchone()["unit"] == "Sheets"
        # ...and only falls back to "Nos" when the line carries no unit at all.
        no_unit = match_material(con, "Unlabelled Fitting")
        assert con.execute(
            "SELECT unit FROM materials WHERE id = ?", (no_unit,)
        ).fetchone()["unit"] == "Nos"

        # A human correction re-points the alias.
        learn_material_alias(con, "Zircon Fibre Mesh 400gsm", "MAT-WALL-PUTTY")
        assert match_material(con, "Zircon Fibre Mesh 400gsm") == "MAT-WALL-PUTTY"

        # Vendors: GSTIN wins, and a repeat lookup does not duplicate the row.
        first = match_vendor(con, "UltraTech Cement Limited", "09AAACL6442L1Z8")
        again = match_vendor(con, "ULTRATECH CEMENT LTD", "09AAACL6442L1Z8")
        assert first == again, "same GSTIN must resolve to one vendor"
        assert match_vendor(con, None, None) is None

        con.execute(
            "DELETE FROM material_aliases WHERE alias IN (?, ?, ?)",
            ("zircon fibre mesh 400gsm", "galvanised roofing sheet 0.5mm", "unlabelled fitting"),
        )
        con.execute("DELETE FROM materials WHERE verified = 0")
        con.execute("DELETE FROM vendors WHERE id = ?", (first,))

        # apply_edits / mark_approved / mark_rejected against a synthetic document.
        _doc_id, _prj_id = "DOC-selfcheck", "PRJ-selfcheck"
        con.execute(
            "INSERT INTO projects (id, code, name) VALUES (?, 'SELFCHECK', 'Self-check project')",
            (_prj_id,),
        )
        con.execute(
            "INSERT INTO documents (id, project_id, source, document_type, file_paths,"
            " page_count, status) VALUES (?, ?, 'UPLOAD', 'INVOICE', '[]', 1, 'EXTRACTED')",
            (_doc_id, _prj_id),
        )
        con.execute(
            "INSERT INTO doc_headers (document_id, doc_kind, doc_number, total_value)"
            " VALUES (?, 'INVOICE', 'INV-1', 100)",
            (_doc_id,),
        )
        con.execute(
            "INSERT INTO doc_lines (document_id, line_no, description_raw, quantity)"
            " VALUES (?, 1, 'Old Description', 5)",
            (_doc_id,),
        )

        apply_edits(
            con, _doc_id,
            {"doc_number": "INV-1-CORRECTED", "doc_date_raw": "05-Mar-2020", "not_a_real_field": "x"},
            [{
                "line_no": 1, "quantity": 6, "material_id": "MAT-OPC-CEMENT-53-GRADE",
                "description_raw": "Old Description",
            }],
        )
        header = con.execute(
            "SELECT * FROM doc_headers WHERE document_id = ?", (_doc_id,)
        ).fetchone()
        assert header["doc_number"] == "INV-1-CORRECTED"
        assert header["doc_date"] == "2020-03-05", "doc_date_raw edit must re-derive doc_date"
        line = con.execute(
            "SELECT * FROM doc_lines WHERE document_id = ? AND line_no = 1", (_doc_id,)
        ).fetchone()
        assert line["quantity"] == 6
        assert line["material_id"] == "MAT-OPC-CEMENT-53-GRADE"
        # A material correction on a line must be learned for next time too.
        assert match_material(con, "Old Description") == "MAT-OPC-CEMENT-53-GRADE"

        # Clearing a line's material (reviewer picks "unmatched") must not try
        # to learn a NULL alias and crash the material_aliases NOT NULL column.
        apply_edits(con, _doc_id, {}, [{"line_no": 1, "material_id": None, "description_raw": "Old Description"}])
        assert con.execute(
            "SELECT material_id FROM doc_lines WHERE document_id = ? AND line_no = 1", (_doc_id,)
        ).fetchone()["material_id"] is None

        try:
            apply_edits(con, _doc_id, {}, [{"quantity": 1}])   # no line_no
        except ValueError:
            pass
        else:
            raise AssertionError("a line edit with no line_no must be rejected")

        assert claim_for_edit(con, _doc_id) is True, "an EXTRACTED doc must be claimable for edit"

        assert mark_approved(con, _doc_id, "selfcheck") is True
        assert con.execute(
            "SELECT status FROM documents WHERE id = ?", (_doc_id,)
        ).fetchone()["status"] == "APPROVED"

        # Once decided, none of these may act again — each must be a no-op
        # that reports failure, not a second write that undoes the decision.
        assert claim_for_edit(con, _doc_id) is False, "an APPROVED doc must not be editable"
        assert mark_approved(con, _doc_id, "someone-else") is False, "cannot approve twice"
        reviewed_at_1 = con.execute(
            "SELECT reviewed_by, reviewed_at FROM doc_headers WHERE document_id = ?", (_doc_id,)
        ).fetchone()
        assert reviewed_at_1["reviewed_by"] == "selfcheck", "a second approve must not overwrite the first"

        assert mark_rejected(con, _doc_id, "selfcheck", "wrong vendor") is False, \
            "an already-APPROVED document must not be rejectable out from under itself"
        row = con.execute(
            "SELECT d.status, h.rejection_reason FROM documents d"
            " JOIN doc_headers h ON h.document_id = d.id WHERE d.id = ?", (_doc_id,)
        ).fetchone()
        assert row["status"] == "APPROVED", "a failed reject must not have changed the status"
        assert row["rejection_reason"] is None

        # Re-queuing extraction on an already-decided document must be a
        # silent no-op, not a network call and not a status change — this is
        # process()'s own guard, exercised directly with no credentials
        # needed since it returns before run_engine is ever reached.
        process(_doc_id)
        assert con.execute(
            "SELECT status FROM documents WHERE id = ?", (_doc_id,)
        ).fetchone()["status"] == "APPROVED", "process() must refuse to re-run on an APPROVED doc"

        # The direct EXTRACTED -> REJECTED path, tested independently of approve.
        _doc_id_2 = "DOC-selfcheck-2"
        con.execute(
            "INSERT INTO documents (id, project_id, source, document_type, file_paths,"
            " page_count, status) VALUES (?, ?, 'UPLOAD', 'INVOICE', '[]', 1, 'EXTRACTED')",
            (_doc_id_2, _prj_id),
        )
        con.execute("INSERT INTO doc_headers (document_id) VALUES (?)", (_doc_id_2,))
        assert mark_rejected(con, _doc_id_2, "selfcheck", "wrong vendor") is True
        row = con.execute(
            "SELECT d.status, h.rejection_reason FROM documents d"
            " JOIN doc_headers h ON h.document_id = d.id WHERE d.id = ?", (_doc_id_2,)
        ).fetchone()
        assert row["status"] == "REJECTED"
        assert row["rejection_reason"] == "wrong vendor"

        con.execute("DELETE FROM material_aliases WHERE alias = 'old description'")
        con.execute("DELETE FROM documents WHERE id IN (?, ?)", (_doc_id, _doc_id_2))
        con.execute("DELETE FROM projects WHERE id = ?", (_prj_id,))

    # A classified kind files the document; anything unexpected stays
    # UNCLASSIFIED rather than tripping the CHECK constraint.
    assert "OTHER" in DOC_TYPES and "INVOICE" in DOC_TYPES
    assert "RA_BILL" not in DOC_TYPES, "an unknown kind must fall back, not be stored"

    # run_engine refuses before it can reach the network: no credentials, or a
    # page that is not on disk. Either way the self-check makes no API call.
    try:
        run_engine(["nope.jpg"], "INVOICE")
    except (EngineNotConfigured, FileNotFoundError):
        pass
    else:
        raise AssertionError("run_engine read a page that does not exist")

    try:
        run_engine([], "INVOICE")
    except (EngineNotConfigured, ValueError):
        pass
    else:
        raise AssertionError("a document with no pages must not be extracted")

    # The engine contract is the schema the model is held to — a drifted field
    # name here is a silent extraction failure, so pin the shape.
    assert Extraction.model_fields.keys() >= {
        "doc_kind", "doc_number", "po_number", "doc_date_raw", "vendor_gstin",
        "tax_type", "tcs_amount", "rounding_off", "total_value", "lines",
    }
    assert "dc_number" in Line.model_fields, "invoice lines carry their own D.C.No"
    # Structured output is strict: every field must be required and nullable, or
    # the model is free to omit one and the parse fails on a real document.
    _schema = Extraction.model_json_schema()
    assert set(_schema["required"]) == set(_schema["properties"]), "all fields must be required"

    # Page encoding: a PDF is a document block, an image is an image block, and
    # anything else is refused rather than sent as garbage the model can't read.
    _scratch = BASE_DIR / "uploads" / "_selfcheck"
    _scratch.mkdir(parents=True, exist_ok=True)
    try:
        (_scratch / "a.png").write_bytes(b"\x89PNG\r\n\x1a\n")
        (_scratch / "b.pdf").write_bytes(b"%PDF-1.4")
        (_scratch / "c.txt").write_bytes(b"nope")

        pages = _blocks(["uploads/_selfcheck/a.png", "uploads/_selfcheck/b.pdf"])
        assert [p["type"] for p in pages] == ["image", "document"], pages
        assert pages[0]["source"]["media_type"] == "image/png"
        assert pages[1]["source"]["media_type"] == "application/pdf"
        # Order is the page order — a reordered multi-page invoice reads wrong.
        assert base64.b64decode(pages[0]["source"]["data"]).startswith(b"\x89PNG")

        for _path, _exc in [("uploads/_selfcheck/c.txt", ValueError),
                            ("uploads/_selfcheck/gone.jpg", FileNotFoundError)]:
            try:
                _blocks([_path])
            except _exc:
                pass
            else:
                raise AssertionError(f"{_path} should have raised {_exc.__name__}")
    finally:
        for _f in _scratch.iterdir():
            _f.unlink()
        _scratch.rmdir()

    print("extract self-check passed")
