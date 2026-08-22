import { create } from 'zustand';
import type { DocType } from './theme';

export interface ScannedDoc {
  id: string;
  pages: string[]; // local file URIs, one per page
  documentType: DocType;
  notes: string;
}

interface SessionState {
  /* Connection — held in memory only. The QR carries the server URL and the
     token expires in 15 minutes, so there is nothing worth persisting. */
  serverUrl: string | null;
  token: string | null;
  sessionId: string | null;

  queue: ScannedDoc[];
  /** Pages captured for the document currently being assembled. */
  draftPages: string[];

  connect: (serverUrl: string, token: string, sessionId: string) => void;
  disconnect: () => void;

  addDraftPage: (uri: string) => void;
  discardDraft: () => void;
  commitDraft: (uri: string, documentType: DocType, notes: string) => void;

  removeDoc: (id: string) => void;
  clearQueue: () => void;
}

let seq = 0;
const nextId = () => `doc-${Date.now().toString(36)}-${seq++}`;

export const useSession = create<SessionState>((set) => ({
  serverUrl: null,
  token: null,
  sessionId: null,
  queue: [],
  draftPages: [],

  connect: (serverUrl, token, sessionId) =>
    set({ serverUrl, token, sessionId, queue: [], draftPages: [] }),

  disconnect: () =>
    set({ serverUrl: null, token: null, sessionId: null, queue: [], draftPages: [] }),

  addDraftPage: (uri) => set((s) => ({ draftPages: [...s.draftPages, uri] })),

  discardDraft: () => set({ draftPages: [] }),

  /* The final page arrives with the commit, so the caller never has to add it
     separately and then remember to clear the draft. */
  commitDraft: (uri, documentType, notes) =>
    set((s) => ({
      queue: [
        ...s.queue,
        { id: nextId(), pages: [...s.draftPages, uri], documentType, notes },
      ],
      draftPages: [],
    })),

  removeDoc: (id) => set((s) => ({ queue: s.queue.filter((d) => d.id !== id) })),

  clearQueue: () => set({ queue: [], draftPages: [] }),
}));

export const totalPages = (queue: ScannedDoc[]) =>
  queue.reduce((n, d) => n + d.pages.length, 0);
