import { IconCheckCircle, IconClock, IconEye, IconFile, IconLayers, IconXCircle } from "../../components/Icons.jsx";
import { countsTowardTotals, isWaiting, money, needsDecision, trendVsLastMonth } from "../../lib/format.js";
import { go } from "../../lib/useHashRoute.js";

const RupeeIcon = () => <span className="rupee-icon">₹</span>;

/* A handful of fixed decorative curves, not real data — the reference this
   redesign follows carries a soft sparkline behind every card, and a chart
   library is a heavy dependency for a shape that isn't plotting anything.
   Picked by index so neighbouring cards don't all repeat the same curve. */
const SPARK_PATHS = [
  "M0 38 C 18 15, 34 42, 52 24 S 88 6, 118 22",
  "M0 26 C 20 42, 42 8, 64 26 S 96 38, 118 14",
  "M0 18 C 16 36, 40 10, 62 28 S 92 14, 118 32",
];

function Sparkline({ seed = 0, className = "" }) {
  const d = SPARK_PATHS[seed % SPARK_PATHS.length];
  const gid = `spark-grad-${seed}`;
  return (
    <svg className={`kpi-spark ${className}`} viewBox="0 0 120 46" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity=".4" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L120 46 L0 46 Z`} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/* Each KPI gets its own tinted icon tile (never the same tint as the status
   pill row below it uses for the same colour family — "captured" reads as
   the app's steel accent, not the info-blue "active" already owns, so the
   two cards aren't just two shades of the same idea). */
const KPI_THEME = {
  active:   "tone-blue",
  captured: "tone-steel",
  booked:   "tone-green",
};

export function DashboardMetrics({ projects, docs }) {
  const active = projects.filter((p) => p.status !== "CLOSED");
  const booked = docs.filter(countsTowardTotals).reduce((sum, d) => sum + (Number(d.total_value) || 0), 0);

  const primary = [
    {
      key: "active", icon: IconLayers, value: active.length, label: "Active projects", href: "/project",
      theme: KPI_THEME.active, trend: trendVsLastMonth(active, "created_at"),
    },
    {
      key: "captured", icon: IconFile, value: docs.length, label: "Documents captured", href: "/documents",
      theme: KPI_THEME.captured, trend: trendVsLastMonth(docs, "uploaded_at"),
    },
    {
      key: "booked", icon: RupeeIcon, value: money(booked) ?? "₹0.00", label: "Total value booked", href: "/documents",
      theme: KPI_THEME.booked, isMoney: true,
      trend: trendVsLastMonth(docs.filter(countsTowardTotals), "uploaded_at", (d) => Number(d.total_value) || 0),
    },
  ];

  const status = [
    { key: "approved", icon: IconCheckCircle, tone: "ok", value: docs.filter((d) => d.status === "APPROVED").length, label: "Approved" },
    { key: "rejected", icon: IconXCircle, tone: "bad", value: docs.filter((d) => d.status === "REJECTED").length, label: "Rejected" },
    { key: "awaiting", icon: IconClock, tone: "warn", value: docs.filter(needsDecision).length, label: "Awaiting approval" },
    { key: "reading", icon: IconEye, tone: "gray", value: docs.filter(isWaiting).length, label: "Still being read" },
  ];

  return (
    <div className="section">
      <div className="section-head">
        <span className="eyebrow">Dashboard</span>
      </div>

      <div className="kpi-grid">
        {primary.map((c, i) => (
          <button
            type="button" className={`kpi-card ${c.theme}`} key={c.key}
            onClick={() => go(c.href)}
            aria-label={`${c.label}: ${c.value}${c.trend ? `, ${c.trend.short} ${c.trend.caption}` : ""}`}
          >
            <span className="kpi-body">
              <span className="kpi-icon"><c.icon width={20} height={20} /></span>
              <span className="kpi-label">{c.label}</span>
              <span className={`kpi-value ${c.isMoney ? "is-money" : ""}`}>{c.value}</span>
              {c.trend ? (
                <span className="kpi-trend">
                  <span className={`kpi-delta trend-${c.trend.tone}`}>{c.trend.short}</span>
                  <span className="kpi-trend-caption">{c.trend.caption}</span>
                </span>
              ) : null}
            </span>
            <Sparkline seed={i} className="kpi-spark-fg" />
          </button>
        ))}
      </div>

      {/* One lead tile plus four status pills — plain, small line icons (no
          colored circle wrapper, no corner watermark), a very light tint per
          status rather than a full-strength wash, and no arrow: the whole
          tile is the click target into Documents, same as before. */}
      <div className="status-grid">
        <button type="button" className="status-tile tone-lead" onClick={() => go("/documents")} aria-label="Document status">
          <span className="status-icon"><IconFile width={17} height={17} /></span>
          <span className="status-title">Document status</span>
          <span className="status-sub">{docs.length} documents captured</span>
        </button>

        {status.map((c) => (
          <button
            type="button" className={`status-tile tone-${c.tone}`} key={c.key}
            onClick={() => go("/documents")} aria-label={`${c.label}: ${c.value}`}
          >
            <span className="status-icon"><c.icon width={17} height={17} /></span>
            <span className="status-value">{c.value}</span>
            <span className="status-label">{c.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
