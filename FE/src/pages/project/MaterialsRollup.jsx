import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { qty } from "../../lib/format.js";

/* Line items live on the document detail, not the list, so a rollup means one
   fetch per document. Cached module-wide and keyed by id: the detail of an
   already-reviewed document does not change, and switching tabs should not
   re-fetch the lot. */
const detailCache = new Map();

async function loadDetails(ids) {
  const missing = ids.filter((id) => !detailCache.has(id));
  const fetched = await Promise.all(
    missing.map((id) => api.getDocument(id).catch(() => null))
  );
  fetched.forEach((doc, i) => { if (doc) detailCache.set(missing[i], doc); });
}

function aggregate(docs, materials) {
  const label = (line) =>
    materials.find((m) => m.id === line.material_id)?.name ||
    line.description_raw ||
    "Unclassified";

  const rows = new Map();
  for (const doc of docs) {
    for (const line of detailCache.get(doc.document_id)?.lines ?? []) {
      const name = label(line);
      const key = `${name}__${line.unit ?? ""}`;
      const row = rows.get(key) ?? { name, unit: line.unit || "—", quantity: 0, docs: new Set() };
      row.quantity += Number(line.quantity) || 0;
      row.docs.add(doc.document_id);
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.quantity - a.quantity);
}

/* What this project actually bought, summed across the documents currently in
   view — so the site and date filters above narrow this table too. */
export function MaterialsRollup({ docs, materials }) {
  const [rows, setRows] = useState(null);

  const ids = docs.map((d) => d.document_id).join(",");

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    loadDetails(docs.map((d) => d.document_id)).then(() => {
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

  return (
    <div className="card">
      {/* Past a dozen materials the table scrolls inside the card rather than
          pushing the page down, and the header stays put while it does. */}
      <div className={`table-wrap rollup-wrap ${rows.length > 12 ? "is-tall" : ""}`}>
        <table className="data rollup">
          {/* Fixed proportions: the three numeric columns are the ones being
              compared, so they sit together at the right instead of drifting
              apart as the material names get longer. */}
          <colgroup>
            <col />
            <col style={{ width: "13ch" }} />
            <col style={{ width: "14ch" }} />
            <col style={{ width: "12ch" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Material</th>
              {/* .right, not .num — .num also switches to mono, which no other
                  column header in the app does. */}
              <th className="right">Quantity</th>
              <th>Unit</th>
              <th className="right">Documents</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.name}-${r.unit}`}>
                <td className="c-mat" title={r.name}>{r.name}</td>
                <td className="num strong">{qty(r.quantity)}</td>
                <td className="c-unit">{r.unit}</td>
                <td className="num">{r.docs.size}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
