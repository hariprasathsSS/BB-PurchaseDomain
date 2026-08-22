"""Construction Purchase POC — scanner backend.

Receives scanned documents from the mobile app and stores them on local disk.

    python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

Env overrides:
    SECRET_KEY    HMAC key for session tokens   (default: dev-insecure-key)
    SESSION_TTL   token lifetime in seconds     (default: 900)
    HOST_IP       LAN IP to advertise in the QR (default: auto-detected)
    PORT          port to advertise in the QR   (default: 8000)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import os
import shutil
import socket
import sqlite3
import time
import uuid
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timezone
from pathlib import Path

import qrcode
import qrcode.image.svg
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
DB_PATH = BASE_DIR / "poc.db"
FE_INDEX = BASE_DIR.parent / "FE" / "index.html"

SECRET = os.environ.get("SECRET_KEY", "dev-insecure-key").encode()
SESSION_TTL = int(os.environ.get("SESSION_TTL", "900"))
PORT = int(os.environ.get("PORT", "8000"))

ALLOWED_EXT = {".jpg", ".jpeg", ".png", ".pdf"}

# The phone no longer says what a document is — classification happens here,
# after upload. Until it runs, everything is UNCLASSIFIED.
SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  code       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  site       TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS scanner_sessions (
  id            TEXT PRIMARY KEY,
  session_token TEXT UNIQUE NOT NULL,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  created_by    TEXT NOT NULL,
  created_at    TEXT DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL,
  status        TEXT DEFAULT 'ACTIVE'
);
CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,
  session_id    TEXT REFERENCES scanner_sessions(id),
  project_id    TEXT NOT NULL REFERENCES projects(id),
  document_type TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
  file_paths    TEXT NOT NULL,          -- JSON array, one entry per page
  page_count    INTEGER NOT NULL,
  status        TEXT DEFAULT 'PENDING',
  uploaded_at   TEXT DEFAULT (datetime('now'))
);
"""


# ── storage ──────────────────────────────────────────────────────────────────

@contextmanager
def db():
    """A connection per request. FastAPI runs sync endpoints in a threadpool,
    and sqlite3 connections are not shareable across threads."""
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    finally:
        con.close()


def migrate(con) -> None:
    """poc.db is checked in and full of test scans, so add the project columns
    instead of asking anyone to delete it. Pre-project rows get ''."""
    for table in ("scanner_sessions", "documents"):
        columns = {r["name"] for r in con.execute(f"PRAGMA table_info({table})")}
        if "project_id" not in columns:
            con.execute(
                f"ALTER TABLE {table} ADD COLUMN project_id TEXT NOT NULL DEFAULT ''"
            )


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
    with db() as con:
        row = con.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "No such project")
    return row


def new_session(project_id: str, created_by: str = "web") -> dict:
    """A session is always bound to a project — that is the whole point of
    choosing one in the web console before the QR is issued."""
    project = get_project(project_id)
    session_id = str(uuid.uuid4())
    expires = int(time.time()) + SESSION_TTL
    token = sign_token(session_id, expires)
    expires_iso = datetime.fromtimestamp(expires, timezone.utc).isoformat()

    with db() as con:
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
        "document_type": row["document_type"],
        "file_paths": json.loads(row["file_paths"]),
        "page_count": row["page_count"],
        "status": row["status"],
        "uploaded_at": row["uploaded_at"],
    }


# ── app ──────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    with db() as con:
        con.executescript(SCHEMA)
        migrate(con)
    print(f"\n  Scanner page:  http://{host_ip()}:{PORT}\n")
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


@app.get("/", response_class=HTMLResponse)
def scanner_page(project: str | None = None):
    """The web console. A QR is only issued once a project is picked, so every
    scan lands against a project without the phone having to ask."""
    if not FE_INDEX.exists():
        return HTMLResponse(
            "<h1>Backend is running</h1>"
            "<p><em>FE/index.html not found — the console has not been built yet.</em></p>"
        )

    fields = {
        "{{QR_SVG}}": "",
        "{{SERVER_URL}}": f"http://{host_ip()}:{PORT}",
        "{{SESSION_ID}}": "",
        "{{EXPIRES_AT}}": "",
        "{{PROJECT_ID}}": "",
        "{{PROJECT_LABEL}}": "",
    }

    if project:
        session = new_session(project)
        fields |= {
            "{{QR_SVG}}": qr_svg(json.dumps(session["qr_payload"])),
            "{{SESSION_ID}}": session["session_id"],
            "{{EXPIRES_AT}}": session["expires_at"],
            "{{PROJECT_ID}}": project,
            "{{PROJECT_LABEL}}": session["qr_payload"]["projectName"],
        }

    html = FE_INDEX.read_text(encoding="utf-8")
    for placeholder, value in fields.items():
        html = html.replace(placeholder, value)
    return HTMLResponse(html)


