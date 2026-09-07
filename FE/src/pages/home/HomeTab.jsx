import { DashboardMetrics } from "./DashboardMetrics.jsx";
import { DashboardCharts } from "./DashboardCharts.jsx";
import { AddProjectModal } from "./AddProjectModal.jsx";
import { IconBuilding } from "../../components/Icons.jsx";

/* Just the pitch, the numbers — no project list, no document list. Both
   live one click away behind their own nav buttons (Projects, Documents);
   Home isn't a second copy of either. No hero buttons either — "+ Add
   project" already lives in the top nav, reachable from every tab, not just
   this one, so repeating it here was the same action twice on the same
   screen. */
export function HomeTab({ projects, docs, reload, addingProject, setAddingProject, updatedAt }) {
  return (
    <>
      {/* Full-bleed photo band behind just the pitch — see .home-hero in
          app.css for the fade/overlay treatment. The image is a plain CSS
          background, not a JS import, so a missing file just leaves the
          band looking plain instead of breaking the app's build. */}
      <div className="home-hero">
        <div className="band">
          <div className="col hero-row">
            <div className="hero-copy">
              <span className="eyebrow">Overview</span>
              <h1>Every material that reaches your site — tracked, verified, reconciled.</h1>
              <p className="lede">
                Purchase orders, vendor invoices, delivery challans and site inward reports —
                captured from a phone or the desk, read automatically, and cross-checked so
                what's billed matches what actually arrived.
              </p>
            </div>

            {/* Quiet, not a CTA — just the one line of positioning copy the
                mockup carries beside the pitch. Hidden below tablet width
                rather than squeezed, since the headline needs the room more. */}
            <div className="hero-badge">
              <span className="badge-icon"><IconBuilding width={18} height={18} /></span>
              <span className="badge-text">Smarter procurement<br />for a stronger tomorrow.</span>
            </div>
          </div>
        </div>
      </div>

      {/* home-below (alongside the ordinary .band) is just a stacking hook —
          see .home-below in app.css for why: the hero photo now bleeds past
          its own box into this section without pushing it down, and this
          needs to paint above that overlay so Dashboard's own label stays
          readable instead of sitting under it. */}
      <div className="band home-below">
        <div className="col">

          <DashboardMetrics projects={projects} docs={docs} />
          <DashboardCharts projects={projects} docs={docs} />

          {updatedAt ? (
            <div className="dash-footer">
              Last updated: {updatedAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })},{" "}
              {updatedAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
            </div>
          ) : null}

          {addingProject ? (
            <AddProjectModal onClose={() => setAddingProject(false)} onCreated={reload} />
          ) : null}
        </div>
      </div>
    </>
  );
}
