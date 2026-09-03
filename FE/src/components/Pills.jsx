import { docTypeLabel, statusClass } from "../lib/format.js";

/* Filled pill = status, the thing you scan a list for.
   Outlined pill = type, secondary metadata. See app.css for why. */

export const StatusPill = ({ status }) => (
  <span className={`pill ${statusClass(status)}`}>{status}</span>
);

export const TypePill = ({ type }) => (
  <span className="pill pill-type">{docTypeLabel(type)}</span>
);
