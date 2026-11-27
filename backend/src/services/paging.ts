// Opt-in paging for the long lists (audit WP-18: PERF-016). A request without `limit` gets the whole list exactly as before, so every existing
// caller keeps working; `?limit=50&offset=100` returns one window plus the total, and `q` narrows the list on the server first.
import type { Request } from 'express';
import { bad } from './http';

export const MAX_PAGE = 1000;

export interface Page { offset: number; limit: number; total: number; nextOffset: number | null }

/** The window the request asks for, or null when it asks for the whole list. */
export function pageRequest(req: Request): { offset: number; limit: number } | null {
  const rawLimit = req.query.limit; const rawOffset = req.query.offset;
  if (rawLimit === undefined && rawOffset === undefined) return null;
  const limit = rawLimit === undefined ? MAX_PAGE : Number(rawLimit);
  const offset = rawOffset === undefined ? 0 : Number(rawOffset);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) throw bad(`limit is a whole number from 1 to ${MAX_PAGE}.`, 'BAD_PAGE');
  if (!Number.isInteger(offset) || offset < 0) throw bad('offset is a whole number from 0.', 'BAD_PAGE');
  return { offset, limit };
}

/** The search text (`q`), lower-cased, or '' when none was given. */
export function searchText(req: Request): string {
  const q = req.query.q;
  return typeof q === 'string' ? q.trim().toLowerCase().slice(0, 200) : '';
}

export function windowOf<T>(items: T[], want: { offset: number; limit: number }): { items: T[]; page: Page } {
  const slice = items.slice(want.offset, want.offset + want.limit);
  const end = want.offset + slice.length;
  return { items: slice, page: { offset: want.offset, limit: want.limit, total: items.length, nextOffset: end < items.length ? end : null } };
}
