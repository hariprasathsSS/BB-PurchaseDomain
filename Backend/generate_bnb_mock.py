"""Mock PO + 3 vendor invoices for B&B Constructions — a one-off fixture set
for exercising the OCR/extraction pipeline manually.

One PO (7 materials, several at large quantities) issued by B&B Constructions,
and three invoices from three different vendors, each independently invoicing
the full cement (100 MT) + M Sand (100 MT) requirement against that PO number.
This is deliberately not arithmetically consistent as a single real order (three
vendors each fully delivering the same line would be triple over-supply) — it is
three independent "does this invoice read as satisfying that PO" test cases, not
a partial-delivery series like generate_sample_docs.py's PO-1042 set.

Output is image files only (no DB writes, no API calls) under
Sample/generated/bnb_mock/, plus a manifest.json with the ground-truth data.

Run: python generate_bnb_mock.py
"""
from __future__ import annotations

import json
from pathlib import Path

from generate_sample_docs import money, render_document

OUT_DIR = Path(__file__).resolve().parent.parent / "Sample" / "generated" / "bnb_mock"

BUYER = {
    "name": "B&B Constructions",
    "gstin": "29AACCB7788K1Z9",
    "site": "B&B Constructions - Lakeview Residency, Site 2, Sarjapur Road, Bengaluru, Karnataka - 560035",
}

PO_NUMBER = "PO-BNB-2026-0001"
PO_DATE = "01-08-2026"

# description, hsn, qty, unit, rate, tax_rate% — several at deliberately large
# quantities, per the request ("add a huge quantity").
PO_LINES = [
    ("OPC Cement 53 Grade", "2523", 100, "MT", 7200, 28),
    ("M Sand", "2505", 100, "MT", 1500, 5),
    ("Ballast 40mm", "2517", 150, "MT", 1100, 5),
    ("Cement Mortar 1:6", "2523", 60, "MT", 3200, 28),
    ("TMT Steel Bar 12mm", "7214", 50, "MT", 62000, 18),
    ("20mm Aggregate", "2517", 80, "Cum", 950, 5),
    ("Red Clay Brick", "6904", 200000, "Nos", 8, 12),
]

# Three different vendors, in two different states relative to the buyer
# (Karnataka, code 29) so the invoices exercise both tax shapes — CGST/SGST
# for an intra-state vendor, IGST for an inter-state one.
VENDORS = [
    {
        "name": "Sri Balaji Cements & Sand Suppliers",
        "gstin": "29AAFCB4521Q1Z7",
        "address": "Plot 22, Industrial Layout, Peenya, Bengaluru, Karnataka - 560058",
        "inv_number": "INV-7701", "inv_date": "08-08-2026", "dc_number": "DC-3101", "dc_date": "08-08-2026",
    },
    {
        "name": "Om Sai Building Materials Trading Co",
        "gstin": "27AABFO9834R1Z1",
        "address": "Gala 5, MIDC Estate, Bhiwandi, Thane, Maharashtra - 421302",
        "inv_number": "INV-4512", "inv_date": "12-08-2026", "dc_number": "DC-3102", "dc_date": "12-08-2026",
    },
    {
        "name": "Anand Enterprises - Construction Supplies",
        "gstin": "29AAKPA3210H1Z4",
        "address": "No. 8, Old Madras Road, KR Puram, Bengaluru, Karnataka - 560036",
        "inv_number": "INV-9088", "inv_date": "15-08-2026", "dc_number": "DC-3103", "dc_date": "15-08-2026",
    },
]

# Every invoice delivers exactly this against the PO — the requirement quoted
# in the request, satisfied in full by each of the three vendors independently.
INVOICE_LINES = [
    ("OPC Cement 53 Grade", "2523", 100, "MT", 7200, 28),
    ("M Sand", "2505", 100, "MT", 1500, 5),
]


