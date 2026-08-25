import { useEffect, useRef } from "react";
import { go } from "../lib/useHashRoute.js";
import { IconFolder, IconGallery, IconHome, IconPlus, IconSearch } from "./Icons.jsx";

const ITEMS = [
  { tab: "home", label: "Home", Icon: IconHome },
  { tab: "project", label: "Projects", Icon: IconFolder },
  { tab: "documents", label: "Documents", Icon: IconGallery },
];

/* The floating nav pill. Carries the two things wanted from anywhere — find a
   project, add one — and the icons let a section be located by shape before
   it is read. */
export function TopNav({ active, search, onSearch, onAddProject }) {
  const field = useRef(null);

  /* The shortcut is advertised on the field, so it has to actually work. */
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        field.current?.focus();
        field.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="nav-rail">
      <nav className="nav" aria-label="Sections">
        <div className="brand">Purchase<i>Division</i></div>

        <div className="nav-links">
          {ITEMS.map(({ tab, label, Icon }) => (
            <button
              key={tab}
              type="button"
              aria-current={active === tab ? "page" : undefined}
              onClick={() => go(`/${tab}`)}
            >
              <Icon width={17} height={17} />
              {label}
            </button>
          ))}
        </div>

        <div className="spacer" />

        <label className="nav-find">
          <IconSearch width={17} height={17} style={{ color: "var(--slate)" }} />
          <input
            ref={field}
            type="search"
            placeholder="Search projects…"
            aria-label="Search projects and documents"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
          <kbd>⌘K</kbd>
        </label>

        <button className="btn btn-ink btn-sm" type="button" onClick={onAddProject}>
          <IconPlus width={17} height={17} />
          Add project
        </button>
      </nav>
    </div>
  );
}
