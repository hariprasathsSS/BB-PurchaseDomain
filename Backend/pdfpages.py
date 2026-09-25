"""Turn a PDF into page images.

The extraction engine reads pixels, and one provider's vision input takes
images only. Rather than teach every reader downstream about PDFs, a PDF is
rendered to pages once — at upload — and everything after it sees exactly what
it sees for a photo from the site phone: a list of image paths.

That also fixes two things that were never really about extraction: the review
screen renders its pages with <img>, and page_count was recorded as 1 for a
PDF however many pages it had.

pypdfium2 rather than PyMuPDF: both ship self-contained wheels (no Poppler on
the site box, which rules out pdf2image), but PyMuPDF is AGPL and this is
commercial work. pypdfium2 is Apache/BSD.
"""

from __future__ import annotations

import os
from pathlib import Path

import pypdfium2

# Enough for a laser-printed GST invoice without inflating the image tokens a
# vision model is billed for. Raise it for third-generation photocopies.
DPI = int(os.environ.get("PDF_DPI", "200"))
# Every page is an image, and every image costs tokens, so a 300-page catalogue
# uploaded by accident must not quietly become 300 model calls' worth of input.
MAX_PAGES = int(os.environ.get("PDF_MAX_PAGES", "20"))


class PdfUnreadable(Exception):
    """Carries a message meant for the person who just picked the file."""


def page_count(pdf_path: str | Path) -> int:
    with _open(pdf_path) as doc:
        return len(doc)


def render(
    pdf_path: str | Path,
    out_dir: str | Path,
    stem: str,
    start_page: int = 1,
    dpi: int | None = None,
    max_pages: int | None = None,
) -> list[str]:
    """Render every page to a PNG beside the original. Returns the filenames.

    Filenames only, not stored paths — how a page path is spelled is the
    caller's convention, not this module's business.

    start_page exists because one document can be several uploads: three photos
    and a PDF posted together are one document, and the PDF's pages have to
    carry on from where the photos stopped rather than collide with them.
    """
    dpi = DPI if dpi is None else dpi
    max_pages = MAX_PAGES if max_pages is None else max_pages
    out_dir = Path(out_dir)

    with _open(pdf_path) as doc:
        total = len(doc)
        if total == 0:
            raise PdfUnreadable("this PDF has no pages in it")
        if total > max_pages:
            raise PdfUnreadable(
                f"this PDF has {total} pages and the limit is {max_pages} — "
                "split it, or upload the pages that matter"
            )

        names = []
        for index in range(total):
            # PDF user space is 72 dpi, so this is the scale that gets us to dpi.
            bitmap = doc[index].render(scale=dpi / 72)
            name = f"{stem}_p{start_page + index}.png"
            bitmap.to_pil().save(out_dir / name)
            names.append(name)

    return names


def _open(pdf_path: str | Path):
    """Every way a PDF can refuse to open, reported in words a person can act on."""
    try:
        return pypdfium2.PdfDocument(str(pdf_path))
    except pypdfium2.PdfiumError as exc:
        if "password" in str(exc).lower():
            raise PdfUnreadable(
                "this PDF is password-protected — save an unlocked copy and upload that"
            ) from exc
        raise PdfUnreadable(f"this PDF could not be read — {exc}") from exc
    except Exception as exc:                      # noqa: BLE001 — a bad upload, not a bug
        raise PdfUnreadable(f"this PDF could not be read — {exc}") from exc


# ── self-check ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)

        # A real two-page PDF, built rather than committed as a fixture.
        pdf = pypdfium2.PdfDocument.new()
        for _ in range(2):
            pdf.new_page(300, 400)
        sample = tmp / "sample.pdf"
        pdf.save(str(sample))
        pdf.close()

        assert page_count(sample) == 2

        names = render(sample, tmp, "DOC-x")
        assert names == ["DOC-x_p1.png", "DOC-x_p2.png"], names
        assert all((tmp / n).exists() for n in names)

        # Pages carry on from earlier uploads in the same document.
        assert render(sample, tmp, "DOC-y", start_page=4) == ["DOC-y_p4.png", "DOC-y_p5.png"]

        # The rendered page is actually at the requested scale, not page units.
        from PIL import Image
        with Image.open(tmp / "DOC-x_p1.png") as img:
            assert img.width > 300, f"rendered at page units, not {DPI} dpi: {img.size}"

        # The cost guard holds.
        try:
            render(sample, tmp, "DOC-z", max_pages=1)
        except PdfUnreadable as exc:
            assert "limit is 1" in str(exc), exc
        else:
            raise AssertionError("a PDF over the page cap must be refused")

        # Rubbish in must produce a message, not a traceback.
        junk = tmp / "junk.pdf"
        junk.write_bytes(b"%PDF-1.4 and then nothing that parses")
        try:
            render(junk, tmp, "DOC-junk")
        except PdfUnreadable:
            pass
        else:
            raise AssertionError("a corrupt PDF must raise PdfUnreadable")

    print("pdfpages.py: all checks passed")
