import { useCallback, useEffect, useState } from "react";
import { StatusPill } from "../../components/Pills.jsx";
import { IconArrow, IconBack } from "../../components/Icons.jsx";
import { HeaderFields } from "../../features/review/HeaderFields.jsx";
import { LineItems } from "../../features/review/LineItems.jsx";
import { HEADER_KEYS, LINE_FIELDS } from "../../features/review/schema.js";
import { api } from "../../lib/api.js";
import { go } from "../../lib/useHashRoute.js";
import { isLocked, isWaiting, money, shortDate } from "../../lib/format.js";

const blank = (v) => (typeof v === "string" && v.trim() === "" ? null : v === "" ? null : v);

/* What gets PUT — same shape ReviewModal saves, kept identical so a PO's
   edits behave exactly like every other document's. */
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

/* The PO is why this page was opened — it keeps the full width and its full
   edit/approve/reject workflow. The scanned page and whatever invoices
   already carry its number are supporting material, not equal billing: a
   narrow sidebar, not a second full column. An invoice is a link through to
   its own full review, not reproduced here — a summary line is what's needed
   to recognise it, not its whole line-item table a second time.

   Matching is a direct po_number == this PO's own doc_number lookup, not
   the fuller materials/qty/price reconciliation described in
   docs/PROJECT_PLAN.md Phase 3 — that engine doesn't exist yet, so this
   shows what can honestly be shown today: which invoices already claim
   this PO, for a human to open and compare. */
