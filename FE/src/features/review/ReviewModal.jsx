import { useCallback, useEffect, useState } from "react";
import { Modal } from "../../components/Modal.jsx";
import { HeaderFields } from "./HeaderFields.jsx";
import { LineItems } from "./LineItems.jsx";
import { HEADER_KEYS, LINE_FIELDS } from "./schema.js";
import { api } from "../../lib/api.js";
import { isLocked, isWaiting, money, projectOf, qty } from "../../lib/format.js";

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

/* The three completeness gates a document can be stuck behind — shared by
   the Approve button (disabled), the banners (why), and the close handler
   below (blocks dismissal on the two that matter there). See
   extract.mark_approved for the server-side half of each. */
function gatesFor(header) {
  const typeUnset = !header?.doc_kind || header.doc_kind === "UNCLASSIFIED";
  const typeOther = header?.doc_kind === "OTHER";
  // An invoice, delivery challan or inward report with no PO number can
  // never be grouped under its purchase order.
  const poNumberMissing =
    ["INVOICE", "DELIVERY", "INWARD"].includes(header?.doc_kind)
    && !String(header?.po_number ?? "").trim();
  // Which physical copy an invoice is — see schema.js's invoice_channel field.
  const invoiceChannelMissing =
    header?.doc_kind === "INVOICE" && !String(header?.invoice_channel ?? "").trim();
  return {
    typeUnset, typeOther, typeMissing: typeUnset || typeOther,
    poNumberMissing, invoiceChannelMissing,
  };
}

