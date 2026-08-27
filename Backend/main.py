"""Construction Purchase POC — HTTP layer.

Receives documents from the mobile scanner and from the web console, stores the
pixels on local disk, and hands each one to extraction in the background.

    python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

This module owns HTTP only. Storage lives in db.py, extraction in extract.py.

Env overrides (a `.env` file next to this module is loaded first, so any of
these can live there instead of the real environment):
    EXTRACT_PROVIDER   "anthropic" or "openai"           (default: anthropic)
    ANTHROPIC_API_KEY  Claude credentials                (required if provider is anthropic)
    OPENAI_API_KEY     OpenAI credentials                 (required if provider is openai)
    EXTRACT_MODEL      override the extraction model     (default: claude-opus-5 / gpt-4o-mini)
    SECRET_KEY         HMAC key for session tokens       (default: dev-insecure-key)
    SESSION_TTL        token lifetime in seconds          (default: 900)
    HOST_IP            LAN IP to advertise in the QR      (default: auto-detected)
    PORT               port to advertise in the QR        (default: 8000)
    CHAT_PROVIDER      "openai" or "groq" — see chat.py    (default: openai, reuses OPENAI_API_KEY above)
    CHAT_MODEL         override the chat model            (default: gpt-4o-mini / llama-3.3-70b-versatile)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import os
import re
import shutil
import socket
import sqlite3
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def _load_dotenv(path: Path) -> None:
    """A few-line substitute for python-dotenv.

    This project already reads config as `os.environ.get(..., default)` —
    a real environment variable still wins; `.env` only fills gaps, and only
    for the keys it names. Must run before `import extract`, which reads
    EXTRACT_PROVIDER at import time.
    """
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key, value)


_load_dotenv(BASE_DIR / ".env")

import pypdfium2
import qrcode
import qrcode.image.svg
from fastapi import (
    BackgroundTasks, Depends, FastAPI, File, Form, Header, HTTPException, UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

import chat
import db
import export
import extract
import media
import pdfpages
from db import UPLOAD_DIR, new_id

# The console is a React app built by Vite; FastAPI serves the build output, so
# the site LAN still only has one process and one port to think about.
FE_DIST = BASE_DIR.parent / "FE" / "dist"

SECRET = os.environ.get("SECRET_KEY", "dev-insecure-key").encode()
SESSION_TTL = int(os.environ.get("SESSION_TTL", "900"))
PORT = int(os.environ.get("PORT", "8000"))

# What a file is, and what it is called on the wire, lives in media.py — it was
# duplicated here and in extract.py, and nothing kept the two in step.


# ── session tokens ───────────────────────────────────────────────────────────
# HMAC-SHA256 over {sid, exp}. One payload shape, one key — a JWT library would
# be a crypto dependency for fifteen lines.

def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64d(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def sign_token(session_id: str, expires_at: int) -> str:
    payload = _b64e(json.dumps({"sid": session_id, "exp": expires_at}).encode())
    sig = _b64e(hmac.new(SECRET, payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}"


def verify_token(token: str) -> str:
    """Return the session id, or raise 401."""
    try:
        payload, sig = token.split(".")
        expected = _b64e(hmac.new(SECRET, payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            raise ValueError("bad signature")
        claims = json.loads(_b64d(payload))
        session_id, expires = claims["sid"], claims["exp"]
    except Exception:
        raise HTTPException(401, "Invalid session token")
    if expires < time.time():
        raise HTTPException(401, "Session token expired — scan the QR again")
    return session_id


def current_session(authorization: str | None = Header(None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token")
    return verify_token(authorization[len("Bearer "):])


# ── helpers ──────────────────────────────────────────────────────────────────

def host_ip() -> str:
    """The LAN IP a phone can actually reach.

    Asking the OS which interface it would use to reach the internet beats a
    hostname lookup on machines with Docker/VM adapters. No packet is sent.
    """
    if override := os.environ.get("HOST_IP"):
        return override
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


def get_project(project_id: str) -> sqlite3.Row:
    with db.db() as con:
        row = con.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "No such project")
    return row


def project_label(row: sqlite3.Row) -> str:
    return f"{row['code']} — {row['name']}"


def generate_project_code(name: str) -> str:
    """A short, human-readable handle for the project card — backend-assigned,
    not user-typed, and not meant to match anything printed on a real
    document (see Implementation_Plan_Phasewise.md Phase 5 rung 4, which
    assumed otherwise before the code stopped being user-supplied)."""
    slug = re.sub(r"[^A-Z0-9]+", "-", name.strip().upper()).strip("-")[:16] or "PROJECT"
    return f"{slug}-{uuid.uuid4().hex[:4].upper()}"


def list_sites(project_id: str) -> list[dict]:
    with db.db() as con:
        rows = con.execute(
            "SELECT * FROM sites WHERE project_id = ? ORDER BY name", (project_id,)
        ).fetchall()
    return [dict(r) for r in rows]


def add_site(con: sqlite3.Connection, project_id: str, name: str, address: str | None = None) -> dict:
    site_id = new_id("SITE")
    con.execute(
        "INSERT INTO sites (id, project_id, name, address) VALUES (?, ?, ?, ?)",
        (site_id, project_id, name, address),
    )
    return {"id": site_id, "project_id": project_id, "name": name, "address": address}


def project_dict(row: sqlite3.Row) -> dict:
    return dict(row) | {"sites": list_sites(row["id"])}


def new_session(project_id: str, created_by: str = "web") -> dict:
    """A session is always bound to a project — that is the whole point of
    choosing one in the web console before the QR is issued."""
    project = get_project(project_id)
    session_id = str(uuid.uuid4())
    expires = int(time.time()) + SESSION_TTL
    token = sign_token(session_id, expires)
    expires_iso = datetime.fromtimestamp(expires, timezone.utc).isoformat()

    with db.db() as con:
        con.execute(
            "INSERT INTO scanner_sessions (id, session_token, project_id, created_by,"
            " expires_at) VALUES (?, ?, ?, ?, ?)",
            (session_id, token, project_id, created_by, expires_iso),
        )

    return {
        "session_id": session_id,
        "session_token": token,
        "expires_at": expires_iso,
        "project": dict(project),
        "project_label": project_label(project),
        # Only what the phone needs to reach us. The project name comes back
        # from /health instead, so there is one authoritative copy of it.
        "qr_payload": {
            "serverUrl": f"http://{host_ip()}:{PORT}",
            "sessionToken": token,
            "sessionId": session_id,
        },
    }


def parse_page_counts(text: str, n_files: int) -> list[int]:
    """"2,1,3" -> [2, 1, 3], checked against the number of files actually sent.

    A wrong total would silently mis-group somebody's pages into the wrong
    documents, so it is rejected rather than trimmed.
    """
    try:
        counts = [int(part) for part in text.split(",") if part.strip()]
    except ValueError:
        raise HTTPException(400, "page_counts must be comma-separated integers")
    if not counts:
        raise HTTPException(400, "page_counts is empty — nothing to store")
    if any(n < 1 for n in counts):
        raise HTTPException(400, "each page count must be at least 1")
    if sum(counts) != n_files:
        raise HTTPException(
            400, f"page_counts totals {sum(counts)} but {n_files} files were sent"
        )
    return counts


def parse_document_types(text: str | None, n_docs: int) -> list[str]:
    """"INVOICE,PO" -> ["INVOICE", "PO"], one hint per document.

    Unlike page_counts, a bad value here is never fatal — it's only ever a
    hint the classifier is free to overrule (see extract.run_engine). Blank,
    absent, or a count that doesn't match the number of documents all just
    fall back to UNCLASSIFIED for every document rather than rejecting the
    upload or guessing which hint belongs to which document.
    """
    if not text:
        return ["UNCLASSIFIED"] * n_docs
    parts = [p.strip().upper() for p in text.split(",")]
    if len(parts) != n_docs:
        return ["UNCLASSIFIED"] * n_docs
    return [p if p in db.DOC_TYPES else "UNCLASSIFIED" for p in parts]


def store_upload(
    upload: UploadFile, directory: Path, doc_id: str, start_page: int
) -> list[str]:
    """Write one uploaded file and return the page paths it contributes.

    An image is one page. A PDF is however many pages it has, rendered to
    images here so that nothing downstream — extraction, the review screen,
    the gallery — has to know a PDF was ever involved.

    The client's filename is never used as a path, and never used to decide
    what the file is: media.identify() reads the bytes. This is a trust
    boundary, and a client can call a PNG anything it likes.
    """
    header = upload.file.read(media.HEADER_BYTES)
    upload.file.seek(0)

    kind = media.identify(header)
    if kind is None:
        raise HTTPException(400, f"unsupported file — only {media.ACCEPTED} can be read")

    if kind is not media.PDF:
        name = f"{doc_id}_p{start_page}{kind.ext}"
        with open(directory / name, "wb") as fh:
            shutil.copyfileobj(upload.file, fh)
        return [stored_path(directory, name)]

    # The PDF itself is the record of what arrived, so it is kept alongside the
    # pages rendered from it rather than thrown away once it has been read.
    source = f"{doc_id}_p{start_page}_src.pdf"
    with open(directory / source, "wb") as fh:
        shutil.copyfileobj(upload.file, fh)

    try:
        names = pdfpages.render(directory / source, directory, doc_id, start_page)
    except pdfpages.PdfUnreadable as exc:
        # Nothing half-stored: the operator is still at the file picker, and a
        # document that cannot be read should never reach the register at all.
        (directory / source).unlink(missing_ok=True)
        raise HTTPException(400, str(exc)) from exc

    return [stored_path(directory, name) for name in names]


def stored_path(directory: Path, name: str) -> str:
    """How a page is spelled in file_paths — relative to where uploads mount."""
    return f"uploads/{directory.name}/{name}"


def qr_svg(data: str) -> str:
    img = qrcode.make(data, image_factory=qrcode.image.svg.SvgPathImage, box_size=9, border=2)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue().decode()


def row_to_document(row: sqlite3.Row) -> dict:
    return {
        "document_id": row["id"],
        "session_id": row["session_id"],
        "project_id": row["project_id"],
        "project_code": row["project_code"],
        "project_name": row["project_name"],
        "site_id": row["site_id"],
        "source": row["source"],
        "document_type": row["document_type"],
        "file_paths": json.loads(row["file_paths"]),
        "page_count": row["page_count"],
        "status": row["status"],
        "duplicate_of": row["duplicate_of"],
        "error": row["error"],
        "uploaded_at": row["uploaded_at"],
        # Null until extraction has run — the console shows a placeholder.
        "vendor_name": row["vendor_name_raw"],
        "vendor_gstin": row["vendor_gstin"],
        "doc_number": row["doc_number"],
        "po_number": row["po_number"],
        "total_value": row["total_value"],
        "invoice_channel": row["invoice_channel"],
    }


# ── app ──────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    if extract.PROVIDER == "openai":
        if not os.environ.get("OPENAI_API_KEY"):
            print("\n  ! No OPENAI_API_KEY — uploads will store fine but extraction will fail.")
    elif not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        print("\n  ! No ANTHROPIC_API_KEY — uploads will store fine but extraction will fail.")
    print(f"\n  Console:  http://{host_ip()}:{PORT}\n")
    yield


app = FastAPI(title="Purchase Division POC — Scanner API", lifespan=lifespan)

# The phone and the Expo web build both call this from a different origin, and
# the Authorization header makes every call preflight.
# ponytail: wide open — LAN-only POC. Pin origins before this leaves the office.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# The review screen needs to show the original scan. Mounted at import time,
# so the directory has to exist before db.init() runs in lifespan.
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# Vite emits every hashed bundle under dist/assets. Created if absent so the
# mount holds even when the server is started before the first build.
(FE_DIST / "assets").mkdir(parents=True, exist_ok=True)
app.mount("/assets", StaticFiles(directory=FE_DIST / "assets"), name="assets")


@app.get("/api/v1/config")
def console_config():
    """The one thing the console cannot work out for itself: which LAN address a
    phone has to reach to get here. Everything else it asks for by API."""
    return {"server_url": f"http://{host_ip()}:{PORT}"}


@app.get("/", response_class=HTMLResponse)
def console_page():
    """The built console. Served as-is — no template substitution: the QR now
    ships with the session it belongs to (POST /api/v1/sessions), so picking a
    project no longer costs a page reload."""
    index = FE_DIST / "index.html"
    if not index.exists():
        return HTMLResponse(
            "<h1>Backend is running</h1>"
            "<p><em>The console has not been built yet — run "
            "<code>npm install &amp;&amp; npm run build</code> in <code>FE/</code>.</em></p>"
        )
    return HTMLResponse(index.read_text(encoding="utf-8"))


@app.get("/api/v1/projects")
def list_projects():
    with db.db() as con:
        rows = con.execute("SELECT * FROM projects ORDER BY code").fetchall()
    return {"total": len(rows), "projects": [project_dict(r) for r in rows]}


@app.post("/api/v1/projects", status_code=201)
def create_project(body: dict):
    """The code is generated here, not typed by the operator — see
    generate_project_code(). A project can list its sites up front, or gain
    more later via POST .../sites."""
    name = str((body or {}).get("name", "")).strip()
    if not name:
        raise HTTPException(400, "name is required")
    site_names = [s.strip() for s in (body or {}).get("sites") or [] if str(s).strip()]

    project_id = new_id("PRJ")
    for _ in range(5):
        code = generate_project_code(name)
        try:
            with db.db() as con:
                con.execute(
                    "INSERT INTO projects (id, code, name) VALUES (?, ?, ?)",
                    (project_id, code, name),
                )
                for site_name in site_names:
                    add_site(con, project_id, site_name)
            break
        except sqlite3.IntegrityError:
            continue
    else:
        raise HTTPException(500, "could not generate a unique project code — try again")
    return project_dict(get_project(project_id))


@app.delete("/api/v1/projects/{project_id}")
def delete_project(project_id: str):
    """Removes the project and everything filed under it — every document
    (and its header/lines), every quotation, sites, quote picks, scanner
    sessions. Irreversible; the caller is expected to have already confirmed
    with a person before calling this.

    sites/quotations/quotation_lines/quote_picks cascade on their own
    (ON DELETE CASCADE from project_id/quotation_id). documents and
    scanner_sessions don't — deleted explicitly here, in dependency order,
    same as the one-off cleanup scripts this session leaned on before this
    endpoint existed. duplicate_of has no ON DELETE clause either, and
    find_duplicate matches across the whole database, not just one project,
    so a document *outside* this project can legitimately point at one
    *inside* it — that pointer is cleared first, or deleting the document it
    names would violate that foreign key.
    """
    get_project(project_id)  # 404 before anything is touched
    with db.db() as con:
        doc_ids = [r["id"] for r in con.execute(
            "SELECT id FROM documents WHERE project_id = ?", (project_id,)
        ).fetchall()]
        if doc_ids:
            placeholders = ",".join("?" for _ in doc_ids)
            con.execute(
                f"UPDATE documents SET duplicate_of = NULL WHERE duplicate_of IN ({placeholders})",
                doc_ids,
            )
            con.execute(f"DELETE FROM doc_lines WHERE document_id IN ({placeholders})", doc_ids)
            con.execute(f"DELETE FROM doc_headers WHERE document_id IN ({placeholders})", doc_ids)
            con.execute(f"DELETE FROM documents WHERE id IN ({placeholders})", doc_ids)
        con.execute("DELETE FROM scanner_sessions WHERE project_id = ?", (project_id,))
        con.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    return {"deleted": project_id}


@app.get("/api/v1/projects/{project_id}/sites")
def get_sites(project_id: str):
    get_project(project_id)
    return {"sites": list_sites(project_id)}


@app.post("/api/v1/projects/{project_id}/sites", status_code=201)
def create_site(project_id: str, body: dict):
    get_project(project_id)
    name = str((body or {}).get("name", "")).strip()
    if not name:
        raise HTTPException(400, "name is required")
    address = str((body or {}).get("address", "")).strip() or None
    with db.db() as con:
        site = add_site(con, project_id, name, address)
    return site


@app.get("/api/v1/projects/{project_id}/export")
def export_project(project_id: str):
    """The project's full document set as a 4-sheet .xlsx (Summary, Documents,
    Line Items, Materials Rollup) — see export.py."""
    project = get_project(project_id)
    with db.db() as con:
        workbook = export.build_workbook(con, project)
    filename = f"{project['code']}_export_{datetime.now(timezone.utc):%Y%m%d}.xlsx"
    return StreamingResponse(
        workbook,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/v1/sessions", status_code=201)
def create_session(body: dict):
    project_id = (body or {}).get("project_id")
    if not project_id:
        raise HTTPException(400, "project_id is required")
    session = new_session(project_id, (body or {}).get("created_by", "web"))
    # The console renders the code as inline SVG, so it ships with the session
    # rather than being rendered into the page by a template hole.
    return session | {"qr_svg": qr_svg(json.dumps(session["qr_payload"]))}


@app.get("/api/v1/health")
def health(session_id: str = Depends(current_session)):
    """Also tells the phone which project it just connected to, so the operator
    can see it on screen without ever choosing it."""
    with db.db() as con:
        row = con.execute(
            "SELECT p.code, p.name FROM scanner_sessions s"
            " LEFT JOIN projects p ON p.id = s.project_id WHERE s.id = ?",
            (session_id,),
        ).fetchone()
    label = project_label(row) if row and row["code"] else None
    return {"status": "ok", "session_id": session_id, "project": label}


# ── intake ───────────────────────────────────────────────────────────────────
# Two paths, one storage shape. The phone posts pages grouped into documents
# against a session; the browser posts loose files against a project. Neither
# says what the documents are — the classifier decides that during extraction.

def store_documents(
    con: sqlite3.Connection,
    directory: Path,
    project_id: str,
    site_id: str | None,
    session_id: str | None,
    source: str,
    groups: list[list[UploadFile]],
    document_type_hints: list[str] | None = None,
) -> list[dict]:
    """Write each group of pages as one document row. Returns the created rows.

    document_type_hints is one entry per group — only what the operator
    *filed* each document as (e.g. the console's "Scan PO" button, or the
    phone's per-document type picker). Missing, or shorter than `groups`,
    defaults the rest to UNCLASSIFIED. The classifier still makes the real
    call during extraction (see extract.run_engine's hint text) and can
    override it; this only decides what the hint says.
    """
    directory.mkdir(parents=True, exist_ok=True)
    documents = []
    for index, pages in enumerate(groups):
        hint = (
            document_type_hints[index]
            if document_type_hints and index < len(document_type_hints)
            else "UNCLASSIFIED"
        )
        doc_id = new_id("DOC")
        # Accumulated rather than enumerated: one document can be several
        # uploads, and a PDF among them contributes more than one page. Page
        # numbers have to run across the whole document or the PDF's pages
        # collide with the photos posted beside it.
        rel_paths: list[str] = []
        for upload in pages:
            rel_paths.extend(
                store_upload(upload, directory, doc_id, start_page=len(rel_paths) + 1)
            )
        con.execute(
            "INSERT INTO documents (id, project_id, site_id, session_id, source, document_type,"
            " file_paths, page_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (doc_id, project_id, site_id, session_id, source, hint,
             json.dumps(rel_paths), len(rel_paths)),
        )
        documents.append({
            "document_id": doc_id,
            "document_type": hint,
            "file_paths": rel_paths,
            "page_count": len(rel_paths),
            "status": "PENDING",
        })
    return documents


def _extract_all(document_ids: list[str]) -> None:
    """Runs every document in a batch through extract.process one at a time,
    as one plain synchronous loop — not one background task per document.

    Queueing N separate background tasks relied on Starlette awaiting them
    strictly in order (BackgroundTasks.__call__ does, by its own source —
    see venv/starlette/background.py), plus extract.ENGINE_LOCK as a second
    line of defence against any two calls actually overlapping. Both were in
    place and a real incident still happened: a 4-file batch uploaded
    through the browser came back with all four documents carrying one of
    the four's data, even though the identical files replayed through curl
    immediately after came back correct every time — a timing-sensitive
    interaction with real upload latency neither of those two guards
    reliably caught. A single task iterating a plain Python list needs
    neither guarantee: there is only one call stack, so there is nothing
    left to interleave."""
    for document_id in document_ids:
        extract.process(document_id)


def queue_extraction(background: BackgroundTasks, documents: list[dict]) -> None:
    background.add_task(_extract_all, [d["document_id"] for d in documents])


@app.post("/api/v1/documents/batch-upload")
def batch_upload(
    background: BackgroundTasks,
    session_id: str = Depends(current_session),
    files: list[UploadFile] = File(...),
    page_counts: str = Form(...),
    document_types: str | None = Form(None),
):
    """Receive N scanned pages grouped into documents, and write them to disk.

    The phone sends pixels, page boundaries, and — since the Preview screen's
    type picker gives it one — an optional hint per document; the project
    comes from the session either way.

    page_counts is one comma-separated count per document — "2,1,3" means the
    first three pages of `files` are one document, the next one another, and so
    on, so the counts must sum to len(files). document_types, if sent, is one
    comma-separated hint per document in the same order — "INVOICE,PO" for the
    example above would mean two documents, not three: parse_document_types
    ignores it entirely (falling back to UNCLASSIFIED for every document)
    unless its count matches exactly.
    """
    counts = parse_page_counts(page_counts, len(files))
    hints = parse_document_types(document_types, len(counts))

    with db.db() as con:
        row = con.execute(
            "SELECT project_id, site_id FROM scanner_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(401, "Unknown session — scan the QR again")

        groups, cursor = [], 0
        for pages in counts:
            groups.append(files[cursor:cursor + pages])
            cursor += pages

        documents = store_documents(
            con, UPLOAD_DIR / session_id, row["project_id"], row["site_id"], session_id, "SCAN", groups,
            document_type_hints=hints,
        )

    queue_extraction(background, documents)
    return {"session_id": session_id, "total": len(documents), "documents": documents}


@app.post("/api/v1/documents/upload")
def web_upload(
    background: BackgroundTasks,
    project_id: str = Form(...),
    site_id: str | None = Form(None),
    document_type: str | None = Form(None),
    files: list[UploadFile] = File(...),
):
    """Console upload: loose files picked in a browser, no phone and no session.

    One file is one document. A multi-page PDF therefore stores as a single
    document with page_count 1 — ponytail: the engine reads every page of the
    PDF regardless, so counting them would mean a PDF library for a number
    nothing reads. Add pypdf when the review UI needs a real page count.

    document_type is optional and only ever a hint — e.g. "Scan PO" sends
    "PO" so the extractor is told what the operator expects, but an invalid
    or absent value just falls back to UNCLASSIFIED rather than rejecting
    the upload over it; the classifier's own read of the pixels is what
    actually decides.
    """
    if not files:
        raise HTTPException(400, "no files were sent")
    get_project(project_id)          # 404 before anything touches the disk

    hint = document_type.strip().upper() if document_type else "UNCLASSIFIED"
    if hint not in db.DOC_TYPES:
        hint = "UNCLASSIFIED"

    with db.db() as con:
        documents = store_documents(
            con, UPLOAD_DIR / "web", project_id, site_id or None, None, "UPLOAD", [[f] for f in files],
            document_type_hints=[hint] * len(files),
        )

    queue_extraction(background, documents)
    return {"project_id": project_id, "total": len(documents), "documents": documents}


# ── quotations ───────────────────────────────────────────────────────────────
# A vendor's price quotation for materials — kept out of documents entirely
# (see db.py's SCHEMA comment on the quotations table for why). No session, no
# document-type hint: this is always a browser upload against one project, and
# the model reads the vendor off the page itself, same as it already does for
# invoices.

def quotation_to_dict(row: sqlite3.Row, lines: list[sqlite3.Row]) -> dict:
    return dict(row) | {"file_paths": json.loads(row["file_paths"]), "lines": [dict(l) for l in lines]}


def fetch_quotation_lines(con: sqlite3.Connection, quotation_id: str) -> list[sqlite3.Row]:
    """material_name/material_unit joined in — the review screen and the
    comparison matrix both want the material's own name, not just its id."""
    return con.execute(
        "SELECT l.*, m.name AS material_name, m.unit AS material_unit"
        " FROM quotation_lines l LEFT JOIN materials m ON m.id = l.material_id"
        " WHERE l.quotation_id = ? ORDER BY l.line_no",
        (quotation_id,),
    ).fetchall()


@app.post("/api/v1/projects/{project_id}/quotations", status_code=201)
def upload_quotation(project_id: str, background: BackgroundTasks, files: list[UploadFile] = File(...)):
    """One upload is one vendor's quotation — one or more pages/files, same
    multi-page accumulation as store_documents, just against a different
    table since a quotation isn't a purchase document."""
    if not files:
        raise HTTPException(400, "no files were sent")
    get_project(project_id)          # 404 before anything touches the disk

    quotation_id = new_id("QUOTE")
    # stored_path() records only directory.name, not the full relative path —
    # single-level nesting under UPLOAD_DIR, same as session uploads
    # (UPLOAD_DIR / session_id). The QUOTE- prefix already keeps this from
    # colliding with a document's DOC- directory in the same root.
    directory = UPLOAD_DIR / quotation_id
    directory.mkdir(parents=True, exist_ok=True)

    rel_paths: list[str] = []
    for upload in files:
        rel_paths.extend(store_upload(upload, directory, quotation_id, start_page=len(rel_paths) + 1))

    with db.db() as con:
        con.execute(
            "INSERT INTO quotations (id, project_id, file_paths, page_count)"
            " VALUES (?, ?, ?, ?)",
            (quotation_id, project_id, json.dumps(rel_paths), len(rel_paths)),
        )

    background.add_task(extract.process_quotation, quotation_id)
    return {"quotation_id": quotation_id, "page_count": len(rel_paths), "status": "PENDING"}


@app.get("/api/v1/projects/{project_id}/quotations")
def list_quotations(project_id: str):
    """Every quotation for a project, lines embedded — the comparison view
    needs every line up front, and the expected count per project is small
    enough that pagination would be solving a problem that doesn't exist."""
    get_project(project_id)
    with db.db() as con:
        rows = con.execute(
            "SELECT * FROM quotations WHERE project_id = ? ORDER BY uploaded_at DESC, rowid DESC",
            (project_id,),
        ).fetchall()
        quotations = [quotation_to_dict(row, fetch_quotation_lines(con, row["id"])) for row in rows]
    return {"total": len(quotations), "quotations": quotations}


@app.get("/api/v1/quotations/{quotation_id}")
def get_quotation(quotation_id: str):
    """One quotation plus its lines, for the review screen — same shape as
    get_document, and polled the same way while extraction is in flight."""
    with db.db() as con:
        row = con.execute("SELECT * FROM quotations WHERE id = ?", (quotation_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "No such quotation")
        lines = fetch_quotation_lines(con, quotation_id)
    return quotation_to_dict(row, lines)


@app.post("/api/v1/quotations/{quotation_id}/extract")
def reextract_quotation(quotation_id: str, background: BackgroundTasks):
    """Re-run extraction — for a FAILED quotation, or after the engine
    changes. No decision to protect here (see claim_quotation_for_edit),
    just re-running while an edit is in flight, which extract.process_quotation
    guards against the same way process() does."""
    with db.db() as con:
        row = con.execute("SELECT status FROM quotations WHERE id = ?", (quotation_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "No such quotation")
    background.add_task(extract.process_quotation, quotation_id)
    return {"quotation_id": quotation_id, "status": "PROCESSING"}


@app.put("/api/v1/quotations/{quotation_id}")
def update_quotation(quotation_id: str, body: dict):
    """Save reviewer corrections to the extracted header/line fields — a
    quotation can be edited any number of times while it sits at EXTRACTED."""
    with db.db() as con:
        if not extract.claim_quotation_for_edit(con, quotation_id):
            row = con.execute("SELECT status FROM quotations WHERE id = ?", (quotation_id,)).fetchone()
            if row is None:
                raise HTTPException(404, "No such quotation")
            raise HTTPException(409, f"Quotation is {row['status']} — cannot edit")

        try:
            extract.apply_quotation_edits(
                con, quotation_id,
                (body or {}).get("header") or {}, (body or {}).get("lines") or [],
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc))

        row = con.execute("SELECT * FROM quotations WHERE id = ?", (quotation_id,)).fetchone()
        lines = fetch_quotation_lines(con, quotation_id)
    return quotation_to_dict(row, lines)


@app.delete("/api/v1/quotations/{quotation_id}")
def delete_quotation(quotation_id: str):
    """Uploading five quotes and pruning a duplicate or misfire is a normal
    part of this workflow — unlike documents, a quotation is never the
    business's own record of a decision, so removing one loses nothing."""
    with db.db() as con:
        row = con.execute("SELECT id FROM quotations WHERE id = ?", (quotation_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "No such quotation")
        con.execute("DELETE FROM quotations WHERE id = ?", (quotation_id,))  # cascades to lines

    shutil.rmtree(UPLOAD_DIR / quotation_id, ignore_errors=True)
    return {"quotation_id": quotation_id, "deleted": True}


# ── quote picks ──────────────────────────────────────────────────────────────
# Which vendor to actually buy each material from — cheapest by default, but
# a person can override it (grade/quality isn't something extraction can
# rank, so the final call is theirs). See db.py's quote_picks comment.

@app.get("/api/v1/projects/{project_id}/quote-picks")
def list_quote_picks(project_id: str):
    get_project(project_id)
    with db.db() as con:
        rows = con.execute(
            "SELECT * FROM quote_picks WHERE project_id = ?", (project_id,)
        ).fetchall()
    return {"picks": {r["material_id"]: dict(r) for r in rows}}


@app.put("/api/v1/projects/{project_id}/quote-picks/{material_id}")
def set_quote_pick(project_id: str, material_id: str, body: dict):
    """Pick a specific quotation as the one to buy this material from,
    overriding whatever the cheapest-quote default would show."""
    quotation_id = str((body or {}).get("quotation_id", "")).strip()
    if not quotation_id:
        raise HTTPException(400, "quotation_id is required")
    picked_by = str((body or {}).get("picked_by", "")).strip() or None

    with db.db() as con:
        get_project(project_id)
        quotation = con.execute(
            "SELECT project_id FROM quotations WHERE id = ?", (quotation_id,)
        ).fetchone()
        if quotation is None:
            raise HTTPException(404, "No such quotation")
        if quotation["project_id"] != project_id:
            raise HTTPException(400, "That quotation belongs to a different project")

        con.execute(
            "INSERT INTO quote_picks (project_id, material_id, quotation_id, picked_by, picked_at)"
            " VALUES (?, ?, ?, ?, datetime('now'))"
            " ON CONFLICT(project_id, material_id) DO UPDATE SET"
            "   quotation_id = excluded.quotation_id,"
            "   picked_by = excluded.picked_by,"
            "   picked_at = excluded.picked_at",
            (project_id, material_id, quotation_id, picked_by),
        )
        row = con.execute(
            "SELECT * FROM quote_picks WHERE project_id = ? AND material_id = ?",
            (project_id, material_id),
        ).fetchone()
    return dict(row)


@app.delete("/api/v1/projects/{project_id}/quote-picks/{material_id}")
def clear_quote_pick(project_id: str, material_id: str):
    """Back to the cheapest-quote default for this material."""
    with db.db() as con:
        con.execute(
            "DELETE FROM quote_picks WHERE project_id = ? AND material_id = ?",
            (project_id, material_id),
        )
    return {"project_id": project_id, "material_id": material_id, "cleared": True}


# ── reads ────────────────────────────────────────────────────────────────────

# Every read joins projects, so row_to_document always has the project columns.
# The console lists documents by vendor and value, not by id, so the few
# header fields a list needs are joined in rather than fetched per row.
DOC_SELECT = """
SELECT d.*, p.code AS project_code, p.name AS project_name,
       h.vendor_name_raw, h.vendor_gstin, h.doc_number, h.po_number, h.total_value,
       h.invoice_channel
  FROM documents d
  LEFT JOIN projects p    ON p.id = d.project_id
  LEFT JOIN doc_headers h ON h.document_id = d.id
"""


@app.get("/api/v1/documents")
def list_documents(session_id: str | None = None, project_id: str | None = None,
                   status: str | None = None, limit: int = 100):
    where, args = [], []
    if session_id:
        where.append("d.session_id = ?")
        args.append(session_id)
    if project_id:
        where.append("d.project_id = ?")
        args.append(project_id)
    if status:
        where.append("d.status = ?")
        args.append(status.upper())

    sql = DOC_SELECT + (f" WHERE {' AND '.join(where)}" if where else "")
    sql += " ORDER BY d.uploaded_at DESC, d.rowid DESC LIMIT ?"
    with db.db() as con:
        rows = con.execute(sql, (*args, limit)).fetchall()
    return {"total": len(rows), "documents": [row_to_document(r) for r in rows]}


@app.get("/api/v1/documents/{document_id}")
def get_document(document_id: str):
    """The document plus whatever extraction produced, for the review screen."""
    with db.db() as con:
        row = con.execute(DOC_SELECT + " WHERE d.id = ?", (document_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "No such document")

        header = con.execute(
            "SELECT * FROM doc_headers WHERE document_id = ?", (document_id,)
        ).fetchone()
        lines = con.execute(
            "SELECT * FROM doc_lines WHERE document_id = ? ORDER BY line_no", (document_id,)
        ).fetchall()

    return row_to_document(row) | {
        "header": dict(header) if header else None,
        "lines": [dict(line) for line in lines],
    }


@app.delete("/api/v1/documents/{document_id}")
def delete_document(document_id: str):
    """Removes one document — any type (PO, invoice, delivery challan, inward
    report, quotation-as-document, other, unclassified). Irreversible; the
    caller is expected to have already confirmed with a person.

    duplicate_of has no ON DELETE clause, so a document that's currently the
    site/office pair-match target for another one gets that pointer cleared
    first — otherwise deleting it would violate that foreign key. The
    now-unpaired copy is left alone; its own duplicate-diff banner just goes
    back to showing nothing, same as any invoice with no matching copy.

    Scanned image files on disk are removed too, best-effort — a failure to
    unlink one (already gone, permissions) doesn't block the delete."""
    with db.db() as con:
        row = con.execute("SELECT file_paths FROM documents WHERE id = ?", (document_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "No such document")
        file_paths = json.loads(row["file_paths"])
        con.execute("UPDATE documents SET duplicate_of = NULL WHERE duplicate_of = ?", (document_id,))
        con.execute("DELETE FROM doc_lines WHERE document_id = ?", (document_id,))
        con.execute("DELETE FROM doc_headers WHERE document_id = ?", (document_id,))
        con.execute("DELETE FROM documents WHERE id = ?", (document_id,))

    for path in file_paths:
        try:
            (BASE_DIR / path).unlink(missing_ok=True)
        except OSError:
            pass

    return {"deleted": document_id}


def fetch_doc_lines_with_materials(con: sqlite3.Connection, document_id: str) -> list[sqlite3.Row]:
    """doc_lines with the material's own name joined in — compare_document_lines
    needs it for its report and does no DB access of its own."""
    return con.execute(
        "SELECT l.*, m.name AS material_name FROM doc_lines l"
        " LEFT JOIN materials m ON m.id = l.material_id"
        " WHERE l.document_id = ? ORDER BY l.line_no",
        (document_id,),
    ).fetchall()


@app.get("/api/v1/documents/{document_id}/duplicate-diff")
def duplicate_diff(document_id: str):
    """Line-by-line comparison against this document's paired copy — same
    vendor + document number, found by find_duplicate at extraction time and
    stored as documents.duplicate_of. Typically the site and office copies
    of the same delivery, billed twice through two different channels.

    duplicate_of only ever points from the second upload back to the first
    — find_duplicate runs once, at extraction time, against whatever already
    exists. Reviewing the first-uploaded copy needs the reverse lookup, or
    it would never show the warning the second copy gets."""
    with db.db() as con:
        row = con.execute(
            "SELECT duplicate_of FROM documents WHERE id = ?", (document_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(404, "No such document")
        other_id = row["duplicate_of"]
        if not other_id:
            reverse = con.execute(
                "SELECT id FROM documents WHERE duplicate_of = ? ORDER BY rowid LIMIT 1",
                (document_id,),
            ).fetchone()
            other_id = reverse["id"] if reverse else None
        if not other_id:
            return {"duplicate_of": None}

        other = con.execute(
            "SELECT d.id AS document_id, h.doc_number, d.uploaded_at FROM documents d"
            " LEFT JOIN doc_headers h ON h.document_id = d.id WHERE d.id = ?",
            (other_id,),
        ).fetchone()
        lines_a = [dict(l) for l in fetch_doc_lines_with_materials(con, document_id)]
        lines_b = [dict(l) for l in fetch_doc_lines_with_materials(con, other_id)]

    diff = extract.compare_document_lines(lines_a, lines_b)
    return diff | {"duplicate_of": other_id, "other_document": dict(other) if other else None}


@app.get("/api/v1/documents/{po_document_id}/reconciliation")
def po_reconciliation(po_document_id: str):
    """For a PO document: every invoice, delivery challan and inward report
    that references its number, grouped into deliveries (same vendor +
    invoice number = one delivery, possibly billed twice — see
    duplicate_diff), which of the four required documents a delivery is
    still missing, its three-way verification against the PO's own lines.
    See docs/PROJECT_PLAN.md §7 for the matching logic this is a scoped-down
    version of.

    A complete delivery has all four: a Site Invoice and a Vendor Invoice
    (the same invoice, two copies — one to the site, one mailed straight to
    the office; doc_headers.invoice_channel says which is which, since
    nothing on the page itself does), a Delivery Challan, and an Inward
    Report (the site's own record of what arrived — DELIVERY covers the
    vendor's challan, INWARD covers this).

    A delivery challan and an inward report don't carry the invoice number —
    each carries its own number, which shows up on the invoice's own lines
    as dc_number. That's the only thread connecting them to an invoice
    group; one no invoice has claimed yet still gets its own group, by its
    own number, rather than being silently dropped from the page.

    Fulfillment is gated on a three-way match, not just "an invoice showed
    up": a delivery's quantities only count toward the PO's delivered total
    once its Site Invoice, Vendor Invoice and Inward Report all exist AND
    agree on material, quantity and rate line for line — the Delivery
    Challan isn't part of this specific check (it's usually unpriced, so
    there's nothing to compare there beyond presence, already covered by
    `missing`). A PO is fulfilled by several such deliveries over time (a
    100 MT order arriving as 50 today, 50 next week), each independently
    three-way-verified and summed — never by trusting one invoice's say-so.
    A delivery that hasn't cleared the check contributes nothing to
    delivered_qty; its claimed quantity (site copy's, falling back to
    vendor's, then inward's — whichever exists first) is reported separately
    as pending_qty, so it's still visible without silently counting as
    received."""
    with db.db() as con:
        po_raw = con.execute(DOC_SELECT + " WHERE d.id = ?", (po_document_id,)).fetchone()
        if po_raw is None:
            raise HTTPException(404, "No such document")
        po_row = row_to_document(po_raw)
        if po_row["document_type"] != "PO":
            raise HTTPException(400, "Reconciliation is only meaningful for a PO document")

        po_lines = [dict(l) for l in fetch_doc_lines_with_materials(con, po_document_id)]

        related = [
            row_to_document(r) for r in con.execute(
                DOC_SELECT + " WHERE d.document_type IN ('INVOICE', 'DELIVERY', 'INWARD')"
                " AND d.project_id = ? AND h.po_number = ?",
                (po_row["project_id"], po_row["doc_number"]),
            ).fetchall()
        ]
        invoices = [d for d in related if d["document_type"] == "INVOICE"]
        notes = [d for d in related if d["document_type"] == "DELIVERY"]
        inward = [d for d in related if d["document_type"] == "INWARD"]

        # One delivery = same vendor GSTIN + invoice number — exactly what
        # find_duplicate already treats as "the same document, different
        # scan" at extraction time.
        def new_group(doc_number, vendor_name):
            return {
                "doc_number": doc_number, "vendor_name": vendor_name,
                "invoices": [], "notes": [], "inward": [],
            }

        groups: dict[tuple, dict] = {}
        for inv in invoices:
            key = (inv["vendor_gstin"] or "", inv["doc_number"] or inv["document_id"])
            g = groups.setdefault(key, new_group(key[1], inv["vendor_name"]))
            g["invoices"].append(inv)

        # Fold delivery challans and inward reports in via the dc_number an
        # invoice line names — built from whichever invoices are already
        # grouped, before one with no claimant yet falls back to its own
        # standalone group.
        dc_to_key: dict[str, tuple] = {}
        for key, g in groups.items():
            for inv in g["invoices"]:
                for line in fetch_doc_lines_with_materials(con, inv["document_id"]):
                    if line["dc_number"]:
                        dc_to_key[line["dc_number"]] = key

        for slot, docs_of_type in (("notes", notes), ("inward", inward)):
            for d in docs_of_type:
                key = dc_to_key.get(d["doc_number"])
                if key is None:
                    key = (d["vendor_gstin"] or "", d["doc_number"] or d["document_id"])
                    groups.setdefault(key, new_group(key[1], d["vendor_name"]))
                groups[key][slot].append(d)

        deliveries = []
        delivered_by_material: dict[str, dict] = {}
        pending_by_material: dict[str, dict] = {}
        for g in groups.values():
            g["invoices"].sort(key=lambda d: d["uploaded_at"])
            g["notes"].sort(key=lambda d: d["uploaded_at"])
            g["inward"].sort(key=lambda d: d["uploaded_at"])

            # The four documents a complete delivery needs. Site/Vendor is
            # read off invoice_channel, not upload order — a reviewer sets it
            # (see extract.mark_approved), since nothing on the page says
            # which copy is which. An invoice with no channel set yet (an
            # older document, or one still mid-review) satisfies neither.
            site_invoice = next((inv for inv in g["invoices"] if inv["invoice_channel"] == "SITE"), None)
            vendor_invoice = next((inv for inv in g["invoices"] if inv["invoice_channel"] == "VENDOR"), None)
            inward_report = g["inward"][0] if g["inward"] else None

            missing = []
            if site_invoice is None:
                missing.append("Site Invoice")
            if vendor_invoice is None:
                missing.append("Vendor Invoice")
            if not g["notes"]:
                missing.append("Delivery Challan")
            if inward_report is None:
                missing.append("Inward Report")

            def lines_of(doc):
                return [dict(l) for l in fetch_doc_lines_with_materials(con, doc["document_id"])]

            # Fulfillment is a three-way match, not "an invoice showed up" —
            # Site Invoice, Vendor Invoice and Inward Report all have to
            # exist AND agree line for line on material, quantity and rate
            # before this delivery's quantities count toward the PO at all.
            # The Delivery Challan isn't part of this specific check (see
            # the function docstring) — its presence is covered by `missing`
            # above only.
            missing_for_match = [
                label for label, doc in (
                    ("Site Invoice", site_invoice), ("Vendor Invoice", vendor_invoice),
                    ("Inward Report", inward_report),
                ) if doc is None
            ]

            site_lines = lines_of(site_invoice) if site_invoice else None
            vendor_lines = lines_of(vendor_invoice) if vendor_invoice else None
            inward_lines = lines_of(inward_report) if inward_report else None

            if missing_for_match:
                status, match_diffs = "incomplete", None
            else:
                match_diffs = {
                    "site_vs_vendor": extract.compare_document_lines(site_lines, vendor_lines),
                    "site_vs_inward": extract.compare_document_lines(site_lines, inward_lines),
                    "vendor_vs_inward": extract.compare_document_lines(vendor_lines, inward_lines),
                }
                status = "verified" if all(d["clean"] for d in match_diffs.values()) else "mismatch"

            verification = {
                "status": status,                    # "verified" | "incomplete" | "mismatch"
                "missing_for_match": missing_for_match,
                "diffs": match_diffs,
                "site_invoice_document_id": site_invoice["document_id"] if site_invoice else None,
                "vendor_invoice_document_id": vendor_invoice["document_id"] if vendor_invoice else None,
                "inward_document_id": inward_report["document_id"] if inward_report else None,
            }

            # Verified deliveries feed delivered_qty (what actually counts
            # against the PO); anything else — missing a document, or the
            # three disagreeing — feeds pending_qty instead, so a claimed
            # amount is still visible without ever being trusted as received.
            # The claimed amount itself, when unverified, is whichever of
            # the three exists first in Site > Vendor > Inward priority —
            # there's no single correct number to show when they disagree,
            # so this is a stated "best guess," not a reconciled figure.
            if status == "verified":
                pool, rep_id, rep_lines = delivered_by_material, site_invoice["document_id"], site_lines
            elif site_invoice:
                pool, rep_id, rep_lines = pending_by_material, site_invoice["document_id"], site_lines
            elif vendor_invoice:
                pool, rep_id, rep_lines = pending_by_material, vendor_invoice["document_id"], vendor_lines
            elif inward_report:
                pool, rep_id, rep_lines = pending_by_material, inward_report["document_id"], inward_lines
            else:
                pool, rep_id, rep_lines = pending_by_material, None, None

            if rep_lines:
                rep_by_material, _ = extract.aggregate_by_material(rep_lines)
                for material_id, entry in rep_by_material.items():
                    total = pool.setdefault(
                        material_id,
                        {"material_id": material_id, "material_name": entry["material_name"],
                         "unit": entry.get("unit"), "qty": 0.0, "entries": []},
                    )
                    if not total["unit"]:
                        total["unit"] = entry.get("unit")
                    total["qty"] += entry["qty"]
                    total["entries"].append({
                        "document_id": rep_id,
                        "doc_number": g["doc_number"],
                        "vendor_name": g["vendor_name"],
                        "quantity": entry["qty"],
                        "status": status,
                    })

            documents = [
                {"document_id": d["document_id"], "document_type": "INVOICE",
                 "invoice_channel": d["invoice_channel"],
                 "status": d["status"], "uploaded_at": d["uploaded_at"]}
                for d in g["invoices"]
            ] + [
                {"document_id": d["document_id"], "document_type": "DELIVERY",
                 "status": d["status"], "uploaded_at": d["uploaded_at"]}
                for d in g["notes"]
            ] + [
                {"document_id": d["document_id"], "document_type": "INWARD",
                 "status": d["status"], "uploaded_at": d["uploaded_at"]}
                for d in g["inward"]
            ]

            deliveries.append({
                "doc_number": g["doc_number"],
                "vendor_name": g["vendor_name"],
                "documents": documents,
                "missing": missing,
                "verification": verification,
                # Kept for the FE's existing "Mismatch" pill — true only for
                # an actual disagreement, not for a still-incomplete delivery.
                "mismatch": status == "mismatch",
            })

    po_by_material, _ = extract.aggregate_by_material(po_lines)
    # Every material this PO ordered, plus every material any delivery
    # (verified or still pending) has claimed against it — a material billed
    # but never actually on the PO is still worth surfacing, not silently
    # dropped for having no ordered_qty to compare against.
    all_material_ids = set(po_by_material) | set(delivered_by_material) | set(pending_by_material)

    materials = []
    for material_id in all_material_ids:
        po_entry = po_by_material.get(material_id)
        delivered_entry = delivered_by_material.get(material_id)
        pending_entry = pending_by_material.get(material_id)
        ordered = po_entry["qty"] if po_entry else 0.0
        delivered = delivered_entry["qty"] if delivered_entry else 0.0
        pending = pending_entry["qty"] if pending_entry else 0.0
        name = (po_entry or delivered_entry or pending_entry)["material_name"]
        unit = (po_entry or delivered_entry or pending_entry).get("unit")
        materials.append({
            "material_id": material_id,
            "material_name": name,
            "unit": unit,
            "ordered_qty": ordered,
            "delivered_qty": delivered,
            "pending_qty": pending,
            "remaining_qty": round(ordered - delivered, 3),
            "over_delivered": delivered > ordered,
            "po_entries": (
                [{"doc_number": po_row["doc_number"], "quantity": ordered}] if po_entry else []
            ),
            "invoice_entries": (
                (delivered_entry["entries"] if delivered_entry else [])
                + (pending_entry["entries"] if pending_entry else [])
            ),
        })

    return {"materials": materials, "deliveries": deliveries}


@app.post("/api/v1/documents/{document_id}/extract")
def reextract(document_id: str, background: BackgroundTasks):
    """Re-run extraction — for a FAILED document, or after the engine changes.

    Blocked once a decision has been made — re-extracting an APPROVED or
    REJECTED document would silently overwrite the reviewed data and the
    decision itself. This is the fast, legible check; extract.process() has
    its own race-safe version of the same guard for the gap between this
    request and the background task actually running.
    """
    with db.db() as con:
        row = con.execute("SELECT status FROM documents WHERE id = ?", (document_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "No such document")
    if row["status"] in ("APPROVED", "REJECTED"):
        raise HTTPException(409, f"Cannot re-extract a document that is {row['status']}")
    background.add_task(extract.process, document_id)
    return {"document_id": document_id, "status": "PROCESSING"}


@app.put("/api/v1/documents/{document_id}")
def update_document(document_id: str, body: dict):
    """Save reviewer corrections to the extracted header/line fields.

    This only saves — it doesn't decide anything. A document can be edited
    any number of times while it sits at EXTRACTED; editing is blocked once a
    decision (approve/reject) has been made, since that decision was made
    against a specific set of values.
    """
    with db.db() as con:
        if not extract.claim_for_edit(con, document_id):
            row = con.execute(
                "SELECT status FROM documents WHERE id = ?", (document_id,)
            ).fetchone()
            if row is None:
                raise HTTPException(404, "No such document")
            raise HTTPException(409, f"Document is {row['status']} — cannot edit")

        try:
            extract.apply_edits(
                con, document_id,
                (body or {}).get("header") or {}, (body or {}).get("lines") or [],
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc))

    return get_document(document_id)


@app.post("/api/v1/documents/{document_id}/approve")
def approve_document(document_id: str, body: dict):
    """Confirm the extracted data is correct. This is an OCR-accuracy gate,
    not a business validation verdict — see Deviation.md §1."""
    approved_by = str((body or {}).get("approved_by", "")).strip()
    if not approved_by:
        raise HTTPException(400, "approved_by is required")

    with db.db() as con:
        if not extract.mark_approved(con, document_id, approved_by):
            row = con.execute(
                "SELECT d.status, d.document_type, h.po_number, h.invoice_channel FROM documents d"
                " LEFT JOIN doc_headers h ON h.document_id = d.id WHERE d.id = ?",
                (document_id,),
            ).fetchone()
            if row is None:
                raise HTTPException(404, "No such document")
            doc_type, waiting = row["document_type"], row["status"] == "EXTRACTED"
            if waiting and doc_type == "UNCLASSIFIED":
                raise HTTPException(
                    400, "Document type could not be read automatically — pick one before approving"
                )
            if waiting and doc_type == "OTHER":
                raise HTTPException(
                    400,
                    "OTHER isn't a real document type — pick Invoice, PO, Delivery, Quotation or "
                    "Inward Report before approving, or reject it if none of those genuinely fit",
                )
            if waiting and doc_type in ("INVOICE", "DELIVERY", "INWARD") and not (row["po_number"] or "").strip():
                raise HTTPException(
                    400,
                    "This document has no PO number — enter the purchase order it belongs to "
                    "before approving",
                )
            if waiting and doc_type == "INVOICE" and row["invoice_channel"] not in ("SITE", "VENDOR"):
                raise HTTPException(
                    400,
                    "This invoice doesn't say whether it's the Site copy or the Vendor copy — "
                    "pick one before approving",
                )
            raise HTTPException(409, f"Cannot approve a document that is {row['status']}")

    return get_document(document_id)


@app.post("/api/v1/documents/{document_id}/reject")
def reject_document(document_id: str, body: dict):
    rejected_by = str((body or {}).get("rejected_by", "")).strip()
    reason = str((body or {}).get("reason", "")).strip()
    if not rejected_by:
        raise HTTPException(400, "rejected_by is required")
    if not reason:
        raise HTTPException(400, "reason is required")

    with db.db() as con:
        if not extract.mark_rejected(con, document_id, rejected_by, reason):
            row = con.execute(
                "SELECT status FROM documents WHERE id = ?", (document_id,)
            ).fetchone()
            if row is None:
                raise HTTPException(404, "No such document")
            raise HTTPException(409, f"Cannot reject a document that is {row['status']}")

    return get_document(document_id)


@app.get("/api/v1/materials")
def list_materials(verified_only: bool = False):
    """The review screen needs this to offer a correct material for a bad guess."""
    sql = "SELECT * FROM materials"
    if verified_only:
        sql += " WHERE verified = 1"
    with db.db() as con:
        rows = con.execute(sql + " ORDER BY category, name").fetchall()
    return {"total": len(rows), "materials": [dict(r) for r in rows]}


@app.post("/api/v1/chat")
def chat_ask(body: dict):
    """Answer a question about the data. Reads only — see chat.py: the connection
    it runs the generated SQL on is opened `mode=ro`, so there is no path from
    here to a write no matter what the model emits."""
    question = str((body or {}).get("question", "")).strip()
    if not question:
        raise HTTPException(400, "question is required")
    try:
        return chat.answer(question, (body or {}).get("history") or [])
    except extract.EngineNotConfigured as exc:
        raise HTTPException(503, str(exc))
    except chat.UnsafeQuery as exc:
        raise HTTPException(400, str(exc))
    except chat.ModelUnavailable as exc:
        raise HTTPException(502, str(exc))
    except sqlite3.Error as exc:
        # The retry inside answer() already had a go at this one.
        raise HTTPException(422, f"Could not run that question against the data: {exc}")


# ── self-check: the token logic is the only security-critical part here ──────

if __name__ == "__main__":
    now = int(time.time())
    good = sign_token("sess-1", now + 60)
    assert verify_token(good) == "sess-1"

    payload, sig = good.split(".")
    for bad, why in [
        (f"{payload}.{'A' * len(sig)}", "forged signature"),
        (f"{_b64e(b'{\"sid\":\"evil\",\"exp\":9999999999}')}.{sig}", "swapped payload"),
        ("not-a-token", "malformed"),
        (sign_token("sess-1", now - 1), "expired"),
    ]:
        try:
            verify_token(bad)
        except HTTPException:
            pass
        else:
            raise AssertionError(f"accepted a token it should have rejected: {why}")

    assert parse_page_counts("2,1,3", 6) == [2, 1, 3]
    assert parse_page_counts("1", 1) == [1]
    assert parse_page_counts(" 2 , 1 ", 3) == [2, 1]
    for bad, why in [("2,1", 5), ("0,3", 3), ("", 0), ("x", 1), ("-1,2", 1)]:
        try:
            parse_page_counts(bad, why)
        except HTTPException:
            pass
        else:
            raise AssertionError(f"accepted bad page_counts {bad!r} for {why} files")

    code1 = generate_project_code("Chennai Residential Tower")
    code2 = generate_project_code("Chennai Residential Tower")
    assert re.fullmatch(r"[A-Z0-9-]+", code1), code1
    assert code1 != code2, "two generated codes for the same name must not collide"
    assert generate_project_code("").startswith("PROJECT-"), "a blank name must still produce a code"

    # store_upload: the bytes decide what a file is, and one upload can be more
    # than one page. A plain SimpleNamespace stands in for UploadFile since only
    # .filename and .file are ever touched.
    import io as _io
    from types import SimpleNamespace as _NS

    _pages_dir = BASE_DIR / "uploads" / "_selfcheck_pages"
    _pages_dir.mkdir(parents=True, exist_ok=True)
    try:
        good = _NS(filename="a.jpg", file=_io.BytesIO(b"\xff\xd8\xff" + b"\x00" * 20))
        assert store_upload(good, _pages_dir, "DOC-x", 1) == ["uploads/_selfcheck_pages/DOC-x_p1.jpg"]

        # The name is not evidence: a PNG called .jpg is stored as the PNG it is,
        # where the old extension-first check rejected it outright.
        mislabelled = _NS(filename="b.jpg", file=_io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00" * 20))
        assert store_upload(mislabelled, _pages_dir, "DOC-x", 2)[0].endswith("DOC-x_p2.png")

        # ...and a file with no name at all is identified rather than assumed.
        unnamed = _NS(filename=None, file=_io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00" * 20))
        assert store_upload(unnamed, _pages_dir, "DOC-x", 3)[0].endswith("DOC-x_p3.png")

        for junk in (b"not actually anything", b"GIF89a", b""):
            try:
                store_upload(_NS(filename="c.jpg", file=_io.BytesIO(junk)), _pages_dir, "DOC-x", 9)
            except HTTPException:
                pass
            else:
                raise AssertionError(f"stored a file it cannot read: {junk[:12]!r}")

        # A PDF becomes pages, numbered on from whatever came before it.
        _pdf = _io.BytesIO()
        _sample = pypdfium2.PdfDocument.new()
        for _ in range(3):
            _sample.new_page(200, 300)
        _sample.save(_pdf)
        _sample.close()
        _pdf.seek(0)

        _paths = store_upload(_NS(filename="scan.pdf", file=_pdf), _pages_dir, "DOC-p", 4)
        assert [p.rsplit("/", 1)[1] for p in _paths] == [
            "DOC-p_p4.png", "DOC-p_p5.png", "DOC-p_p6.png"
        ], _paths
        assert (_pages_dir / "DOC-p_p4_src.pdf").exists(), "the PDF that arrived must be kept"
    finally:
        for _f in _pages_dir.iterdir():
            _f.unlink()
        _pages_dir.rmdir()

    # _load_dotenv: a conventionally-quoted value must not carry its quotes
    # into the environment.
    _env_test = BASE_DIR / "_selfcheck.env"
    _env_test.write_text('SELFCHECK_QUOTED="hello world"\nSELFCHECK_BARE=plain\n')
    try:
        _load_dotenv(_env_test)
        assert os.environ.pop("SELFCHECK_QUOTED") == "hello world"
        assert os.environ.pop("SELFCHECK_BARE") == "plain"
    finally:
        _env_test.unlink()

    print("self-check passed")
