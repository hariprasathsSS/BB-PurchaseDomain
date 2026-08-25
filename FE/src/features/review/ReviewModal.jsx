import { useCallback, useEffect, useState } from "react";
import { Modal } from "../../components/Modal.jsx";
import { HeaderFields } from "./HeaderFields.jsx";
import { LineItems } from "./LineItems.jsx";
import { HEADER_KEYS, LINE_FIELDS } from "./schema.js";
import { api } from "../../lib/api.js";
import { isLocked, isWaiting, projectOf } from "../../lib/format.js";

const blank = (v) => (typeof v === "string" && v.trim() === "" ? null : v === "" ? null : v);

/* What gets PUT: every field the form owns, with empties normalised to null so
   clearing a wrong value actually clears it server-side. */
function buildEdits(draft) {
  const header = {};
  HEADER_KEYS.forEach((key) => { header[key] = blank(draft.header[key] ?? ""); });

  const lines = draft.lines.map((line) => {
    const out = { line_no: line.line_no };
    LINE_FIELDS.forEach((f) => { out[f.key] = blank(line[f.key] ?? ""); });
    return out;
  });

  return { header, lines };
}

export function ReviewModal({ docId, materials, onClose, onChanged }) {
  const [doc, setDoc] = useState(null);
  const [draft, setDraft] = useState(null);
  const [reviewer, setReviewer] = useState(() => localStorage.getItem("reviewerName") ?? "");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  /* Load, then re-read only while extraction is still running — the loop
     schedules its own next tick and so stops itself the moment the document
     settles. Nothing polls once the form is on screen, which is what keeps a
     refresh from discarding edits in progress. */
  useEffect(() => {
    let cancelled = false;
    let timer = null;
    let watched = false;

    const read = async () => {
      const fresh = await api.getDocument(docId).catch(() => null);
      if (cancelled || !fresh) return;
      setDoc(fresh);

      if (isWaiting(fresh)) {
        watched = true;
        timer = setTimeout(read, 3000);
      } else if (watched) {
        onChanged();      // extraction finished while open — refresh the lists
      }
    };

    read();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [docId, onChanged]);

  useEffect(() => {
    if (!doc || isWaiting(doc) || isLocked(doc)) return;
    setDraft((prev) => prev ?? {
      header: { ...(doc.header ?? {}) },
      lines: (doc.lines ?? []).map((l) => ({ ...l })),
    });
  }, [doc]);

  const setHeader = (key, value) =>
    setDraft((d) => ({ ...d, header: { ...d.header, [key]: value } }));

  const setLine = (lineNo, key, value) =>
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l) => (l.line_no === lineNo ? { ...l, [key]: value } : l)),
    }));

  const save = useCallback(async ({ silent = false } = {}) => {
    setErr("");
    try {
      const updated = await api.saveDocument(docId, buildEdits(draft));
      if (!silent) { setDoc(updated); onChanged(); }
      return updated;
    } catch (e) {
      setErr(`Could not save — ${e.message}`);
      return null;
    }
  }, [docId, draft, onChanged]);

  const rememberReviewer = () => {
    const name = reviewer.trim();
    if (name) localStorage.setItem("reviewerName", name);
    return name;
  };

  const decide = async (kind) => {
    const name = rememberReviewer();
    if (!name) { setErr("Enter your name first."); return; }
    if (kind === "reject" && !reason.trim()) {
      setErr("A rejection reason is required.");
      return;
    }

    setBusy(true);
    /* Edits are saved before the verdict, so what gets approved is what is on
       screen — not the extractor's original guess. */
    if (!(await save({ silent: true }))) { setBusy(false); return; }

    try {
      const updated = kind === "approve"
        ? await api.approveDocument(docId, name)
        : await api.rejectDocument(docId, name, reason.trim());
      setDoc(updated);
      onChanged();
    } catch (e) {
      setErr(`Could not ${kind} — ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    await api.retryExtraction(docId);
    setDoc(await api.getDocument(docId).catch(() => doc));
    onChanged();
  };

  const subtitle = doc ? `${doc.document_id} — ${projectOf(doc)}` : docId;

  return (
    <Modal title="Review document" subtitle={subtitle} wide onClose={onClose}>
      {!doc ? <div className="empty">Loading…</div> : (
        <>
          <div className="doc-pages">
            {doc.file_paths.map((path) => (
              <a key={path} href={`/${path}`} target="_blank" rel="noopener noreferrer">
                <img src={`/${path}`} alt="captured page" />
              </a>
            ))}
          </div>

          <StatusBanner doc={doc} onRetry={retry} />

          {isWaiting(doc) || doc.status === "FAILED" ? null : (
            <Body
              doc={doc}
              draft={draft}
              materials={materials}
              reviewer={reviewer}
              setReviewer={setReviewer}
              rejecting={rejecting}
              setRejecting={setRejecting}
              reason={reason}
              setReason={setReason}
              err={err}
              busy={busy}
              onHeader={setHeader}
              onLine={setLine}
              onSave={save}
              onDecide={decide}
            />
          )}
        </>
      )}
    </Modal>
  );
}

function StatusBanner({ doc, onRetry }) {
  if (isWaiting(doc)) {
    return <div className="banner banner-wait">Extraction in progress… this updates automatically.</div>;
  }
  if (doc.status === "FAILED") {
    return (
      <div className="banner banner-err">
        Extraction failed — {doc.error || "unknown error"}.
        <div style={{ marginTop: 10 }}>
          <button className="btn btn-out" onClick={onRetry}>Retry extraction</button>
        </div>
      </div>
    );
  }
  if (doc.status === "APPROVED") {
    return (
      <div className="banner banner-ok">
        Approved by {doc.header?.reviewed_by} on {doc.header?.reviewed_at}.
      </div>
    );
  }
  if (doc.status === "REJECTED") {
    return (
      <div className="banner banner-err">
        Rejected by {doc.header?.reviewed_by} on {doc.header?.reviewed_at}
        {doc.header?.rejection_reason ? ` — ${doc.header.rejection_reason}` : ""}
      </div>
    );
  }
  return null;
}

function Body({
  doc, draft, materials, reviewer, setReviewer, rejecting, setRejecting,
  reason, setReason, err, busy, onHeader, onLine, onSave, onDecide,
}) {
  const locked = isLocked(doc);
  const header = locked ? (doc.header ?? {}) : draft?.header;
  const lines = locked ? (doc.lines ?? []) : draft?.lines;

  if (!header) return <div className="empty">Loading…</div>;

  return (
    <>
      <HeaderFields header={header} locked={locked} onChange={onHeader} />
      <LineItems lines={lines ?? []} materials={materials} locked={locked} onChange={onLine} />

      {locked ? null : (
        <div className="field-section">
          <h3>Decision</h3>
          <div className="reviewer-row">
            <input
              className="input"
              placeholder="Your name"
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
            />
            <button className="btn btn-quiet" onClick={() => onSave()} disabled={busy}>
              Save changes
            </button>
            <button className="btn btn-ink" onClick={() => onDecide("approve")} disabled={busy}>
              Approve
            </button>
            <button
              className="btn btn-out"
              onClick={() => setRejecting(true)}
              disabled={busy}
            >
              Reject
            </button>
          </div>

          {rejecting ? (
            <div className="reject-panel">
              <textarea
                placeholder="Why is this being rejected?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              {/* Signal orange: the irreversible half of the decision. */}
              <button
                className="btn btn-signal"
                style={{ width: "fit-content" }}
                onClick={() => onDecide("reject")}
                disabled={busy}
              >
                Confirm reject
              </button>
            </div>
          ) : null}

          {err ? <div className="banner banner-err" style={{ marginTop: 16 }}>{err}</div> : null}
        </div>
      )}
    </>
  );
}
