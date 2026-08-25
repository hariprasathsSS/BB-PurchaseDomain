"""Schema, connections and seed data for the purchase document POC.

Split out of main.py once the schema grew past two tables. main.py owns HTTP,
this owns storage.
"""

from __future__ import annotations

import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "poc.db"
UPLOAD_DIR = BASE_DIR / "uploads"

# OTHER is the works-contract / RA-bill bucket: classified so it never enters
# the material three-way-match path.
DOC_TYPES = {"UNCLASSIFIED", "INVOICE", "PO", "DELIVERY", "OTHER"}
SOURCES = {"SCAN", "UPLOAD"}
# APPROVED/REJECTED are an accuracy gate on the OCR read, not a business
# validation verdict — the 3-way match (Phase 6) doesn't exist yet. See
# Deviation.md §1.
STATUSES = {"PENDING", "PROCESSING", "EXTRACTED", "APPROVED", "REJECTED", "FAILED"}


SCHEMA = """
PRAGMA foreign_keys = ON;

-- masters --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  code       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  client     TEXT,
  location   TEXT,
  -- ponytail: the console's one free-text site label. The `sites` table below
  -- is the Phase 5 site master; this is just what the project card prints.
  site       TEXT,
  status     TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sites (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  address    TEXT
);

CREATE TABLE IF NOT EXISTS materials (
  id       TEXT PRIMARY KEY,
  code     TEXT UNIQUE,
  name     TEXT NOT NULL,
  category TEXT,
  unit     TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0   -- 0 = auto-created from a scan
);

-- alias is the primary key: one spelling maps to exactly one material, and
-- INSERT OR IGNORE makes "learn this alias" idempotent.
CREATE TABLE IF NOT EXISTS material_aliases (
  alias       TEXT PRIMARY KEY,
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vendors (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  gstin    TEXT UNIQUE,
  phone    TEXT,
  verified INTEGER NOT NULL DEFAULT 0
);

-- capture --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS scanner_sessions (
  id            TEXT PRIMARY KEY,
  session_token TEXT UNIQUE NOT NULL,
  created_by    TEXT NOT NULL,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  site_id       TEXT REFERENCES sites(id),
  created_at    TEXT DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL,
  status        TEXT DEFAULT 'ACTIVE'
);

CREATE TABLE IF NOT EXISTS documents (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id),
  site_id        TEXT REFERENCES sites(id),
  session_id     TEXT REFERENCES scanner_sessions(id),
  source         TEXT NOT NULL CHECK (source IN ('SCAN','UPLOAD')),

  document_type  TEXT NOT NULL DEFAULT 'UNCLASSIFIED'
                 CHECK (document_type IN ('UNCLASSIFIED','INVOICE','PO','DELIVERY','OTHER')),
  file_paths     TEXT NOT NULL,
  page_count     INTEGER NOT NULL,
  notes          TEXT,
  is_handwritten INTEGER NOT NULL DEFAULT 0,

  status         TEXT NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','PROCESSING','EXTRACTED','APPROVED','REJECTED','FAILED')),
  extracted_json TEXT,
  duplicate_of   TEXT REFERENCES documents(id),
  error          TEXT,
  uploaded_at    TEXT DEFAULT (datetime('now'))
);

-- extracted business record ---------------------------------------------------

CREATE TABLE IF NOT EXISTS doc_headers (
  document_id  TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  doc_kind     TEXT,

  doc_number   TEXT,
  po_number    TEXT,
  dc_number    TEXT,

  doc_date     TEXT,
  doc_date_raw TEXT,

  vendor_id       TEXT REFERENCES vendors(id),
  vendor_name_raw TEXT,
  vendor_gstin    TEXT,
  buyer_gstin     TEXT,

  place_of_supply      TEXT,
  delivery_address_raw TEXT,

  basic_value  REAL,
  tax_type     TEXT CHECK (tax_type IN ('IGST','CGST_SGST')),
  igst_amount  REAL,
  cgst_amount  REAL,
  sgst_amount  REAL,
  tcs_amount   REAL,
  rounding_off REAL,
  total_value  REAL,

  irn         TEXT,
  qr_verified INTEGER NOT NULL DEFAULT 0,

  reviewed_by       TEXT,
  reviewed_at       TEXT,
  rejection_reason  TEXT
);

CREATE TABLE IF NOT EXISTS doc_lines (
  id              INTEGER PRIMARY KEY,
  document_id     TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  line_no         INTEGER NOT NULL,

  description_raw TEXT NOT NULL,
  material_id     TEXT REFERENCES materials(id),
  hsn_code        TEXT,

  quantity  REAL,
  unit      TEXT,
  rate      REAL,
  amount    REAL,
  tax_rate  REAL,
  dc_number TEXT,
  dc_date   TEXT
);

CREATE INDEX IF NOT EXISTS ix_headers_date ON doc_headers(doc_date);
CREATE INDEX IF NOT EXISTS ix_documents_project ON documents(project_id);
CREATE INDEX IF NOT EXISTS ix_sites_project ON sites(project_id);
"""