export function ComparePage({ documentId, docs, materials, onOpenDocument, reload }) {
  const [po, setPo] = useState(null);
  const [draft, setDraft] = useState(null);
  const [reviewer, setReviewer] = useState(() => localStorage.getItem("reviewerName") ?? "");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    let watched = false;

    const read = async () => {
      const fresh = await api.getDocument(documentId).catch(() => null);
      if (cancelled || !fresh) return;
      setPo(fresh);
      if (isWaiting(fresh)) { watched = true; timer = setTimeout(read, 3000); }
      else if (watched) reload();
    };

    read();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [documentId, reload]);

  useEffect(() => {
    if (!po || isWaiting(po) || isLocked(po)) return;
    setDraft((prev) => prev ?? {
      header: { ...(po.header ?? {}) },
      lines: (po.lines ?? []).map((l) => ({ ...l })),
    });
  }, [po]);

  const setHeader = (key, value) => setDraft((d) => ({ ...d, header: { ...d.header, [key]: value } }));
  const setLine = (lineNo, key, value) =>
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l) => (l.line_no === lineNo ? { ...l, [key]: value } : l)),
    }));

  const save = useCallback(async ({ silent = false } = {}) => {
    setErr("");
    try {
      const updated = await api.saveDocument(documentId, buildEdits(draft));
      if (!silent) { setPo(updated); reload(); }
      return updated;
    } catch (e) {
      setErr(`Could not save — ${e.message}`);
      return null;
    }
  }, [documentId, draft, reload]);

  const decide = async (kind) => {
    const name = reviewer.trim();
    if (!name) { setErr("Enter your name first."); return; }
    if (kind === "reject" && !reason.trim()) { setErr("A rejection reason is required."); return; }
    localStorage.setItem("reviewerName", name);

    setBusy(true);
    if (!(await save({ silent: true }))) { setBusy(false); return; }
    try {
      const updated = kind === "approve"
        ? await api.approveDocument(documentId, name)
        : await api.rejectDocument(documentId, name, reason.trim());
      setPo(updated);
      reload();
    } catch (e) {
      setErr(`Could not ${kind} — ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const retry = async () => {
    await api.retryExtraction(documentId);
    setPo(await api.getDocument(documentId).catch(() => po));
    reload();
  };

  if (!po) {
    return <div className="band"><div className="col"><div className="empty">Loading…</div></div></div>;
  }

  const matches = docs.filter(
    (d) => d.document_type === "INVOICE" && d.project_id === po.project_id
      && d.po_number && d.po_number === po.doc_number
  );

  const locked = isLocked(po);
  const header = locked ? (po.header ?? {}) : draft?.header;
  const lines = locked ? (po.lines ?? []) : draft?.lines;

  return (
    <div className="band">
      <div className="col">
        <div className="phead">
          <button className="back" type="button" onClick={() => go(`/project/${po.project_id}`)}>
            <IconBack width={16} height={16} />
            {po.project_code ?? "Project"}
          </button>

          <div className="phead-main">
            <div>
              <div className="code">{po.doc_number ?? po.document_id.slice(0, 8)}</div>
              <div className="pname">Purchase order — {po.project_name}</div>
            </div>
            <div className="spacer" />
            <StatusPill status={po.status} />
          </div>

          <div className="phead-meta">
            <span>{po.vendor_name ?? "Vendor not read yet"}</span>
            <span className="sep">·</span>
            <span>{shortDate(po.uploaded_at)}</span>
            {money(po.total_value) ? (
              <>
                <span className="sep">·</span>
                <span><b>{money(po.total_value)}</b></span>
              </>
            ) : null}
          </div>
        </div>

        <div className="section-head" style={{ marginTop: 28 }}>
          <span className="eyebrow">Overview</span>
        </div>

        <div className="compare-layout">
          <div className="card compare-main">
            {isWaiting(po) ? (
              <div className="banner banner-wait">Extraction in progress… this updates automatically.</div>
            ) : null}

            {po.status === "FAILED" ? (
              <div className="banner banner-err">
                Extraction failed — {po.error || "unknown error"}.
                <div style={{ marginTop: 10 }}>
                  <button className="btn btn-out" onClick={retry}>Retry extraction</button>
                </div>
              </div>
            ) : null}

            {!isWaiting(po) && po.status !== "FAILED" && header ? (
              <>
                <HeaderFields header={header} locked={locked} onChange={setHeader} />
                <LineItems lines={lines ?? []} materials={materials} locked={locked} onChange={setLine} />

                {locked ? (
                  <div className={`banner ${po.status === "APPROVED" ? "banner-ok" : "banner-err"}`} style={{ marginTop: 16 }}>
                    {po.status === "APPROVED"
                      ? `Approved by ${po.header?.reviewed_by} on ${po.header?.reviewed_at}`
                      : `Rejected by ${po.header?.reviewed_by} on ${po.header?.reviewed_at}${po.header?.rejection_reason ? ` — ${po.header.rejection_reason}` : ""}`}
                  </div>
                ) : (
                  <div className="field-section">
                    <h3>Decision</h3>
                    <div className="reviewer-row">
                      <input
                        className="input"
                        placeholder="Your name"
                        value={reviewer}
                        onChange={(e) => setReviewer(e.target.value)}
                      />
                      <button className="btn btn-quiet" onClick={() => save()} disabled={busy}>Save changes</button>
                      <button className="btn btn-ink" onClick={() => decide("approve")} disabled={busy}>Approve</button>
                      <button className="btn btn-out" onClick={() => setRejecting(true)} disabled={busy}>Reject</button>
                    </div>

                    {rejecting ? (
                      <div className="reject-panel">
                        <textarea
                          placeholder="Why is this being rejected?"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                        <button
                          className="btn btn-signal"
                          style={{ width: "fit-content" }}
                          onClick={() => decide("reject")}
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
            ) : null}
          </div>

          <div className="compare-aside">
            <div className="compare-side">
              {po.file_paths.map((path) => (
                <a key={path} href={`/${path}`} target="_blank" rel="noopener noreferrer">
                  <img src={`/${path}`} alt="scanned PO page" />
                </a>
              ))}
            </div>

            <div className="card compare-links">
              <h3>{matches.length ? `Matching invoice${matches.length === 1 ? "" : "s"}` : "Matching invoice"}</h3>

              {matches.length ? matches.map((inv) => (
                <button
                  key={inv.document_id}
                  className="compare-link-row"
                  type="button"
                  onClick={() => onOpenDocument(inv.document_id)}
                >
                  <div className="compare-link-main">
                    <div className="compare-link-num">{inv.doc_number ?? inv.document_id.slice(0, 8)}</div>
                    <div className="compare-link-meta">
                      {inv.vendor_name ?? "Vendor not read"}
                      {money(inv.total_value) ? ` · ${money(inv.total_value)}` : ""}
                    </div>
                  </div>
                  <StatusPill status={inv.status} />
                  <IconArrow width={16} height={16} />
                </button>
              )) : (
                <div className="empty-mini">
                  No invoice yet references PO {po.doc_number ?? "this document"} — once one is scanned and
                  read, it will show up here automatically.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
