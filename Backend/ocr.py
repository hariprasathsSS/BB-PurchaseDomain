"""Optional local OCR cross-check via Docling — controlled only by
ENABLE_OCR in .env, read once at startup. No runtime toggle on purpose —
restart the server to change it.

Docling pulls in torch and a real model stack (layout detection, table
structure, OCR) — nothing here imports it until read_page() actually runs
with ENABLED true, so leaving this off costs nothing at startup or on any
request.

Verified once, live, against a real invoice page: correct on every number
that mattered (both GSTINs kept distinct, quantity, rate, CGST/SGST,
total) but ~48s/page even with its models already cached, and not
immune to its own misreads (a ₹ symbol came back as a stray CJK character
in one run). So this is wired into run_engine as a second, cross-checked
opinion alongside the vision model's own read — never a replacement for
it, and never allowed to block extraction if it fails or times out.
"""

from __future__ import annotations

import os
from pathlib import Path

ENABLED = os.environ.get("ENABLE_OCR", "false").strip().lower() in ("1", "true", "yes")

# Every OCR read's raw markdown, kept for your own reference — never linked
# from any API response or served as a static file, so nothing in the app
# itself ever points here.
EXTRACT_DIR = Path(__file__).resolve().parent / "ocr_extract"

_converter = None


def _get_converter():
    global _converter
    if _converter is None:
        from docling.document_converter import DocumentConverter
        _converter = DocumentConverter()
    return _converter


def read_page(image_path: str) -> str | None:
    """Docling's markdown read of one page, or None if OCR is off or the
    read itself fails. A bad or slow OCR pass must never block extraction —
    the vision model's own read stays the primary source of truth either
    way, so a caller treats None exactly like "no OCR text available".

    Also saved to EXTRACT_DIR as its own .md file, named after the source
    page image, purely for manual inspection later — that save is best
    effort too, since a disk hiccup there is no reason to throw away an
    OCR read that otherwise succeeded.
    """
    if not ENABLED:
        return None
    try:
        result = _get_converter().convert(image_path)
        text = result.document.export_to_markdown()
    except Exception:
        return None
    try:
        EXTRACT_DIR.mkdir(parents=True, exist_ok=True)
        out_path = EXTRACT_DIR / f"{Path(image_path).stem}.md"
        out_path.write_text(text, encoding="utf-8")
    except OSError:
        pass
    return text
