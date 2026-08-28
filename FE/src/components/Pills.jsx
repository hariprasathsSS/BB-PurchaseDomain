import { statusClass } from "../lib/format.js";

/* Filled pill = status, the thing you scan a list for.
   Outlined pill = type, secondary metadata. See app.css for why. */

export const StatusPill = ({ status }) => (
  <span className={`pill ${statusClass(status)}`}>{status}</span>
);

// PURCHASE_BILL is the one document_type with an underscore in it — shown
// as a space instead, same all-caps style every other type already reads
// fine in without any transform.
export const TypePill = ({ type }) => (
  <span className="pill pill-type">{type?.replace(/_/g, " ")}</span>
);
