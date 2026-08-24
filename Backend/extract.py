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

from db import BASE_DIR, DOC_TYPES, db, new_id

try:
    import anthropic
except ImportError:          # the rest of this module is engine-agnostic and
    anthropic = None         # stays importable — and testable — without the SDK.


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

def match_material(con: sqlite3.Connection, description: str | None) -> str | None:
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
    material_id = new_id("MAT")
    label = str(description).splitlines()[0].strip()[:120]
    con.execute(
        "INSERT INTO materials (id, code, name, category, unit, verified)"
        " VALUES (?, NULL, ?, NULL, ?, 0)",
        (material_id, label, "Nos"),
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

MODEL = os.environ.get("EXTRACT_MODEL", "claude-opus-5")

_MEDIA_TYPES = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".pdf": "application/pdf",
}


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
        media_type = _MEDIA_TYPES.get(full.suffix.lower())
        if media_type is None:
            raise ValueError(f"cannot read {full.suffix} as a document page")
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
    """
    if anthropic is None:
        raise EngineNotConfigured(
            "The anthropic package is not installed — pip install -r requirements.txt"
        )
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        raise EngineNotConfigured(
            "No Claude credentials found. Set ANTHROPIC_API_KEY (or run `ant auth login`) "
            "and restart the server."
        )
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
                match_material(con, description),
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
    """Background task: PENDING -> PROCESSING -> EXTRACTED, or FAILED with a reason."""
    with db() as con:
        row = con.execute(
            "SELECT file_paths, document_type FROM documents WHERE id = ?", (document_id,)
        ).fetchone()
        if row is None:
            return
        con.execute("UPDATE documents SET status = 'PROCESSING' WHERE id = ?", (document_id,))
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


def mark_reviewed(con: sqlite3.Connection, document_id: str, reviewed_by: str) -> None:
    con.execute(
        "UPDATE doc_headers SET reviewed_by = ?, reviewed_at = ? WHERE document_id = ?",
        (reviewed_by, datetime.now(timezone.utc).isoformat(timespec="seconds"), document_id),
    )
    con.execute("UPDATE documents SET status = 'REVIEWED' WHERE id = ?", (document_id,))


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

        # A human correction re-points the alias.
        learn_material_alias(con, "Zircon Fibre Mesh 400gsm", "MAT-WALL-PUTTY")
        assert match_material(con, "Zircon Fibre Mesh 400gsm") == "MAT-WALL-PUTTY"

        # Vendors: GSTIN wins, and a repeat lookup does not duplicate the row.
        first = match_vendor(con, "UltraTech Cement Limited", "09AAACL6442L1Z8")
        again = match_vendor(con, "ULTRATECH CEMENT LTD", "09AAACL6442L1Z8")
        assert first == again, "same GSTIN must resolve to one vendor"
        assert match_vendor(con, None, None) is None

        con.execute("DELETE FROM material_aliases WHERE alias = ?", ("zircon fibre mesh 400gsm",))
        con.execute("DELETE FROM materials WHERE verified = 0")
        con.execute("DELETE FROM vendors WHERE id = ?", (first,))

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