def build_and_render():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {
        "po_number": PO_NUMBER, "po_date": PO_DATE,
        "buyer": BUYER, "po_lines": [], "invoices": [],
    }

    # ── the PO ────────────────────────────────────────────────────────────
    po_rows, po_total = [], 0.0
    for desc, hsn, qty, unit, rate, tax in PO_LINES:
        amount = qty * rate
        po_total += amount
        po_rows.append([desc, hsn, qty, unit, money(rate), money(amount)])
        manifest["po_lines"].append({
            "description": desc, "hsn": hsn, "qty": qty, "unit": unit,
            "rate": rate, "amount": amount, "tax_rate": tax,
        })

    render_document(
        doc_type="PURCHASE ORDER",
        doc_number=PO_NUMBER,
        doc_date=PO_DATE,
        issuer={"name": BUYER["name"], "address": BUYER["site"], "gstin": BUYER["gstin"]},
        counterparty_lines=[
            "Delivery Site:", BUYER["site"],
            "Open order — empanelled vendors may supply against this PO number.",
        ],
        ref_line=None,
        table_header=["Description", "HSN", "Qty", "Unit", "Rate", "Amount"],
        table_rows=po_rows,
        col_widths=[360, 100, 110, 110, 180, 180],
        totals=[("Total Order Value", money(po_total))],
        out_path=OUT_DIR / f"PO_BnB-Constructions_{PO_NUMBER}.png",
    )

    # ── one invoice per vendor, each satisfying the cement + M Sand lines ───
    for vendor in VENDORS:
        inv_rows, basic_value, tax_total = [], 0.0, 0.0
        inv_lines_manifest = []
        intra_state = vendor["gstin"][:2] == BUYER["gstin"][:2]

        for desc, hsn, qty, unit, rate, tax in INVOICE_LINES:
            amount = qty * rate
            basic_value += amount
            tax_amt = amount * tax / 100
            tax_total += tax_amt
            inv_rows.append([
                desc, hsn, qty, unit, money(rate), money(amount), f"{tax}%", vendor["dc_number"],
            ])
            inv_lines_manifest.append({
                "description": desc, "hsn": hsn, "qty": qty, "unit": unit,
                "rate": rate, "amount": amount, "tax_rate": tax,
                "dc_number": vendor["dc_number"], "dc_date": vendor["dc_date"],
            })

        totals_rows = [("Basic Value", money(basic_value))]
        if intra_state:
            cgst = round(tax_total / 2, 2)
            sgst = round(tax_total - cgst, 2)
            tax_shape = {"tax_type": "CGST_SGST", "cgst_amount": cgst, "sgst_amount": sgst, "igst_amount": None}
            totals_rows += [("CGST", money(cgst)), ("SGST", money(sgst))]
        else:
            igst = round(tax_total, 2)
            tax_shape = {"tax_type": "IGST", "cgst_amount": None, "sgst_amount": None, "igst_amount": igst}
            totals_rows += [("IGST", money(igst))]

        raw_total = basic_value + tax_total
        total_value = round(raw_total)
        rounding_off = round(total_value - raw_total, 2)
        totals_rows += [("Round Off", money(rounding_off)), ("Total Value", money(total_value))]

        render_document(
            doc_type="TAX INVOICE",
            doc_number=vendor["inv_number"],
            doc_date=vendor["inv_date"],
            issuer={"name": vendor["name"], "address": vendor["address"], "gstin": vendor["gstin"]},
            counterparty_lines=["Buyer:", BUYER["name"], f"Site: {BUYER['site']}", f"GSTIN: {BUYER['gstin']}"],
            ref_line=f"Against PO No: {PO_NUMBER} dt. {PO_DATE}   |   D.C. No: {vendor['dc_number']} dt. {vendor['dc_date']}",
            table_header=["Description", "HSN", "Qty", "Unit", "Rate", "Amount", "Tax%", "DC No"],
            table_rows=inv_rows,
            col_widths=[280, 90, 90, 90, 130, 150, 80, 140],
            totals=totals_rows,
            out_path=OUT_DIR / f"INV_{vendor['name'].split()[0]}_{vendor['inv_number']}.png",
        )

        manifest["invoices"].append({
            "vendor": {"name": vendor["name"], "gstin": vendor["gstin"], "address": vendor["address"]},
            "invoice_number": vendor["inv_number"], "invoice_date": vendor["inv_date"],
            "po_number": PO_NUMBER, "dc_number": vendor["dc_number"], "dc_date": vendor["dc_date"],
            "lines": inv_lines_manifest,
            "basic_value": basic_value, "rounding_off": rounding_off, "total_value": total_value,
            **tax_shape,
        })

    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Wrote 1 PO + {len(VENDORS)} invoice images + manifest.json to {OUT_DIR}")


if __name__ == "__main__":
    build_and_render()
