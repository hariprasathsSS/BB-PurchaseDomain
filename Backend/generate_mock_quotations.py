"""5 vendor quotation letters for Quote Analysis manual testing — cement, sand,
ballast (20mm aggregate) and TMT steel bar, each vendor quoting a different
grade/brand for the steel line so the comparison has something real to show.

Deliberately one-specialty-each: every vendor undercuts everyone else on
exactly one material and is pricier than the eventual winner on the other
three — so the comparison has to recommend four *different* vendors, one per
material, never a single "cheapest overall" supplier. The fifth vendor (Om
Sakthi) never wins anything, to prove a non-competitive vendor is correctly
skipped rather than picked by default.

  Sri Balaji Building Materials -> cheapest CEMENT
  Chennai Traders               -> cheapest SAND
  SSPDL Building Supplies       -> cheapest STEEL (Fe415 — a lower grade,
                                    not just a lower price; the other three
                                    steel quotes are Fe500/Fe500D/Fe550D)
  Kaveri Infra Materials        -> cheapest BALLAST
  Om Sakthi Traders             -> never cheapest on anything

Output is image files only (no DB writes, no API calls) under
Sample/generated/quotations/, plus a manifest.json with the ground-truth
numbers to check extraction against.

Run: python generate_mock_quotations.py
"""
from __future__ import annotations

import json
from pathlib import Path

from generate_sample_docs import money, render_document

OUT_DIR = Path(__file__).resolve().parent.parent / "Sample" / "generated" / "quotations"

BUYER = {
    "name": "B&B Constructions",
    "site": "B&B Constructions — Lakeview Residency, Site 2, Sarjapur Road, Bengaluru, Karnataka - 560035",
}

# Same four materials, same quantities, every vendor — so the rates actually
# compare apples to apples. Only steel's grade varies per vendor; a real RFQ
# would specify the grade wanted, but the point here is exercising grade_raw
# as a field extraction has to read off the page, not asserting a business
# rule about vendors offering off-spec substitutes.
QTY = {"cement": 500, "sand": 100, "ballast": 80, "steel": 20}

VENDORS = [
    {
        "name": "Sri Balaji Building Materials Pvt Ltd",
        "gstin": "29AABCS5678F1Z2",
        "address": "Plot 14, Industrial Area, Peenya, Bengaluru, Karnataka - 560058",
        "quote_no": "SBM-Q-2201", "quote_date": "03-08-2026",
        # Specialty: CEMENT (360 undercuts everyone). Pricier on the rest.
        "rates": {"cement": 360, "sand": 1560, "ballast": 960, "steel": 61500},
        "steel_grade": "Fe550D",
    },
    {
        "name": "Chennai Traders",
        "gstin": "33AABFC4521Q1Z8",
        "address": "No. 7, GST Road, Guindy, Chennai, Tamil Nadu - 600032",
        "quote_no": "CHT-Q-0087", "quote_date": "04-08-2026",
        # Specialty: SAND (1350 undercuts everyone). Pricier on the rest.
        "rates": {"cement": 410, "sand": 1350, "ballast": 990, "steel": 62000},
        "steel_grade": "Fe500",
    },
    {
        "name": "SSPDL Building Supplies",
        "gstin": "33AADFS1123M1Z6",
        "address": "Plot 9, SIDCO Estate, Ambattur, Chennai, Tamil Nadu - 600098",
        "quote_no": "SBS-Q-0512", "quote_date": "05-08-2026",
        # Specialty: STEEL (54500 undercuts everyone) — a lower grade, not
        # just a lower price. Pricier on the rest.
        "rates": {"cement": 405, "sand": 1580, "ballast": 970, "steel": 54500},
        "steel_grade": "Fe415",
    },
    {
        "name": "Kaveri Infra Materials",
        "gstin": "29AAECK7788N1Z4",
        "address": "Survey No. 112, Bommasandra Industrial Area, Bengaluru, Karnataka - 560099",
        "quote_no": "KIM-Q-4470", "quote_date": "04-08-2026",
        # Specialty: BALLAST (880 undercuts everyone). Pricier on the rest.
        "rates": {"cement": 398, "sand": 1540, "ballast": 880, "steel": 60800},
        "steel_grade": "Fe550",
    },
    {
        "name": "Om Sakthi Traders",
        "gstin": "33AABFO9834R1Z1",
        "address": "24 Anna Salai, Teynampet, Chennai, Tamil Nadu - 600018",
        "quote_no": "OST-Q-3391", "quote_date": "03-08-2026",
        # No specialty — competitive-looking but never actually cheapest on
        # anything, to prove the comparison correctly skips a vendor rather
        # than defaulting to the last one read or the one with the lowest
        # total.
        "rates": {"cement": 395, "sand": 1500, "ballast": 940, "steel": 59000},
        "steel_grade": "Fe500D",
    },
]


def build_and_render():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {"buyer": BUYER, "quantities": QTY, "quotations": []}

    for vendor in VENDORS:
        r = vendor["rates"]
        lines = [
            ("OPC Cement 53 Grade", "53 Grade — UltraTech", QTY["cement"], "Bags", r["cement"]),
            ("River Sand", "Natural river sand", QTY["sand"], "Tons", r["sand"]),
            ("20mm Aggregate (Ballast)", "20mm graded", QTY["ballast"], "Cum", r["ballast"]),
            ("TMT Steel Bar 12mm", vendor["steel_grade"], QTY["steel"], "MT", r["steel"]),
        ]

        table_rows, total = [], 0.0
        manifest_lines = []
        for desc, grade, qty, unit, rate in lines:
            amount = qty * rate
            total += amount
            table_rows.append([desc, grade, qty, unit, money(rate), money(amount)])
            manifest_lines.append({
                "description": desc, "grade": grade, "quantity": qty, "unit": unit,
                "rate": rate, "amount": amount,
            })

        safe_name = vendor["name"].split()[0].upper()
        render_document(
            doc_type="RATE QUOTATION",
            doc_number=vendor["quote_no"],
            doc_date=vendor["quote_date"],
            issuer={"name": vendor["name"], "address": vendor["address"], "gstin": vendor["gstin"]},
            counterparty_lines=[
                "To:", BUYER["name"], f"Site: {BUYER['site']}",
                "Re: Rate quotation for cement, sand, ballast and TMT steel bar",
            ],
            ref_line="Valid for 15 days from the date above. Rates exclusive of GST.",
            table_header=["Material", "Grade / Brand", "Qty", "Unit", "Rate", "Amount"],
            table_rows=table_rows,
            col_widths=[300, 210, 90, 90, 150, 180],
            totals=[("Total Quotation Value", money(total))],
            out_path=OUT_DIR / f"QUOTE_{safe_name}_{vendor['quote_no']}.png",
        )

        manifest["quotations"].append({
            "vendor": vendor["name"], "gstin": vendor["gstin"],
            "quote_no": vendor["quote_no"], "quote_date": vendor["quote_date"],
            "lines": manifest_lines, "total": total,
        })

    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Wrote {len(VENDORS)} quotation images + manifest.json to {OUT_DIR}")


if __name__ == "__main__":
    build_and_render()
