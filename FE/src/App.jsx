import { useState } from "react";
import { TopNav } from "./components/TopNav.jsx";
import { HomeTab } from "./pages/home/HomeTab.jsx";
import { ProjectTab } from "./pages/project/ProjectTab.jsx";
import { DocumentsTab } from "./pages/documents/DocumentsTab.jsx";
import { UploadModal } from "./pages/home/UploadModal.jsx";
import { AddProjectModal } from "./pages/home/AddProjectModal.jsx";
import { ReviewModal } from "./features/review/ReviewModal.jsx";
import { useConsoleData } from "./lib/useConsoleData.js";
import { useHashRoute } from "./lib/useHashRoute.js";

/* Shell and routing only. Each tab owns its own filters; the shared data comes
   from one hook so all three read the same lists. */
export default function App() {
  const { tab, projectId } = useHashRoute();
  const { projects, docs, materials, reload } = useConsoleData();

  /* Search lives in the nav, so it belongs to the shell and is handed down. */
  const [search, setSearch] = useState("");

  /* Reachable from every tab, so they live up here rather than in one of them. */
  const [reviewId, setReviewId] = useState(null);
  const [addingProject, setAddingProject] = useState(false);
  const [uploadFor, setUploadFor] = useState(null);

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
            reload={reload}
            onOpenDocument={setReviewId}
            onAddProject={() => setAddingProject(true)}
            onAddDocument={setUploadFor}
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
    </div>
  );
}
