import { useState } from "react";
import { Modal } from "../../components/Modal.jsx";
import { StatusPill } from "../../components/Pills.jsx";
import { IconClose, IconUpload } from "../../components/Icons.jsx";
import { api } from "../../lib/api.js";
import { forgetDetail, useDetails } from "../../lib/details.js";
import {
  countsTowardTotals, isInvoice, isPO, isWaiting, money, orderKey, qty, shortDate,
} from "../../lib/format.js";

/* The purchase desk for one project: the orders, the invoices raised against
   them, and everything ordered rolled up into materials. One section at a time
   behind a tab strip — three lists side by side left each of them too narrow to
   read, and only one of the three is ever the question being asked.

   Picking an order narrows the other two tabs to it. */

const refOfDoc = (doc) => doc.doc_number || doc.po_number || doc.document_id.slice(0, 8);

/* Every material ordered, with the orders it was ordered on — so a row can be
   opened to answer "against which PO did this come". */
function materialIndex(pos, materials, detailOf) {
  const rows = new Map();
  for (const po of pos) {
    for (const line of detailOf(po.document_id)?.lines ?? []) {
      const master = materials.find((m) => m.id === line.material_id);
      const name = master?.name || line.description_raw || "Unclassified";
      const unit = master?.unit || line.unit || "—";
      const key = `${name}__${unit}`;
      const row = rows.get(key)
        ?? { key, name, unit, quantity: 0, matched: Boolean(master), sources: [] };
      const amount = Number(line.quantity) || 0;
      row.quantity += amount;
      row.sources.push({ po, quantity: amount });
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.quantity - a.quantity);
}

export function PurchaseOrder({
  project, docs, materials, onSettled, onScanPO, onUploadInvoice, onOpenDocument,
}) {
  const [tab, setTab] = useState("po");
  const [selected, setSelected] = useState(null);   // a PO id, or null for all
  const [openMaterial, setOpenMaterial] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const mine = docs.filter((d) => d.project_id === project.id);
  /* A rejected document stays in the register as the audit trail — a refused
     invoice, or a second scan of something already on file — but the desk is
     what the project is actually buying, so neither belongs in these lists. */
  const pos = mine.filter(isPO).filter(countsTowardTotals);
  const allInvoices = mine.filter(isInvoice).filter(countsTowardTotals);

  /* Lines come from the document detail, so the materials tab needs them
     fetched one document at a time. */
  const detailOf = useDetails(pos);

  const chosen = pos.find((p) => p.document_id === selected) ?? null;

  const invoiceFor = (invoice) =>
    pos.find(
      (po) => orderKey(po.doc_number) && orderKey(po.doc_number) === orderKey(invoice.po_number)
    ) ?? null;

  const invoices = chosen
    ? allInvoices.filter((inv) => invoiceFor(inv)?.document_id === chosen.document_id)
    : allInvoices;

  const rows = materialIndex(chosen ? [chosen] : pos, materials, detailOf);

  const remove = async (doc, typed) => {
    await api.deleteDocument(doc.document_id, typed);
    forgetDetail(doc.document_id);
    if (selected === doc.document_id) setSelected(null);
    await onSettled?.();
  };

  const TABS = [
    { id: "po", label: "Purchase Orders", count: pos.length },
    { id: "invoices", label: "Invoices", count: invoices.length },
    { id: "materials", label: "Materials", count: rows.length },
  ];

  return (
    <div className="po">
      <div className="po-head">
        <div>
          <span className="eyebrow">Purchase desk</span>
          <div className="po-title">{project.name}</div>
          <div className="po-sub">
            {pos.length} order{pos.length === 1 ? "" : "s"} ·{" "}
            {allInvoices.length} invoice{allInvoices.length === 1 ? "" : "s"}
            {chosen ? ` · showing ${refOfDoc(chosen)} only` : ""}
          </div>
        </div>
        <div className="spacer" />
        <div className="po-act">
          {chosen ? (
            <button className="btn btn-quiet btn-sm" type="button" onClick={() => setSelected(null)}>
              Show all orders
            </button>
          ) : null}
          <button className="btn btn-out btn-sm" type="button" onClick={onUploadInvoice}>
            <IconUpload width={16} height={16} />
            Upload invoice
          </button>
          <button className="btn btn-ink btn-sm" type="button" onClick={onScanPO}>
            <IconUpload width={16} height={16} />
            Scan PO
          </button>
        </div>
      </div>

      <div className="po-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            <span className="n">{t.count}</span>
          </button>
        ))}
      </div>

      <div className="po-panel">
        {tab === "po" ? (
          pos.length ? (
            <ul className="po-list">
              <ListHead
                actions
                cols={[["t", "Purchase order"], ["d", "Vendor and date"],
                       ["s", "Status"], ["m", "Order value"]]}
              />
              <li>
                <button
                  type="button"
                  className={`po-item ${chosen ? "" : "is-on"}`}
                  onClick={() => setSelected(null)}
                >
                  <span className="t">All purchase orders</span>
                  <span className="d">
                    {pos.length} order{pos.length === 1 ? "" : "s"} on this project
                  </span>
                  <span className="m">
                    {money(pos.reduce((n, p) => n + (Number(p.total_value) || 0), 0)) ?? "—"}
                  </span>
                </button>
              </li>
              {pos.map((po) => (
                <li key={po.document_id}>
                  <button
                    type="button"
                    className={`po-item ${po.document_id === selected ? "is-on" : ""}`}
                    onClick={() => setSelected(po.document_id === selected ? null : po.document_id)}
                  >
                    <span className="t">{refOfDoc(po)}</span>
                    <span className="d">
                      {po.vendor_name ?? (isWaiting(po) ? "reading…" : "vendor not read")}
                      {` · ${shortDate(po.uploaded_at)}`}
                    </span>
                    <span className="s"><StatusPill status={po.status} /></span>
                    <span className="m">{money(po.total_value) ?? "—"}</span>
                  </button>
                  <RowActions
                    label={refOfDoc(po)}
                    onOpen={() => onOpenDocument(po.document_id)}
                    onDelete={() => setDeleting(po)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <Blank action="Scan purchase order" onAction={onScanPO}>
              No purchase order scanned yet.
            </Blank>
          )
        ) : null}

        {tab === "invoices" ? (
          invoices.length ? (
            <ul className="po-list">
              <ListHead
                actions
                cols={[["t", "Invoice"], ["d", "Vendor and date"],
                       ["against", "Against PO"], ["s", "Status"], ["m", "Amount"]]}
              />
              {invoices.map((inv) => {
                const against = invoiceFor(inv);
                return (
                  <li key={inv.document_id}>
                    <button
                      type="button"
                      className="po-item"
                      onClick={() => onOpenDocument(inv.document_id)}
                    >
                      <span className="t">{refOfDoc(inv)}</span>
                      <span className="d">
                        {inv.vendor_name ?? (isWaiting(inv) ? "reading…" : "vendor not read")}
                        {` · ${shortDate(inv.uploaded_at)}`}
                      </span>
                      {/* Which order it belongs to is the point of this tab, so
                          it is stated on every row rather than left to the
                          filter above. */}
                      <span className={`against ${against ? "" : "is-loose"}`}>
                        {against
                          ? `against ${refOfDoc(against)}`
                          : inv.po_number
                            ? `PO ${inv.po_number} — no matching order here`
                            : "no PO number on the invoice"}
                      </span>
                      <span className="s"><StatusPill status={inv.status} /></span>
                      <span className="m">{money(inv.total_value) ?? "—"}</span>
                    </button>
                    <RowActions
                      label={refOfDoc(inv)}
                      onOpen={() => onOpenDocument(inv.document_id)}
                      onDelete={() => setDeleting(inv)}
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <Blank action="Upload invoice" onAction={onUploadInvoice}>
              {chosen
                ? `No invoice has been received against ${refOfDoc(chosen)} yet.`
                : "No invoice has been received on this project yet."}
            </Blank>
          )
        ) : null}

        {tab === "materials" ? (
          rows.length ? (
            <ul className="po-list">
              <ListHead cols={[["t", "Material"], ["d", "Ordered on"], ["m", "Quantity"]]} />
              {rows.map((r) => (
                <li key={r.key}>
                  <button
                    type="button"
                    className={`po-item ${openMaterial === r.key ? "is-on" : ""}`}
                    aria-expanded={openMaterial === r.key}
                    onClick={() => setOpenMaterial(openMaterial === r.key ? null : r.key)}
                  >
                    <span className="t">{r.name}</span>
                    <span className="d">
                      {r.sources.length} order{r.sources.length === 1 ? "" : "s"}
                      {r.matched ? "" : " · not in the material master"}
                    </span>
                    <span className="m">{qty(r.quantity)} {r.unit}</span>
                  </button>

                  {/* Which orders it came in on — the question a material row
                      is always opened to answer. */}
                  {openMaterial === r.key ? (
                    <ul className="mat-sub">
                      {r.sources.map((s, i) => (
                        <li key={`${s.po.document_id}-${i}`}>
                          <button
                            type="button"
                            onClick={() => { setSelected(s.po.document_id); setTab("po"); }}
                          >
                            <span>{refOfDoc(s.po)}</span>
                            <span className="spacer" />
                            <span className="q">{qty(s.quantity)} {r.unit}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty">
              {pos.some(isWaiting)
                ? "Reading the purchase order…"
                : "Materials appear once a purchase order has been read."}
            </div>
          )
        ) : null}
      </div>

      {deleting ? (
        <DeleteModal
          doc={deleting}
          onClose={() => setDeleting(null)}
          onConfirm={(typed) => remove(deleting, typed)}
        />
      ) : null}
    </div>
  );
}

/* The heading row for a list. It is the same flex shape as a row, so the
   labels sit over the values rather than near them. */
function ListHead({ cols, actions = false }) {
  return (
    <li className="po-list-head">
      <div className="po-item is-head">
        {cols.map(([cls, label]) => <span key={cls} className={cls}>{label}</span>)}
      </div>
      {actions ? <div className="row-act" /> : null}
    </li>
  );
}

function Blank({ children, action, onAction }) {
  return (
    <div className="empty">
      <div>{children}</div>
      <button
        className="btn btn-out btn-sm"
        type="button"
        onClick={onAction}
        style={{ marginTop: 16 }}
      >
        {action}
      </button>
    </div>
  );
}

function RowActions({ label, onOpen, onDelete }) {
  return (
    <div className="row-act">
      {onOpen ? (
        <button type="button" onClick={onOpen} aria-label={`Review ${label}`}>Review</button>
      ) : null}
      <button
        type="button"
        className="row-x"
        onClick={onDelete}
        aria-label={`Delete ${label}`}
        title="Delete"
      >
        <IconClose width={15} height={15} />
      </button>
    </div>
  );
}

/* Deleting a scan cannot be undone, so it is gated on retyping the number
   printed on the document rather than on a yes/no anyone clicks through. The
   backend checks the same string — see main.delete_document. */
function DeleteModal({ doc, onClose, onConfirm }) {
  const reference = doc.doc_number || doc.po_number || doc.document_id;
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const matches = typed.trim().toLowerCase() === reference.toLowerCase();

  const go = async () => {
    if (!matches) { setErr(`Type ${reference} exactly.`); return; }
    setBusy(true);
    setErr("");
    try {
      await onConfirm(typed.trim());
      onClose();
    } catch (e) {
      setErr(`Could not delete — ${e.message}`);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Delete document"
      subtitle={doc.document_id}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button className="btn btn-out" onClick={onClose}>Cancel</button>
          <button className="btn btn-signal" onClick={go} disabled={busy || !matches}>
            {busy ? "Deleting…" : "Delete"}
          </button>
        </>
      }
    >
      {err ? <div className="banner banner-err">{err}</div> : null}

      <p style={{ fontSize: 15, marginBottom: 16 }}>
        This removes the scan, its pages and everything read off it. It cannot
        be undone.
      </p>

      <div className="form">
        <label>
          <span>Type <b className="mono">{reference}</b> to confirm</span>
          <input
            className="input"
            autoFocus
            value={typed}
            placeholder={reference}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && matches) go(); }}
          />
        </label>
      </div>
    </Modal>
  );
}
