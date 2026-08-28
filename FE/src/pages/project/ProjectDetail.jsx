import { useMemo, useState } from "react";
import { IconBack, IconDownload, IconPlus, IconPrint, IconTrash } from "../../components/Icons.jsx";
import { AddDocumentMenu } from "../../components/AddDocumentMenu.jsx";
import { MaterialsRollup } from "./MaterialsRollup.jsx";
import { PurchaseOrdersSection } from "./PurchaseOrdersSection.jsx";
import { QuoteAnalysisSection } from "./QuoteAnalysisSection.jsx";
import { go } from "../../lib/useHashRoute.js";
import { api } from "../../lib/api.js";
import { countsTowardTotals, money, projectTally } from "../../lib/format.js";

/* Purchase Orders, Materials and Quote Analysis are the project's whole
   story now — Overview's document explorer and the separate Invoices tab
   both folded away, leaving nothing that duplicated what those three
   already show. */
const SECTIONS = [
  { id: "po", label: "Purchase Orders" },
  { id: "materials", label: "Materials" },
  { id: "quotes", label: "Quote Analysis" },
];

export function ProjectDetail({ project, docs, materials, reload, onAddDocument, onScan }) {
  const [section, setSection] = useState("po");
  // Owned here rather than inside QuoteAnalysisSection so the button that
  // flips it can sit in the shared tab row instead of its own header line.
  const [quoteUploading, setQuoteUploading] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");

  const deleteProject = async () => {
    setDeleting(true);
    setDeleteErr("");
    try {
      await api.deleteProject(project.id);
      await reload();
      go("/project");
    } catch (e) {
      setDeleteErr(`Could not delete — ${e.message}`);
      setDeleting(false);
    }
  };

  const projectDocs = useMemo(
    () => docs.filter((d) => d.project_id === project.id),
    [docs, project.id]
  );

  /* The materials rollup must exclude rejected documents; nothing else here
     filters the project's own document set any further. */
  const counted = useMemo(() => projectDocs.filter(countsTowardTotals), [projectDocs]);
  const rejectedInView = projectDocs.length - counted.length;

  const tally = projectTally(project, docs);

  return (
    <div className="band">
      <div className="col">

        <div className="phead">
          <button className="back" type="button" onClick={() => go("/project")}>
            <IconBack width={16} height={16} />
            All projects
          </button>

          <div className="phead-main">
            <div>
              <div className="code">{project.code}</div>
              <div className="pname">{project.name}</div>
            </div>
            <div className="spacer" />
            <div className="phead-actions">
              <button className="btn btn-out btn-sm" type="button" onClick={() => window.print()}>
                <IconPrint width={16} height={16} />
                Print
              </button>
              {/* An anchor, not a fetch: the server names the file in its
                  Content-Disposition, and letting the browser handle the
                  download keeps that name. */}
              <a
                className="btn btn-out btn-sm"
                href={api.exportUrl(project.id)}
                title="Summary, documents, line items and materials rollup as .xlsx"
              >
                <IconDownload width={16} height={16} />
                Export
              </a>
              <AddDocumentMenu
                onScan={() => onScan(project)}
                onUpload={() => onAddDocument(project)}
              />
              <button
                className="icon-btn-danger"
                type="button"
                aria-label="Delete project"
                title="Delete project"
                onClick={() => setConfirmingDelete(true)}
              >
                <IconTrash width={16} height={16} />
              </button>
            </div>
          </div>

          {confirmingDelete ? (
            <div className="banner banner-err" style={{ marginTop: 16 }}>
              <div>
                Delete {project.code} and everything under it — every document, invoice, PO and
                quotation? This can't be undone.
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                <button className="btn btn-signal btn-sm" type="button" onClick={deleteProject} disabled={deleting}>
                  {deleting ? "Deleting…" : "Delete project"}
                </button>
                <button
                  className="btn btn-out btn-sm"
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                >
                  Cancel
                </button>
              </div>
              {deleteErr ? <div style={{ marginTop: 8 }}>{deleteErr}</div> : null}
            </div>
          ) : null}

          {/* The project's own numbers on a hairline — a stat strip here would
              be four more boxes on a page whose problem was boxes. */}
          <div className="phead-meta">
            <span><b>{tally.documents}</b> documents</span>
            {tally.awaiting ? (
              <>
                <span className="sep">·</span>
                <span className="warn"><b>{tally.awaiting}</b> awaiting review</span>
              </>
            ) : null}
            {tally.reading ? (
              <>
                <span className="sep">·</span>
                <span><b>{tally.reading}</b> still reading</span>
              </>
            ) : null}
            {tally.booked ? (
              <>
                <span className="sep">·</span>
                <span><b>{money(tally.booked)}</b> booked</span>
              </>
            ) : null}
          </div>
        </div>

        <div className="ptabs">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={section === s.id}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          ))}
          {section === "quotes" ? (
            <>
              <div className="spacer" />
              <button
                className="btn btn-ink btn-sm"
                type="button"
                onClick={() => setQuoteUploading(true)}
              >
                <IconPlus width={17} height={17} />
                Upload quotation
              </button>
            </>
          ) : null}
        </div>

        {section === "po" ? (
          <div className="section">
            <div className="section-head">
              <div className="spacer" />
              <span className="tag">
                {projectDocs.filter((d) => d.document_type === "PO").length} total
              </span>
            </div>
            <PurchaseOrdersSection docs={projectDocs} />
          </div>
        ) : null}

        {section === "materials" ? (
          <div className="section">
            <div className="section-head">
              <div className="spacer" />
              <span className="tag">
                from {counted.length} document{counted.length === 1 ? "" : "s"}
                {rejectedInView ? ` · ${rejectedInView} rejected excluded` : ""}
              </span>
            </div>
            <MaterialsRollup docs={counted} materials={materials} />
          </div>
        ) : null}

        {section === "quotes" ? (
          <div className="section">
            <QuoteAnalysisSection
              project={project}
              materials={materials}
              uploading={quoteUploading}
              setUploading={setQuoteUploading}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
