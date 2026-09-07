import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrow, IconChevron, IconClock, IconFile, IconGrid, IconLayers,
  IconList, IconPackage, IconPages, IconPlus, IconSearch,
} from "../../components/Icons.jsx";
import { AddDocumentMenu } from "../../components/AddDocumentMenu.jsx";
import { go } from "../../lib/useHashRoute.js";
import { projectStatus, projectTally } from "../../lib/format.js";

/* Exactly the four states projectStatus() itself can return, plus "All" —
   nothing here is a filter dimension invented on top of the business logic. */
const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "st-action", label: "Action required" },
  { value: "st-proc", label: "Processing" },
  { value: "st-track", label: "On track" },
  { value: "st-none", label: "No activity" },
];

const SORTS = {
  "name-asc":  { label: "Name (A-Z)", cmp: (a, b) => a.p.name.localeCompare(b.p.name) },
  "name-desc": { label: "Name (Z-A)", cmp: (a, b) => b.p.name.localeCompare(a.p.name) },
  "awaiting":  { label: "Most awaiting first", cmp: (a, b) => b.tally.awaiting - a.tally.awaiting },
  "documents": { label: "Most documents first", cmp: (a, b) => b.tally.documents - a.tally.documents },
};

const TALLY_ITEMS = [
  { key: "documents", label: "Documents", icon: IconFile },
  { key: "pages", label: "Pages", icon: IconPages },
  { key: "awaiting", label: "Awaiting", icon: IconClock, hot: true },
  { key: "pos", label: "POs", icon: IconPackage },
  { key: "materials", label: "Materials", icon: IconLayers },
];

/* The five tally numbers, icon-led — shared by the tile and the list row so
   the two views never drift into showing different facts. */
