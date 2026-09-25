import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";

/* The console's shared state: projects, documents, the material master and the
   server's own address. One hook so every tab reads the same list and a single
   reload() refreshes all of them after an upload or a review decision.

   Materials are fetched once and kept — the master list changes when a scan
   invents a new material, which reload() picks up anyway. */
export function useConsoleData() {
  const [projects, setProjects] = useState([]);
  const [docs, setDocs] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [serverUrl, setServerUrl] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const [nextProjects, nextDocs] = await Promise.all([
        api.listProjects(),
        api.listDocuments(),
      ]);
      setProjects(nextProjects);
      setDocs(nextDocs);
      setUpdatedAt(new Date());
      setError("");
    } catch (e) {
      setError(e.message || "could not reach the server");
    }
  }, []);

  useEffect(() => {
    reload();
    api.listMaterials().then(setMaterials).catch(() => setMaterials([]));
    api.config().then((c) => setServerUrl(c.server_url)).catch(() => {});
  }, [reload]);

  return { projects, docs, materials, serverUrl, updatedAt, error, reload };
}
