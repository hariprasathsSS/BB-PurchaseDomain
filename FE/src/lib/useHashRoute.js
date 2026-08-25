import { useEffect, useState } from "react";

/* Routing is two segments deep: #/<tab> and #/project/<id>. A router library
   would be a dependency for that, so this is the hash and a listener. */
const TABS = ["home", "project", "documents"];

function parse() {
  const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const tab = TABS.includes(parts[0]) ? parts[0] : "home";
  return { tab, projectId: tab === "project" ? parts[1] ?? null : null };
}

export function useHashRoute() {
  const [route, setRoute] = useState(parse);

  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return route;
}

export const go = (path) => { window.location.hash = path; };
export { TABS };
