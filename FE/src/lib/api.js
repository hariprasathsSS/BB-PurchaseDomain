/* Every call to the backend lives here, so a route change is a one-file edit
   and no component has a URL baked into it. */

async function json(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail ?? `Server returned ${res.status}`);
  return body;
}

const get = (path) => fetch(path).then(json);

const send = (path, method, body) =>
  fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(json);

export const api = {
  /* The LAN address a phone has to reach — only the server knows its own. */
  config: () => get("/api/v1/config"),

  listProjects: () => get("/api/v1/projects").then((d) => d.projects ?? []),
  createProject: (name, sites) => send("/api/v1/projects", "POST", { name, sites }),
  deleteProject: (id) => fetch(`/api/v1/projects/${id}`, { method: "DELETE" }).then(json),

  listDocuments: () => get("/api/v1/documents").then((d) => d.documents ?? []),
  getDocument: (id) => get(`/api/v1/documents/${id}`),
  saveDocument: (id, edits) => send(`/api/v1/documents/${id}`, "PUT", edits),
  deleteDocument: (id) => fetch(`/api/v1/documents/${id}`, { method: "DELETE" }).then(json),
  approveDocument: (id, approvedBy) =>
    send(`/api/v1/documents/${id}/approve`, "POST", { approved_by: approvedBy }),
  rejectDocument: (id, rejectedBy, reason) =>
    send(`/api/v1/documents/${id}/reject`, "POST", { rejected_by: rejectedBy, reason }),
  retryExtraction: (id) => fetch(`/api/v1/documents/${id}/extract`, { method: "POST" }),

  /* Same delivery billed twice through two channels (site copy, office
     copy) — found automatically by vendor + invoice number at extraction
     time. duplicate_of is null in the response when this document has no
     paired copy on file (yet). */
  getDuplicateDiff: (id) => get(`/api/v1/documents/${id}/duplicate-diff`),
  /* Only meaningful for a PO document: every invoice referencing it,
     grouped into deliveries, and the running delivered-vs-ordered total
     per material. */
  getPoReconciliation: (id) => get(`/api/v1/documents/${id}/reconciliation`),

  listMaterials: () => get("/api/v1/materials").then((d) => d.materials ?? []),

  /* Read-only question answering. Stateless on the server — prior turns are
     replayed from here, so there is no conversation to lose or to clean up. */
  ask: (question, history) => send("/api/v1/chat", "POST", { question, history }),

  /* The QR ships with the session, so picking a project no longer costs a
     page reload. */
  createSession: (projectId) =>
    send("/api/v1/sessions", "POST", { project_id: projectId, created_by: "web" }),

  /* A file download, not JSON: the response carries Content-Disposition, so
     the browser saves it. Returned as a URL rather than fetched — an anchor
     gets the filename the server chose, which a blob round-trip would lose. */
  exportUrl: (projectId) => `/api/v1/projects/${projectId}/export`,

  /* Multipart, so it does not go through send(). One file is one document —
     no document-type hint from the console; the classifier's own read of the
     pixels is what decides what gets stored. */
  uploadFiles: ({ projectId, siteId, files }) => {
    const form = new FormData();
    form.append("project_id", projectId);
    if (siteId) form.append("site_id", siteId);
    files.forEach((f) => form.append("files", f, f.name));
    return fetch("/api/v1/documents/upload", { method: "POST", body: form }).then(json);
  },

  /* Quote analysis — a vendor's price quotation, not a purchase document, so
     it lives on its own small set of endpoints rather than /documents. */
  listQuotations: (projectId) =>
    get(`/api/v1/projects/${projectId}/quotations`).then((d) => d.quotations ?? []),
  getQuotation: (id) => get(`/api/v1/quotations/${id}`),
  uploadQuotation: ({ projectId, files }) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f, f.name));
    return fetch(`/api/v1/projects/${projectId}/quotations`, { method: "POST", body: form }).then(json);
  },
  saveQuotation: (id, edits) => send(`/api/v1/quotations/${id}`, "PUT", edits),
  retryQuotationExtraction: (id) => fetch(`/api/v1/quotations/${id}/extract`, { method: "POST" }),
  deleteQuotation: (id) => fetch(`/api/v1/quotations/${id}`, { method: "DELETE" }).then(json),

  /* Which vendor to actually buy each material from — cheapest by default,
     overridable per material since grade/quality isn't a number the app can
     rank on its own. */
  listQuotePicks: (projectId) =>
    get(`/api/v1/projects/${projectId}/quote-picks`).then((d) => d.picks ?? {}),
  setQuotePick: (projectId, materialId, quotationId, pickedBy) =>
    send(`/api/v1/projects/${projectId}/quote-picks/${materialId}`, "PUT",
      { quotation_id: quotationId, picked_by: pickedBy }),
  clearQuotePick: (projectId, materialId) =>
    fetch(`/api/v1/projects/${projectId}/quote-picks/${materialId}`, { method: "DELETE" }).then(json),
};
