import { Platform } from 'react-native';
import type { ScannedDoc } from './store';

/** Site Wi-Fi drops silently; fetch has no default timeout in React Native. */
const TIMEOUT_MS = 30_000;

async function request(url: string, init: RequestInit) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: abort.signal });
    const body = await res.text();
    if (!res.ok) throw new Error(detailOf(body) ?? `Server returned ${res.status}`);
    return body ? JSON.parse(body) : null;
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error('Server did not respond. Check Wi-Fi.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** FastAPI errors arrive as {"detail": "..."} — surface that, not "400". */
function detailOf(body: string): string | null {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.detail === 'string' ? parsed.detail : null;
  } catch {
    return null;
  }
}

export interface QrPayload {
  serverUrl: string;
  sessionToken: string;
  sessionId: string;
}

/** Throws if the QR is not one of ours. */
export function parseQr(raw: string): QrPayload {
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('That is not a scanner QR code.');
  }
  const { serverUrl, sessionToken, sessionId } = data ?? {};
  if (typeof serverUrl !== 'string' || typeof sessionToken !== 'string' || typeof sessionId !== 'string') {
    throw new Error('That QR code is missing connection details.');
  }
  return { serverUrl, sessionToken, sessionId };
}

export function checkHealth(serverUrl: string, token: string) {
  return request(`${serverUrl}/api/v1/health`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export interface UploadResult {
  session_id: string;
  total: number;
  documents: { document_id: string; document_type: string; page_count: number }[];
}

/** Native FormData takes {uri}; the browser's only takes a Blob — a plain
 *  object there stringifies to "[object Object]" and the server 422s. */
async function appendPage(form: FormData, uri: string, name: string) {
  if (Platform.OS === 'web') {
    form.append('files', await (await fetch(uri)).blob(), name);
  } else {
    form.append('files', { uri, name, type: 'image/jpeg' } as any);
  }
}

export async function batchUpload(
  serverUrl: string,
  token: string,
  queue: ScannedDoc[],
): Promise<UploadResult> {
  const form = new FormData();

  // Files are flat and consumed in order; page_counts tells the server where
  // each document starts and stops — the backend's actual contract, not the
  // {document_type, notes, page_count} metadata blob this used to send
  // (which the server has never read; every phone upload 422'd until this
  // was caught). document_types rides beside it, one hint per document, in
  // the same order — what the Preview screen's type picker chose.
  for (const doc of queue) {
    for (const [i, uri] of doc.pages.entries()) {
      await appendPage(form, uri, `${doc.id}_p${i + 1}.jpg`);
    }
  }

  form.append('page_counts', queue.map((d) => d.pages.length).join(','));
  form.append('document_types', queue.map((d) => d.documentType).join(','));

  return request(`${serverUrl}/api/v1/documents/batch-upload`, {
    method: 'POST',
    // No Content-Type here — React Native must set the multipart boundary.
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}
