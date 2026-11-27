// The one same-origin rule, for state-changing HTTP requests and for the WebSocket upgrade (audit WP-03: ENT-012, PLT-017).
// A browser page on another origin is refused; a request with no Origin (not a browser, so it cannot carry a victim's
// cookie) is allowed. In development the Vite proxy forwards the browser's Origin, so the dev server's own origin is
// allowed explicitly (AGASTYA_DEV_ORIGINS).
import { config } from '../config';

const devOrigins = new Set(config.devOrigins);

export function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  let h: string | null = null;
  try { h = new URL(origin).host; } catch { /* malformed */ }
  return !!h && (h === host || devOrigins.has(origin));
}
