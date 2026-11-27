/**
 * Persistence: IndexedDB for drafts (crash recovery), the project BREX
 * library, linked ICN images and recent files; localStorage for settings.
 */
export interface Draft {
  id: string;
  fileName: string;
  text: string;
  savedAt: number;
  /** Embedded in the platform (FE-006): "<user>/<project>" the draft belongs to. Only that person, in that project, is offered it. */
  scope?: string;
}

export interface RecentFile {
  name: string;
  dmc: string;
  title: string;
  openedAt: number;
}

export interface StoredBrex {
  dmc: string;
  fileName: string;
  text: string;
  addedAt: number;
}

const DB_NAME = 's1000d-studio';
const DB_VERSION = 1;

let dbp: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    if (!('indexedDB' in window)) return resolve(null);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ['drafts', 'brex', 'images', 'kv']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbp;
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const r = fn(s);
      t.oncomplete = () => resolve(r ? (r.result as T) : undefined);
      t.onerror = () => resolve(undefined);
      t.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

/** False when the browser gives no IndexedDB (private window, blocked site data): drafts, linked images and the BREX are then not kept. */
export async function storageAvailable(): Promise<boolean> {
  return (await openDb()) !== null;
}

export const storage = {
  put: (store: string, key: string, value: unknown) => tx(store, 'readwrite', (s) => s.put(value, key)),
  get: <T>(store: string, key: string) => tx<T>(store, 'readonly', (s) => s.get(key) as IDBRequest<T>),
  del: (store: string, key: string) => tx(store, 'readwrite', (s) => s.delete(key)),
  all: <T>(store: string) => tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>),
  keys: (store: string) => tx<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys()),
  clear: (store: string) => tx(store, 'readwrite', (s) => s.clear()),
};

export function loadLocal<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
}

export function saveLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

/** ICN name -> object URL for linked images (persisted as Blobs). */
export class ImageStore {
  private urls = new Map<string, string>();
  private blobs = new Map<string, Blob>();
  readonly resolver = (icn: string): string | null => {
    if (!icn) return null;
    return this.urls.get(icn) ?? this.urls.get(icn.toUpperCase()) ?? null;
  };

  async load() {
    const keys = ((await storage.keys('images')) ?? []) as string[];
    for (const k of keys) {
      const b = await storage.get<Blob>('images', k);
      if (b) {
        this.urls.set(k, URL.createObjectURL(b));
        this.blobs.set(k, b);
      }
    }
  }

  static icnName(fileName: string): string {
    return fileName.replace(/\.[^.]+$/, '');
  }

  async add(file: File | Blob, icn: string) {
    const old = this.urls.get(icn);
    if (old) URL.revokeObjectURL(old);
    this.urls.set(icn, URL.createObjectURL(file));
    this.blobs.set(icn, file);
    await storage.put('images', icn, file);
  }

  has(icn: string) { return this.urls.has(icn); }
  get count() { return this.urls.size; }
  names() { return [...this.urls.keys()].sort(); }

  /** The raw linked Blob for an ICN (case-insensitive), or null if none is linked. */
  blob(icn: string): Blob | null {
    if (!icn) return null;
    return this.blobs.get(icn) ?? this.blobs.get(icn.toUpperCase()) ?? null;
  }

  async remove(icn: string) {
    const u = this.urls.get(icn);
    if (u) URL.revokeObjectURL(u);
    this.urls.delete(icn);
    this.blobs.delete(icn);
    await storage.del('images', icn);
  }
}