export function ReviewModal({ docId, materials, onClose, onChanged }) {
  const [doc, setDoc] = useState(null);
  const [draft, setDraft] = useState(null);
  const [reviewer, setReviewer] = useState(() => localStorage.getItem("reviewerName") ?? "");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState(null);

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

  /* Site copy vs. office copy of the same delivery — same vendor + invoice
     number, paired automatically at extraction time (extract.find_duplicate).
     Fetched once the document itself has settled; most invoices have no
     paired copy at all, in which case duplicate_of comes back null and
     nothing renders. */
  useEffect(() => {
    if (!doc || isWaiting(doc) || doc.status === "FAILED") { setDiff(null); return; }
    let cancelled = false;
    api.getDuplicateDiff(docId).then((d) => { if (!cancelled) setDiff(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [docId, doc?.status]);

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

  /* The one thing this refuses to do is close while extraction is still
     running — there's nothing to review yet, and a reviewer who dismisses
     it now has no way back to it except finding it again in a list, so
     Escape, the X and the backdrop all do nothing until the document
     settles into EXTRACTED (or FAILED, which is as settled as a broken
     document gets). See the `closable` prop on Modal below for the other
     half of this — the X itself is disabled too, so it doesn't sit there
     looking clickable while doing nothing.

     Past that, closing always works — PO number and invoice channel are
     required to *save* (the footer's Save/Approve are disabled without
     them, see gatesFor), not to walk away. A reviewer who doesn't want to
     finish this document can still just close it: nothing gets saved, the
     document sits exactly where it was (EXTRACTED, unreviewed) for whoever
     opens it next. Closing when it IS complete still saves, so filling the
     form in and clicking away doesn't lose the edit. */
  const attemptClose = () => {
    if (!doc) { onClose(); return; }
    if (isWaiting(doc)) return;
    if (doc.status === "FAILED" || isLocked(doc) || !draft) {
      onClose();
      return;
    }
    const gates = gatesFor(draft.header);
    if (!gates.poNumberMissing && !gates.invoiceChannelMissing) {
      save({ silent: true });
    }
    onClose();
  };

  const subtitle = doc ? `${doc.document_id} — ${projectOf(doc)}` : docId;
  const locked = doc ? isLocked(doc) : false;
  const header = locked ? (doc?.header ?? {}) : draft?.header;
  /* header can be briefly undefined even once doc.status is EXTRACTED — the
     poll's setDoc(fresh) and the effect that populates draft from it commit
     on two different renders, and gatesFor(header) has to survive the one
     in between rather than forcing every caller to null-check gates. */
  const gates = header ? gatesFor(header) : gatesFor({});
  const showFooter = doc && !isWaiting(doc) && doc.status !== "FAILED" && !locked && Boolean(header);

  return (
    <Modal
      title="Review document"
      subtitle={subtitle}
      wide
      closable={!doc || !isWaiting(doc)}
      onClose={attemptClose}
      footer={showFooter ? (
        <DecisionFooter
          reviewer={reviewer}
          setReviewer={setReviewer}
          busy={busy}
          gates={gates}
          onSave={async () => {
            setBusy(true);
            const ok = await save();
            setBusy(false);
            if (ok) onClose();
          }}
          onApprove={() => decide("approve")}
          onReject={() => setRejecting(true)}
        />
      ) : null}
    >
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
            <>
              <DuplicateDiffBanner diff={diff} />
              <Body
                header={header}
                lines={locked ? (doc.lines ?? []) : draft?.lines}
                locked={locked}
                gates={gates}
                materials={materials}
                rejecting={rejecting}
                reason={reason}
                setReason={setReason}
                err={err}
                busy={busy}
                onHeader={setHeader}
                onLine={setLine}
                onDecide={decide}
              />
            </>
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

/* Most invoices have no paired copy at all — duplicate_of is null and this
   renders nothing. When one exists, it's typically the site and office
   copies of the same delivery, billed twice through two different
   channels — see extract.compare_document_lines for how "match" is decided. */
function DuplicateDiffBanner({ diff }) {
  if (!diff || !diff.duplicate_of) return null;
  const otherLabel = diff.other_document?.doc_number ?? diff.duplicate_of;

  if (diff.clean) {
    return (
      <div className="banner banner-ok">
        Matches its other copy ({otherLabel}) — same materials, quantities and rates.
      </div>
    );
  }

  // A line missing entirely from one side reads as "missing", not as a
  // "— @ —" mismatch against a value that was never there to disagree with.
  const describe = (l) => {
    const name = l.material_name ?? "Unrecognised material";
    if (l.qty_a == null) return `${name} — not on this copy (other copy has ${qty(l.qty_b)} @ ${money(l.rate_b)})`;
    if (l.qty_b == null) return `${name} — missing from the other copy (this copy has ${qty(l.qty_a)} @ ${money(l.rate_a)})`;
    return `${name} — this copy: ${qty(l.qty_a)} @ ${money(l.rate_a)}, other copy: ${qty(l.qty_b)} @ ${money(l.rate_b)}`;
  };

  return (
    <div className="banner banner-err">
      <div>This invoice doesn't match its other copy ({otherLabel}):</div>
      <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
        {diff.lines.filter((l) => !l.match).map((l) => <li key={l.material_id}>{describe(l)}</li>)}
      </ul>
      {diff.unmatched_a.length || diff.unmatched_b.length ? (
        <div style={{ marginTop: 6 }}>
          {diff.unmatched_a.length
            ? `This copy has ${diff.unmatched_a.length} line${diff.unmatched_a.length === 1 ? "" : "s"} `
              + "that couldn't be matched to a material. "
            : ""}
          {diff.unmatched_b.length
            ? `The other copy has ${diff.unmatched_b.length} line${diff.unmatched_b.length === 1 ? "" : "s"} `
              + "that couldn't be matched to a material."
            : ""}
        </div>
      ) : null}
    </div>
  );
}

/* Reviewer name + Save/Approve/Reject, right-aligned in the modal's own
   footer strip rather than inline in the scrolling body — the actions that
   finish a review stay in the same place regardless of how long the body
   above them gets. */
function DecisionFooter({ reviewer, setReviewer, busy, gates, onSave, onApprove, onReject }) {
  return (
    <>
      <input
        className="input"
        style={{ maxWidth: 220 }}
        placeholder="Your name"
        value={reviewer}
        onChange={(e) => setReviewer(e.target.value)}
      />
      <div className="spacer" />
      <button
        className="btn btn-quiet"
        onClick={onSave}
        disabled={busy || gates.poNumberMissing || gates.invoiceChannelMissing}
        title={
          gates.poNumberMissing ? "Enter PO number before save"
            : gates.invoiceChannelMissing ? "Enter Invoice Type before save"
            : undefined
        }
      >
        Save
      </button>
      <button
        className="btn btn-ink"
        onClick={onApprove}
        disabled={busy || gates.typeMissing || gates.poNumberMissing || gates.invoiceChannelMissing}
        title={
          gates.typeMissing ? "Please fill a document type, eg: PO, Invoice"
            : gates.poNumberMissing ? "Enter PO number before approving"
            : gates.invoiceChannelMissing ? "Enter Invoice Type before approving"
            : undefined
        }
      >
        Approve
      </button>
      <button className="btn btn-out" onClick={onReject} disabled={busy}>Reject</button>
    </>
  );
}

/* Each gate's reason, keyed to the field it's actually about — HeaderFields
   renders these right above that field's own label instead of bundled into
   one banner down in the Decision section. */
function fieldErrorsFor(gates) {
  return {
    doc_kind: gates.typeUnset || gates.typeOther
      ? "Please fill a document type, eg: PO, Invoice"
      : null,
    po_number: gates.poNumberMissing ? "Enter PO number before save" : null,
    invoice_channel: gates.invoiceChannelMissing ? "Enter Invoice Type before save" : null,
  };
}

function Body({
  header, lines, locked, gates, materials, rejecting, reason, setReason, err, busy, onHeader, onLine, onDecide,
}) {
  if (!header) return <div className="empty">Loading…</div>;

  return (
    <>
      <HeaderFields
        header={header}
        locked={locked}
        onChange={onHeader}
        fieldErrors={locked ? {} : fieldErrorsFor(gates)}
      />
      <LineItems lines={lines ?? []} materials={materials} locked={locked} onChange={onLine} />

      {locked ? null : (
        <div className="field-section">
          <h3>Decision</h3>

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
