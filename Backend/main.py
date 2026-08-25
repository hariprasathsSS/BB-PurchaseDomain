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
        "doc_number": row["doc_number"],
        "po_number": row["po_number"],
        "total_value": row["total_value"],
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
) -> list[dict]:
    """Write each group of pages as one document row. Returns the created rows."""
    directory.mkdir(parents=True, exist_ok=True)
    documents = []
    for pages in groups:
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
            "INSERT INTO documents (id, project_id, site_id, session_id, source, file_paths,"
            " page_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (doc_id, project_id, site_id, session_id, source, json.dumps(rel_paths), len(rel_paths)),
        )
        documents.append({
            "document_id": doc_id,
            "document_type": "UNCLASSIFIED",
            "file_paths": rel_paths,
            "page_count": len(rel_paths),
            "status": "PENDING",
        })
    return documents


def queue_extraction(background: BackgroundTasks, documents: list[dict]) -> None:
    for document in documents:
        background.add_task(extract.process, document["document_id"])


@app.post("/api/v1/documents/batch-upload")
def batch_upload(
    background: BackgroundTasks,
    session_id: str = Depends(current_session),
    files: list[UploadFile] = File(...),
    page_counts: str = Form(...),
):
    """Receive N scanned pages grouped into documents, and write them to disk.

    The phone sends pixels and page boundaries, nothing else. Document type is
    decided by the classifier; the project comes from the session.

    page_counts is one comma-separated count per document — "2,1,3" means the
    first three pages of `files` are one document, the next one another, and so
    on, so the counts must sum to len(files).
    """
    counts = parse_page_counts(page_counts, len(files))

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
        )

    queue_extraction(background, documents)
    return {"session_id": session_id, "total": len(documents), "documents": documents}


@app.post("/api/v1/documents/upload")
def web_upload(
    background: BackgroundTasks,
    project_id: str = Form(...),
    site_id: str | None = Form(None),
    files: list[UploadFile] = File(...),
):
    """Console upload: loose files picked in a browser, no phone and no session.

    One file is one document. A multi-page PDF therefore stores as a single
    document with page_count 1 — ponytail: the engine reads every page of the
    PDF regardless, so counting them would mean a PDF library for a number
    nothing reads. Add pypdf when the review UI needs a real page count.
    """
    if not files:
        raise HTTPException(400, "no files were sent")
    get_project(project_id)          # 404 before anything touches the disk

    with db.db() as con:
        documents = store_documents(
            con, UPLOAD_DIR / "web", project_id, site_id or None, None, "UPLOAD", [[f] for f in files],
        )

    queue_extraction(background, documents)
    return {"project_id": project_id, "total": len(documents), "documents": documents}


# ── reads ────────────────────────────────────────────────────────────────────

# Every read joins projects, so row_to_document always has the project columns.
# The console lists documents by vendor and value, not by id, so the few
# header fields a list needs are joined in rather than fetched per row.
DOC_SELECT = """
SELECT d.*, p.code AS project_code, p.name AS project_name,
       h.vendor_name_raw, h.doc_number, h.po_number, h.total_value
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
                "SELECT status FROM documents WHERE id = ?", (document_id,)
            ).fetchone()
            if row is None:
                raise HTTPException(404, "No such document")
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
