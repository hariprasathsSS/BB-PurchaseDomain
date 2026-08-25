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
  createProject: (name) => send("/api/v1/projects", "POST", { name }),

  listDocuments: () => get("/api/v1/documents").then((d) => d.documents ?? []),
  getDocument: (id) => get(`/api/v1/documents/${id}`),
  saveDocument: (id, edits) => send(`/api/v1/documents/${id}`, "PUT", edits),
  approveDocument: (id, approvedBy) =>
    send(`/api/v1/documents/${id}/approve`, "POST", { approved_by: approvedBy }),
  rejectDocument: (id, rejectedBy, reason) =>
    send(`/api/v1/documents/${id}/reject`, "POST", { rejected_by: rejectedBy, reason }),
  retryExtraction: (id) => fetch(`/api/v1/documents/${id}/extract`, { method: "POST" }),

  /* `confirm` is the reference the operator retyped. The server checks it too,
     so a mis-wired button cannot delete the wrong document. */
  deleteDocument: (id, confirm) =>
    fetch(`/api/v1/documents/${id}?confirm=${encodeURIComponent(confirm)}`, {
      method: "DELETE",
    }).then(json),

  listMaterials: () => get("/api/v1/materials").then((d) => d.materials ?? []),

  /* The QR ships with the session, so picking a project no longer costs a
     page reload. */
  createSession: (projectId) =>
    send("/api/v1/sessions", "POST", { project_id: projectId, created_by: "web" }),

  /* A file download, not JSON: the response carries Content-Disposition, so
     the browser saves it. Returned as a URL rather than fetched — an anchor
     gets the filename the server chose, which a blob round-trip would lose. */
  exportUrl: (projectId) => `/api/v1/projects/${projectId}/export`,

  /* Multipart, so it does not go through send(). One file is one document.
     documentType is the operator saying what they scanned ("this is the PO");
     the classifier still reads the page and can overrule it. */
  uploadFiles: ({ projectId, files, documentType }) => {
    const form = new FormData();
    form.append("project_id", projectId);
    if (documentType) form.append("document_type", documentType);
    files.forEach((f) => form.append("files", f, f.name));
    return fetch("/api/v1/documents/upload", { method: "POST", body: form }).then(json);
  },
};
