"""Generate a construction-site sample document set for the extraction pipeline.

One PO (PO-1042, 6 construction materials) fulfilled across two Delivery
Challans and two Invoices (60/40 split), all cross-referencing the PO number
and, per invoice line, the delivering challan's number/date. Output is image
files only (no DB writes, no API calls) under Sample/generated/, plus a
manifest.json with the ground-truth data for eyeballing extraction results.

Run: python generate_sample_docs.py
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT_DIR = Path(__file__).resolve().parent.parent / "Sample" / "generated"
FONT_DIR = Path("C:/Windows/Fonts")

VENDOR = {
    "name": "Sri Balaji Building Materials Pvt Ltd",
    "gstin": "29AABCS5678F1Z2",
    "address": "Plot 14, Industrial Area, Peenya, Bengaluru, Karnataka - 560058",
}
BUYER = {
    "name": "ACME Constructions Pvt Ltd",
    "gstin": "29AAACA9988B1Z4",
    "site": "ACME Riverfront Residency, Site B, Whitefield, Bengaluru, Karnataka - 560066",
}

PO_NUMBER = "PO-1042"
PO_DATE = "10-07-2026"

# description, hsn, qty, unit, rate, tax_rate%
PO_LINES = [
    ("OPC Cement 53 Grade", "2523", 500, "Bags", 380, 28),
    ("TMT Steel Bar 12mm", "7214", 20, "MT", 62000, 18),
    ("TMT Steel Bar 16mm", "7214", 15, "MT", 61500, 18),
    ("River Sand", "2505", 100, "Tons", 1450, 5),
    ("20mm Aggregate", "2517", 80, "Cum", 950, 5),
    ("Red Clay Brick", "6904", 50000, "Nos", 8, 12),
]

SPLITS = [
    {"dc_number": "DC-2201", "dc_date": "18-07-2026", "inv_number": "INV-5501", "inv_date": "19-07-2026", "fraction": 0.6},
    {"dc_number": "DC-2202", "dc_date": "25-07-2026", "inv_number": "INV-5502", "inv_date": "26-07-2026", "fraction": 0.4},
]

# ponytail: fractions must fully account for every PO line's quantity, else the
# generated DC+Invoice pairs would silently under/over-deliver the PO.
for _desc, _hsn, _qty, _unit, _rate, _tax in PO_LINES:
    _delivered = sum(round(_qty * s["fraction"]) for s in SPLITS)
    assert _delivered == _qty, f"split mismatch for {_desc}: {_delivered} != {_qty}"


def _font(bold=False, size=17):
    name = "arialbd.ttf" if bold else "arial.ttf"
    try:
        return ImageFont.truetype(str(FONT_DIR / name), size)
    except OSError:
        return ImageFont.load_default()


def money(v):
    return f"{v:,.2f}"


def _draw_table(draw, x, y, col_widths, header, rows, row_h=34):
    f_head, f_body = _font(bold=True, size=16), _font(size=15)
    n_rows = len(rows) + 1
    total_w = sum(col_widths)
    xs = [x]
    for w in col_widths:
        xs.append(xs[-1] + w)

    draw.rectangle([x, y, x + total_w, y + row_h * n_rows], outline="black", width=2)
    draw.line([x, y + row_h, x + total_w, y + row_h], fill="black", width=2)
    for i in range(1, len(col_widths)):
        draw.line([xs[i], y, xs[i], y + row_h * n_rows], fill="black", width=1)
    for i, text in enumerate(header):
        draw.text((xs[i] + 6, y + 8), text, font=f_head, fill="black")
    for r, row in enumerate(rows):
        ry = y + row_h * (r + 1)
        if r > 0:
            draw.line([x, ry, x + total_w, ry], fill="black", width=1)
        for i, cell in enumerate(row):
            draw.text((xs[i] + 6, ry + 8), str(cell), font=f_body, fill="black")
    return y + row_h * n_rows


def render_document(
    doc_type, doc_number, doc_date, issuer, counterparty_lines, ref_line,
    table_header, table_rows, col_widths, totals, out_path,
):
    W, H = 1240, 1650
    img = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(img)
    f_title, f_h2, f_body = _font(bold=True, size=30), _font(bold=True, size=20), _font(size=17)

    y = 40
    d.text((40, y), issuer["name"], font=f_h2, fill="black"); y += 28
    d.text((40, y), issuer["address"], font=f_body, fill="black"); y += 24
    d.text((40, y), f"GSTIN: {issuer['gstin']}", font=f_body, fill="black"); y += 40

    d.line([40, y, W - 40, y], fill="black", width=2); y += 20
    title_w = d.textlength(doc_type, font=f_title)
    d.text(((W - title_w) / 2, y), doc_type, font=f_title, fill="black"); y += 50
    d.line([40, y, W - 40, y], fill="black", width=2); y += 20

    d.text((40, y), f"No: {doc_number}", font=f_h2, fill="black")
    d.text((W - 340, y), f"Date: {doc_date}", font=f_h2, fill="black")
    y += 36

    if ref_line:
        d.text((40, y), ref_line, font=f_h2, fill="black")
        y += 32

    for line in counterparty_lines:
        d.text((40, y), line, font=f_body, fill="black")
        y += 24
    y += 20

    y = _draw_table(d, 40, y, col_widths, table_header, table_rows) + 30

    if totals:
        for label, value in totals:
            text = f"{label}: {value}"
            w = d.textlength(text, font=f_h2)
            d.text((W - 40 - w, y), text, font=f_h2, fill="black")
            y += 30

    sig_y = H - 100
    d.line([W - 340, sig_y, W - 40, sig_y], fill="black", width=1)
    d.text((W - 340, sig_y + 8), "Authorised Signatory", font=f_body, fill="black")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)


def build_and_render():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {
        "po_number": PO_NUMBER, "po_date": PO_DATE,
        "vendor": VENDOR, "buyer": BUYER,
        "po_lines": [], "splits": [],
    }

    po_rows, po_total = [], 0.0
    for desc, hsn, qty, unit, rate, tax in PO_LINES:
        amount = qty * rate
        po_total += amount
        po_rows.append([desc, hsn, qty, unit, money(rate), money(amount)])
        manifest["po_lines"].append(
            {"description": desc, "hsn": hsn, "qty": qty, "unit": unit, "rate": rate, "amount": amount, "tax_rate": tax}
        )

    render_document(
        doc_type="PURCHASE ORDER",
        doc_number=PO_NUMBER,
        doc_date=PO_DATE,
        issuer={"name": BUYER["name"], "address": BUYER["site"], "gstin": BUYER["gstin"]},
        counterparty_lines=[
            "To (Supplier):", VENDOR["name"], VENDOR["address"], f"GSTIN: {VENDOR['gstin']}",
            f"Delivery Site: {BUYER['site']}",
        ],
        ref_line=None,
        table_header=["Description", "HSN", "Qty", "Unit", "Rate", "Amount"],
        table_rows=po_rows,
        col_widths=[380, 100, 110, 110, 180, 180],
        totals=[("Total Order Value", money(po_total))],
        out_path=OUT_DIR / f"PO_ACME-Constructions_{PO_NUMBER}.png",
    )

    for split in SPLITS:
        frac = split["fraction"]
        dc_rows, inv_rows, inv_lines_manifest = [], [], []
        basic_value = tax_total = 0.0
        for desc, hsn, qty, unit, rate, tax in PO_LINES:
            split_qty = round(qty * frac)
            amount = split_qty * rate
            basic_value += amount
            tax_amt = amount * tax / 100
            tax_total += tax_amt
            dc_rows.append([desc, hsn, split_qty, unit])
            inv_rows.append([desc, hsn, split_qty, unit, money(rate), money(amount), f"{tax}%", split["dc_number"]])
            inv_lines_manifest.append({
                "description": desc, "hsn": hsn, "qty": split_qty, "unit": unit,
                "rate": rate, "amount": amount, "tax_rate": tax,
                "dc_number": split["dc_number"], "dc_date": split["dc_date"],
            })

        cgst = round(tax_total / 2, 2)
        sgst = round(tax_total - cgst, 2)
        raw_total = basic_value + cgst + sgst
        total_value = round(raw_total)
        rounding_off = round(total_value - raw_total, 2)

        render_document(
            doc_type="DELIVERY CHALLAN",
            doc_number=split["dc_number"],
            doc_date=split["dc_date"],
            issuer={"name": VENDOR["name"], "address": VENDOR["address"], "gstin": VENDOR["gstin"]},
            counterparty_lines=["Consignee:", BUYER["name"], f"Site: {BUYER['site']}", f"GSTIN: {BUYER['gstin']}"],
            ref_line=f"Against PO No: {PO_NUMBER} dt. {PO_DATE}",
            table_header=["Description", "HSN", "Qty", "Unit"],
            table_rows=dc_rows,
            col_widths=[460, 120, 150, 150],
            totals=None,
            out_path=OUT_DIR / f"DC_ACME-Constructions_{split['dc_number']}.png",
        )

        render_document(
            doc_type="TAX INVOICE",
            doc_number=split["inv_number"],
            doc_date=split["inv_date"],
            issuer={"name": VENDOR["name"], "address": VENDOR["address"], "gstin": VENDOR["gstin"]},
            counterparty_lines=["Buyer:", BUYER["name"], f"Site: {BUYER['site']}", f"GSTIN: {BUYER['gstin']}"],
            ref_line=f"Against PO No: {PO_NUMBER} dt. {PO_DATE}   |   D.C. No: {split['dc_number']} dt. {split['dc_date']}",
            table_header=["Description", "HSN", "Qty", "Unit", "Rate", "Amount", "Tax%", "DC No"],
            table_rows=inv_rows,
            col_widths=[300, 90, 90, 90, 130, 150, 80, 140],
            totals=[
                ("Basic Value", money(basic_value)),
                ("CGST", money(cgst)),
                ("SGST", money(sgst)),
                ("Round Off", money(rounding_off)),
                ("Total Value", money(total_value)),
            ],
            out_path=OUT_DIR / f"INV_ACME-Constructions_{split['inv_number']}.png",
        )

        manifest["splits"].append({
            "dc_number": split["dc_number"], "dc_date": split["dc_date"],
            "invoice_number": split["inv_number"], "invoice_date": split["inv_date"],
            "lines": inv_lines_manifest,
            "basic_value": basic_value, "cgst": cgst, "sgst": sgst,
            "rounding_off": rounding_off, "total_value": total_value,
        })

    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Wrote 5 document images + manifest.json to {OUT_DIR}")


if __name__ == "__main__":
    build_and_render()
