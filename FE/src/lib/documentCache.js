import { api } from "./api.js";

/* Line items live on the document detail, not the list, so anything that
   needs them (the Materials rollup, the Purchase Orders section) means one
   fetch per document. Cached module-wide and keyed by id: the detail of an
   already-reviewed document does not change, and switching tabs should not
   re-fetch the lot. Shared rather than duplicated per caller — two separate
   caches would double the requests for the same rows. */
const detailCache = new Map();

export async function loadDocumentDetails(ids) {
  const missing = ids.filter((id) => !detailCache.has(id));
  const fetched = await Promise.all(
    missing.map((id) => api.getDocument(id).catch(() => null))
  );
  fetched.forEach((doc, i) => { if (doc) detailCache.set(missing[i], doc); });
}

export function getCachedDocument(id) {
  return detailCache.get(id);
}
