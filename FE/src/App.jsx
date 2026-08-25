import { useState } from "react";
import { TopNav } from "./components/TopNav.jsx";
import { HomeTab } from "./pages/home/HomeTab.jsx";
import { ProjectTab } from "./pages/project/ProjectTab.jsx";
import { DocumentsTab } from "./pages/documents/DocumentsTab.jsx";
import { ComparePage } from "./pages/compare/ComparePage.jsx";
import { UploadModal } from "./pages/home/UploadModal.jsx";
import { AddProjectModal } from "./pages/home/AddProjectModal.jsx";
import { ReviewModal } from "./features/review/ReviewModal.jsx";
import { useConsoleData } from "./lib/useConsoleData.js";
import { useHashRoute } from "./lib/useHashRoute.js";

/* Shell and routing only. Each tab owns its own filters; the shared data comes
   from one hook so all three read the same lists. */
export default function App() {
  const { tab, projectId, documentId } = useHashRoute();
  const { projects, docs, materials, reload } = useConsoleData();

  /* Search lives in the nav, so it belongs to the shell and is handed down. */
  const [search, setSearch] = useState("");

  /* Reachable from every tab, so they live up here rather than in one of them. */
  const [reviewId, setReviewId] = useState(null);
  const [addingProject, setAddingProject] = useState(false);
  const [uploadFor, setUploadFor] = useState(null);
  const [scanPoFor, setScanPoFor] = useState(null);

  return (
    <div className="shell">
      <TopNav
        active={tab}
        search={search}
        onSearch={setSearch}
        onAddProject={() => setAddingProject(true)}
      />

      <main id={`tab-${tab}`}>
        {tab === "home" ? (
          <HomeTab
            projects={projects}
            docs={docs}
            search={search}
            reload={reload}
            onOpenDocument={setReviewId}
            addingProject={addingProject}
            setAddingProject={setAddingProject}
          />
        ) : null}

        {tab === "project" ? (
          <ProjectTab
            projectId={projectId}
            projects={projects}
            docs={docs}
            materials={materials}
            search={search}
            onOpenDocument={setReviewId}
            onAddProject={() => setAddingProject(true)}
            onAddDocument={setUploadFor}
            onScanPo={setScanPoFor}
          />
        ) : null}

        {tab === "documents" ? (
          <DocumentsTab
            docs={docs}
            projects={projects}
            search={search}
            onOpenDocument={setReviewId}
          />
        ) : null}

        {tab === "compare" ? (
          <ComparePage
            documentId={documentId}
            docs={docs}
            materials={materials}
            onOpenDocument={setReviewId}
            reload={reload}
          />
        ) : null}
      </main>

      {reviewId ? (
        <ReviewModal
          docId={reviewId}
          materials={materials}
          onClose={() => setReviewId(null)}
          onChanged={reload}
        />
      ) : null}

      {/* Home renders its own copy while it owns the intake flow; this one
          covers the other tabs. */}
      {tab !== "home" && addingProject ? (
        <AddProjectModal onClose={() => setAddingProject(false)} onCreated={reload} />
      ) : null}

      {uploadFor ? (
        <UploadModal
          project={uploadFor}
          onClose={() => setUploadFor(null)}
          onUploaded={reload}
        />
      ) : null}

      {/* Same capture flow as "Add document" — reused rather than duplicated
          — just hinted as a PO so extraction is told what to expect and the
          Purchase Orders section on the project page picks it up. */}
      {scanPoFor ? (
        <UploadModal
          project={scanPoFor}
          documentType="PO"
          title="Scan PO"
          hint="A photo or PDF of the purchase order. Materials, quantities and the PO number are read automatically — drag it here or click to browse."
          onClose={() => setScanPoFor(null)}
          onUploaded={reload}
        />
      ) : null}
    </div>
  );
}
