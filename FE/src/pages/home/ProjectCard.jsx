import { IconArrow } from "../../components/Icons.jsx";
import { AddDocumentMenu } from "../../components/AddDocumentMenu.jsx";
import { go } from "../../lib/useHashRoute.js";
import { projectStatus, projectTally } from "../../lib/format.js";

/* A project in the portfolio: its health, its tally, a way to get documents
   in, and a way through to the project itself. The status label is what makes
   the grid scannable — without it every card looks the same. */
export function ProjectCard({ project, docs, onScan, onUpload }) {
  const status = projectStatus(project, docs);
  const tally = projectTally(project, docs);
  const sites = project.sites ?? [];

  return (
    <div className={`tile ${status.cls === "st-action" ? "is-hot" : ""}`}>
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

      <div className="tile-actions">
        <AddDocumentMenu
          onScan={() => onScan(project)}
          onUpload={() => onUpload(project)}
        />
        <div className="spacer" />
        <button
          className="open-round"
          type="button"
          onClick={() => go(`/project/${project.id}`)}
          aria-label={`Open ${project.name}`}
        >
          <IconArrow />
        </button>
      </div>
    </div>
  );
}

