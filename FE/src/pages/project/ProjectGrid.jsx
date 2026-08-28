import { IconArrow, IconPlus } from "../../components/Icons.jsx";
import { AddDocumentMenu } from "../../components/AddDocumentMenu.jsx";
import { go } from "../../lib/useHashRoute.js";
import { projectStatus, projectTally } from "../../lib/format.js";

/* The portfolio. Same tile as the home page, so a project looks like itself
   wherever it appears — including the status label, which is what makes the
   grid scannable without opening anything. */
export function ProjectGrid({ projects, docs, onAddProject, onAddDocument, onScan }) {
  return (
    <div className="band">
      <div className="col">
        <div className="pagetitle">
          <div>
            <span className="eyebrow">Explorer</span>
            <h1 style={{ marginTop: 14 }}>Projects</h1>
            <p className="lede">
              Open a project to see what was captured for it and the materials they add up to.
            </p>
          </div>
        </div>

        <div className="section">
          <div className="section-head">
            <span className="tag">{projects.length} total</span>
          </div>

          <div className="tiles">
            {projects.map((p) => {
              const status = projectStatus(p, docs);
              const tally = projectTally(p, docs);
              return (
                <div key={p.id} className={`tile ${status.cls === "st-action" ? "is-hot" : ""}`}>
                  <div>
                    <span className={`tile-status ${status.cls}`}>{status.label}</span>
                    <div className="tile-head">
                      <span className="name">{p.name}</span>
                      <span className="code">{p.code}</span>
                    </div>
                  </div>

                  <div className="tally">
                    <div><b>{tally.documents}</b><span>Documents</span></div>
                    <div><b>{tally.pages}</b><span>Pages</span></div>
                    <div className={tally.awaiting ? "hot" : ""}>
                      <b>{tally.awaiting}</b><span>Awaiting</span>
                    </div>
                  </div>

                  <div className="tile-actions">
                    <AddDocumentMenu
                      onScan={() => onScan(p)}
                      onUpload={() => onAddDocument(p)}
                    />
                    <div className="spacer" />
                    <button
                      className="open-round"
                      type="button"
                      onClick={() => go(`/project/${p.id}`)}
                      aria-label={`Open ${p.name}`}
                    >
                      <IconArrow />
                    </button>
                  </div>
                </div>
              );
            })}

            <button className={`tile-add ${projects.length === 0 ? "is-only" : ""}`} type="button" onClick={onAddProject}>
              <span className="ring"><IconPlus width={24} height={24} /></span>
              <span className="t">Add project</span>
              <span className="d">Its documents will start showing up here as soon as it exists.</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
