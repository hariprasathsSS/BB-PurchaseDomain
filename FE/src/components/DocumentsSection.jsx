import { useMemo, useState } from "react";
import { FilterBar } from "./FilterBar.jsx";
import { StatusPill, TypePill } from "./Pills.jsx";
import { IconArrow, IconFile } from "./Icons.jsx";
import { IMAGE_RE, isWaiting, matchesFilter, money, refOf, shortDate } from "../lib/format.js";

/* The same register row + filter bar the overall Document Register uses
   (DocumentsTab), reused wherever a scoped list of documents needs the same
   treatment — a project's own Documents tab (every document under any of
   its POs) and a PO's own Documents tab (that PO plus everything referencing
   it: invoice, MIN Voucher, Purchase Bill, anything else). The caller
   decides the scope by which `docs` it passes in; this only filters and
   renders it. */
export function DocumentsSection({ docs, projects = null, onOpenDocument, emptyLabel = "Nothing here yet." }) {
  const [filter, setFilter] = useState({ q: "", project: "", type: "", status: "" });

  const shown = useMemo(() => docs.filter((d) => matchesFilter(d, filter)), [docs, filter]);
  const scanned = shown.filter((d) => d.source === "SCAN").length;
  const pending = shown.filter(isWaiting).length;

  return (
    <div className="section">
      <FilterBar value={filter} onChange={setFilter} projects={projects} />

      <div className="section-head">
        <span className="tag">{shown.length} of {docs.length}</span>
        {scanned ? <span className="tag">{scanned} by phone</span> : null}
        {pending ? <span className="tag">{pending} still reading</span> : null}
      </div>

      <div className="dgrid reg">
        <div className="dhead">
          <span />
          <span>Document</span>
          <span>Status</span>
          <span>Vendor</span>
          <span>Project</span>
          <span>Reference</span>
          <span className="r">Amount</span>
          <span>Type</span>
          <span>Captured</span>
          <span />
        </div>

        {shown.length ? shown.map((d) => {
          const file = d.file_paths?.[0];
          const isImage = file && IMAGE_RE.test(file);
          return (
            <button
              key={d.document_id}
              className="drow"
              type="button"
              onClick={() => onOpenDocument(d.document_id)}
              aria-label={`Review ${d.document_id}`}
            >
              <span className="c-thumb">
                {isImage
                  ? <img src={`/${file}`} alt="" loading="lazy" />
                  : <IconFile width={18} height={18} />}
              </span>

              <span className="c-id">{d.document_id.slice(0, 8)}</span>
              <span><StatusPill status={d.status} /></span>
              <span className="c-vend">{d.vendor_name ?? "—"}</span>
              <span className="c-proj">{d.project_code ?? "—"}</span>
              <span className="c-ref">{refOf(d) ?? "—"}</span>
              {money(d.total_value)
                ? <span className="c-amt">{money(d.total_value)}</span>
                : <span className="c-amt pending">{isWaiting(d) ? "reading…" : "—"}</span>}
              <span><TypePill type={d.document_type} /></span>
              <span className="c-date">
                {d.source === "SCAN" ? "Scanned" : "Uploaded"} {shortDate(d.uploaded_at)}
              </span>
              <span className="open-sm" aria-hidden="true">
                <IconArrow width={18} height={18} />
              </span>
            </button>
          );
        }) : (
          <div className="empty">
            {docs.length ? "No document matches these filters." : emptyLabel}
          </div>
        )}
      </div>
    </div>
  );
}
