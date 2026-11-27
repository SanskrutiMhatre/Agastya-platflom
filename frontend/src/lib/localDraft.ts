// Local drafts for the JSS and JSG editors (audit FE-002, FE-006, PUB-023, WP-05).
//
// While a document has unsaved changes its text is written to IndexedDB every few seconds, under the signed-in person and the project.
// Opening the editor again (after a crash, a closed tab, a power cut, an ended session) offers it back. A save removes it; so does the
// person's own sign-out (FE-024: the next person at the computer finds nothing of theirs). Nothing here ever reaches the server.

import { useEffect, useRef, useState } from 'react';
import { useSession } from '../store/session';

export interface LocalDraft { key: string; xml: string; baseHash: string; savedAt: number }

const DB = 'agastya-drafts';
const STORE = 'drafts';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'key' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode); const r = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(r.result); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
    });
  } finally { db.close(); }
}

export const draftKey = (userId: string, projectId: string, kind: string) => `${userId}/${projectId}/${kind}`;
export const getDraft = (key: string): Promise<LocalDraft | null> => tx('readonly', (s) => s.get(key)).then((r) => (r as LocalDraft) ?? null).catch(() => null);
export const putDraft = (d: LocalDraft): Promise<void> => tx('readwrite', (s) => s.put(d)).then(() => undefined).catch(() => undefined);
export const delDraft = (key: string): Promise<void> => tx('readwrite', (s) => s.delete(key)).then(() => undefined).catch(() => undefined);

// A sign-out the person chose removes their drafts (store/session.ts, through lib/draftPurge.ts, whatever page they were on); an
// ended session keeps them for when they come back.

/**
 * Keep a draft of an editor's document while it has unsaved changes, and find the one left from last time.
 * `read` returns the current text ONLY while it has unsaved changes, else null (so nothing is written after a save); `dirty` is the
 * editor's unsaved flag; `serverXml` is the text the editor opened with, so a draft equal to it is not offered.
 */
export function useLocalDraft(projectId: string, kind: string, read: () => string | null, dirty: boolean, baseHash: () => string, serverXml: string | null) {
  const user = useSession((s) => s.user);
  const key = user ? draftKey(user.id, projectId, kind) : null;
  const [found, setFound] = useState<LocalDraft | null>(null);
  const last = useRef<string | null>(null);

  // the draft left from last time, once the document is here
  useEffect(() => {
    setFound(null);
    if (!key || serverXml === null) return;
    let live = true;
    void getDraft(key).then((d) => { if (live && d && d.xml !== serverXml) setFound(d); });
    return () => { live = false; };
  }, [key, serverXml]);

  // while unsaved: write the text when it changed, every 3 s
  useEffect(() => {
    if (!key || !dirty) return;
    // written only while that person is still signed in: the editor unmounting after a sign-out must not leave a draft behind
    const live = () => useSession.getState().user?.id === key.split('/')[0];
    const t = setInterval(() => {
      if (!live()) return;
      const xml = read(); if (xml === null || xml === last.current) return;
      last.current = xml; void putDraft({ key, xml, baseHash: baseHash(), savedAt: Date.now() });
    }, 3000);
    const flush = () => { if (!live()) return; const xml = read(); if (xml !== null && xml !== last.current) { last.current = xml; void putDraft({ key, xml, baseHash: baseHash(), savedAt: Date.now() }); } };
    window.addEventListener('pagehide', flush);
    return () => { clearInterval(t); window.removeEventListener('pagehide', flush); flush(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, dirty]);

  return {
    /** A draft from an earlier visit that differs from the saved document, or null. */
    found,
    /** The document was saved (or the author chose the saved version): the draft goes. */
    clear: async () => { last.current = null; setFound(null); if (key) await delDraft(key); },
    /** The author has decided about the found draft (recovered it into the editor): stop offering it; autosave takes over. */
    dismiss: () => setFound(null),
  };
}

/** Save a text as a file through the browser (FE-007: "Download my version"). */
export function downloadText(name: string, text: string, type = 'application/xml'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
