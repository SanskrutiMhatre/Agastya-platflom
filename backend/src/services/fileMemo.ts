// A per-file memo (audit WP-18: PERF-016, FE-029, FE-030). Values derived from one file's content (a data module's identity, the BREX it names,
// its content hash) are kept with the file's size and modification and change times, and computed again as soon as any of them changes. The
// listing, the dashboard summary and the BREX check then read a file only when it changed, instead of reading every module on every request.
// Bounded: the oldest entries are dropped beyond `max`, so a very large workspace costs memory in proportion to `max`, not to its size.
import type fs from 'fs';

interface Entry<T> { size: number; mtimeMs: number; ctimeMs: number; ino: number; value: T }

export class FileMemo<T> {
  private map = new Map<string, Entry<T>>();
  hits = 0; misses = 0;
  constructor(private readonly max = 50000) {}

  get(abs: string, st: fs.Stats, compute: () => T): T {
    const e = this.map.get(abs);
    // WP-17: the file id as well, so a file replaced by an atomic rename within one clock tick, at the same size, is never taken for the old one
    if (e && e.size === st.size && e.mtimeMs === st.mtimeMs && e.ctimeMs === st.ctimeMs && e.ino === st.ino) { this.hits++; return e.value; }
    this.misses++;
    const value = compute();
    if (e) this.map.delete(abs);                       // re-insert so the newest entries are the last dropped
    this.map.set(abs, { size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, ino: st.ino, value });
    if (this.map.size > this.max) { const first = this.map.keys().next().value; if (first !== undefined) this.map.delete(first); }
    return value;
  }

  clear(): void { this.map.clear(); }
}