@app.get("/api/v1/projects")
def list_projects():
    with db() as con:
        rows = con.execute("SELECT * FROM projects ORDER BY code").fetchall()
    return {"total": len(rows), "projects": [dict(r) for r in rows]}


@app.post("/api/v1/projects", status_code=201)
def create_project(body: dict):
    code = str(body.get("code", "")).strip().upper()
    name = str(body.get("name", "")).strip()
    if not code or not name:
        raise HTTPException(400, "code and name are required")

    project_id = str(uuid.uuid4())
    try:
        with db() as con:
            con.execute(
                "INSERT INTO projects (id, code, name, site) VALUES (?, ?, ?, ?)",
                (project_id, code, name, str(body.get("site", "")).strip() or None),
            )
    except sqlite3.IntegrityError:
        raise HTTPException(409, f"Project code {code} already exists")
    return dict(get_project(project_id))


@app.post("/api/v1/sessions", status_code=201)
def create_session(body: dict):
    project_id = (body or {}).get("project_id")
    if not project_id:
        raise HTTPException(400, "project_id is required")
    return new_session(project_id, (body or {}).get("created_by", "web"))


@app.get("/api/v1/health")
def health(session_id: str = Depends(current_session)):
    """Also tells the phone which project it just connected to, so the operator
    can see it on screen without ever choosing it."""
    with db() as con:
        row = con.execute(
            "SELECT p.code, p.name FROM scanner_sessions s"
            " LEFT JOIN projects p ON p.id = s.project_id WHERE s.id = ?",
            (session_id,),
        ).fetchone()
    label = f"{row['code']} — {row['name']}" if row and row["code"] else None
    return {"status": "ok", "session_id": session_id, "project": label}


@app.post("/api/v1/documents/batch-upload")
def batch_upload(
    session_id: str = Depends(current_session),
    files: list[UploadFile] = File(...),
    page_counts: str = Form(...),
):
    """Receive N scanned pages grouped into documents, and write them to disk.

    The phone sends pixels and page boundaries, nothing else. Document type is
    decided here by classification; the project comes from the session.

    page_counts is one comma-separated count per document — "2,1,3" means the
    first three pages of `files` are one document, the next one another, and so
    on, so the counts must sum to len(files).
    """
    counts = parse_page_counts(page_counts, len(files))

    with db() as con:
        row = con.execute(
            "SELECT project_id FROM scanner_sessions WHERE id = ?", (session_id,)
        ).fetchone()
    if row is None:
        raise HTTPException(401, "Unknown session — scan the QR again")
    project_id = row["project_id"]

    session_dir = UPLOAD_DIR / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    documents, cursor = [], 0
    with db() as con:
        for pages in counts:
            doc_id = str(uuid.uuid4())
            rel_paths = []

            for page_no in range(1, pages + 1):
                upload = files[cursor]
                cursor += 1
                # The client's filename is never used as a path — only its
                # extension is read, and only from a whitelist.
                ext = Path(upload.filename or "").suffix.lower() or ".jpg"
                if ext not in ALLOWED_EXT:
                    raise HTTPException(400, f"unsupported file type {ext!r}")
                name = f"{doc_id}_p{page_no}{ext}"
                with open(session_dir / name, "wb") as fh:
                    shutil.copyfileobj(upload.file, fh)
                rel_paths.append(f"uploads/{session_id}/{name}")

            con.execute(
                "INSERT INTO documents (id, session_id, project_id, file_paths,"
                " page_count) VALUES (?, ?, ?, ?, ?)",
                (doc_id, session_id, project_id, json.dumps(rel_paths), pages),
            )
            documents.append({
                "document_id": doc_id,
                "document_type": "UNCLASSIFIED",
                "file_paths": rel_paths,
                "page_count": pages,
                "status": "PENDING",
            })

    return {"session_id": session_id, "total": len(documents), "documents": documents}


# Every read joins projects, so row_to_document always has the project columns.
DOC_SELECT = """
SELECT d.*, p.code AS project_code, p.name AS project_name
  FROM documents d LEFT JOIN projects p ON p.id = d.project_id
"""


@app.get("/api/v1/documents")
def list_documents(session_id: str | None = None, project_id: str | None = None,
                   limit: int = 100):
    where, args = [], []
    if session_id:
        where.append("d.session_id = ?")
        args.append(session_id)
    if project_id:
        where.append("d.project_id = ?")
        args.append(project_id)

    sql = DOC_SELECT + (f" WHERE {' AND '.join(where)}" if where else "")
    sql += " ORDER BY d.uploaded_at DESC, d.rowid DESC LIMIT ?"
    with db() as con:
        rows = con.execute(sql, (*args, limit)).fetchall()
    return {"total": len(rows), "documents": [row_to_document(r) for r in rows]}


@app.get("/api/v1/documents/{document_id}")
def get_document(document_id: str):
    with db() as con:
        row = con.execute(DOC_SELECT + " WHERE d.id = ?", (document_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "No such document")
    return row_to_document(row)


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

    print("self-check passed")
