import { IconArrow } from "../../components/Icons.jsx";
import { needsDecision, isWaiting } from "../../lib/format.js";

/* Actions outrank metrics. The one figure with a decision waiting on it gets
   the numeral, a sentence and a button; everything else is a quiet row.
   Deliberately one panel rather than a hero snapshot plus a separate stat
   band — those would print the same four numbers twice. */
export function AttentionPanel({ projects, docs, onReview }) {
  const waiting = docs.filter(needsDecision);
  const rows = [
    { dot: "d-mute", label: "Active projects", value: projects.length },
    { dot: "d-ink", label: "Documents captured", value: docs.length },
    { dot: "d-ok", label: "Approved", value: docs.filter((d) => d.status === "APPROVED").length },
    { dot: "d-no", label: "Rejected", value: docs.filter((d) => d.status === "REJECTED").length },
  ];

  const reading = docs.filter(isWaiting).length;

  return (
    <div className="attn">
      <div className="attn-top">
        <span className="eyebrow">Needs attention</span>
        <div className="attn-lead">
          <div className={`n ${waiting.length ? "" : "calm"}`}>{waiting.length}</div>
          <div>
            <div className="t">{waiting.length === 1 ? "Document awaiting review" : "Documents awaiting review"}</div>
            <div className="d">
              {waiting.length
                ? "Read and waiting on your decision."
                : reading
                  ? `Nothing to decide yet — ${reading} still being read.`
                  : "Nothing is waiting on you."}
            </div>
            {waiting.length ? (
              <div className="attn-act">
                <button
                  className="btn btn-ink btn-sm"
                  type="button"
                  onClick={() => onReview(waiting[0].document_id)}
                >
                  Review now
                  <IconArrow width={17} height={17} />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {rows.map((r) => (
        <div className="attn-row" key={r.label}>
          <span className={`dot ${r.dot}`} />
          {r.label}
          <div className="spacer" />
          <b>{r.value}</b>
        </div>
      ))}
    </div>
  );
}