# Starter list. Unmatched invoice lines auto-create unverified materials on top
# of these, so a gap here never blocks extraction.
MATERIAL_SEED = [
    ("Cement", "OPC Cement 53 Grade", "Bags", ["opc 53", "opc cement 53 grade", "cement opc-53", "opc-53"]),
    ("Cement", "OPC Cement 43 Grade", "Bags", ["opc 43", "opc cement 43 grade", "cement opc-43"]),
    ("Cement", "PPC Cement", "Bags", ["ppc", "portland pozzolana cement"]),
    ("Cement", "White Cement", "Bags", ["white cement"]),
    ("Concrete", "Ready Mix Concrete M20", "Cum", ["m020", "m20", "rmc m20"]),
    ("Concrete", "Ready Mix Concrete M25", "Cum", ["m025", "m25", "rmc m25"]),
    ("Concrete", "Ready Mix Concrete M30", "Cum", ["m030", "m30", "rmc m30", "m030-regular concrete"]),
    ("Steel", "TMT Steel Bar 8mm", "MT", ["tmt 8mm", "8mm tmt", "rebar 8mm"]),
    ("Steel", "TMT Steel Bar 10mm", "MT", ["tmt 10mm", "10mm tmt", "rebar 10mm"]),
    ("Steel", "TMT Steel Bar 12mm", "MT", ["tmt 12mm", "12mm tmt", "rebar 12mm", "steel bar 12"]),
    ("Steel", "TMT Steel Bar 16mm", "MT", ["tmt 16mm", "16mm tmt", "rebar 16mm"]),
    ("Steel", "Binding Wire", "Kg", ["binding wire", "gi binding wire"]),
    ("Steel", "Structural Steel", "MT", ["ms angle", "ms channel", "structural steel"]),
    ("Aggregate", "River Sand", "Tons", ["river sand", "natural sand"]),
    ("Aggregate", "M Sand", "Tons", ["m sand", "manufactured sand", "msand"]),
    ("Aggregate", "20mm Aggregate", "Cum", ["20mm aggregate", "20mm jelly"]),
    ("Aggregate", "40mm Aggregate", "Cum", ["40mm aggregate", "40mm jelly"]),
    ("Masonry", "Red Clay Brick", "Nos", ["red brick", "clay brick", "brick"]),
    ("Masonry", "AAC Block", "Nos", ["aac block", "aerated block"]),
    ("Masonry", "Concrete Solid Block", "Nos", ["solid block", "concrete block", "cc block"]),
    ("Finishing", "Wall Putty", "Bags", ["wall putty", "putty"]),
    ("Finishing", "Emulsion Paint", "Ltr", ["emulsion paint", "emulsion"]),
    ("Waterproof", "Waterproofing Compound", "Kg", ["waterproofing compound", "waterproof chemical"]),
]


@contextmanager
def db():
    """One connection per request.

    FastAPI runs sync endpoints in a threadpool and sqlite3 connections are not
    shareable across threads, so a module-level connection would be a bug.
    """
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    try:
        yield con
        con.commit()
    finally:
        con.close()


def new_id(prefix: str) -> str:
    return prefix + "-" + uuid.uuid4().hex[:10]


def seed_materials(con) -> int:
    """Idempotent: only fills an empty materials table."""
    if con.execute("SELECT 1 FROM materials LIMIT 1").fetchone():
        return 0

    for category, name, unit, aliases in MATERIAL_SEED:
        material_id = "MAT-" + name.upper().replace(" ", "-")
        con.execute(
            "INSERT INTO materials (id, code, name, category, unit, verified)"
            " VALUES (?, ?, ?, ?, ?, 1)",
            (material_id, material_id, name, category, unit),
        )
        # The canonical name is itself an alias, so an exact-name hit needs no
        # special case in the matcher.
        for alias in {name.lower(), *aliases}:
            con.execute(
                "INSERT OR IGNORE INTO material_aliases (alias, material_id) VALUES (?, ?)",
                (alias, material_id),
            )
    return len(MATERIAL_SEED)


def init() -> None:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    with db() as con:
        con.executescript(SCHEMA)
        seed_materials(con)
