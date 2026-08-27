"""Four variants of the Anand Enterprises invoice (INV-9088, against
PO-BNB-2026-0001 / D.C. No DC-3103 — see generate_bnb_mock.py for the
ground-truth data this reuses) for testing the Site/Vendor invoice channel
tagging and the Inward Report side of the three-way delivery match:

  INV-9088_vendor-copy.png    — same invoice, retitled "VENDOR INVOICE"
  INV-9088_site-copy.png      — same invoice, retitled "SITE INVOICE"
  DC-3103_inward-missing-product.png   — Inward Report, only one of the two
                                          materials listed (M Sand dropped)
  DC-3103_inward-missing-quantity.png  — Inward Report, both materials
                                          listed but Qty left blank on one

The two invoice copies are identical in every material/quantity/rate — they
exist to test that tagging one SITE and one VENDOR (see doc_headers.
invoice_channel) still reads as a clean three-way match. The two Inward
Report variants exist to each trigger a different kind of three-way
mismatch once paired with the (clean) invoice copies above.

The Inward Report is deliberately not rendered like the invoice: it's the
site's own record, not the vendor's — no vendor GSTIN or letterhead, a
"Received by" line instead of "Authorised Signatory". Its own document
number is the D.C. number (DC-3103), not a new number of its own — that's
the field po_reconciliation actually matches an Inward Report against an
invoice's lines by (see main.py's dc_to_key).

Run: python generate_anand_channel_copies.py
"""
from __future__ import annotations

import json
from pathlib import Path

from generate_sample_docs import _draw_table, _font, money
from PIL import Image, ImageDraw

OUT_DIR = Path(__file__).resolve().parent.parent / "Sample" / "generated" / "anand_channel_copies"

BUYER = {
    "name": "B&B Constructions",
    "gstin": "29AACCB7788K1Z9",
    "site": "B&B Constructions - Lakeview Residency, Site 2, Sarjapur Road, Bengaluru, Karnataka - 560035",
}
VENDOR = {
    "name": "Anand Enterprises - Construction Supplies",
    "gstin": "29AAKPA3210H1Z4",
    "address": "No. 8, Old Madras Road, KR Puram, Bengaluru, Karnataka - 560036",
}
PO_NUMBER = "PO-BNB-2026-0001"
PO_DATE = "01-08-2026"
INV_NUMBER = "INV-9088"
INV_DATE = "15-08-2026"
DC_NUMBER, DC_DATE = "DC-3103", "15-08-2026"

# The original's two lines — description, hsn, qty, unit, rate, tax%.
CEMENT = ("OPC Cement 53 Grade", "2523", 100, "MT", 7200, 28)
SAND = ("M Sand", "2505", 100, "MT", 1500, 5)


def render_invoice_copy(doc_type_label: str, out_path: Path) -> None:
    """Same invoice content as the original, just retitled — the vendor's
    own tax invoice, handed to two different channels."""
    W, H = 1240, 1650
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    f_title, f_h2, f_body = _font(bold=True, size=30), _font(bold=True, size=20), _font(size=17)

    y = 40
    d.text((40, y), VENDOR["name"], font=f_h2, fill="black"); y += 28
    d.text((40, y), VENDOR["address"], font=f_body, fill="black"); y += 24
    d.text((40, y), f"GSTIN: {VENDOR['gstin']}", font=f_body, fill="black"); y += 40

    d.line([40, y, W - 40, y], fill="black", width=2); y += 20
    title_w = d.textlength(doc_type_label, font=f_title)
    d.text(((W - title_w) / 2, y), doc_type_label, font=f_title, fill="black"); y += 50
    d.line([40, y, W - 40, y], fill="black", width=2); y += 20

    d.text((40, y), f"No: {INV_NUMBER}", font=f_h2, fill="black")
    d.text((W - 340, y), f"Date: {INV_DATE}", font=f_h2, fill="black")
    y += 36

    ref_line = f"Against PO No: {PO_NUMBER} dt. {PO_DATE}   |   D.C. No: {DC_NUMBER} dt. {DC_DATE}"
    d.text((40, y), ref_line, font=f_h2, fill="black"); y += 32

    for line in [
        "Buyer:", BUYER["name"], f"Site: {BUYER['site']}", f"GSTIN: {BUYER['gstin']}",
    ]:
        d.text((40, y), line, font=f_body, fill="black")
        y += 24
    y += 20

    rows, basic_value, tax_total = [], 0.0, 0.0
    for desc, hsn, qty, unit, rate, tax in (CEMENT, SAND):
        amount = qty * rate
        basic_value += amount
        tax_amt = amount * tax / 100
        tax_total += tax_amt
        rows.append([desc, hsn, qty, unit, money(rate), money(amount), f"{tax}%", DC_NUMBER])

    y = _draw_table(
        d, 40, y,
        [280, 90, 90, 90, 130, 150, 80, 140],
        ["Description", "HSN", "Qty", "Unit", "Rate", "Amount", "Tax%", "DC No"],
        rows,
    ) + 30

    cgst = round(tax_total / 2, 2)
    sgst = round(tax_total - cgst, 2)
    raw_total = basic_value + tax_total
    total_value = round(raw_total)
    rounding_off = round(total_value - raw_total, 2)

    for label, value in [
        ("Basic Value", money(basic_value)), ("CGST", money(cgst)), ("SGST", money(sgst)),
        ("Round Off", money(rounding_off)), ("Total Value", money(total_value)),
    ]:
        text = f"{label}: {value}"
        w = d.textlength(text, font=f_h2)
        d.text((W - 40 - w, y), text, font=f_h2, fill="black")
        y += 30

    sig_y = H - 100
    d.line([W - 340, sig_y, W - 40, sig_y], fill="black", width=1)
    d.text((W - 340, sig_y + 8), "Authorised Signatory", font=f_body, fill="black")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)


