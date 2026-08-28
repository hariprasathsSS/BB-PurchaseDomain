import { DOC_STATUSES, DOC_TYPES } from "../lib/format.js";

const title = (s) => s.charAt(0) + s.slice(1).toLowerCase();

/* One filter bar for both the project detail and the material gallery — the
   caller says which controls it wants and owns the filter object. */
export function FilterBar({
  value,
  onChange,
  projects = null,   // pass a project list to show the project select
  dates = false,
  placeholder = "Search document ID or project…",
}) {
  const set = (patch) => onChange({ ...value, ...patch });

  return (
    <div className="filter-bar">
      <input
        className="input input-search"
        type="search"
        placeholder={placeholder}
        value={value.q ?? ""}
        onChange={(e) => set({ q: e.target.value })}
        aria-label={placeholder}
      />

      {projects ? (
        <select
          className="input"
          value={value.project ?? ""}
          aria-label="Filter by project"
          onChange={(e) => set({ project: e.target.value })}
        >
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
        </select>
      ) : null}

      <select
        className="input"
        value={value.type ?? ""}
        aria-label="Filter by document type"
        onChange={(e) => set({ type: e.target.value })}
      >
        <option value="">All types</option>
        {DOC_TYPES.map((t) => <option key={t} value={t}>{title(t)}</option>)}
      </select>

      <select
        className="input"
        value={value.status ?? ""}
        aria-label="Filter by status"
        onChange={(e) => set({ status: e.target.value })}
      >
        <option value="">All statuses</option>
        {DOC_STATUSES.map((s) => <option key={s} value={s}>{title(s)}</option>)}
      </select>

      {dates ? (
        <>
          <label>
            From
            <input
              className="input"
              type="date"
              value={value.from ?? ""}
              onChange={(e) => set({ from: e.target.value })}
            />
          </label>
          <label>
            To
            <input
              className="input"
              type="date"
              value={value.to ?? ""}
              onChange={(e) => set({ to: e.target.value })}
            />
          </label>
        </>
      ) : null}
    </div>
  );
}
