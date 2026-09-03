import { DocumentsSection } from "../../components/DocumentsSection.jsx";

/* The document register: every scan and upload the console has taken, newest
   first, as a register rather than a gallery. A register is what this is —
   the question asked of it is "what came in, from whom, for how much, and
   what happened to it", and those are columns to be compared down the page,
   not captions under pictures. */
export function DocumentsTab({ docs, projects, onOpenDocument }) {
  return (
    <div className="band">
      <div className="col">
        <div className="pagetitle">
          <div>
            <span className="eyebrow">Capture history</span>
            <h1 style={{ marginTop: 14 }}>Document Register</h1>
            <p className="lede">
              Every document photographed on a site phone or uploaded from this
              desk, newest first, with the project it was filed against.
            </p>
          </div>
        </div>

        <DocumentsSection
          docs={docs}
          projects={projects}
          onOpenDocument={onOpenDocument}
          emptyLabel="Nothing captured yet."
        />
      </div>
    </div>
  );
}
