import { useState } from "react";
import { TopNav } from "./components/TopNav.jsx";
import { ChatDock } from "./components/ChatDock.jsx";
import { HomeTab } from "./pages/home/HomeTab.jsx";
import { ProjectTab } from "./pages/project/ProjectTab.jsx";
import { DocumentsTab } from "./pages/documents/DocumentsTab.jsx";
import { ComparePage } from "./pages/compare/ComparePage.jsx";
import { UploadModal } from "./pages/home/UploadModal.jsx";
import { ScanModal } from "./pages/home/ScanModal.jsx";
import { AddProjectModal } from "./pages/home/AddProjectModal.jsx";
import { ReviewModal } from "./features/review/ReviewModal.jsx";
import { useConsoleData } from "./lib/useConsoleData.js";
import { useHashRoute } from "./lib/useHashRoute.js";

/* Shell and routing only. Each tab owns its own filters; the shared data comes
   from one hook so all three read the same lists. */
export default function App() {
  const { tab, projectId, documentId } = useHashRoute();
  const { projects, docs, materials, reload } = useConsoleData();

  /* Reachable from every tab, so they live up here rather than in one of them. */
  const [reviewId, setReviewId] = useState(null);
  // Freshly-uploaded documents queued to open into Review one after another —
  // see openReviewQueue/closeReview below and UploadModal's onUploaded.
  const [reviewQueue, setReviewQueue] = useState([]);
  const [addingProject, setAddingProject] = useState(false);
  const [uploadFor, setUploadFor] = useState(null);
  const [scanFor, setScanFor] = useState(null);

  const openReviewQueue = (ids) => {
    if (!ids?.length) return;
    setReviewId(ids[0]);
    setReviewQueue(ids.slice(1));
  };

  /* An upload no longer closes into a toast — it opens straight into Review,
     the same screen clicking an existing document opens. Closing that (once
     its own required fields are filled in — see ReviewModal's attemptClose)
     advances to the next freshly-uploaded document instead of just
     vanishing, so a multi-file upload walks through all of them in turn. */
  const closeReview = () => {
    if (reviewQueue.length) {
      setReviewId(reviewQueue[0]);
      setReviewQueue((q) => q.slice(1));
    } else {
      setReviewId(null);
    }
  };

  return (
    <div className="shell">
      <TopNav
        active={tab}
        onAddProject={() => setAddingProject(true)}
      />

      <main id={`tab-${tab}`}>
        {tab === "home" ? (
          <HomeTab
            projects={projects}
            docs={docs}
            materials={materials}
            reload={reload}
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
            reload={reload}
            onOpenDocument={setReviewId}
            onAddProject={() => setAddingProject(true)}
            onAddDocument={setUploadFor}
            onScan={setScanFor}
          />
        ) : null}

        {tab === "documents" ? (
          <DocumentsTab
            docs={docs}
            projects={projects}
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
            onAddDocument={setUploadFor}
            onScan={setScanFor}
          />
        ) : null}
      </main>

      {reviewId ? (
        <ReviewModal
          docId={reviewId}
          docs={docs}
          materials={materials}
          onClose={closeReview}
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
          onUploaded={(ids) => { setUploadFor(null); reload(); openReviewQueue(ids); }}
        />
      ) : null}

      {/* Same QR-connect flow as the home tiles — reused rather than
          duplicated — reachable from the projects grid and a project's own
          page too, not just home. */}
      {scanFor ? <ScanModal project={scanFor} onClose={() => setScanFor(null)} /> : null}

      {/* Shell-level like the modals: a question outlives a tab switch. */}
      <ChatDock />
    </div>
  );
}
