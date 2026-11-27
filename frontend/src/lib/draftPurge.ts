// FE-024: a sign-out the person chose removes every draft they left in this browser: the JSS / JSG drafts (database "agastya-drafts",
// keys "<user>/<project>/<kind>") and the S1000D Studio's (database "s1000d-studio", store "drafts", records carrying scope "<user>/<project>").
// It lives here, imported by the session store, because the editors' own code is loaded only when an editor is opened: a sign-out from any
// other page must clean up as well. A database that does not exist is not created.

function openExisting(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(name); } catch { resolve(null); return; }
    req.onupgradeneeded = () => { req.transaction?.abort(); };          // it did not exist: leave it that way
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

async function purgeStore(dbName: string, store: string, mine: (key: IDBValidKey, value: unknown) => boolean): Promise<number> {
  const db = await openExisting(dbName);
  if (!db) return 0;
  try {
    if (!db.objectStoreNames.contains(store)) return 0;
    return await new Promise<number>((resolve) => {
      let n = 0;
      const t = db.transaction(store, 'readwrite');
      const cur = t.objectStore(store).openCursor();
      cur.onsuccess = () => { const c = cur.result; if (!c) return; if (mine(c.key, c.value)) { c.delete(); n++; } c.continue(); };
      t.oncomplete = () => resolve(n); t.onerror = () => resolve(n); t.onabort = () => resolve(n);
    });
  } finally { db.close(); }
}

/** Remove one person's drafts from both editors' stores; resolves with how many were removed. */
export async function purgeDraftsOf(userId: string): Promise<number> {
  if (!userId || typeof indexedDB === 'undefined') return 0;
  const a = await purgeStore('agastya-drafts', 'drafts', (key) => String(key).startsWith(`${userId}/`)).catch(() => 0);
  const b = await purgeStore('s1000d-studio', 'drafts', (_k, v) => String((v as { scope?: string } | null)?.scope ?? '').split('/')[0] === userId).catch(() => 0);
  return a + b;
}