def render_inward_report(lines: list[tuple], blank_qty_for: str | None, out_path: Path) -> None:
    """The site's own record of what arrived — no vendor letterhead or
    GSTIN, since the site prepares this, not the vendor. `lines` is which
    materials are on it at all; `blank_qty_for` (a description string, or
    None) leaves that one line's Qty cell empty rather than dropping the
    line — a different failure shape than the material being absent
    entirely, and the two Inward Report variants each test one of these."""
    W, H = 1240, 1650
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    f_title, f_h2, f_body = _font(bold=True, size=30), _font(bold=True, size=20), _font(size=17)

    y = 40
    d.text((40, y), BUYER["name"], font=f_h2, fill="black"); y += 28
    d.text((40, y), BUYER["site"], font=f_body, fill="black"); y += 40

    d.line([40, y, W - 40, y], fill="black", width=2); y += 20
    title = "MATERIAL INWARD REGISTER"
    title_w = d.textlength(title, font=f_title)
    d.text(((W - title_w) / 2, y), title, font=f_title, fill="black"); y += 50
    d.line([40, y, W - 40, y], fill="black", width=2); y += 20

    d.text((40, y), f"No: {DC_NUMBER}", font=f_h2, fill="black")
    d.text((W - 340, y), f"Date: {DC_DATE}", font=f_h2, fill="black")
    y += 36

    d.text((40, y), f"Against PO No: {PO_NUMBER} dt. {PO_DATE}   |   Invoice No: {INV_NUMBER}", font=f_h2, fill="black")
    y += 32

    for line in [f"Received from: {VENDOR['name']}", "Recorded by: Site Store Keeper"]:
        d.text((40, y), line, font=f_body, fill="black")
        y += 24
    y += 20

    rows = []
    for desc, hsn, qty, unit, rate, _tax in lines:
        amount = qty * rate
        qty_cell = "" if desc == blank_qty_for else qty
        rows.append([desc, hsn, qty_cell, unit, money(rate), money(amount) if qty_cell != "" else ""])

    _draw_table(
        d, 40, y,
        [320, 100, 100, 100, 150, 170],
        ["Material", "HSN", "Qty", "Unit", "Rate", "Amount"],
        rows,
    )

    sig_y = H - 100
    d.line([W - 340, sig_y, W - 40, sig_y], fill="black", width=1)
    d.text((W - 340, sig_y + 8), "Received by (Site Supervisor)", font=f_body, fill="black")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)


def build_and_render():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    render_invoice_copy("VENDOR INVOICE", OUT_DIR / "INV-9088_vendor-copy.png")
    render_invoice_copy("SITE INVOICE", OUT_DIR / "INV-9088_site-copy.png")
    render_inward_report([CEMENT], None, OUT_DIR / "DC-3103_inward-missing-product.png")
    render_inward_report([CEMENT, SAND], "M Sand", OUT_DIR / "DC-3103_inward-missing-quantity.png")

    manifest = {
        "po_number": PO_NUMBER, "invoice_number": INV_NUMBER, "dc_number": DC_NUMBER,
        "vendor": VENDOR, "buyer": BUYER,
        "variants": {
            "vendor_copy": {"file": "INV-9088_vendor-copy.png", "lines": [CEMENT, SAND]},
            "site_copy": {"file": "INV-9088_site-copy.png", "lines": [CEMENT, SAND]},
            "inward_missing_product": {
                "file": "DC-3103_inward-missing-product.png", "lines": [CEMENT], "missing": "M Sand",
            },
            "inward_missing_quantity": {
                "file": "DC-3103_inward-missing-quantity.png", "lines": [CEMENT, SAND],
                "blank_qty_for": "M Sand",
            },
        },
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Wrote 4 images + manifest.json to {OUT_DIR}")


if __name__ == "__main__":
    build_and_render()
