/* Formatting, derivation and lookup helpers shared across tabs. No JSX. */

export const inr = (n) =>
  n == null || n === ""
    ? "—"
    : Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const money = (n) => (n == null || n === "" ? null : `₹${inr(n)}`);

export const qty = (n) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

export const kb = (n) =>
  n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;

/* "2026-08-24 19:03:27" -> "24 Aug". The full stamp is still on the review
   sheet; a list only needs enough to tell one day from another. */
export const shortDate = (stamp) => {
  const d = new Date(String(stamp).replace(" ", "T"));
  return Number.isNaN(d.getTime())
    ? String(stamp).slice(0, 10)
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

export const projectOf = (doc) =>
  doc.project_code ? `${doc.project_code} — ${doc.project_name}` : "—";

export const siteNameOf = (doc, projects) =>
  projects
    .find((p) => p.id === doc.project_id)
    ?.sites?.find((s) => s.id === doc.site_id)?.name ?? "—";

/* The reference printed on the paper, whichever kind of paper it is. */
export const refOf = (doc) => doc.doc_number || doc.po_number || null;

export const IMAGE_RE = /\.(png|jpe?g|gif|webp)$/i;
export const ALLOWED_UPLOAD_RE = /\.(pdf|jpe?g|png)$/i;

export const DOC_TYPES = ["INVOICE", "PO", "DELIVERY", "QUOTATION", "INWARD", "OTHER", "UNCLASSIFIED"];
export const DOC_STATUSES = [
  "PENDING", "PROCESSING", "EXTRACTED", "APPROVED", "REJECTED", "FAILED",
];

export const titleCase = (s) => s.charAt(0) + s.slice(1).toLowerCase();

/* EXTRACTED reads as "pending" because it still needs a human — the document
   is done being read, not done being handled. */
const STATUS_CLASS = {
  PENDING: "s-pending",
  PROCESSING: "s-working",
  EXTRACTED: "s-pending",
  APPROVED: "s-approved",
  REJECTED: "s-rejected",
  FAILED: "s-failed",
};
export const statusClass = (status) => STATUS_CLASS[status] ?? "s-pending";

export const isWaiting = (doc) => doc.status === "PENDING" || doc.status === "PROCESSING";
export const isLocked = (doc) => doc.status === "APPROVED" || doc.status === "REJECTED";
/* "Awaiting review" means a person, not a machine: extraction is finished and
   the document is sitting there wanting a decision. */
export const needsDecision = (doc) => doc.status === "EXTRACTED";

export const isRejected = (doc) => doc.status === "REJECTED";
/* A rejected document stays visible in every list — that is the audit trail —
   but it is a document the business has decided not to accept, so its money
   and its materials must not reach any total. Every aggregate filters through
   this one predicate rather than each re-testing the status string. */
export const countsTowardTotals = (doc) => !isRejected(doc);

/* ── project health ───────────────────────────────────────────────────────
   Lets a portfolio be scanned without opening anything. Order matters: a
   project with something waiting on a person outranks one still reading. */
export function projectStatus(project, docs) {
  const mine = docs.filter((d) => d.project_id === project.id);
  if (mine.some(needsDecision)) return { cls: "st-action", label: "Action required", dot: "d-hot" };
  if (mine.some(isWaiting))     return { cls: "st-proc",   label: "Processing",      dot: "d-ink" };
  if (mine.length)              return { cls: "st-track",  label: "On track",        dot: "d-ok" };
  return { cls: "st-none", label: "No activity", dot: "d-mute" };
}

export function projectTally(project, docs) {
  const mine = docs.filter((d) => d.project_id === project.id);
  const counted = mine.filter(countsTowardTotals);
  return {
    documents: mine.length,
    pages: mine.reduce((n, d) => n + (d.page_count ?? 0), 0),
    awaiting: mine.filter(needsDecision).length,
    sites: (project.sites ?? []).length,
    // Rejected documents are excluded: the project did not buy that.
    booked: counted.reduce((sum, d) => sum + (Number(d.total_value) || 0), 0),
    reading: mine.filter(isWaiting).length,
    rejected: mine.length - counted.length,
  };
}

/* What a document did, in the words a person would use for it. */
export function activityOf(doc) {
  const kind = titleCase(doc.document_type ?? "Document");
  const value = money(doc.total_value);
  switch (doc.status) {
    case "APPROVED":
      return { dot: "d-ok", what: value ? `${kind} approved · ${value}` : `${kind} approved` };
    case "REJECTED":
      return { dot: "d-no", what: `${kind} rejected` };
    case "EXTRACTED":
      return { dot: "d-hot", what: "Read — waiting on your decision" };
    case "FAILED":
      return { dot: "d-no", what: `Could not be read — ${doc.error || "unknown error"}` };
    default:
      return { dot: "d-ink", what: `${kind} being read` };
  }
}

/* Shared by the project detail and material tabs so both filter identically. */
export function matchesFilter(doc, f = {}) {
  if (f.project && doc.project_id !== f.project) return false;
  if (f.site && doc.site_id !== f.site) return false;
  if (f.type && doc.document_type !== f.type) return false;
  if (f.status && doc.status !== f.status) return false;
  const day = (doc.uploaded_at || "").slice(0, 10);
  if (f.from && day < f.from) return false;
  if (f.to && day > f.to) return false;
  if (f.q) {
    const hay = `${doc.document_id} ${projectOf(doc)} ${doc.vendor_name ?? ""} ${refOf(doc) ?? ""}`;
    if (!hay.toLowerCase().includes(f.q.toLowerCase())) return false;
  }
  return true;
}
