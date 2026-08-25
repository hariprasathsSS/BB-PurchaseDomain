"""What kind of file is this, and what is it called on the wire?

One table instead of three: main.py used to keep ALLOWED_EXT and _MAGIC_BYTES
while extract.py kept its own _MEDIA_TYPES, and nothing kept them in step.

Identification reads the bytes. A filename is a hint from a client, and a
client can call a PNG whatever it likes — at a trust boundary the content is
the only thing worth believing. That is the reverse of the old check, which
read the extension first and then confirmed the magic matched: a file arriving
with no filename at all was assumed to be a JPEG, so a perfectly good PNG from
a phone was rejected for "not matching its .jpg extension".
"""

from __future__ import annotations

from pathlib import Path
from typing import NamedTuple


class Kind(NamedTuple):
    name: str         # how a person would say it
    media_type: str   # what the model APIs want
    ext: str          # what we store it as — always the canonical spelling


PNG = Kind("PNG", "image/png", ".png")
JPEG = Kind("JPEG", "image/jpeg", ".jpg")
PDF = Kind("PDF", "application/pdf", ".pdf")

# ponytail: literal byte prefixes rather than the stdlib imghdr module — imghdr
# is gone as of Python 3.13, and this only ever needs to tell three formats
# apart. Longest signature first so nothing shadows anything shorter.
_SIGNATURES: tuple[tuple[bytes, Kind], ...] = (
    (b"\x89PNG\r\n\x1a\n", PNG),
    (b"\xff\xd8\xff", JPEG),
    (b"%PDF", PDF),
)

# How much of a file has to be read before it can be identified.
HEADER_BYTES = max(len(signature) for signature, _ in _SIGNATURES)

# For error messages, so the wording and the reality cannot drift apart.
ACCEPTED = ", ".join(kind.name for _, kind in _SIGNATURES)

IMAGE_KINDS = (PNG, JPEG)


def identify(head: bytes) -> Kind | None:
    """The kind these bytes actually are, or None if we do not read it."""
    for signature, kind in _SIGNATURES:
        if head.startswith(signature):
            return kind
    return None


# Both spellings of the JPEG suffix resolve, because files stored before this
# module existed were written as ".jpeg" when the client said so.
_BY_EXT = {kind.ext: kind for _, kind in _SIGNATURES} | {".jpeg": JPEG}


def kind_for(path: str | Path) -> Kind:
    """The kind of a file already on disk, from its stored extension.

    Trusting the extension is safe *here* precisely because identify() chose
    it when the file was written — these are our names, not a client's.
    """
    kind = _BY_EXT.get(Path(path).suffix.lower())
    if kind is None:
        raise ValueError(f"cannot read {Path(path).suffix!r} as a document page")
    return kind


def media_type_for(path: str | Path) -> str:
    return kind_for(path).media_type


def is_pdf(path: str | Path) -> bool:
    return Path(path).suffix.lower() == ".pdf"


# ── self-check: identification is a trust boundary, so it gets asserts ───────

if __name__ == "__main__":
    assert identify(b"\x89PNG\r\n\x1a\nrest") is PNG
    assert identify(b"\xff\xd8\xff\xe0junk") is JPEG
    assert identify(b"%PDF-1.7") is PDF

    # The point of reading content: the name is not evidence.
    assert identify(b"\x89PNG\r\n\x1a\n") is PNG, "a PNG is a PNG whatever it is called"
    assert identify(b"") is None
    assert identify(b"GIF89a") is None, "we do not read GIFs — say so rather than guess"
    assert identify(b"PK\x03\x04") is None, "a zip is not a document page"

    # A short read must never identify by accident.
    assert identify(b"%PD") is None
    assert len(b"\x89PNG\r\n\x1a\n") == HEADER_BYTES

    assert media_type_for("a/b/DOC-1_p1.png") == "image/png"
    assert media_type_for("DOC-1_p1.JPG") == "image/jpeg", "extension case must not matter"
    assert media_type_for("legacy_p1.jpeg") == "image/jpeg", "older rows spelled it .jpeg"
    assert is_pdf("DOC-1_src.pdf") and not is_pdf("DOC-1_p1.png")

    try:
        media_type_for("notes.txt")
    except ValueError:
        pass
    else:
        raise AssertionError("an unknown extension must raise, not default to something")

    print("media.py: all checks passed")
