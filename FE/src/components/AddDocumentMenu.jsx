import { useEffect, useRef, useState } from "react";
import { IconPhone, IconPlus, IconUpload } from "./Icons.jsx";

/* The one "Add document" control, everywhere it appears — home tiles, the
   projects grid, a project's own page. Same two ways in every time: a QR the
   site phone scans, or files picked at this desk. Extracted out of
   ProjectCard so the project page and the projects grid don't each grow
   their own slightly-different copy of the open/close/click-outside dance. */
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
