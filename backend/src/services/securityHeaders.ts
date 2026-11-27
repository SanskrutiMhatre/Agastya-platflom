// Security headers (audit WP-03: ENT-012, FE-017). One middleware for every response.
//
// The application (the SPA and its static files) gets a Content-Security-Policy that loads nothing from any other origin
// (it doubles as the proof for gate G-OFF-2 that the product works offline) and runs no inline script:
//   * 'unsafe-eval' is a known residual: the Studio patches the pdfmake bundle at run time and evaluates it
//     (frontend/src/studio/export/pdfmake-patch.ts). It allows no inline <script> and no event-handler attribute, which is
//     what the policy is mainly for; moving the patch to build time removes it (tracked in docs/audit/IMPLEMENTATION-LOG.md).
//   * 'wasm-unsafe-eval' and blob: workers: XSD validation runs xmllint compiled to WebAssembly in a worker.
//   * style 'unsafe-inline': React style attributes and the editors' computed styles.
// API responses (JSON, PDFs, HTML previews shown in the application's own frames) keep their own content and get only
// the framing rule, nosniff and the referrer rule, so a published HTML preview is not broken by the application policy.
import type { Request, Response, NextFunction } from 'express';

export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // blob: and data: reach only content the page already holds (pdf.js reads a rendered PDF from a blob: URL, the Studio reads its own
  // pictures); no other origin is reachable, so the offline proof stands.
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob: data:",
  "media-src 'self' blob: data:",
  "object-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  if (req.path.startsWith('/api/')) res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
  else res.setHeader('Content-Security-Policy', APP_CSP);
  next();
}
