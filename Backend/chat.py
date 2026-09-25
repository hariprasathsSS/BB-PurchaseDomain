"""Read-only question answering over poc.db — text to SQL, then SQL to a sentence.

    POST /api/v1/chat  {"question": "...", "history": [...]}

Two model calls. The first writes one SELECT against the live schema; the second
turns the rows it returned into plain English. Nothing here writes: the only
connection this module opens is `mode=ro`, so SQLite itself refuses every INSERT,
UPDATE, DROP and ATTACH regardless of what the model was talked into emitting.

There is no vector store. "Retrieval" for text-to-SQL means fetching the relevant
schema, and the whole schema is ten tables — roughly 1.5k tokens — so the answer
to "which tables matter" is always "all of them".
ponytail: send the whole DDL; index it if the schema ever passes ~40 tables.

Groq and OpenAI both serve an OpenAI-shaped API, so the `openai` package below
is only the HTTP client — which credential and base URL it points at is
CHAT_PROVIDER's call. Defaults to reusing the same OPENAI_API_KEY the document
reader already has configured, so a deployment with only an OpenAI key needs
nothing extra to get the chat working; set CHAT_PROVIDER=groq (and
GROQ_API_KEY) to go back to a separate, free-tier credential instead — useful
if extraction is on Anthropic and this would otherwise be the only OpenAI
spend in the project.

Env overrides (main.py loads .env before importing this module):
    CHAT_PROVIDER   "openai" or "groq"                  (default: openai)
    OPENAI_API_KEY  required if CHAT_PROVIDER=openai     (same key extraction uses)
    GROQ_API_KEY    required if CHAT_PROVIDER=groq
    CHAT_MODEL      overrides the provider's own default (gpt-4o-mini / llama-3.3-70b-versatile)
    CHAT_BASE_URL   overrides the provider's own default endpoint
"""

from __future__ import annotations

import os
import re
import sqlite3
import time

try:
    import openai
except ImportError:          # the guard and the schema prompt below stay
    openai = None            # importable and self-testable without the SDK

import db
from extract import EngineNotConfigured


class UnsafeQuery(ValueError):
    """The model emitted something that is not a single read-only statement."""


class ModelUnavailable(RuntimeError):
    """The provider accepted the request but returned no completion."""


# base_url=None means "the openai package's own default" (api.openai.com) —
# passing it explicitly here anyway would work too, but None is what the SDK
# itself treats as "use the default", so this stays exactly one code path
# rather than an if/else between "pass a URL" and "don't".
_CHAT_PROVIDERS = {
    "openai": {"key_env": "OPENAI_API_KEY", "base_url": None, "model": "gpt-4o-mini"},
    "groq": {"key_env": "GROQ_API_KEY", "base_url": "https://api.groq.com/openai/v1",
              "model": "llama-3.3-70b-versatile"},
}

CHAT_PROVIDER = os.environ.get("CHAT_PROVIDER", "openai").strip().lower()
_PROVIDER_CFG = _CHAT_PROVIDERS.get(CHAT_PROVIDER, _CHAT_PROVIDERS["openai"])

BASE_URL = os.environ.get("CHAT_BASE_URL", _PROVIDER_CFG["base_url"])
MODEL = os.environ.get("CHAT_MODEL", _PROVIDER_CFG["model"])

MAX_ROWS = 200          # never fetchall() — one bad GROUP BY should not fill a response
QUERY_TIMEOUT = 5.0     # seconds before an accidental cartesian join is aborted
HISTORY_TURNS = 6       # how much of the conversation is replayed to the model
ATTEMPTS = 3            # tries per completion — free tiers fail intermittently
BACKOFF = 1.5           # seconds before the second try, doubled for the third


def _client():
    if openai is None:
        raise EngineNotConfigured(
            "The openai package is not installed — pip install -r requirements.txt"
        )
    key = os.environ.get(_PROVIDER_CFG["key_env"])
    if not key:
        raise EngineNotConfigured(
            f"No {_PROVIDER_CFG['key_env']} found. Set it in Backend/.env and restart "
            "the server — or set CHAT_PROVIDER to switch which credential this reads."
        )
    return openai.OpenAI(base_url=BASE_URL, api_key=key) if BASE_URL else openai.OpenAI(api_key=key)


# ── the read-only connection ─────────────────────────────────────────────────

