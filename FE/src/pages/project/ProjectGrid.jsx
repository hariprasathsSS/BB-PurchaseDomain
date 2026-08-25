import { IconArrow, IconPlus } from "../../components/Icons.jsx";
import { go } from "../../lib/useHashRoute.js";
import { projectStatus, projectTally } from "../../lib/format.js";

/* The portfolio. Same tile as the home page, so a project looks like itself
   wherever it appears — including the status label, which is what makes the
   grid scannable without opening anything. */
export function ProjectGrid({ projects, docs, search, onAddProject, onAddDocument }) {
  const term = search.trim().toLowerCase();
  const shown = !term
    ? projects
    : projects.filter((p) => `${p.code} ${p.name}`.toLowerCase().includes(term));

  return (
    <div className="band">
      <div className="col">
        <div className="pagetitle">
          <div>
            <span className="eyebrow">Explorer</span>
            <h1 style={{ marginTop: 14 }}>Projects</h1>
            <p className="lede">
              Open a project to scan its purchase orders, see what was captured
              against them, and the materials they add up to.
            </p>
          </div>
        </div>

        <div className="section">
          <div className="section-head">
            <span className="tag">
              {term ? `${shown.length} of ${projects.length}` : `${projects.length} total`}
            </span>
          </div>

          <div className="tiles">
            {shown.map((p) => {
              const status = projectStatus(p, docs);
              const tally = projectTally(p, docs);
              return (
                <div key={p.id} className={`tile ${status.cls === "st-action" ? "is-hot" : ""}`}>
                  <div>
                    <span className={`tile-status ${status.cls}`}>{status.label}</span>
                    <div className="code">{p.code}</div>
                    <div className="name">{p.name}</div>
                  </div>

                  <div className="tally">
                    <div><b>{tally.documents}</b><span>Documents</span></div>
                    <div><b>{tally.purchaseOrders}</b><span>POs</span></div>
                    <div className={tally.awaiting ? "hot" : ""}>
                      <b>{tally.awaiting}</b><span>Awaiting</span>
                    </div>
                  </div>

                  <div className="tile-actions">
                    <button className="btn btn-ink btn-sm" type="button" onClick={() => onAddDocument(p)}>
                      <IconPlus width={17} height={17} />
                      Add document
                    </button>
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

            {term && !shown.length ? (
              <div className="empty" style={{ gridColumn: "1 / -1" }}>
                No project matches “{search}”.
              </div>
            ) : null}

            <button className={`tile-add ${projects.length === 0 ? "is-only" : ""}`} type="button" onClick={onAddProject}>
              <span className="ring"><IconPlus width={24} height={24} /></span>
              <span className="t">Add project</span>
              <span className="d">Register a project before its documents start arriving.</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
