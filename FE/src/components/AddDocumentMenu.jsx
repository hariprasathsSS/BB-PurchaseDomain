import { useEffect, useRef, useState } from "react";
import { IconPhone, IconPlus, IconUpload } from "./Icons.jsx";

/* The one "Add document" control, everywhere it appears — home tiles, the
   projects grid, a project's own page. Normally two ways in: a QR the site
   phone scans, or files picked at this desk — see PHONE_SCAN_ENABLED below
   for why it may only offer one. Extracted out of ProjectCard so the project
   page and the projects grid don't each grow their own slightly-different
   copy of the open/close/click-outside dance. */
// Scan-with-phone's mobile companion app isn't reliable yet, so it's turned
// off here rather than pulled out of the code — flip FE/.env's
// VITE_ENABLE_PHONE_SCAN back to true (and restart the dev server / rebuild;
// Vite only reads .env at boot) once that app works, no code change needed.
const PHONE_SCAN_ENABLED = import.meta.env.VITE_ENABLE_PHONE_SCAN === "true";

export function AddDocumentMenu({
  onScan, onUpload, className = "btn btn-ink btn-sm", label = "Add document",
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  // With scan-with-phone off there's only one way to add a document, so this
  // is a plain button instead of a one-item dropdown pretending to be a choice.
  if (!PHONE_SCAN_ENABLED) {
    return (
      <button className={className} type="button" onClick={onUpload}>
        <IconPlus width={17} height={17} />
        {label}
      </button>
    );
  }

  return (
    <div className="add-doc-menu" ref={ref} style={{ position: "relative" }}>
      <button className={className} type="button" onClick={() => setOpen((v) => !v)}>
        <IconPlus width={17} height={17} />
        {label}
      </button>

      {open ? (
        <div className="menu">
          <button type="button" onClick={() => { setOpen(false); onScan(); }}>
            <span className="ico"><IconPhone /></span>
            <span>
              <span className="t">Scan with phone</span>
              <span className="d">Show a QR code the site phone can scan</span>
            </span>
          </button>
          <button type="button" onClick={() => { setOpen(false); onUpload(); }}>
            <span className="ico"><IconUpload /></span>
            <span>
              <span className="t">Upload files</span>
              <span className="d">Choose photos or PDFs from this computer</span>
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