def readonly() -> sqlite3.Connection:
    """The real guard. A `mode=ro` connection cannot be talked into writing —
    every layer below this one only buys a clearer error message."""
    # as_uri() percent-encodes the path — this repo already lives under a
    # directory with an "&" in it, which is a query separator in a sqlite URI.
    con = sqlite3.connect(db.DB_PATH.as_uri() + "?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    return con


def _deadline(seconds: float):
    """sqlite calls this every N opcodes; truthy aborts the query."""
    stop = time.monotonic() + seconds
    return lambda: time.monotonic() > stop


# ── the guard ────────────────────────────────────────────────────────────────

_COMMENTS = re.compile(r"--[^\n]*|/\*.*?\*/", re.S)
_FENCE = re.compile(r"^```(?:sql)?\s*|\s*```$", re.I | re.M)
_BANNED = re.compile(r"\b(ATTACH|DETACH|PRAGMA|VACUUM)\b", re.I)


def clean_sql(raw: str) -> str:
    """Strip the markdown fence models wrap SQL in, and any trailing semicolon."""
    return _FENCE.sub("", (raw or "").strip()).strip().rstrip(";").strip()


def check_sql(sql: str) -> str:
    """One read-only statement, or raise. Returns the statement unchanged.

    Comments are stripped before the checks so a commented-out semicolon cannot
    smuggle a second statement past the one-statement test.
    """
    if not sql:
        raise UnsafeQuery("the model returned no query")
    bare = _COMMENTS.sub(" ", sql).strip().rstrip(";").strip()
    if ";" in bare:
        raise UnsafeQuery("only one statement may be run per question")
    if not re.match(r"^(SELECT|WITH)\b", bare, re.I):
        raise UnsafeQuery("only SELECT queries are allowed — this bot cannot change data")
    if _BANNED.search(bare):
        raise UnsafeQuery("only SELECT queries are allowed — this bot cannot change data")
    return sql


def run_sql(sql: str) -> tuple[list[str], list[list], bool]:
    """Execute a checked statement and return (columns, rows, truncated)."""
    check_sql(sql)
    con = readonly()
    con.set_progress_handler(_deadline(QUERY_TIMEOUT), 10_000)
    try:
        cur = con.execute(sql)
        rows = cur.fetchmany(MAX_ROWS)
        truncated = len(cur.fetchmany(1)) > 0
        columns = [d[0] for d in cur.description or []]
    finally:
        con.close()
    return columns, [list(r) for r in rows], truncated


# ── the prompt ───────────────────────────────────────────────────────────────

def schema_ddl() -> str:
    """Read the DDL off the live database rather than restating db.SCHEMA here —
    this way the prompt cannot drift, and it picks up whatever db.migrate()
    added to a poc.db that predates a column."""
    con = readonly()
    try:
        return "\n\n".join(
            r["sql"] for r in con.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL "
                "AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        )
    finally:
        con.close()


# Worked examples matter more than prose here: they teach the join shape once
# instead of describing it three times.
EXAMPLES = """\
Q: how many documents are waiting to be reviewed?
A: SELECT COUNT(*) AS waiting FROM documents WHERE status = 'EXTRACTED'

Q: total invoice value by vendor
A: SELECT COALESCE(v.name, h.vendor_name_raw) AS vendor,
          ROUND(SUM(h.total_value), 2) AS total
     FROM doc_headers h
     JOIN documents d ON d.id = h.document_id
     LEFT JOIN vendors v ON v.id = h.vendor_id
    WHERE d.document_type = 'INVOICE'
    GROUP BY vendor
    ORDER BY total DESC
    LIMIT 50

Q: how much cement was ordered on project SITE-A?
A: SELECT m.name, l.unit, ROUND(SUM(l.quantity), 3) AS qty
     FROM doc_lines l
     JOIN documents d ON d.id = l.document_id
     JOIN projects p ON p.id = d.project_id
     LEFT JOIN materials m ON m.id = l.material_id
    WHERE p.code = 'SITE-A' AND m.category = 'Cement'
    GROUP BY m.name, l.unit

Q: which projects have documents that failed extraction?
A: SELECT p.code, p.name, COUNT(*) AS failed
     FROM documents d JOIN projects p ON p.id = d.project_id
    WHERE d.status = 'FAILED'
    GROUP BY p.code, p.name
"""


def sql_system_prompt() -> str:
    return f"""You write SQLite SELECT queries against a construction purchase database.

SCHEMA
{schema_ddl()}

DOMAIN NOTES
- documents.status is one of {sorted(db.STATUSES)}. EXTRACTED means read but not
  yet reviewed by a human; APPROVED/REJECTED are that reviewer's verdict.
- documents.document_type is one of {sorted(db.DOC_TYPES)} and is the classifier's
  label. doc_headers.doc_kind is what the model read off the page itself — the two
  can disagree; prefer documents.document_type unless the question is about the
  printed document.
- documents.source is one of {sorted(db.SOURCES)}: SCAN came from the phone,
  UPLOAD from the web console.
- Document totals live in doc_headers (total_value, basic_value, the tax amount
  columns), one row per document, joined as doc_headers.document_id = documents.id.
  Per-line amounts live in doc_lines.amount. Do not sum both for one figure.
- doc_lines.material_id is NULL when the description could not be matched to the
  materials master, so join materials with LEFT JOIN and expect NULLs.
- doc_headers.reviewed_at IS NULL means nobody has reviewed that document yet.
- Dates are ISO-8601 TEXT ('YYYY-MM-DD'). Use date(), strftime() and plain string
  comparison; doc_date_raw is the unparsed original and is not comparable.
- Money is INR REAL. Round money to 2 decimals in the output.
- projects.code is the human reference ('SITE-A'); projects.id is 'PRJ-...'.

EXAMPLES
{EXAMPLES}
RULES
- Reply with the SQL and nothing else. No prose, no markdown fence, no explanation.
- Exactly one SELECT (a leading WITH is fine). Never INSERT, UPDATE, DELETE, DROP,
  ALTER, ATTACH or PRAGMA — you are read-only and cannot change anything.
- Always add a LIMIT of at most {MAX_ROWS} unless the query returns one aggregate row.
- Give every computed column a readable alias.
- Never SELECT *. The rows are shown to the person who asked, so select only the
  columns they would recognise and alias them as words: `p.code AS Project`,
  `h.vendor_name_raw AS Vendor`, `h.total_value AS Total`. Leave out internal
  ids and empty columns unless the question is about them.
- If the message is not a data question at all — a greeting, a thank-you, or a
  question about what you can do — reply with CHAT: followed by one friendly
  sentence, and no SQL. Say what you can look up: projects, documents, vendors,
  materials and purchase totals.
- If it is a data question but these tables cannot answer it, reply with exactly
  CANNOT_ANSWER and nothing else."""


ANSWER_SYSTEM = """You answer questions about a construction purchase database for
the person running the purchase desk.

You are given the question, the SQL that was run, and the rows it returned. The
rows are also shown to the reader as a table directly beneath your answer, so
you are writing the lead, not the listing.

- Lead with the direct answer, and always state the actual figures.
- Name things, do not just count them. "3 projects — B&B Construction, Joel
  Builders and Fin Contructions" tells the reader something; "There are 3
  projects." makes them go looking. Name them when there are six or fewer;
  above that, give the count and name the largest two or three.
- Say what stands out if the rows show it — the biggest value, an outlier, a
  count sitting at zero that probably should not be.
- Money is Indian rupees: ₹1,23,456.00, lakh grouping.
- Two or three sentences is plenty, and one is fine. Do not pad, do not restate
  the question, and do not re-list every row that is already in the table.
- If nothing matched, say so plainly and say what was looked for. Never invent
  a row that is not in the result.
- Never mention SQL, tables or columns, and never offer to do anything else:
  you can only read.
- Plain sentences only. No markdown headings, no bullet lists, no tables — the
  rows are already shown as a table beneath you."""

GREETING = (
    "Hello. Ask me anything about what the purchase desk has taken in — projects, "
    "documents, vendors, materials or totals. For example: “which invoices are "
    "still waiting on a decision?” or “what have we spent on cement this month?”"
)

# Small talk answered here rather than by the model. A greeting is the first
# thing anyone types, the reply never varies, and leaving it to the model means
# a free tier occasionally decides "hi" is a data question it cannot answer —
# which is how a first-time user gets told the database cannot help them.
_PLEASANTRIES = {
    "hi", "hii", "hello", "helo", "hey", "yo", "hi there", "hello there",
    "good morning", "good afternoon", "good evening", "greetings",
    "thanks", "thank you", "thanks a lot", "thankyou", "ta", "cheers",
    "ok", "okay", "k", "cool", "nice", "great",
    "bye", "goodbye", "see you",
    "who are you", "what are you", "what can you do", "what can i ask",
    "help", "what do you do",
}


def small_talk(question: str) -> str | None:
    """The reply for a greeting or a thank-you, or None if it is a real question.

    Exact match on the normalised text only: "hi how many projects" has to reach
    the model, because it is asking something.
    """
    words = re.sub(r"[^a-z0-9 ]+", " ", question.lower())
    normalised = " ".join(words.split())
    if normalised not in _PLEASANTRIES:
        return None
    if normalised in {"thanks", "thank you", "thanks a lot", "thankyou", "ta", "cheers"}:
        return "Any time. Ask again whenever you need a figure checked."
    if normalised in {"bye", "goodbye", "see you"}:
        return "Cheerio."
    return GREETING


def _no_query(text: str) -> dict:
    """An answer that ran no SQL, in the same shape as one that did."""
    return {"answer": text, "sql": None, "columns": [], "rows": [], "truncated": False}


# ── the flow ─────────────────────────────────────────────────────────────────

def _error_detail(reply) -> str:
    """OpenRouter reports upstream trouble — rate limits and overloaded providers
    on the :free tiers above all — as a 200 whose body carries `error` and no
    `choices`, which the SDK hands back as choices=None."""
    detail = (getattr(reply, "model_extra", None) or {}).get("error") or "no choices returned"
    if isinstance(detail, dict):
        detail = detail.get("message") or detail
    return str(detail)


def _ask(client, messages: list[dict], sleep=time.sleep) -> str:
    """One completion, or a clear error. Retries the empty-completion case.

    Every call goes through here, so the retry belongs here rather than at each
    of the three call sites. "Overloaded" and "rate limit" are the provider
    having a moment, not the question being wrong, so a couple of tries a second
    apart usually gets an answer — and the message the user finally sees says
    what to do rather than naming a model id they cannot act on.
    """
    detail = ""
    for attempt in range(ATTEMPTS):
        try:
            reply = client.chat.completions.create(model=MODEL, messages=messages)
        except openai.RateLimitError as exc:
            # A quota is not a blip: retrying spends time and changes nothing,
            # so this one gives up immediately and says which limit was hit.
            raise ModelUnavailable(_quota_message(exc)) from exc
        except openai.APIError as exc:
            detail = str(getattr(exc, "message", None) or exc)
            if attempt < ATTEMPTS - 1:
                sleep(BACKOFF * 2 ** attempt)
                continue
            raise ModelUnavailable(
                "The answering service could not be reached — please try again in a "
                f"moment. ({detail})"
            ) from exc

        if reply.choices:
            return (reply.choices[0].message.content or "").strip()
        detail = _error_detail(reply)
        if attempt < ATTEMPTS - 1:
            sleep(BACKOFF * 2 ** attempt)
    raise ModelUnavailable(
        f"The answering service is busy right now — please try again in a moment. ({detail})"
    )


def _quota_message(exc) -> str:
    """A 429 is either "too fast" or "that is your lot for today", and the two
    need different things from the reader — one waits a second, the other has to
    top up the key. Saying "busy, try again" to someone out of daily quota sends
    them round a loop that cannot succeed."""
    text = str(exc)
    if "per-day" in text or "daily" in text:
        return (
            "The free daily allowance for the answering model is used up, so no "
            "more questions can be answered today. It resets every day; adding "
            "credits to the OpenRouter key lifts the cap."
        )
    return "Questions are arriving faster than the free tier allows — try again in a few seconds."


def answer(question: str, history: list[dict] | None = None) -> dict:
    """Question in, {answer, sql, columns, rows, truncated} out.

    History is whatever the client replays — this is stateless by design.
    ponytail: no conversation table; add one when a thread needs to reopen
    across sessions.
    """
    # Answered before the model is even reached: no round trip, and no chance of
    # a greeting being mistaken for an unanswerable query.
    if (pleasantry := small_talk(question)) is not None:
        return _no_query(pleasantry)

    client = _client()

    turns = []
    for turn in (history or [])[-HISTORY_TURNS:]:
        role = "assistant" if turn.get("role") == "assistant" else "user"
        text = str(turn.get("content") or "").strip()
        if text:
            turns.append({"role": role, "content": text[:2000]})

    messages = [
        {"role": "system", "content": sql_system_prompt()},
        *turns,
        {"role": "user", "content": question},
    ]
    sql = clean_sql(_ask(client, messages))

    if sql.upper().startswith("CHAT:"):
        return _no_query(sql[len("CHAT:"):].strip() or GREETING)

    if sql.upper().startswith("CANNOT_ANSWER"):
        return _no_query(
            "That is not in the purchase data. What is here: projects and their "
            "sites, every document captured against them, the vendors they came "
            "from, the materials on them, and what it all totals. Ask about any "
            "of those and I can check it."
        )

    check_sql(sql)
    try:
        columns, rows, truncated = run_sql(sql)
    except sqlite3.Error as exc:
        # One retry with the error fed back. Most failures are a slipped column
        # name, which the model fixes immediately when shown the message.
        messages += [
            {"role": "assistant", "content": sql},
            {"role": "user", "content": f"That query failed: {exc}. Return corrected SQL only."},
        ]
        sql = clean_sql(_ask(client, messages))
        check_sql(sql)
        columns, rows, truncated = run_sql(sql)

    shown = {"columns": columns, "rows": rows, "truncated": truncated}
    prose = _ask(client, [
        {"role": "system", "content": ANSWER_SYSTEM},
        {"role": "user", "content": f"Question: {question}\n\nSQL: {sql}\n\nResult: {shown}"},
    ])
    return {"answer": prose, "sql": sql, "columns": columns, "rows": rows,
            "truncated": truncated}


if __name__ == "__main__":
    # The guard is the security-relevant branch and the only part that runs
    # without a network call, so it is what the self-check covers.
    for _bad in (
        "INSERT INTO projects (id, code, name) VALUES ('x','X','X')",
        "DROP TABLE projects",
        "DELETE FROM documents",
        "UPDATE documents SET status = 'APPROVED'",
        "SELECT 1; DELETE FROM documents",
        "SELECT 1 -- a comment\n; DROP TABLE projects",
        "PRAGMA writable_schema = 1",
        "ATTACH DATABASE 'evil.db' AS evil",
        "WITH x AS (SELECT 1) SELECT * FROM x; DROP TABLE projects",
        "",
    ):
        try:
            check_sql(clean_sql(_bad))
        except UnsafeQuery:
            pass
        else:
            raise AssertionError(f"guard let this through: {_bad!r}")

    for _ok in (
        "SELECT COUNT(*) FROM documents",
        "select * from projects limit 5;",
        "-- how many\nSELECT COUNT(*) AS n FROM vendors",
        "WITH t AS (SELECT id FROM documents) SELECT COUNT(*) FROM t",
    ):
        assert check_sql(clean_sql(_ok)), _ok

    # An error payload (choices=None) must be retried, then surface as
    # ModelUnavailable — not as a TypeError from subscripting None.
    class _Err:
        choices = None
        model_extra = {"error": {"message": "Service temporarily overloaded"}}

    class _Ok:
        class _Choice:
            class message:
                content = "SELECT 1"
        choices = [_Choice()]

    def _fake(*replies):
        seq = list(replies)

        class _Fake:
            calls = 0

            class chat:
                class completions:
                    @staticmethod
                    def create(**kw):
                        _Fake.calls += 1
                        return seq.pop(0)
        return _Fake

    _flaky = _fake(_Err(), _Err(), _Ok())
    assert _ask(_flaky(), [], sleep=lambda s: None) == "SELECT 1"
    assert _flaky.calls == 3, _flaky.calls

    _dead = _fake(*[_Err()] * ATTEMPTS)
    try:
        _ask(_dead(), [], sleep=lambda s: None)
    except ModelUnavailable as _exc:
        assert "try again" in str(_exc) and "overloaded" in str(_exc), _exc
    else:
        raise AssertionError("an empty completion must raise ModelUnavailable")
    assert _dead.calls == ATTEMPTS, _dead.calls

    # A model that fences its reply must not defeat the SELECT check.
    assert clean_sql("```sql\nSELECT 1\n```") == "SELECT 1"

    # Layer 1 on its own: even a statement the guard never sees cannot write.
    if db.DB_PATH.exists():
        _con = readonly()
        try:
            _con.execute("CREATE TABLE _selfcheck (x INT)")
        except sqlite3.OperationalError:
            pass
        else:
            raise AssertionError("the read-only connection accepted a write")
        finally:
            _con.close()

        assert schema_ddl().count("CREATE TABLE") >= 8, "schema prompt looks empty"
        _cols, _rows, _trunc = run_sql("SELECT code, name FROM projects ORDER BY code")
        assert _cols == ["code", "name"] and _rows, _rows

    print("self-check passed")
