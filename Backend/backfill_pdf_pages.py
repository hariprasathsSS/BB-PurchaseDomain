"""One-off: render page images for documents stored as a PDF.

PDFs used to be stored as-is, which left three things broken — the OpenAI
provider could not read them, the review screen rendered <img> against a .pdf
path, and page_count was recorded as 1 however many pages there were. Uploads
now render pages at intake; this does the same for rows that predate that.

    python backfill_pdf_pages.py            # say what would change
    python backfill_pdf_pages.py --apply    # do it

Idempotent: a row whose file_paths already hold images is skipped, so it is
safe to run twice.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import db
import media
import pdfpages

BASE_DIR = Path(__file__).resolve().parent


def pdf_rows(con):
    rows = con.execute("SELECT id, file_paths, page_count, status FROM documents").fetchall()
    return [r for r in rows if any(media.is_pdf(p) for p in json.loads(r["file_paths"]))]


def main(apply: bool) -> int:
    with db.db() as con:
        rows = pdf_rows(con)
        if not rows:
            print("nothing to do — no document is stored as a PDF")
            return 0

        print(f"{len(rows)} document(s) stored as PDF\n")
        touched = 0

        for row in rows:
            paths = json.loads(row["file_paths"])
            print(f"{row['id']}  [{row['status']}]  {paths}")

            rendered: list[str] = []
            failed = False

            for path in paths:
                if not media.is_pdf(path):
                    rendered.append(path)      # an image page beside the PDF: keep it
                    continue

                full = BASE_DIR / path
                if not full.exists():
                    print(f"  ! missing from disk, leaving alone: {path}")
                    failed = True
                    break

                # The original keeps the name the new intake path would give it,
                # so a backfilled row is indistinguishable from a fresh upload.
                source = full.with_name(f"{full.stem}_src.pdf")
                try:
                    names = pdfpages.render(full, full.parent, row["id"], len(rendered) + 1)
                except pdfpages.PdfUnreadable as exc:
                    print(f"  ! {exc}")
                    failed = True
                    break

                rendered.extend(f"uploads/{full.parent.name}/{n}" for n in names)
                if apply:
                    full.rename(source)
                print(f"  -> {len(names)} page(s): {names}")

            if failed or not apply:
                continue

            con.execute(
                "UPDATE documents SET file_paths = ?, page_count = ? WHERE id = ?",
                (json.dumps(rendered), len(rendered), row["id"]),
            )
            touched += 1

        if apply:
            print(f"\nupdated {touched} row(s)")
            print("re-run extraction on them from the console, or POST .../extract")
        else:
            print("\ndry run — nothing written. pass --apply to commit.")
        return 0


if __name__ == "__main__":
    sys.exit(main(apply="--apply" in sys.argv))
