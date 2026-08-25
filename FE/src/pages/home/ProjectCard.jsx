import { useEffect, useRef, useState } from "react";
import { IconArrow, IconPhone, IconPlus, IconUpload } from "../../components/Icons.jsx";
import { go } from "../../lib/useHashRoute.js";
import { projectStatus, projectTally } from "../../lib/format.js";

/* A project in the portfolio: its health, its tally, a way to get documents
   in, and a way through to the project itself. The status label is what makes
   the grid scannable — without it every card looks the same. */
export function ProjectCard({ project, docs, onScan, onUpload }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const status = projectStatus(project, docs);
  const tally = projectTally(project, docs);
  const sites = project.sites ?? [];

  return (
    <div className={`tile ${status.cls === "st-action" ? "is-hot" : ""}`} ref={ref}>
      <div>
        <span className={`tile-status ${status.cls}`}>{status.label}</span>
        <div className="code">{project.code}</div>
        <div className="name">{project.name}</div>
      </div>

      {sites.length ? (
        <div className="where">{sites.map((s) => s.name).join(" · ")}</div>
      ) : (
        <div className="where">No sites registered yet</div>
      )}

      <div className="tally">
        <div><b>{tally.documents}</b><span>Documents</span></div>
        <div><b>{tally.pages}</b><span>Pages</span></div>
        <div className={tally.awaiting ? "hot" : ""}>
          <b>{tally.awaiting}</b><span>Awaiting</span>
        </div>
      </div>

      <div className="tile-actions" style={{ position: "relative" }}>
        <button className="btn btn-ink btn-sm" type="button" onClick={() => setOpen((v) => !v)}>
          <IconPlus width={17} height={17} />
          Add document
        </button>
        <div className="spacer" />
        <button
          className="open-round"
          type="button"
          onClick={() => go(`/project/${project.id}`)}
          aria-label={`Open ${project.name}`}
        >
          <IconArrow />
        </button>

        {open ? (
          <div className="menu">
            <button onClick={() => { setOpen(false); onScan(project); }}>
              <span className="ico"><IconPhone /></span>
              <span>
                <span className="t">Scan with phone</span>
                <span className="d">Show a QR code the site phone can scan</span>
              </span>
            </button>
            <button onClick={() => { setOpen(false); onUpload(project); }}>
              <span className="ico"><IconUpload /></span>
              <span>
                <span className="t">Upload files</span>
                <span className="d">Choose photos or PDFs from this computer</span>
              </span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

