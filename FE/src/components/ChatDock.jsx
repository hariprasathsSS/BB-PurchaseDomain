import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { IconChat, IconClose, IconSend } from "./Icons.jsx";

/* Ask-the-data panel. Lives in the shell rather than a tab so a question
   survives navigating away to check the answer.

   The server still returns the SQL it ran with every answer (see api.ask),
   this panel just doesn't show it — turn.sql stays on each turn's state in
   case a future "how was this counted" affordance wants it back. */

const SUGGESTIONS = [
  "How many documents are waiting to be reviewed?",
  "Total invoice value by vendor",
  "Which projects have documents that failed extraction?",
];

/* A table earns its place when it carries something the sentence cannot: more
   than one row, or more than one field. A single cell does not. */
function worthShowing(turn) {
  const rows = turn.rows ?? [];
  const columns = turn.columns ?? [];
  if (!rows.length || !columns.length) return false;
  return rows.length > 1 || columns.length > 1;
}

/* The model is asked for plain text, but one that has read the whole internet
   emits **bold** and `code` regardless — and .chat-text is pre-wrap, so the
   asterisks would show. Rendering the two it actually reaches for beats
   printing them, and beats adding a markdown dependency for two cases. */
function RichText({ text }) {
  const parts = String(text ?? "").split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

/* A column that is null the whole way down is telling the reader nothing — it
   is an artefact of the query having asked for it. Dropping them is what keeps
   a SELECT with a wide table from burying the two columns that matter. */
function Rows({ columns, rows }) {
  if (!columns?.length || !rows?.length) return null;

  const keep = columns
    .map((_, i) => i)
    .filter((i) => rows.some((r) => r[i] !== null && r[i] !== ""));
  if (!keep.length) return null;

  return (
    <div className="chat-rows">
      <table>
        <thead>
          <tr>{keep.map((i) => <th key={i}>{columns[i]}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {keep.map((i) => (
                <td key={i}>{row[i] === null ? "—" : String(row[i])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChatDock() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const log = useRef(null);
  const field = useRef(null);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [turns, pending]);

  useEffect(() => {
    if (!open) return;
    field.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") requestClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, turns.length]);

  /* The X asks first rather than just closing — an emptied conversation
     cannot be gotten back, so which the click meant needs to be explicit.
     Nothing to lose (an already-empty chat) skips the question entirely. */
  const requestClose = () => {
    if (turns.length === 0) { setOpen(false); return; }
    setConfirmingClose(true);
  };
  const clearAndClose = () => { setTurns([]); setConfirmingClose(false); setOpen(false); };
  const keepAndClose = () => { setConfirmingClose(false); setOpen(false); };

  async function ask(question) {
    if (!question || pending) return;
    /* Only the plain text goes back as history — the server re-runs the SQL it
       needs, and replaying rows would spend tokens on data it can just query. */
    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((t) => [...t, { role: "user", content: question }]);
    setDraft("");
    setPending(true);
    try {
      const res = await api.ask(question, history);
      setTurns((t) => [...t, {
        role: "assistant",
        content: res.answer,
        sql: res.sql,
        columns: res.columns,
        rows: res.rows,
        truncated: res.truncated,
      }]);
    } catch (e) {
      setTurns((t) => [...t, { role: "assistant", content: e.message, failed: true }]);
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        className="chat-bubble"
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Purchase Bot"
      >
        <IconChat width={22} height={22} />
      </button>
    );
  }

  return (
    <aside className="chat-dock" role="dialog" aria-label="Purchase Bot">
      <header className="chat-head">
        {confirmingClose ? (
          <div className="chat-close-confirm">
            <span>Clear this conversation?</span>
            <div className="spacer" />
            <button className="row-link" type="button" onClick={clearAndClose}>Yes, clear it</button>
            <button className="row-link" type="button" onClick={keepAndClose}>Cancel</button>
          </div>
        ) : (
          <>
            <div>
              <h2><span className="brand-red">Purchase</span> Bot</h2>
            </div>
            <div className="spacer" />
            <button className="close-x" onClick={requestClose} aria-label="Close">
              <IconClose />
            </button>
          </>
        )}
      </header>

      <div className="chat-log" ref={log}>
        {turns.length === 0 ? (
          <div className="chat-empty">
            <p>Ask a question about projects, documents, vendors or materials.</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="btn btn-quiet btn-sm" type="button" onClick={() => ask(s)}>
                {s}
              </button>
            ))}
          </div>
        ) : null}

        {turns.map((turn, i) => (
          <div key={i} className={`chat-turn is-${turn.role}${turn.failed ? " is-failed" : ""}`}>
            <div className="chat-text"><RichText text={turn.content} /></div>

            {/* The rows are the answer, so they sit in the turn. They used to be
                folded inside "How this was counted", which meant a question
                like "list the projects" showed one flat sentence and hid the
                actual list behind a disclosure meant for auditing SQL.

                A lone scalar stays hidden: the sentence already says "7", and a
                one-cell table under it is furniture. */}
            {worthShowing(turn) ? (
              <div className="chat-result">
                <Rows columns={turn.columns} rows={turn.rows} />
                <div className="chat-result-foot">
                  {turn.rows.length} {turn.rows.length === 1 ? "row" : "rows"}
                  {turn.truncated ? " · first 200 only" : ""}
                </div>
              </div>
            ) : null}
          </div>
        ))}

        {pending ? <div className="chat-turn is-assistant chat-wait">Working…</div> : null}
      </div>

      <form className="chat-ask" onSubmit={(e) => { e.preventDefault(); ask(draft.trim()); }}>
        <input
          ref={field}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about the data…"
          aria-label="Your question"
        />
        <button className="btn btn-ink btn-sm" type="submit" disabled={pending || !draft.trim()}>
          <IconSend width={17} height={17} />
        </button>
      </form>
    </aside>
  );
}
