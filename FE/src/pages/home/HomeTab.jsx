import { useState } from "react";
import { AttentionPanel } from "./AttentionPanel.jsx";
import { ProjectCard } from "./ProjectCard.jsx";
import { RecentActivity } from "./RecentActivity.jsx";
import { AddProjectModal } from "./AddProjectModal.jsx";
import { UploadModal } from "./UploadModal.jsx";
import { ScanModal } from "./ScanModal.jsx";
import { IconPlus } from "../../components/Icons.jsx";
import { go } from "../../lib/useHashRoute.js";
import { projectStatus } from "../../lib/format.js";

/* Four zones — pitch, attention, portfolio, activity — and only two of them
   are cards. The rest sits on the cream so the page does not read as a stack
   of floating boxes. Intake is deliberately not here: a document needs a
   project, and every route to one starts from a project card below. */
export function HomeTab({
  projects, docs, search, reload, onOpenDocument,
  addingProject, setAddingProject,
}) {
  const [scanFor, setScanFor] = useState(null);
  const [uploadFor, setUploadFor] = useState(null);

  const term = search.trim().toLowerCase();
  const shown = !term
    ? projects
    : projects.filter((p) =>
        `${p.code} ${p.name} ${(p.sites ?? []).map((s) => s.name).join(" ")}`
          .toLowerCase()
          .includes(term)
      );

  /* Whatever needs a person floats up; everything else keeps its order. */
  const ordered = [...shown].sort((a, b) => {
    const rank = (p) => (projectStatus(p, docs).cls === "st-action" ? 0 : 1);
    return rank(a) - rank(b);
  });

  return (
    <div className="band">
      <div className="col">

        <div className="hero-grid">
          <div className="hero-copy">
            <span className="eyebrow">Overview</span>
            <h1>Purchase orders, invoices and deliveries — by project.</h1>
            <p className="lede">
              Everything captured on a site phone or uploaded at the desk lands here,
              read automatically and filed against the right project and material.
            </p>
            <div className="hero-cta">
              <button className="btn btn-ink" type="button" onClick={() => setAddingProject(true)}>
                <IconPlus width={18} height={18} />
                Add project
              </button>
              <button className="btn btn-out" type="button" onClick={() => go("/project")}>
                View projects
              </button>
            </div>
          </div>

          <AttentionPanel projects={projects} docs={docs} onReview={onOpenDocument} />
        </div>

        <div className="section">
          <div className="section-head">
            <span className="eyebrow">Projects</span>
            <span className="tag">
              {term ? `${shown.length} of ${projects.length}` : `${projects.length} total`}
            </span>
            <div className="spacer" />
            <button className="btn btn-out btn-sm" type="button" onClick={() => go("/project")}>
              View all
            </button>
          </div>

          <div className="tiles">
            {ordered.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                docs={docs}
                onScan={setScanFor}
                onUpload={setUploadFor}
              />
            ))}

            {term && !shown.length ? (
              <div className="empty" style={{ gridColumn: "1 / -1" }}>
                No project matches “{search}”.
              </div>
            ) : null}

            <button
              className={`tile-add ${projects.length === 0 ? "is-only" : ""}`}
              type="button"
              onClick={() => setAddingProject(true)}
            >
              <span className="ring"><IconPlus width={24} height={24} /></span>
              <span className="t">Add project</span>
              <span className="d">
                {projects.length === 0
                  ? "No sites registered yet. Add the first one and its documents will have somewhere to land."
                  : "Register a site before its documents start arriving."}
              </span>
            </button>
          </div>
        </div>

        <div className="section">
          <div className="section-head">
            <span className="eyebrow">Recent activity</span>
            <div className="spacer" />
            <button className="btn btn-out btn-sm" type="button" onClick={() => go("/documents")}>
              View all documents
            </button>
          </div>
          <RecentActivity docs={docs} onOpen={onOpenDocument} />
        </div>

        {addingProject ? (
          <AddProjectModal onClose={() => setAddingProject(false)} onCreated={reload} />
        ) : null}

        {scanFor ? <ScanModal project={scanFor} onClose={() => setScanFor(null)} /> : null}

        {uploadFor ? (
          <UploadModal
            project={uploadFor}
            onClose={() => setUploadFor(null)}
            onUploaded={reload}
          />
        ) : null}
      </div>
    </div>
  );
}
