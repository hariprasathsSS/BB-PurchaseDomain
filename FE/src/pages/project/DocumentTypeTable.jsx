import { useEffect, useMemo, useState } from "react";
import { StatusPill } from "../../components/Pills.jsx";
import { IconArrow } from "../../components/Icons.jsx";
import { getCachedDocument, loadDocumentDetails } from "../../lib/documentCache.js";
import { money, shortDate } from "../../lib/format.js";

/* One column narrower than the Overview tab's document grid — no Type
   column, since every row here is already the one type this table was
   filtered to — reusing its --cols custom property rather than a second
   grid class. Several columns share the extra width a wide viewport frees
   (minmax(floor, Nfr) on each), not just one — see the note beside .dgrid
   in app.css for why that matters at full page width. */
const COLS = "minmax(150px, 1.6fr) 112px minmax(160px, 1.6fr) minmax(90px, .8fr) "
  + "minmax(110px, .9fr) minmax(110px, .9fr) 96px 40px";

/* The shape behind both the Purchase Orders and Invoices tabs — same table,
   filtered to one document_type, differing only in what the number column
   is called, where a row opens to, and what an empty list says. */
export function DocumentTypeTable({ docs, sites, type, numberLabel, emptyText, onOpenRow }) {
  const rows = useMemo(() => docs.filter((d) => d.document_type === type), [docs, type]);
  const [ready, setReady] = useState(false);
  const ids = rows.map((d) => d.document_id).join(",");

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    loadDocumentDetails(rows.map((d) => d.document_id)).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => { cancelled = true; };
    // Recomputed when the visible set changes, not on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  if (!rows.length) {
    return <div className="card"><div className="empty">{emptyText}</div></div>;
  }

  const siteName = (id) => sites.find((s) => s.id === id)?.name ?? "Unfiled";

  return (
    <div className="card">
      <div className="table-wrap">
        <div className="dgrid" style={{ "--cols": COLS }}>
          <div className="dhead">
            <span>{numberLabel}</span>
            <span>Status</span>
            <span>Vendor</span>
            <span>Site</span>
            <span>Materials</span>
            <span className="r">Amount</span>
            <span>Date</span>
            <span />
          </div>

          {rows.map((d) => {
            const lineCount = getCachedDocument(d.document_id)?.lines?.length;
            return (
              <button
                key={d.document_id}
                className="drow"
                type="button"
                onClick={() => onOpenRow(d)}
                aria-label={`Open ${d.doc_number ?? d.document_id.slice(0, 8)}`}
              >
                <span className="c-vend">{d.doc_number ?? d.document_id.slice(0, 8)}</span>
                <span><StatusPill status={d.status} /></span>
                <span className="c-vend">{d.vendor_name ?? "—"}</span>
                <span className="c-site">{siteName(d.site_id)}</span>
                <span className="c-ref">
                  {!ready ? "…" : lineCount ? `${lineCount} item${lineCount === 1 ? "" : "s"}` : "—"}
                </span>
                {money(d.total_value)
                  ? <span className="c-amt">{money(d.total_value)}</span>
                  : <span className="c-amt pending">—</span>}
                <span className="c-date">{shortDate(d.uploaded_at)}</span>
                <span className="open-sm" aria-hidden="true"><IconArrow width={18} height={18} /></span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
