import { IconCheck, IconClock, IconClose, IconFile, IconFolder, IconRefresh } from "../../components/Icons.jsx";
import { countsTowardTotals, isWaiting, money, needsDecision } from "../../lib/format.js";

/* Two tiers, the way a real ops dashboard reads: the totals first — what's
   in flight and what it's worth — then the breakdown of what stage every
   captured document is actually sitting at. */
export function DashboardMetrics({ projects, docs }) {
  const booked = docs.filter(countsTowardTotals).reduce((sum, d) => sum + (Number(d.total_value) || 0), 0);

  const primary = [
    { key: "active", icon: IconFolder, value: projects.filter((p) => p.status !== "CLOSED").length, label: "Active projects" },
    { key: "captured", icon: IconFile, value: docs.length, label: "Documents captured" },
    { key: "booked", icon: IconFile, value: money(booked) ?? "₹0.00", label: "Total value booked", isMoney: true },
  ];

  const status = [
    { key: "approved", icon: IconCheck, tone: "ok", value: docs.filter((d) => d.status === "APPROVED").length, label: "Approved" },
    { key: "rejected", icon: IconClose, tone: "bad", value: docs.filter((d) => d.status === "REJECTED").length, label: "Rejected" },
    { key: "awaiting", icon: IconClock, tone: "warn", value: docs.filter(needsDecision).length, label: "Awaiting approval" },
    { key: "reading", icon: IconRefresh, tone: "info", value: docs.filter(isWaiting).length, label: "Still being read" },
  ];

  return (
    <div className="section">
      <div className="section-head">
        <span className="eyebrow">Dashboard</span>
      </div>

      <div className="metrics-primary">
        {primary.map((c) => (
          <div className="metric-card metric-card-primary" key={c.key}>
            <span className="metric-icon tone-primary"><c.icon width={20} height={20} /></span>
            <div className={`metric-value ${c.isMoney ? "is-money" : ""}`}>{c.value}</div>
            <div className="metric-label">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="metrics-status">
        {status.map((c) => (
          <div className="metric-card metric-card-status" key={c.key}>
            <span className={`metric-icon tone-${c.tone}`}><c.icon width={17} height={17} /></span>
            <div>
              <div className="metric-value is-compact">{c.value}</div>
              <div className="metric-label">{c.label}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
