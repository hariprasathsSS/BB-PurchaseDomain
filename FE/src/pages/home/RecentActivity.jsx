import { activityOf, shortDate } from "../../lib/format.js";

/* What has been happening, newest first. Aligned columns rather than cards:
   a feed is read down the page, and the same field has to sit in the same
   place on every line for that to work. */
export function RecentActivity({ docs, onOpen, limit = 6 }) {
  const recent = docs.slice(0, limit);

  if (!recent.length) {
    return (
      <div className="activity">
        <div className="empty">Nothing captured yet.</div>
      </div>
    );
  }

  return (
    <div className="activity">
      {recent.map((doc) => {
        const { dot, what } = activityOf(doc);
        return (
          <button
            key={doc.document_id}
            className="act-row"
            type="button"
            onClick={() => onOpen(doc.document_id)}
          >
            <span className={`dot ${dot}`} />
            <span className="act-vend">{doc.vendor_name ?? doc.document_id.slice(0, 8)}</span>
            <span className="act-what">{what}</span>
            <span className="act-proj">{doc.project_code ?? "—"}</span>
            <span className="act-when">{shortDate(doc.uploaded_at)}</span>
          </button>
        );
      })}
    </div>
  );
}
