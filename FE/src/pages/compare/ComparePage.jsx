import { Fragment, useCallback, useEffect, useState } from "react";
import { StatusPill, TypePill } from "../../components/Pills.jsx";
import { IconArrow, IconBack, IconChevron, IconTrash } from "../../components/Icons.jsx";
import { AddDocumentMenu } from "../../components/AddDocumentMenu.jsx";
import { HeaderFields } from "../../features/review/HeaderFields.jsx";
import { LineItems } from "../../features/review/LineItems.jsx";
import { HEADER_KEYS, LINE_FIELDS } from "../../features/review/schema.js";
import { api } from "../../lib/api.js";
import { go } from "../../lib/useHashRoute.js";
import { isLocked, isWaiting, money, qty, shortDate } from "../../lib/format.js";

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

/* This PO's own materials against what's actually turned up across its
   deliveries — same Material/Unit/Ordered/Delivered shape as the project's
   own Materials rollup (MaterialsRollup.jsx), just scoped to one PO's lines
   and fed by the server-computed reconciliation instead of a client-side sum
   across every INVOICE in the project (which would double-count an invoice
   uploaded twice — the reconciliation endpoint already dedupes that per
   delivery group). */
function PoMaterialsSection({ materials, loading, onOpenDocument }) {
  const [open, setOpen] = useState(() => new Set());

  if (loading) {
    return <div className="card"><div className="empty">Reading line items…</div></div>;
  }
  if (!materials?.length) {
    return (
      <div className="card">
        <div className="empty">No materials on this PO yet — they appear once it's been read.</div>
      </div>
    );
  }

  const deliveredClass = (m) => {
    if (!m.ordered_qty) return "";
    if (m.delivered_qty >= m.ordered_qty) return "ok";
    if (m.delivered_qty > 0) return "warn";
    return "mute";
  };

  const toggle = (key) => setOpen((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  return (
    <div className="card">
      <div className={`table-wrap rollup-wrap ${materials.length > 12 ? "is-tall" : ""}`}>
        <table className="data rollup">
          <colgroup>
            <col />
            <col style={{ width: "11ch" }} />
            <col style={{ width: "13ch" }} />
            <col style={{ width: "13ch" }} />
            <col style={{ width: "13ch" }} />
            <col style={{ width: "13ch" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Material</th>
              <th>Unit</th>
              <th className="right">Ordered</th>
              <th className="right">Delivered</th>
              <th className="right">Pending</th>
              <th className="right">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {materials.map((m) => {
              const isOpen = open.has(m.material_id);
              return (
                <Fragment key={m.material_id}>
                  <tr>
                    <td className="c-mat" title={m.material_name}>
                      <div className="rollup-mat-cell">
                        <button
                          className={`rollup-toggle ${isOpen ? "is-open" : ""}`}
                          type="button"
                          onClick={() => toggle(m.material_id)}
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? "Hide" : "Show"} order and delivery breakdown for ${m.material_name ?? "this material"}`}
                        >
                          <IconChevron width={16} height={16} />
                        </button>
                        <span>{m.material_name ?? "Unrecognised material"}</span>
                      </div>
                    </td>
                    <td className="c-unit">{m.unit ?? "—"}</td>
                    <td className="num strong">{m.ordered_qty ? qty(m.ordered_qty) : "—"}</td>
                    <td className={`num strong ${deliveredClass(m)}`}>
                      {m.delivered_qty ? qty(m.delivered_qty) : "—"}
                      {m.over_delivered ? " ⚠" : ""}
                    </td>
                    {/* Claimed by a delivery whose Invoice, MIN Voucher and
                        Purchase Bill haven't all agreed yet — not counted
                        above, not silently dropped either. */}
                    <td className="num mute">{m.pending_qty ? qty(m.pending_qty) : "—"}</td>
                    <td className={`num strong ${m.remaining_qty < 0 ? "is-over" : ""}`}>
                      {qty(Math.abs(m.remaining_qty))}{m.remaining_qty < 0 ? " over" : ""}
                    </td>
                  </tr>

                  {isOpen ? (
                    <tr className="rollup-detail">
                      <td colSpan={6}>
                        <div className="rollup-breakdown">
                          <div>
                            <h4>Purchase order</h4>
                            {m.po_entries?.length ? (
                              <ul>
                                {m.po_entries.map((e, i) => (
                                  <li key={i}>
                                    <span>{e.doc_number}</span>
                                    <span className="qty">{qty(e.quantity)} {m.unit}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <div className="empty-mini">Not on this PO — delivered against it anyway.</div>
                            )}
                          </div>
                          <div>
                            <h4>Deliveries</h4>
                            {m.invoice_entries?.length ? (
                              <ul>
                                {m.invoice_entries.map((e, i) => (
                                  <li key={i}>
                                    <button
                                      type="button"
                                      className="link-btn"
                                      onClick={() => onOpenDocument?.(e.document_id)}
                                    >
                                      {e.doc_number}{e.vendor_name ? ` — ${e.vendor_name}` : ""}
                                    </button>
                                    <span className="qty">
                                      {qty(e.quantity)} {m.unit}
                                      {e.status !== "verified" ? " · pending" : ""}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <div className="empty-mini">No delivery has claimed this material yet.</div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* The three-way match's verdict, worn right on the delivery row — verified
   is deliberately shown too, not just the problem states, since it's what
   actually makes a delivery's quantity count toward the PO (see
   po_reconciliation's docstring in main.py). */
function VerificationPill({ status }) {
  if (status === "verified") return <span className="pill s-approved">Verified</span>;
  if (status === "mismatch") return <span className="pill s-rejected">Mismatch</span>;
  return <span className="pill s-pending">Awaiting verification</span>;
}

/* One delivery's diff line between two named documents — labelA/labelB are
   "Invoice", "MIN Voucher" or "Purchase Bill". */
function describeDiffLine(l, labelA, labelB) {
  const name = l.material_name ?? "Unrecognised material";
  if (l.qty_a == null) {
    return `${name} — not on ${labelA} (${labelB} has ${qty(l.qty_b)} @ ${money(l.rate_b)})`;
  }
  if (l.qty_b == null) {
    return `${name} — not on ${labelB} (${labelA} has ${qty(l.qty_a)} @ ${money(l.rate_a)})`;
  }
  return `${name} — ${labelA}: ${qty(l.qty_a)} @ ${money(l.rate_a)}, ${labelB}: ${qty(l.qty_b)} @ ${money(l.rate_b)}`;
}

/* Same slot the PO tab uses for the scanned image — here it's the thing a
   reviewer actually needs while looking at a list of deliveries: which ones
   disagree with themselves. Missing documents and "not verified yet" are
   both shown elsewhere (the delivery's own "Missing documents:" line and
   its Verified/Awaiting verification/Mismatch pill in the list to the
   left) — this panel is only for an actual disagreement: all three of
   Invoice, MIN Voucher and Purchase Bill exist but don't match on material
   or quantity. Each disagreeing pair (invoice vs MIN, invoice vs purchase
   bill, MIN vs purchase bill) gets its own block, named by which two
   documents disagree. */
function DeliveryIssuesPanel({ deliveries, loading, onOpenDocument }) {
  if (loading) {
    return <div className="card compare-links"><div className="empty-mini">Loading…</div></div>;
  }

  const flagged = (deliveries ?? []).filter((d) => d.verification.status === "mismatch");

  return (
    <div className="card compare-links">
      <h3>Issues</h3>
      {!flagged.length ? (
        <div className="empty-mini">
          {deliveries?.length
            ? "No mismatches — every Invoice, MIN Voucher and Purchase Bill checked so far agree."
            : "Nothing to check yet."}
        </div>
      ) : (
        flagged.map((delivery) => {
          const v = delivery.verification;
          const pairs = [
            ["invoice_vs_min", "Invoice", "MIN Voucher", v.invoice_document_id, v.inward_document_id],
            ["invoice_vs_purchase_bill", "Invoice", "Purchase Bill", v.invoice_document_id, v.purchase_bill_document_id],
            ["min_vs_purchase_bill", "MIN Voucher", "Purchase Bill", v.inward_document_id, v.purchase_bill_document_id],
          ].filter(([key]) => !v.diffs[key].clean);

          return (
            <div key={delivery.doc_number} className="delivery-issue">
              <div className="delivery-issue-head">
                <span className="compare-link-num">{delivery.doc_number}</span>
                <span className="compare-link-meta">{delivery.vendor_name ?? "Vendor not read"}</span>
              </div>
              {pairs.map(([key, labelA, labelB, idA, idB]) => {
                const diff = v.diffs[key];
                const badLines = (diff.lines ?? []).filter((l) => !l.match);
                return (
                  <div key={key}>
                    <p className="delivery-issue-lead">
                      <button type="button" className="link-btn" onClick={() => onOpenDocument(idA)}>
                        {labelA}
                      </button>
                      {" and "}
                      <button type="button" className="link-btn" onClick={() => onOpenDocument(idB)}>
                        {labelB}
                      </button>
                      {" disagree:"}
                    </p>
                    <ul className="delivery-issue-lines">
                      {badLines.map((l) => <li key={l.material_id}>{describeDiffLine(l, labelA, labelB)}</li>)}
                      {(diff.unmatched_a ?? []).map((l, i) => (
                        <li key={`ua-${i}`}>Unrecognised line on {labelA} — "{l.description_raw}"</li>
                      ))}
                      {(diff.unmatched_b ?? []).map((l, i) => (
                        <li key={`ub-${i}`}>Unrecognised line on {labelB} — "{l.description_raw}"</li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          );
        })
      )}
    </div>
  );
}

/* The PO is why this page was opened — it keeps the full width and its full
   edit/approve/reject workflow. The scanned page and whatever invoices
   already carry its number are supporting material, not equal billing: a
   narrow sidebar, not a second full column. An invoice is a link through to
   its own full review, not reproduced here — a summary line is what's needed
   to recognise it, not its whole line-item table a second time.

   The reconciliation itself — materials/qty delivered-so-far against what
   was ordered, and each delivery's Invoice/MIN Voucher/Purchase Bill
   cross-check — comes from GET .../reconciliation (see main.py), computed
   server-side against the same po_number == this PO's own doc_number match
   this page always used; `matches` below is only the fallback while that
   call is still loading. */
export function ComparePage({ documentId, docs, materials, onOpenDocument, reload, onAddDocument, onScan }) {
  const [section, setSection] = useState("po");
  const [po, setPo] = useState(null);
  const [draft, setDraft] = useState(null);
  const [recon, setRecon] = useState(null);
  const [reviewer, setReviewer] = useState(() => localStorage.getItem("reviewerName") ?? "");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingDeletePo, setConfirmingDeletePo] = useState(false);
  const [deletingPo, setDeletingPo] = useState(false);
  // Which document, or which whole delivery (by its doc_number), is mid
  // delete-confirmation in the Delivery info tab — at most one at a time,
  // so confirming one doesn't leave a stray "are you sure" open elsewhere.
  const [confirmingDeleteDoc, setConfirmingDeleteDoc] = useState(null);
  const [confirmingDeleteDelivery, setConfirmingDeleteDelivery] = useState(null);
  const [deletingKey, setDeletingKey] = useState(null);

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

  const reloadRecon = useCallback(async () => {
    const fresh = await api.getPoReconciliation(documentId).catch(() => null);
    setRecon(fresh);
  }, [documentId]);

  /* Only meaningful once the PO itself has actually been read — reruns
     whenever docs changes (an invoice being uploaded, extracted, or edited
     all move that list), so a newly-matched invoice shows up without
     needing its own poll loop. */
  useEffect(() => {
    if (!po || isWaiting(po)) return;
    reloadRecon();
  }, [po, docs, reloadRecon]);

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

  const deletePo = async () => {
    setDeletingPo(true);
    try {
      await api.deleteDocument(documentId);
      reload();
      go(`/project/${po.project_id}`);
    } catch (e) {
      setErr(`Could not delete — ${e.message}`);
      setDeletingPo(false);
    }
  };

  /* One document out of a delivery — a wrong upload, most often. Removing
     it never touches the others in its group; the delivery just goes back
     to missing whichever slot that document filled. */
  const deleteOneDoc = async (docId) => {
    setDeletingKey(docId);
    try {
      await api.deleteDocument(docId);
      setConfirmingDeleteDoc(null);
      await reloadRecon();
      reload();
    } catch (e) {
      setErr(`Could not delete — ${e.message}`);
    } finally {
      setDeletingKey(null);
    }
  };

  /* The whole delivery at once — every document currently grouped under it
     (invoices, challan, inward report alike). */
  const deleteDelivery = async (delivery) => {
    setDeletingKey(delivery.doc_number);
    try {
      await Promise.all(delivery.documents.map((d) => api.deleteDocument(d.document_id)));
      setConfirmingDeleteDelivery(null);
      await reloadRecon();
      reload();
    } catch (e) {
      setErr(`Could not delete — ${e.message}`);
    } finally {
      setDeletingKey(null);
    }
  };

  if (!po) {
    return <div className="band"><div className="col"><div className="empty">Loading…</div></div></div>;
  }

  const matches = docs.filter(
    (d) => d.document_type === "INVOICE" && d.project_id === po.project_id
      && d.po_number && d.po_number === po.doc_number
  );

  // AddDocumentMenu/UploadModal/ScanModal only ever read id/code/name off
  // this — the PO itself already carries all three of its own project's,
  // so a new invoice, challan or inward report added from here lands in
  // the same project as the PO, same as adding one from the project page.
  const project = { id: po.project_id, code: po.project_code, name: po.project_name };

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
            <AddDocumentMenu
              onScan={() => onScan(project)}
              onUpload={() => onAddDocument(project)}
            />
            <button
              className="btn btn-out btn-sm"
              type="button"
              onClick={() => setConfirmingDeletePo(true)}
              style={{ marginLeft: 10 }}
            >
              <IconTrash width={16} height={16} />
              Delete
            </button>
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

          {confirmingDeletePo ? (
            <div className="banner banner-err" style={{ marginTop: 16 }}>
              <div>
                Delete this PO ({po.doc_number ?? po.document_id})? This doesn't remove the
                invoices, MIN Vouchers or Purchase Bills referencing it — only the PO document
                itself. This can't be undone.
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                <button className="btn btn-signal btn-sm" type="button" onClick={deletePo} disabled={deletingPo}>
                  {deletingPo ? "Deleting…" : "Delete PO"}
                </button>
                <button
                  className="btn btn-out btn-sm"
                  type="button"
                  onClick={() => setConfirmingDeletePo(false)}
                  disabled={deletingPo}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="ptabs">
          {[
            { id: "po", label: "PO" },
            { id: "delivery", label: `Delivery info${recon?.deliveries?.length ? ` (${recon.deliveries.length})` : ""}` },
            { id: "materials", label: "Materials" },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={section === t.id}
              onClick={() => setSection(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {section === "po" ? (
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
                <LineItems lines={lines ?? []} materials={materials} locked={locked} onChange={setLine} header={header} />

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
          </div>
        </div>
        ) : section === "delivery" ? (
        <div className="compare-layout">
          <div className="card compare-main">
            <h3 style={{ padding: "var(--s3) var(--s3) 0" }}>
              {recon?.deliveries?.length
                ? `${recon.deliveries.length} deliver${recon.deliveries.length === 1 ? "y" : "ies"}`
                : matches.length ? `Matching invoice${matches.length === 1 ? "" : "s"}` : "Deliveries"}
            </h3>

            {err ? (
              <div className="banner banner-err" style={{ margin: "0 var(--s3) var(--s3)" }}>{err}</div>
            ) : null}

            {recon?.deliveries?.length ? recon.deliveries.map((delivery) => (
              <div key={delivery.doc_number} className="compare-delivery">
                <div className="compare-delivery-head">
                  <span className="compare-link-num">{delivery.doc_number}</span>
                  <span className="compare-link-meta">{delivery.vendor_name ?? "Vendor not read"}</span>
                  <div className="spacer" />
                  <VerificationPill status={delivery.verification.status} />
                  {confirmingDeleteDelivery === delivery.doc_number ? (
                    <span className="row-actions">
                      Delete all {delivery.documents.length}?
                      <button
                        className="row-link warn"
                        type="button"
                        onClick={() => deleteDelivery(delivery)}
                        disabled={deletingKey === delivery.doc_number}
                      >
                        {deletingKey === delivery.doc_number ? "…" : "Confirm"}
                      </button>
                      <button
                        className="row-link"
                        type="button"
                        onClick={() => setConfirmingDeleteDelivery(null)}
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="compare-link-delete"
                      aria-label="Delete this whole delivery"
                      title="Delete every document in this delivery"
                      onClick={() => setConfirmingDeleteDelivery(delivery.doc_number)}
                    >
                      <IconTrash width={15} height={15} />
                    </button>
                  )}
                </div>
                {delivery.missing?.length ? (
                  <div className="compare-missing">
                    Missing documents: {delivery.missing.join(", ")}
                  </div>
                ) : null}
                {delivery.documents.map((d) => (
                  <div key={d.document_id} className="compare-link-row">
                    <button
                      type="button"
                      className="compare-link-open"
                      onClick={() => onOpenDocument(d.document_id)}
                    >
                      <div className="compare-link-main">
                        <div className="compare-link-num-row">
                          {/* The document's own number — a MIN Voucher or
                              Purchase Bill carries its own MIN No/PV No, not
                              the invoice number the group above is named
                              after, so this is the one place that actually
                              says so. */}
                          <span className="compare-link-num">{d.doc_number || "Document not yet numbered"}</span>
                          {/* Every document in a delivery is the same vendor
                              by construction (see po_reconciliation's
                              grouping) — repeated per row anyway, since a row
                              reads as its own document, not just a slot in
                              the group above it. */}
                          <span className="compare-link-vendor">{delivery.vendor_name ?? "Vendor not read"}</span>
                        </div>
                        <div className="compare-link-meta">
                          {shortDate(d.uploaded_at)}
                          {money(d.total_value) ? ` · ${money(d.total_value)}` : ""}
                          {d.page_count > 1 ? ` · ${d.page_count} pages` : ""}
                        </div>
                      </div>
                      <TypePill type={d.document_type} />
                      <StatusPill status={d.status} />
                      <IconArrow width={16} height={16} />
                    </button>
                    {confirmingDeleteDoc === d.document_id ? (
                      <span className="row-actions">
                        Delete?
                        <button
                          className="row-link warn"
                          type="button"
                          onClick={() => deleteOneDoc(d.document_id)}
                          disabled={deletingKey === d.document_id}
                        >
                          {deletingKey === d.document_id ? "…" : "Confirm"}
                        </button>
                        <button
                          className="row-link"
                          type="button"
                          onClick={() => setConfirmingDeleteDoc(null)}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="compare-link-delete"
                        aria-label="Delete this document"
                        onClick={() => setConfirmingDeleteDoc(d.document_id)}
                      >
                        <IconTrash width={15} height={15} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )) : !recon ? (
              <div className="empty-mini" style={{ padding: "0 var(--s3) var(--s3)" }}>Loading…</div>
            ) : (
              <div className="empty-mini" style={{ padding: "0 var(--s3) var(--s3)" }}>
                No invoice or delivery note yet references PO {po.doc_number ?? "this document"} — once
                one is scanned and read, it will show up here automatically.
              </div>
            )}
          </div>

          <div className="compare-aside">
            <DeliveryIssuesPanel deliveries={recon?.deliveries} loading={!recon} onOpenDocument={onOpenDocument} />
          </div>
        </div>
        ) : (
        <PoMaterialsSection materials={recon?.materials} loading={!recon} onOpenDocument={onOpenDocument} />
        )}
      </div>
    </div>
  );
}
