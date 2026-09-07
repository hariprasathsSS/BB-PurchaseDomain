import { useState } from "react";
import { compactMoney, countsTowardTotals, docTypeLabel, projectTally } from "../../lib/format.js";

/* Rounds a chart's ceiling up to a clean 1/2/2.5/5/10 × 10^n step, the way a
   real axis is drawn by hand — so gridlines read "₹12L, ₹9L, ₹6L..." instead
   of some jagged fraction of whatever the largest bar happens to be. */
function niceCeil(value) {
  if (value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * base) return step * base;
  }
  return 10 * base;
}

/* Project-wise Value Booked — the primary chart. One bar per project with
   any booked value, tallest first; the shape a reviewer already knows from
   the metric cards above, just broken out by project. */
function ValueByProjectChart({ projects, docs }) {
  const rows = projects
    .map((p) => ({ id: p.id, label: p.name || p.code, value: projectTally(p, docs).booked }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  if (!rows.length) {
    return <div className="chart-empty">No value booked yet.</div>;
  }

  const ceiling = niceCeil(Math.max(...rows.map((r) => r.value)));
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => ceiling * f);

  return (
    <div className="bar-chart">
      <div className="bar-chart-axis">
        {ticks.map((t) => (
          <span key={t}>{t === 0 ? "0" : compactMoney(t)}</span>
        ))}
      </div>
      <div className="bar-chart-plot">
        {rows.map((r) => (
          <div className="bar-col" key={r.id}>
            <span className="bar-value">{compactMoney(r.value)}</span>
            <span className="bar" style={{ height: `${(r.value / ceiling) * 100}%` }} />
            <span className="bar-label" title={r.label}>{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Documents by Type — the secondary chart. Only Invoice/PO/MIN/Purchase Bill
   get their own slice; everything else (delivery challans, quotations,
   still-unclassified pages) folds into "Others" so five calm slices always
   answer "what kind of paper is this portfolio mostly made of." Every
   colour is still one of the app's own tokens (ink/accent-tint/warn/slate/
   dust) — a wider spread across the palette than one blue family, but never
   a colour the app doesn't already use somewhere else. */
const LIGHT_BLUE = "color-mix(in srgb, var(--accent) 62%, white)";
// The app's amber is a pale-cream/dark-brown text pair (built for contrast,
// not for a filled shape) — blending the two gives the mid-tone gold this
// wedge needs without inventing a colour the app doesn't already use.
const AMBER_FILL = "color-mix(in srgb, var(--warn-fg) 55%, var(--warn-bg))";
const TYPE_SLICES = [
  { key: "INVOICE", color: "var(--ink)" },
  { key: "PO", color: LIGHT_BLUE },
  { key: "INWARD", color: AMBER_FILL },
  { key: "PURCHASE_BILL", color: "var(--slate)" },
];
const OTHER_COLOR = "var(--dust)";

function DocumentsByTypeChart({ docs }) {
  const total = docs.length;
  const counts = {};
  for (const d of docs) counts[d.document_type] = (counts[d.document_type] || 0) + 1;

  const named = TYPE_SLICES.map((t) => ({ ...t, label: docTypeLabel(t.key), count: counts[t.key] || 0 }));
  const otherCount = total - named.reduce((sum, t) => sum + t.count, 0);
  const buckets = [...named, { key: "OTHER", color: OTHER_COLOR, label: "Others", count: otherCount }]
    .filter((b) => b.count > 0);

  if (!total) {
    return <div className="chart-empty">No documents yet.</div>;
  }

  let cum = 0;
  const stops = buckets.map((b) => {
    const start = cum;
    cum += (b.count / total) * 100;
    return `${b.color} ${start}% ${cum}%`;
  });

  return (
    <div className="donut-chart">
      <div className="donut-ring" style={{ background: `conic-gradient(${stops.join(", ")})` }}>
        <div className="donut-center">
          <div className="donut-total">{total}</div>
          <div className="donut-total-label">Documents</div>
        </div>
      </div>
      <ul className="donut-legend">
        {buckets.map((b) => (
          <li key={b.key}>
            <span className="legend-dot" style={{ background: b.color }} />
            <span className="legend-label">{b.label}</span>
            <span className="legend-count">{b.count}</span>
            <span className="legend-pct">{Math.round((b.count / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* Both charts share one project filter — "All projects" by default, or one
   project's own slice of the same two questions ("what did it cost" /
   "what kind of paper was it"). A dropdown per card rather than one shared
   control above both, since each card still reads as a complete, standalone
   answer on its own. */
function ProjectFilter({ projects, value, onChange }) {
  return (
    <select className="ctl ctl-xs chart-filter" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All projects</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>{p.code || p.name}</option>
      ))}
    </select>
  );
}

export function DashboardCharts({ projects, docs }) {
  const [projectId, setProjectId] = useState("");
  const scoped = projectId ? docs.filter((d) => d.project_id === projectId) : docs;
  const scopedProjects = projectId ? projects.filter((p) => p.id === projectId) : projects;
  const counted = scoped.filter(countsTowardTotals);

  return (
    <div className="section section-analytics">
      <div className="section-head">
        <span className="eyebrow">Analytics</span>
      </div>

      <div className="analytics-grid">
        <div className="chart-card chart-card-primary">
          <div className="chart-card-head">
            <div>
              <h3>Project-wise Value Booked</h3>
              <p className="chart-sub">Total value of materials booked per project</p>
            </div>
            <ProjectFilter projects={projects} value={projectId} onChange={setProjectId} />
          </div>
          <ValueByProjectChart projects={scopedProjects} docs={counted} />
        </div>

        <div className="chart-card chart-card-secondary">
          <div className="chart-card-head">
            <div>
              <h3>Documents by Type</h3>
              <p className="chart-sub">Breakdown of captured documents</p>
            </div>
            <ProjectFilter projects={projects} value={projectId} onChange={setProjectId} />
          </div>
          <DocumentsByTypeChart docs={scoped} />
        </div>
      </div>
    </div>
  );
}
