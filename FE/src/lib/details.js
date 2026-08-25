import { useEffect, useState } from "react";
import { api } from "./api.js";
import { isWaiting } from "./format.js";

/* Line items live on the document detail, not on the list, so anything that
   needs them costs one fetch per document. Cached module-wide and keyed by id:
   a document that has been read does not change under us, and moving between
   tabs should not re-fetch the lot.

   A document still being extracted is deliberately never cached — it has no
   lines yet, and caching that emptiness would freeze it on screen. */
const cache = new Map();

export const detailOf = (id) => cache.get(id) ?? null;

export const forgetDetail = (id) => cache.delete(id);

async function load(ids) {
  const missing = ids.filter((id) => !cache.has(id));
  if (!missing.length) return false;
  const fetched = await Promise.all(missing.map((id) => api.getDocument(id).catch(() => null)));
  fetched.forEach((doc, i) => {
    if (doc && !isWaiting(doc)) cache.set(missing[i], doc);
  });
  return true;
}

/* Fetches the line items for `docs` and re-renders when they land. Keyed by id
   *and* status, so a document that finishes extracting is picked up on the
   next list refresh rather than staying empty until a reload. */
export function useDetails(docs) {
  const key = docs.map((d) => `${d.document_id}:${d.status}`).join(",");
  const [, bump] = useState(0);

  useEffect(() => {
    let cancelled = false;
    load(docs.map((d) => d.document_id)).then((changed) => {
      if (changed && !cancelled) bump((n) => n + 1);
    });
    return () => { cancelled = true; };
    // The ids and their statuses are the whole dependency; `docs` is a new
    // array on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return detailOf;
}