function Tally({ tally, materialCount, className }) {
  const values = { documents: tally.documents, pages: tally.pages, awaiting: tally.awaiting, pos: tally.pos, materials: materialCount };
  return (
    <div className={className}>
      {TALLY_ITEMS.map(({ key, label, icon: Icon, hot }) => (
        <div key={key} className={hot && values[key] ? "hot" : ""}>
          <Icon width={16} height={16} />
          <div>
            <b>{values[key]}</b>
            <span>{label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* A trigger that shows only the current choice, expanding into a floating
   list of options on click — the same collapsed-until-touched control for
   both sort and status, rather than a whole row of pills sitting open all
   the time. Built on the .combo/.combo-menu pattern Combobox.jsx already
   uses for free-text suggestions. */
function FilterMenu({ label, value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div className="combo filter-combo" ref={ref}>
      <button
        type="button" className="ctl filter-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox" aria-expanded={open}
      >
        <span>{label}: {current?.label}</span>
        <IconChevron width={14} height={14} className={`filter-chevron ${open ? "is-open" : ""}`} />
      </button>
      {open ? (
        <div className="combo-menu">
          {options.map((o) => (
            <button
              key={o.value} type="button"
              className={o.value === value ? "is-selected" : ""}
              aria-selected={o.value === value}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              {o.label}
              {o.count != null ? <span className="n"> {o.count}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* The portfolio. Same tile as the home page, so a project looks like itself
   wherever it appears — including the status label, which is what makes the
   grid scannable without opening anything. */
export function ProjectGrid({ projects, docs, onAddProject, onAddDocument, onScan }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortKey, setSortKey] = useState("name-asc");
  const [view, setView] = useState("grid");

  const scored = useMemo(
    () => projects.map((p) => ({ p, status: projectStatus(p, docs), tally: projectTally(p, docs) })),
    [projects, docs],
  );

  const statusCounts = useMemo(() => {
    const counts = { "": scored.length, "st-action": 0, "st-proc": 0, "st-track": 0, "st-none": 0 };
    for (const { status } of scored) counts[status.cls] = (counts[status.cls] || 0) + 1;
    return counts;
  }, [scored]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scored
      .filter(({ p }) => !q || `${p.name} ${p.code}`.toLowerCase().includes(q))
      .filter(({ status }) => !statusFilter || status.cls === statusFilter)
      .sort(SORTS[sortKey].cmp);
  }, [scored, query, statusFilter, sortKey]);

  const filtering = query.trim() || statusFilter;

  return (
    <>
      {/* Same full-bleed photo band the home page puts behind its pitch —
          see .projects-hero in app.css, which shares every rule with
          .home-hero except the photo itself. */}
      <div className="projects-hero">
        <div className="band">
          <div className="col">
            <div className="pagetitle">
              <div>
                <span className="eyebrow">Explorer</span>
                <h1 style={{ marginTop: 14 }}>Projects</h1>
                <p className="lede">
                  Open a project to see what was captured for it and the materials they add up to.
                </p>
                <span className="tag">{projects.length} total</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* projects-below is the same stacking hook home-below is: the photo
          bleeds past the hero's own bottom edge, and this keeps the grid
          painting above it. */}
      <div className="band projects-below">
        <div className="col">
          <div className="section">
            <div className="explorer projects-toolbar-card">
              <div className="explorer-bar">
                <div className="toolbar-search">
                  <IconSearch width={17} height={17} />
                  <input
                    type="text"
                    placeholder="Search projects by name or ID…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <FilterMenu
                  label="Status" value={statusFilter} onChange={setStatusFilter}
                  options={STATUS_FILTERS.map((s) => ({ value: s.value, label: s.label, count: statusCounts[s.value] ?? 0 }))}
                />
                <FilterMenu
                  label="Sort" value={sortKey} onChange={setSortKey}
                  options={Object.entries(SORTS).map(([key, s]) => ({ value: key, label: s.label }))}
                />
                {filtering ? (
                  <button type="button" className="row-link" onClick={() => { setQuery(""); setStatusFilter(""); }}>
                    Clear filters
                  </button>
                ) : null}
                <div className="spacer" />
                <div className="view-toggle" role="group" aria-label="Layout">
                  <button
                    type="button"
                    aria-pressed={view === "grid"}
                    aria-label="Grid view"
                    onClick={() => setView("grid")}
                  >
                    <IconGrid width={17} height={17} />
                  </button>
                  <button
                    type="button"
                    aria-pressed={view === "list"}
                    aria-label="List view"
                    onClick={() => setView("list")}
                  >
                    <IconList width={17} height={17} />
                  </button>
                </div>
              </div>
            </div>

            {!rows.length && filtering ? (
              <div className="empty">No projects match your search.</div>
            ) : view === "grid" ? (
              <div className="tiles">
                {rows.map(({ p, status, tally }) => (
                  <div key={p.id} className={`tile ${status.cls === "st-action" ? "is-hot" : ""}`}>
                    <div>
                      <span className={`tile-status ${status.cls}`}>
                        <span className={`dot ${status.dot}`} />
                        {status.label}
                      </span>
                      <div className="tile-head">
                        <span className="name">{p.name}</span>
                        <span className="code">{p.code}</span>
                      </div>
                    </div>

                    <Tally tally={tally} materialCount={p.material_count ?? 0} className="tally" />

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
                ))}

                <button className={`tile-add ${rows.length === 0 ? "is-only" : ""}`} type="button" onClick={onAddProject}>
                  <span className="ring"><IconPlus width={24} height={24} /></span>
                  <span className="t">Add project</span>
                  <span className="d">Its documents will start showing up here as soon as it exists.</span>
                </button>
              </div>
            ) : (
              <div className="plist">
                {rows.map(({ p, status, tally }) => (
                  <div key={p.id} className={`prow ${status.cls === "st-action" ? "is-hot" : ""}`}>
                    <div className="prow-main">
                      <span className={`tile-status ${status.cls}`}>
                        <span className={`dot ${status.dot}`} />
                        {status.label}
                      </span>
                      <div className="tile-head">
                        <span className="name">{p.name}</span>
                        <span className="code">{p.code}</span>
                      </div>
                    </div>

                    <Tally tally={tally} materialCount={p.material_count ?? 0} className="prow-tally" />

                    <div className="prow-actions">
                      <AddDocumentMenu
                        onScan={() => onScan(p)}
                        onUpload={() => onAddDocument(p)}
                      />
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
                ))}

                <button className="btn btn-out btn-wide" type="button" onClick={onAddProject}>
                  <IconPlus width={18} height={18} />
                  Add project
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
