import { DashboardMetrics } from "./DashboardMetrics.jsx";
import { MaterialsPieChart } from "./MaterialsPieChart.jsx";
import { AddProjectModal } from "./AddProjectModal.jsx";

/* Just the pitch, the numbers, and one project's material pipeline at a
   time — no project list, no document list. Both of those still live one
   click away behind their own nav buttons (Projects, Documents); Home isn't
   a second copy of either. No hero buttons either — "+ Add project" already
   lives in the top nav, reachable from every tab, not just this one, so
   repeating it here was the same action twice on the same screen. */
export function HomeTab({ projects, docs, materials, reload, addingProject, setAddingProject }) {
  return (
    <>
      {/* Full-bleed photo band, ~half the viewport tall, sitting behind just
          the pitch — not the whole page. The image itself is a plain CSS
          background (see .home-hero in app.css), not a JS import, so a
          missing file just leaves the band looking plain rather than
          breaking the app's build. */}
      <div className="home-hero">
        <div className="band">
          <div className="col hero-copy">
            <span className="eyebrow">Overview</span>
            <h1>Every material that reaches your site — tracked, verified, reconciled.</h1>
            <p className="lede">
              <strong>Purchase orders</strong>, <strong>vendor invoices</strong>,{" "}
              <strong>delivery challans</strong> and <strong>site inward reports</strong> —
              captured from a phone or the desk, read automatically, and cross-checked so
              what's billed matches what actually arrived.
            </p>
          </div>
        </div>
      </div>

      <div className="band">
        <div className="col">

          <DashboardMetrics projects={projects} docs={docs} />

          <MaterialsPieChart projects={projects} docs={docs} materials={materials} />

          {addingProject ? (
            <AddProjectModal onClose={() => setAddingProject(false)} onCreated={reload} />
          ) : null}
        </div>
      </div>
    </>
  );
}
