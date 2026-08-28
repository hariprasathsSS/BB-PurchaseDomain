import { useEffect, useMemo, useState } from "react";
import { getCachedDocument, loadDocumentDetails } from "../../lib/documentCache.js";
import { qty } from "../../lib/format.js";

/* Same per-material ordered-vs-delivered aggregation ProjectDetail's own
   Materials tab does (see MaterialsRollup.jsx) — kept as a second small
   copy rather than a shared import since this only needs requested/received
   totals per material, not that component's PO/invoice entry breakdown. */
function aggregate(docs, materials) {
  const label = (line) =>
    materials.find((m) => m.id === line.material_id)?.name || line.description_raw || "Unclassified";

  const rows = new Map();
  for (const doc of docs) {
    for (const line of getCachedDocument(doc.document_id)?.lines ?? []) {
      const name = label(line);
      const key = `${name}__${line.unit ?? ""}`;
      const row = rows.get(key) ?? { name, unit: line.unit || "—", requested: 0, received: 0 };
      const quantity = Number(line.quantity) || 0;
      if (doc.document_type === "PO") row.requested += quantity;
      else if (doc.document_type === "INVOICE") row.received += quantity;
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.requested - a.requested);
}

/* One ring per material, not one ring for the whole project — a real PO
   here can carry 100 MT of cement, 80 Cum of aggregate and 200,000 bricks
   side by side, and adding those raw numbers into one "requested" total
   would make the ring almost entirely brick-count with everything else lost
   in the rounding. Each material keeps its own unit and its own ring
   instead; a slice's share is (this material's requested) vs (received) of
   each other, not a percentage of some larger cross-material whole. */
function Donut({ requested, received, size = 88, thickness = 14 }) {
  const total = requested + received;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const reqLen = total ? (requested / total) * c : 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="pie-svg">
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          strokeWidth={thickness} style={{ stroke: "var(--hair)" }}
        />
        {total ? (
          <>
            <circle
              cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={thickness}
              style={{ stroke: "var(--ink)" }}
              strokeDasharray={`${reqLen} ${c - reqLen}`}
            />
            <circle
              cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={thickness}
              style={{ stroke: "var(--ok-fg)" }}
              strokeDasharray={`${c - reqLen} ${reqLen}`}
              strokeDashoffset={-reqLen}
            />
          </>
        ) : null}
      </g>
    </svg>
  );
}

/* Requested vs received, per material, for whichever project the dropdown
   picks. No charting library — two arcs per ring is simple enough in plain
   SVG not to need one. */
export function MaterialsPieChart({ projects, docs, materials }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [rows, setRows] = useState(null);

  // A project can vanish out from under the selection (deleted elsewhere) —
  // fall back to the first one still on the list rather than showing a
  // picker stuck on an option that no longer exists.
  useEffect(() => {
    if (projects.length && !projects.some((p) => p.id === projectId)) {
      setProjectId(projects[0].id);
    }
  }, [projects, projectId]);

  const projectDocs = useMemo(
    () => docs.filter(
      (d) => d.project_id === projectId && (d.document_type === "PO" || d.document_type === "INVOICE")
    ),
    [docs, projectId]
  );
  const ids = projectDocs.map((d) => d.document_id).join(",");

  useEffect(() => {
    if (!projectId) { setRows([]); return; }
    let cancelled = false;
    setRows(null);
    loadDocumentDetails(projectDocs.map((d) => d.document_id)).then(() => {
      if (!cancelled) setRows(aggregate(projectDocs, materials));
    });
    return () => { cancelled = true; };
    // Recomputed when the visible set changes, not on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, ids, materials]);

  return (
    <div className="card pie-card">
      <div className="section-head">
        <span className="eyebrow">Requested vs received</span>
        <span className="spacer" />
        <select
          className="input pie-select"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
          ))}
        </select>
      </div>

      {!projects.length ? (
        <div className="empty">No projects yet.</div>
      ) : rows === null ? (
        <div className="empty">Reading line items…</div>
      ) : !rows.length ? (
        <div className="empty">No purchase orders or invoices yet for this project.</div>
      ) : (
        <>
          <div className="pie-legend-key">
            <span className="pie-legend-row"><span className="pie-dot" style={{ background: "var(--ink)" }} /> Requested</span>
            <span className="pie-legend-row"><span className="pie-dot" style={{ background: "var(--ok-fg)" }} /> Received</span>
          </div>

          <div className="pie-grid">
            {rows.map((r) => (
              <div className="pie-mat" key={`${r.name}-${r.unit}`}>
                <Donut requested={r.requested} received={r.received} />
                <div className="pie-mat-info">
                  <div className="pie-mat-name" title={r.name}>{r.name}</div>
                  <div className="pie-mat-qty">
                    {qty(r.requested)} → {qty(r.received)} {r.unit}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
