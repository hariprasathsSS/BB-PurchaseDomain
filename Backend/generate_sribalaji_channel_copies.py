"""A full, clean delivery for the Sri Balaji Cements & Sand Suppliers invoice
(INV-7701, against PO-BNB-2026-0001 / D.C. No DC-3101 — see
Sample/generated/bnb_mock/INV_Sri_INV-7701.png for the original this reuses)
— the happy-path counterpart to generate_anand_channel_copies.py's Anand
Enterprises set, all four documents agreeing on every material and quantity,
no mismatch anywhere:

  INV-7701_vendor-copy.png    — the invoice, retitled "VENDOR INVOICE"
  INV-7701_site-copy.png      — the invoice, retitled "SITE INVOICE"
  DC-3101_delivery-note.png   — Delivery Note, same two materials/quantities
  DC-3101_inward-report.png   — Inward Report, same two materials/quantities

Same OPC Cement 53 Grade (100 MT) + M Sand (100 MT) as the original invoice,
unchanged on every one of the four — that identical `LINES` tuple feeding
every render call is what makes this "no mismatch" by construction rather
than by coincidence. See generate_anand_channel_copies.py for the format
notes (why the Delivery Note is unpriced, why the Inward Report isn't
rendered like the invoice, why both carry the D.C. number as their own
document number) — this mirrors it exactly, just for a different vendor.

Run: python generate_sribalaji_channel_copies.py
"""
from __future__ import annotations

import json
from pathlib import Path

from generate_anand_channel_copies import render_delivery_note, render_inward_report
from generate_sample_docs import _draw_table, _font, money, render_document
from PIL import Image, ImageDraw

OUT_DIR = Path(__file__).resolve().parent.parent / "Sample" / "generated" / "sribalaji_channel_copies"

BUYER = {
    "name": "B&B Constructions",
    "gstin": "29AACCB7788K1Z9",
    "site": "B&B Constructions - Lakeview Residency, Site 2, Sarjapur Road, Bengaluru, Karnataka - 560035",
}
VENDOR = {
    "name": "Sri Balaji Cements & Sand Suppliers",
    "gstin": "29AAFCB4521Q1Z7",
    "address": "Plot 22, Industrial Layout, Peenya, Bengaluru, Karnataka - 560058",
}
PO_NUMBER = "PO-BNB-2026-0001"
PO_DATE = "01-08-2026"
INV_NUMBER = "INV-7701"
INV_DATE = "08-08-2026"
DC_NUMBER, DC_DATE = "DC-3101", "08-08-2026"

# The original's two lines — description, hsn, qty, unit, rate, tax%.
CEMENT = ("OPC Cement 53 Grade", "2523", 100, "MT", 7200, 28)
SAND = ("M Sand", "2505", 100, "MT", 1500, 5)


def render_invoice_copy(doc_type_label: str, out_path: Path) -> None:
    """Same invoice content as the original, just retitled — the vendor's
    own tax invoice, handed to two different channels. Mirrors
    generate_anand_channel_copies.render_invoice_copy exactly, with this
    module's own VENDOR/BUYER/line constants."""
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


# Sri Balaji's own identity, for the two renderers borrowed from
# generate_anand_channel_copies.py — their `ids` param exists exactly for
# this, so a second vendor's delivery doesn't need its own copy of either
# renderer. See that module's _DEFAULT_IDS.
IDS = {
    "vendor": VENDOR, "buyer": BUYER, "po_number": PO_NUMBER, "po_date": PO_DATE,
    "inv_number": INV_NUMBER, "dc_number": DC_NUMBER, "dc_date": DC_DATE,
}


def build_and_render():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    render_invoice_copy("VENDOR INVOICE", OUT_DIR / "INV-7701_vendor-copy.png")
    render_invoice_copy("SITE INVOICE", OUT_DIR / "INV-7701_site-copy.png")
    render_delivery_note([CEMENT, SAND], OUT_DIR / "DC-3101_delivery-note.png", ids=IDS)
    render_inward_report([CEMENT, SAND], None, OUT_DIR / "DC-3101_inward-report.png", ids=IDS)

    manifest = {
        "po_number": PO_NUMBER, "invoice_number": INV_NUMBER, "dc_number": DC_NUMBER,
        "vendor": VENDOR, "buyer": BUYER,
        "variants": {
            "vendor_copy": {"file": "INV-7701_vendor-copy.png", "lines": [CEMENT, SAND]},
            "site_copy": {"file": "INV-7701_site-copy.png", "lines": [CEMENT, SAND]},
            "delivery_note": {"file": "DC-3101_delivery-note.png", "lines": [CEMENT, SAND]},
            "inward_report": {"file": "DC-3101_inward-report.png", "lines": [CEMENT, SAND]},
        },
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Wrote 4 images + manifest.json to {OUT_DIR}")


if __name__ == "__main__":
    build_and_render()
