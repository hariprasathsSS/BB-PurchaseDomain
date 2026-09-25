"""3 variant scans of a real invoice already in poc.db (INV-7701, Sri Balaji
Cements & Sand Suppliers) — same vendor letterhead and invoice number as the
original, each missing a different subset of its two line items, for testing
the duplicate-invoice line-item cross-check (Backend/main.py's
/duplicate-diff endpoint) with something more real than a shared placeholder
scan.

Same vendor data generate_bnb_mock.py used to originally produce INV-7701, so
this reads as a second, independent scan of the "same" paper rather than a
different document.

Output is image files under Sample/generated/invoice_duplicates/, plus a
manifest.json. Run this, then re-run the DB-side script that points each
duplicate document's file_paths at its own image here instead of sharing the
original's.

Run: python generate_invoice_duplicates.py
"""
from __future__ import annotations

import json
from pathlib import Path

from generate_sample_docs import money, render_document

OUT_DIR = Path(__file__).resolve().parent.parent / "Sample" / "generated" / "invoice_duplicates"

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

# Which lines each variant actually shows — matching the 3 duplicate
# documents already created in poc.db (DOC-244109b84e / DOC-6a3ddc0bf1 /
# DOC-1554df072c): one missing sand, one missing cement, one missing both.
VARIANTS = [
    ("missing-sand", [CEMENT]),
    ("missing-cement", [SAND]),
    ("missing-both", []),
]


def render_invoice(lines: list[tuple], out_path: Path) -> dict:
    rows, basic_value, tax_total = [], 0.0, 0.0
    manifest_lines = []
    for desc, hsn, qty, unit, rate, tax in lines:
        amount = qty * rate
        basic_value += amount
        tax_amt = amount * tax / 100
        tax_total += tax_amt
        rows.append([desc, hsn, qty, unit, money(rate), money(amount), f"{tax}%", DC_NUMBER])
        manifest_lines.append({
            "description": desc, "hsn": hsn, "qty": qty, "unit": unit,
            "rate": rate, "amount": amount, "tax_rate": tax,
        })

    cgst = round(tax_total / 2, 2)
    sgst = round(tax_total - cgst, 2)
    raw_total = basic_value + tax_total
    total_value = round(raw_total)
    rounding_off = round(total_value - raw_total, 2)

    render_document(
        doc_type="TAX INVOICE",
        doc_number=INV_NUMBER,
        doc_date=INV_DATE,
        issuer={"name": VENDOR["name"], "address": VENDOR["address"], "gstin": VENDOR["gstin"]},
        counterparty_lines=["Buyer:", BUYER["name"], f"Site: {BUYER['site']}", f"GSTIN: {BUYER['gstin']}"],
        ref_line=f"Against PO No: {PO_NUMBER} dt. {PO_DATE}   |   D.C. No: {DC_NUMBER} dt. {DC_DATE}",
        table_header=["Description", "HSN", "Qty", "Unit", "Rate", "Amount", "Tax%", "DC No"],
        table_rows=rows if rows else [["— no line items on this scan —", "", "", "", "", "", "", ""]],
        col_widths=[280, 90, 90, 90, 130, 150, 80, 140],
        totals=[
            ("Basic Value", money(basic_value)), ("CGST", money(cgst)), ("SGST", money(sgst)),
            ("Round Off", money(rounding_off)), ("Total Value", money(total_value)),
        ] if rows else None,
        out_path=out_path,
    )
    return {"lines": manifest_lines, "basic_value": basic_value, "total_value": total_value if rows else 0}


def build_and_render():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {"invoice_number": INV_NUMBER, "vendor": VENDOR, "po_number": PO_NUMBER, "variants": {}}

    for label, lines in VARIANTS:
        out_path = OUT_DIR / f"INV-7701_{label}.png"
        manifest["variants"][label] = render_invoice(lines, out_path) | {"file": out_path.name}

    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Wrote {len(VARIANTS)} invoice variants + manifest.json to {OUT_DIR}")


if __name__ == "__main__":
    build_and_render()
