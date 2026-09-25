import { Fragment, useEffect, useState } from "react";
import { IconChevron } from "../../components/Icons.jsx";
import { getCachedDocument, loadDocumentDetails } from "../../lib/documentCache.js";
import { qty } from "../../lib/format.js";

/* Ordered vs. delivered, per material — not the fuller PO<->invoice matching
   described in docs/PROJECT_PLAN.md Phase 3 (that engine doesn't exist yet,
   and this makes no attempt to say *which* invoice fulfils *which* PO), just
   an honest sum: everything this project's POs ask for against everything
   its invoices have actually billed, for a human to compare by eye. */
function aggregate(docs, materials) {
  const label = (line) =>
    materials.find((m) => m.id === line.material_id)?.name ||
    line.description_raw ||
    "Unclassified";

  const rows = new Map();
  for (const doc of docs) {
    for (const line of getCachedDocument(doc.document_id)?.lines ?? []) {
      const name = label(line);
      const key = `${name}__${line.unit ?? ""}`;
      const row = rows.get(key) ?? {
        name, unit: line.unit || "—",
        poQty: 0, invoiceQty: 0,
        poEntries: [], invoiceEntries: [],
      };
      const quantity = Number(line.quantity) || 0;

      if (doc.document_type === "PO") {
        row.poQty += quantity;
        row.poEntries.push({
          key: `${doc.document_id}-${line.line_no}`,
          label: doc.doc_number ?? doc.document_id.slice(0, 8),
          quantity,
        });
      } else if (doc.document_type === "INVOICE") {
        row.invoiceQty += quantity;
        row.invoiceEntries.push({
          key: `${doc.document_id}-${line.line_no}`,
          label: doc.doc_number ?? doc.document_id.slice(0, 8),
          vendor: doc.vendor_name,
          quantity,
        });
      }
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.poQty - a.poQty || b.invoiceQty - a.invoiceQty);
}

/* What this project ordered and what it's actually received, summed across
   the documents currently in view — so the site and date filters above
   narrow this table too. */
export function MaterialsRollup({ docs, materials }) {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(() => new Set());

  const ids = docs.map((d) => d.document_id).join(",");

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    loadDocumentDetails(docs.map((d) => d.document_id)).then(() => {
      if (!cancelled) setRows(aggregate(docs, materials));
    });
    return () => { cancelled = true; };
    // Recomputed when the visible set changes, not on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, materials]);

  if (rows === null) {
    return <div className="card"><div className="empty">Reading line items…</div></div>;
  }

  if (!rows.length) {
    return (
      <div className="card">
        <div className="empty">
          No line items yet — materials appear once a document has been extracted.
        </div>
      </div>
    );
  }

  const toggle = (key) => setOpen((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  /* No PO for the quantity to compare against is its own state — worth
     showing as a dash, not a false "0", and worth telling apart from a
     shortfall or a clean delivery. */
  const deliveredClass = (row) => {
    if (!row.poQty) return "";
    if (row.invoiceQty >= row.poQty) return "ok";
    if (row.invoiceQty > 0) return "warn";
    return "mute";
  };

  return (
    <div className="card">
      {/* Past a dozen materials the table scrolls inside the card rather than
          pushing the page down, and the header stays put while it does. */}
      <div className={`table-wrap rollup-wrap ${rows.length > 12 ? "is-tall" : ""}`}>
        <table className="data rollup">
          {/* Fixed proportions: the numeric columns are the ones being
              compared, so they sit together at the right instead of drifting
              apart as the material names get longer. */}
          <colgroup>
            <col />
            <col style={{ width: "11ch" }} />
            <col style={{ width: "13ch" }} />
            <col style={{ width: "13ch" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Material</th>
              <th>Unit</th>
              {/* .right, not .num — .num also switches to mono, which no
                  other column header in the app does. */}
              <th className="right">PO qty</th>
              <th className="right">Delivered</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const key = `${r.name}-${r.unit}`;
              const isOpen = open.has(key);
              return (
                <Fragment key={key}>
                  <tr>
                    <td className="c-mat" title={r.name}>
                      <div className="rollup-mat-cell">
                        <button
                          className={`rollup-toggle ${isOpen ? "is-open" : ""}`}
                          type="button"
                          onClick={() => toggle(key)}
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? "Hide" : "Show"} PO and invoice breakdown for ${r.name}`}
                        >
                          <IconChevron width={16} height={16} />
                        </button>
                        <span>{r.name}</span>
                      </div>
                    </td>
                    <td className="c-unit">{r.unit}</td>
                    <td className="num strong">{r.poQty ? qty(r.poQty) : "—"}</td>
                    <td className={`num strong ${deliveredClass(r)}`}>
                      {r.invoiceQty ? qty(r.invoiceQty) : "—"}
                    </td>
                  </tr>

                  {isOpen ? (
                    <tr className="rollup-detail">
                      <td colSpan={4}>
                        <div className="rollup-breakdown">
                          <div>
                            <h4>Purchase orders</h4>
                            {r.poEntries.length ? (
                              <ul>
                                {r.poEntries.map((e) => (
                                  <li key={e.key}>
                                    <span>{e.label}</span>
                                    <span className="qty">{qty(e.quantity)} {r.unit}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <div className="empty-mini">No PO orders this material.</div>
                            )}
                          </div>
                          <div>
                            <h4>Invoices</h4>
                            {r.invoiceEntries.length ? (
                              <ul>
                                {r.invoiceEntries.map((e) => (
                                  <li key={e.key}>
                                    <span>{e.label}{e.vendor ? ` — ${e.vendor}` : ""}</span>
                                    <span className="qty">{qty(e.quantity)} {r.unit}</span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <div className="empty-mini">No invoice has delivered this material yet.</div>
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
