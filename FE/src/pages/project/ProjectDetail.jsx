import { useMemo, useState } from "react";
import { StatusPill, TypePill } from "../../components/Pills.jsx";
import { IconArrow, IconBack, IconDownload, IconPlus, IconPrint } from "../../components/Icons.jsx";
import { PurchaseOrder } from "./PurchaseOrder.jsx";
import { UploadModal } from "../home/UploadModal.jsx";
import { go } from "../../lib/useHashRoute.js";
import { api } from "../../lib/api.js";
import {
  DOC_STATUSES, DOC_TYPES, isWaiting, matchesFilter, money,
  projectTally, refOf, shortDate, titleCase,
} from "../../lib/format.js";

const EMPTY = { q: "", type: "", status: "", from: "", to: "" };

/* The two things the purchase desk takes in. Both are an upload for now; the
   document type is the operator's hint, which the classifier can still
   overrule. */
const INTAKE = {
  PO: {
    documentType: "PO",
    title: "Scan purchase order",
    hint: "A photo or PDF of the purchase order.",
  },
  INVOICE: {
    documentType: "INVOICE",
    title: "Upload invoice",
    hint: "A photo or PDF of the vendor's invoice.",
  },
};

/* Three containers: who the project is, an overview of everything captured
   against it, and the purchase desk. The overview leads because it answers
   "what came in" — the desk below it answers "what does it add up to". */
export function ProjectDetail({ project, docs, materials, reload, onOpenDocument, onAddDocument }) {
  const [filter, setFilter] = useState(EMPTY);
  /* Which kind of paper the intake modal is currently taking, or null. */
  const [intake, setIntake] = useState(null);

  const projectDocs = useMemo(
    () => docs.filter((d) => d.project_id === project.id),
    [docs, project.id]
  );

  const visible = useMemo(
    () => projectDocs.filter((d) => matchesFilter(d, filter)),
    [projectDocs, filter]
  );

  const tally = projectTally(project, docs);
  const dirty = JSON.stringify(filter) !== JSON.stringify(EMPTY);

  return (
    <div className="band">
      <div className="col">

        <div className="phead">
          <button className="back" type="button" onClick={() => go("/project")}>
            <IconBack width={16} height={16} />
            All projects
          </button>

          <div className="phead-main">
            <div>
              <div className="code">{project.code}</div>
              <div className="pname">{project.name}</div>
            </div>
            <div className="spacer" />
            <div className="phead-actions">
              <button className="btn btn-out btn-sm" type="button" onClick={() => window.print()}>
                <IconPrint width={16} height={16} />
                Print
              </button>
              {/* An anchor, not a fetch: the server names the file in its
                  Content-Disposition, and letting the browser handle the
                  download keeps that name. */}
              <a
                className="btn btn-out btn-sm"
                href={api.exportUrl(project.id)}
                title="Summary, documents, line items and materials rollup as .xlsx"
              >
                <IconDownload width={16} height={16} />
                Export
              </a>
              <button className="btn btn-ink btn-sm" type="button" onClick={() => onAddDocument(project)}>
                <IconPlus width={17} height={17} />
                Add document
              </button>
            </div>
          </div>

          {/* The project's own numbers on a hairline — a stat strip here would
              be four more boxes on a page whose problem was boxes. */}
          <div className="phead-meta">
            <span><b>{tally.documents}</b> documents</span>
            <span className="sep">·</span>
            <span><b>{tally.purchaseOrders}</b> purchase orders</span>
            {tally.awaiting ? (
              <>
                <span className="sep">·</span>
                <span className="warn"><b>{tally.awaiting}</b> awaiting review</span>
              </>
            ) : null}
            {tally.reading ? (
              <>
                <span className="sep">·</span>
                <span><b>{tally.reading}</b> still reading</span>
              </>
            ) : null}
            {tally.booked ? (
              <>
                <span className="sep">·</span>
                <span><b>{money(tally.booked)}</b> booked</span>
              </>
            ) : null}
          </div>
        </div>

        <div className="explorer">
          <div className="explorer-bar">
            <span className="eyebrow">Overview</span>
            <div className="spacer" />
            <span className="explorer-count">
              <b>{visible.length}</b> of {projectDocs.length} documents
            </span>
          </div>

          <div className="toolbar">
            <input
              className="ctl ctl-search"
              type="search"
              placeholder="Vendor, document or reference"
              aria-label="Search documents"
              value={filter.q}
              onChange={(e) => setFilter({ ...filter, q: e.target.value })}
            />
            <select
              className="ctl"
              aria-label="Document type"
              value={filter.type}
              onChange={(e) => setFilter({ ...filter, type: e.target.value })}
            >
              <option value="">All types</option>
              {DOC_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </select>
            <select
              className="ctl"
              aria-label="Status"
              value={filter.status}
              onChange={(e) => setFilter({ ...filter, status: e.target.value })}
            >
              <option value="">All statuses</option>
              {DOC_STATUSES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </select>
            <span className="lbl">From</span>
            <input
              className="ctl" type="date" aria-label="From date"
              value={filter.from}
              onChange={(e) => setFilter({ ...filter, from: e.target.value })}
            />
            <span className="lbl">To</span>
            <input
              className="ctl" type="date" aria-label="To date"
              value={filter.to}
              onChange={(e) => setFilter({ ...filter, to: e.target.value })}
            />
            <div className="spacer" />
            {dirty ? (
              <button className="clear" type="button" onClick={() => setFilter(EMPTY)}>Clear</button>
            ) : null}
          </div>

          {/* Columns, not cards: the point of a document list is comparing the
              same field down the page. */}
          <div className="dgrid">
            <div className="dhead">
              <span>Document</span>
              <span>Status</span>
              <span>Vendor</span>
              <span>Reference</span>
              <span className="r">Amount</span>
              <span>Type</span>
              <span>Date</span>
              <span />
            </div>

            {visible.length ? visible.map((d) => (
              <button
                key={d.document_id}
                className="drow"
                type="button"
                onClick={() => onOpenDocument(d.document_id)}
                aria-label={`Review ${d.document_id}`}
              >
                <span className="c-id">{d.document_id.slice(0, 8)}</span>
                <span><StatusPill status={d.status} /></span>
                <span className="c-vend">{d.vendor_name ?? "—"}</span>
                <span className="c-ref">{refOf(d) ?? "—"}</span>
                {money(d.total_value)
                  ? <span className="c-amt">{money(d.total_value)}</span>
                  : <span className="c-amt pending">{isWaiting(d) ? "reading…" : "—"}</span>}
                <span><TypePill type={d.document_type} /></span>
                <span className="c-date">{shortDate(d.uploaded_at)}</span>
                <span className="open-sm" aria-hidden="true"><IconArrow width={18} height={18} /></span>
              </button>
            )) : (
              <div className="empty">No documents match.</div>
            )}
          </div>
        </div>

        <PurchaseOrder
          project={project}
          docs={docs}
          materials={materials}
          onSettled={reload}
          onScanPO={() => setIntake(INTAKE.PO)}
          onUploadInvoice={() => setIntake(INTAKE.INVOICE)}
          onOpenDocument={onOpenDocument}
        />

        {/* ponytail: "scan" is an upload for now — the phone route already
            exists on the home page and this desk does not need a second one. */}
        {intake ? (
          <UploadModal
            project={project}
            documentType={intake.documentType}
            title={intake.title}
            hint={intake.hint}
            onClose={() => setIntake(null)}
            onUploaded={reload}
          />
        ) : null}
      </div>
    </div>
  );
}
