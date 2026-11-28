// =============================================================================
// PdfJsViewer — a self-rendered, continuously scrollable PDF view.
//
// Why not <iframe src="foo.pdf">: the browser's native viewer runs in an
// internal, cross-origin context even for a same-origin file, so JavaScript can
// never read which page the reader is on. Every regenerate therefore threw the
// author back to page 1 — punishing in an authoring loop where you rebuild
// constantly to check one figure halfway through the book.
//
// Rendering the pages ourselves means WE know the current page (from scroll
// position), so it survives a reload, and the document becomes searchable.
//
// Pages render lazily: a slot stays an empty placeholder until it scrolls near
// the viewport, which is what lets a 300-page book scroll smoothly instead of
// rasterising everything up front.
// =============================================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
// Self-hosted worker (Vite bundles it locally via ?url) so the viewer works
// fully offline — no CDN fetch, matching the rest of this app's tooling.
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Icon } from '../Icon';
import '../../styles/pdf.css';   // WP-35 second pass: the pdf.js text layer styles load with the viewer chunk, not the entry

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

interface Match { key: string; page: number; rect: number[] }
interface LinkBox { key: string; left: number; top: number; width: number; height: number; url?: string; destPage?: number }

// ── One page ───────────────────────────────────────────────────────────────

interface PageSlotProps {
  pdf: PDFDocumentProxy | null;
  pageNum: number;
  scale: number;
  active: boolean;
  registerEl: (n: number, el: HTMLDivElement | null) => void;
  matches: Match[];
  currentMatchKey?: string;
  onGoPage: (n: number) => void;
  /** the full viewer (Publication page, pop-out): the page number is printed under the sheet ("Page 3 of 20"), as the mockup draws it */
  full: boolean;
  total: number;
  /** Phase 3 (P3-4): drawn over the page (the review highlights, the area tool), with the page's viewport */
  overlay?: (p: PageOverlayInfo) => React.ReactNode;
}

const PageSlot: React.FC<PageSlotProps> = ({ pdf, pageNum, scale, active, registerEl, matches, currentMatchKey, onGoPage, full, total, overlay }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [overlays, setOverlays] = useState<LinkBox[]>([]);
  const [links, setLinks] = useState<LinkBox[]>([]);
  const [vp, setVp] = useState<PageOverlayInfo['viewport'] | null>(null);

  useEffect(() => {
    registerEl(pageNum, wrapRef.current);
    return () => registerEl(pageNum, null);
  }, [pageNum, registerEl]);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    let renderTask: any = null;
    let textLayer: any = null;

    // Wrapped in try/catch: when the parent swaps to a new document the old
    // one's worker is torn down, and getPage() then throws synchronously. This
    // slot simply belongs to a document that no longer exists.
    (async () => {
      try {
        const page = await pdf.getPage(pageNum);
        if (cancelled) return;

        const viewport = page.getViewport({ scale });
        setSize({ width: viewport.width, height: viewport.height });
        setVp(viewport as unknown as PageOverlayInfo['viewport']);
        if (!active) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        renderTask = page.render({ canvasContext: ctx, viewport } as any);
        await renderTask.promise;
        if (cancelled) return;

        // Real selectable/copyable text, positioned to match the canvas.
        const el = textLayerRef.current;
        if (el) {
          el.innerHTML = '';
          el.style.setProperty('--scale-factor', String(scale));
          const textContent = await page.getTextContent();
          if (cancelled) return;
          textLayer = new (pdfjsLib as any).TextLayer({ textContentSource: textContent, container: el, viewport });
          await textLayer.render();
          if (cancelled) return;
        }

        // Cross-references the FO pipeline already emits as real link
        // annotations — internal jumps and external URLs.
        const annots = await page.getAnnotations();
        if (cancelled) return;
        const resolved = await Promise.all(
          annots
            .filter((a: any) => a.subtype === 'Link' && (a.url || a.dest))
            .map(async (a: any): Promise<LinkBox | null> => {
              const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(a.rect);
              const rect = {
                left: Math.min(x1, x2), top: Math.min(y1, y2),
                width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
              };
              if (a.url) return { key: 'l' + a.id, ...rect, url: a.url };
              try {
                const dest = typeof a.dest === 'string' ? await pdf.getDestination(a.dest) : a.dest;
                if (!dest?.[0]) return null;
                const idx = await pdf.getPageIndex(dest[0] as any);
                return { key: 'l' + a.id, ...rect, destPage: idx + 1 };
              } catch { return null; }
            }),
        );
        if (cancelled) return;
        setLinks(resolved.filter(Boolean) as LinkBox[]);

        // Position search highlights now the exact viewport is known.
        setOverlays((matches ?? []).filter(m => m.page === pageNum).map(m => {
          const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(m.rect);
          return {
            key: m.key,
            left: Math.min(x1, x2), top: Math.min(y1, y2),
            width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
          };
        }));
      } catch {
        /* cancelled render or destroyed document */
      }
    })();

    return () => {
      cancelled = true;
      if (renderTask) { try { renderTask.cancel(); } catch { /* already done */ } }
      if (textLayer) { try { textLayer.cancel(); } catch { /* already done */ } }
    };
  }, [pdf, pageNum, scale, active, matches]);

  const box = (l: LinkBox): React.CSSProperties => ({
    position: 'absolute', left: l.left, top: l.top, width: l.width, height: l.height,
    zIndex: 5, borderRadius: 2, background: 'transparent', border: 'none', cursor: 'pointer',
  });

  return (
    <>
    <div
      ref={wrapRef}
      data-page={pageNum}
      className="pdfv-sheet"
      style={{
        position: 'relative', flex: 'none', background: 'var(--viewer-page)',
        ...(size ? { width: size.width, height: size.height } : { width: '80%', aspectRatio: '210 / 297' }),
      }}
    >
      {active && <canvas ref={canvasRef} style={{ display: 'block' }} />}
      {active && <div ref={textLayerRef} className="textLayer" />}

      {links.map(l => l.url ? (
        <a key={l.key} href={l.url} target="_blank" rel="noreferrer" title={l.url} style={box(l)} />
      ) : (
        <button key={l.key} onClick={() => l.destPage && onGoPage(l.destPage)} title={`Go to page ${l.destPage}`} style={box(l)} />
      ))}

      {overlay && vp ? overlay({ page: pageNum, viewport: vp, active }) : null}

      {overlays.map(o => (
        <div key={o.key} style={{
          position: 'absolute', left: o.left, top: o.top, width: o.width, height: o.height,
          zIndex: 10, pointerEvents: 'none',
          background: o.key === currentMatchKey ? 'var(--viewer-match-current)' : 'var(--viewer-match)',
          outline: o.key === currentMatchKey ? '2px solid var(--viewer-match-outline)' : undefined,
        }} />
      ))}

      {full ? null : (
        <div style={{ position: 'absolute', bottom: 4, right: 8, fontSize: 10, color: 'var(--viewer-page-label)', userSelect: 'none', pointerEvents: 'none' }}>
          {pageNum}
        </div>
      )}
    </div>
    {full ? <span className="pageno">Page {pageNum} of {total}</span> : null}
    </>
  );
};

// ── Table of contents (real PDF bookmarks from the FO pipeline) ────────────

interface TocItem { title: string; dest: any; items?: TocItem[] }

const TocRow: React.FC<{ item: TocItem; depth: number; pdf: PDFDocumentProxy; current: number; onGoPage: (n: number) => void }> =
({ item, depth, pdf, current, onGoPage }) => {
  const [open, setOpen] = useState(depth < 1);
  const [page, setPage] = useState<number | null>(null);
  const hasKids = !!item.items?.length;

  // A bookmark's destination is a named object, not a page index, so it has to
  // be resolved before the row can navigate anywhere.
  useEffect(() => {
    if (!item.dest) return;
    let cancelled = false;
    (async () => {
      try {
        const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
        if (!dest?.[0]) return;
        const idx = await pdf.getPageIndex(dest[0]);
        if (!cancelled) setPage(idx + 1);
      } catch { /* unresolved — the row just won't be clickable */ }
    })();
    return () => { cancelled = true; };
  }, [pdf, item.dest]);

  const active = page != null && page === current;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 6 + depth * 14, paddingRight: 8, borderRadius: 'var(--radius-md)', background: active ? 'var(--surface-selected)' : undefined }}>
        {hasKids ? (
          <button
            onClick={() => setOpen(o => !o)} aria-label={open ? "Collapse" : "Expand"} title={open ? "Collapse" : "Expand"} aria-expanded={open}
            style={{ width: 16, height: 16, border: 'none', background: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: 0, display: 'grid', placeItems: 'center', transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .12s' }}
          ><Icon name="right" size={12} /></button>
        ) : <span style={{ width: 16, flexShrink: 0 }} />}
        <button
          onClick={() => page != null && onGoPage(page)}
          disabled={page == null}
          title={item.title}
          style={{
            flex: 1, minWidth: 0, textAlign: 'left', padding: '6px 0', fontSize: 12,
            border: 'none', background: 'none', cursor: page == null ? 'default' : 'pointer',
            color: active ? 'var(--text-link)' : 'var(--text-primary)',
            fontWeight: active ? 600 : 400, opacity: page == null ? 0.4 : 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >{item.title}</button>
        {page != null && <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>{page}</span>}
      </div>
      {hasKids && open && item.items!.map((kid, i) => (
        <TocRow key={i} item={kid} depth={depth + 1} pdf={pdf} current={current} onGoPage={onGoPage} />
      ))}
    </div>
  );
};

// ── Viewer ─────────────────────────────────────────────────────────────────

export interface PdfJsViewerProps {
  /** URL of the PDF. Changing it loads a new document, keeping the page. */
  src: string | null;
  downloadName?: string;
  /** Rendered into the toolbar, e.g. a Re-generate button. */
  toolbarExtra?: React.ReactNode;
  /** Shown when there is no src yet. */
  placeholder?: React.ReactNode;
  /** Fit the page to the width of the pane when a document loads and whenever the pane is resized. */
  autoFit?: boolean;
  /** The narrow toolbar of the editor's PDF pane (default: when autoFit). The Publication page and the pop-out use the full one. */
  compact?: boolean;
  /** Show the Download button in the toolbar (default true; the Publication page has Download PDF in its top bar). */
  download?: boolean;
  /** The width in pixels the first page is drawn at when a document is first opened (the user's zoom is kept across reloads). */
  startWidth?: number;
  /** What is on screen: the current page, the first and last visible page, the page count and the page size in millimetres. */
  onView?: (v: PdfView) => void;
  /** The document's bookmarks with the page each one starts on, once they are resolved. */
  onOutline?: (items: OutlinePage[]) => void;
  /** Phase 3 (P3-4, PDF review): drawn over every page; see PageOverlayInfo. */
  pageOverlay?: (p: PageOverlayInfo) => React.ReactNode;
  /** Go to this place whenever `seq` changes. */
  jumpTo?: PdfJump | null;
  /** The loaded document (null when none), for a caller that reads its text. */
  onDocument?: (pdf: PDFDocumentProxy | null) => void;
  /** Mouse up over the pages (a text selection ends here). */
  onPagesMouseUp?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Extra class on the scrolling pages box (the area tool's cursor). */
  pagesClass?: string;
}

/** What a page overlay is given: the page number, its pdf.js viewport (PDF user space <-> pixels at the current zoom) and whether it is drawn. */
export interface PageOverlayInfo { page: number; viewport: { width: number; height: number; scale: number; convertToViewportPoint: (x: number, y: number) => number[]; convertToPdfPoint: (x: number, y: number) => number[] }; active: boolean }
/** Scroll to a place: the page, and optionally a point in PDF user space (brought to the upper third of the view). `seq` makes a repeat jump happen. */
export interface PdfJump { page: number; x?: number; y?: number; seq: number }

export interface PdfView { page: number; first: number; last: number; numPages: number; widthMm: number; heightMm: number }
export interface OutlinePage { title: string; page: number | null; items: OutlinePage[] }

async function resolveOutline(pdf: PDFDocumentProxy, items: TocItem[]): Promise<OutlinePage[]> {
  const out: OutlinePage[] = [];
  for (const it of items) {
    let page: number | null = null;
    try {
      const dest = typeof it.dest === 'string' ? await pdf.getDestination(it.dest) : it.dest;
      if (dest?.[0]) page = (await pdf.getPageIndex(dest[0])) + 1;
    } catch { /* unresolved */ }
    out.push({ title: it.title, page, items: it.items?.length ? await resolveOutline(pdf, it.items) : [] });
  }
  return out;
}

export const PdfJsViewer: React.FC<PdfJsViewerProps> = ({ src, downloadName = 'output.pdf', toolbarExtra, placeholder, autoFit, compact = !!autoFit, download = true, startWidth, onView, onOutline, pageOverlay, jumpTo, onDocument, onPagesMouseUp, pagesClass }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageEls = useRef(new Map<number, HTMLDivElement>());
  const pendingScrollPage = useRef<number | null>(null);

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  // Deliberately NOT reset when src changes — that is the whole point.
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [scale, setScale] = useState(1.15);
  const [visible, setVisible] = useState<Set<number>>(() => new Set([1]));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tocOpen, setTocOpen] = useState(false); // every viewer starts with the pages; the contents panel opens from the toolbar
  const [outline, setOutline] = useState<TocItem[]>([]);
  const [findOpen, setFindOpen] = useState(compact);  // the full toolbar shows a Search button that opens the find box (mockup 4)
  const [range, setRange] = useState<{ first: number; last: number }>({ first: 1, last: 1 });
  const [pageMm, setPageMm] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const startedRef = useRef(false);
  const onViewRef = useRef(onView); onViewRef.current = onView;
  const onOutlineRef = useRef(onOutline); onOutlineRef.current = onOutline;
  const onDocumentRef = useRef(onDocument); onDocumentRef.current = onDocument;

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchIndex, setMatchIndex] = useState(0);

  const registerEl = useCallback((n: number, el: HTMLDivElement | null) => {
    if (el) pageEls.current.set(n, el);
    else pageEls.current.delete(n);
  }, []);

  // ── Load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!src) { setPdf(null); setNumPages(0); setOutline([]); return; }

    let cancelled = false;
    let adopted = false;
    setLoading(true);
    setError('');
    setMatches([]);

    const task = pdfjsLib.getDocument({ url: src });
    task.promise.then(async doc => {
      if (cancelled) { try { doc.destroy(); } catch { /* ignore */ } return; }
      adopted = true;
      setPdf(prev => { if (prev) { try { prev.destroy(); } catch { /* ignore */ } } return doc; });
      setNumPages(doc.numPages);
      // Keep the reader where they were, clamped to the new length.
      setPage(p => {
        const next = Math.min(Math.max(1, p), doc.numPages);
        pendingScrollPage.current = next;
        return next;
      });
      try {
        const p1 = await doc.getPage(1);
        const v = p1.getViewport({ scale: 1 });
        setPageMm({ w: Math.round(v.width * 25.4 / 72), h: Math.round(v.height * 25.4 / 72) });
        if (startWidth && !startedRef.current) { startedRef.current = true; const room = containerRef.current ? containerRef.current.clientWidth - 32 : startWidth; setScale(Math.max(0.4, Math.min(3, Math.min(startWidth, room > 120 ? room : startWidth) / v.width))); }
      } catch { /* the size is shown when known */ }
      let toc: TocItem[] = [];
      try { toc = (await doc.getOutline()) ?? []; } catch { toc = []; }
      setOutline(toc);
      setLoading(false);
      if (onOutlineRef.current) { try { const r = await resolveOutline(doc, toc); if (!cancelled) onOutlineRef.current?.(r); } catch { /* no pages for the bookmarks */ } }
    }).catch(e => {
      if (cancelled) return;
      setError(e?.message ?? 'Could not open the PDF.');
      setLoading(false);
    });

    return () => {
      cancelled = true;
      if (!adopted) { try { task.destroy(); } catch { /* ignore */ } }
    };
  }, [src]);

  useEffect(() => { onDocumentRef.current?.(pdf); }, [pdf]);

  // Destroy the last document on unmount, or its worker outlives the view.
  useEffect(() => () => { if (pdf) { try { pdf.destroy(); } catch { /* ignore */ } } }, [pdf]);

  // ── Which pages are near the viewport ────────────────────────────────────
  const recompute = useCallback(() => {
    const box = containerRef.current;
    if (!box || !numPages) return;

    const top = box.scrollTop;
    const bottom = top + box.clientHeight;
    const near = new Set<number>();
    let best = page;
    let bestOverlap = -1;
    let first = Infinity;
    let last = 0;

    for (const [n, el] of pageEls.current) {
      const elTop = el.offsetTop;
      const elBottom = elTop + el.offsetHeight;
      // One viewport of slack either side, so scrolling reveals rendered pages.
      if (elBottom > top - box.clientHeight && elTop < bottom + box.clientHeight) near.add(n);
      const overlap = Math.min(elBottom, bottom) - Math.max(elTop, top);
      if (overlap > bestOverlap) { bestOverlap = overlap; best = n; }
      if (overlap > 0) { first = Math.min(first, n); last = Math.max(last, n); }
    }

    setVisible(near);
    if (last) setRange((r) => (r.first === first && r.last === last ? r : { first, last }));
    setPage(p => (p === best ? p : best));
  }, [numPages, page]);

  useEffect(() => {
    const box = containerRef.current;
    if (!box) return;
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(recompute); };
    box.addEventListener('scroll', onScroll, { passive: true });
    recompute();
    return () => { box.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [recompute]);

  useEffect(() => { setPageInput(String(page)); }, [page]);
  // the pages take their real size once drawn (and again on zoom): measure what is on screen after that, not only on scroll
  const recomputeRef = useRef(recompute); recomputeRef.current = recompute;
  useEffect(() => {
    const t = window.setTimeout(() => recomputeRef.current(), 400);
    return () => window.clearTimeout(t);
  }, [scale, numPages, pdf]);
  useEffect(() => {
    onViewRef.current?.({ page, first: Math.min(range.first, numPages || 1), last: Math.min(range.last, numPages || 1), numPages, widthMm: pageMm.w, heightMm: pageMm.h });
  }, [page, range, numPages, pageMm]);

  // Print: the browser prints the PDF itself from a hidden frame (its own print dialog); a new tab when the frame cannot print
  const print = useCallback(() => {
    if (!src) return;
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    frame.src = src;
    frame.onload = () => {
      try { frame.contentWindow?.focus(); frame.contentWindow?.print(); } catch { window.open(src, '_blank', 'noopener'); }
      window.setTimeout(() => frame.remove(), 60_000);
    };
    document.body.appendChild(frame);
  }, [src]);

  const goPage = useCallback((n: number) => {
    const target = Math.min(Math.max(1, n), numPages || 1);
    const el = pageEls.current.get(target);
    if (el && containerRef.current) {
      containerRef.current.scrollTo({ top: el.offsetTop - (compact ? 8 : 20), behavior: 'smooth' });
    } else {
      // Not laid out yet — remember and jump once it is.
      pendingScrollPage.current = target;
    }
    setPage(target);
  }, [numPages, compact]);

  // Phase 3 (P3-4): jump to a place (a review thread): the page, then the point brought to the upper third of the view
  const jumpSeq = useRef(-1);
  useEffect(() => {
    if (!jumpTo || !pdf || !numPages || jumpTo.seq === jumpSeq.current) return undefined;
    const target = Math.min(Math.max(1, jumpTo.page), numPages);
    const box = containerRef.current; const el = pageEls.current.get(target);
    if (!box || !el) return undefined;
    jumpSeq.current = jumpTo.seq;
    setPage(target);
    let cancelled = false;
    (async () => {
      let dy = 0;
      if (jumpTo.y !== undefined) { try { const p = await pdf.getPage(target); const v = p.getViewport({ scale }); dy = v.convertToViewportPoint(jumpTo.x ?? 0, jumpTo.y)[1]; } catch { dy = 0; } }
      if (cancelled) return;
      box.scrollTo({ top: Math.max(0, el.offsetTop + dy - box.clientHeight / 3), behavior: 'auto' });
      window.setTimeout(() => recomputeRef.current(), 50);
      // the pages around take their real size once drawn: place it once more after that
      window.setTimeout(() => { if (!cancelled) { const e2 = pageEls.current.get(target); if (e2) box.scrollTo({ top: Math.max(0, e2.offsetTop + dy - box.clientHeight / 3), behavior: 'auto' }); } }, 450);
    })();
    return () => { cancelled = true; };
  }, [jumpTo, pdf, numPages, scale]);

  // Restore position after a reload, once the new pages have laid out.
  useEffect(() => {
    const want = pendingScrollPage.current;
    if (want == null || !numPages) return;
    const el = pageEls.current.get(want);
    if (!el || !containerRef.current) return;
    containerRef.current.scrollTop = Math.max(0, el.offsetTop - (compact ? 8 : 20));
    pendingScrollPage.current = null;
    recompute();
  }, [numPages, visible, recompute, compact]);

  const fitWidth = useCallback(async () => {
    if (!pdf || !containerRef.current) return;
    try {
      const p = await pdf.getPage(page || 1);
      const avail = containerRef.current.clientWidth - 40;
      setScale(Math.max(0.4, Math.min(3, avail / p.getViewport({ scale: 1 }).width)));
    } catch { /* ignore */ }
  }, [pdf, page]);

  // Keep the page fitted to its pane (the editor's splitter changes the pane width).
  useEffect(() => {
    if (!autoFit || !pdf) return;
    void fitWidth();
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let last = el.clientWidth;
    let t: number | undefined;
    const ro = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - last) < 24) return;
      last = el.clientWidth;
      window.clearTimeout(t);
      t = window.setTimeout(() => void fitWidth(), 120);
    });
    ro.observe(el);
    return () => { ro.disconnect(); window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, autoFit]);

  // ── Search ───────────────────────────────────────────────────────────────
  const runSearch = useCallback(async () => {
    if (!pdf || !query.trim()) { setMatches([]); return; }
    setSearching(true);
    const needle = query.trim().toLowerCase();
    const found: Match[] = [];
    try {
      for (let n = 1; n <= pdf.numPages; n++) {
        const content = await pdf.getPage(n).then(p => p.getTextContent());
        content.items.forEach((item: any, i: number) => {
          if (!item.str || !item.str.toLowerCase().includes(needle)) return;
          // Item-level granularity: the highlight covers the whole text run
          // containing the hit, which is accurate enough to find it by eye and
          // avoids per-glyph measurement on every page of a long book.
          const [a, b, c, d, e, f] = item.transform;
          void a; void b; void c; void d;
          found.push({ key: `m${n}-${i}`, page: n, rect: [e, f, e + item.width, f + item.height] });
        });
      }
      setMatches(found);
      setMatchIndex(0);
      if (found.length) goPage(found[0].page);
    } finally {
      setSearching(false);
    }
  }, [pdf, query, goPage]);

  const stepMatch = (delta: number) => {
    if (!matches.length) return;
    const next = (matchIndex + delta + matches.length) % matches.length;
    setMatchIndex(next);
    goPage(matches[next].page);
  };

  return (
    <div className={`pdfv${compact ? ' compact' : ''}`}>
      {/* Toolbar: the mockup's viewer bar (contents, page, zoom, search, print); the paper below stays white in both themes */}
      <div className="vbar" role="toolbar" aria-label="PDF viewer">
        <button className="icon-btn" onClick={() => setTocOpen(o => !o)} title="Contents" aria-label="Table of contents" aria-pressed={tocOpen}><Icon name="panel" size={16} /></button>
        <span className="vsep" />
        <button className="icon-btn" onClick={() => goPage(page - 1)} disabled={page <= 1} title="Previous page" aria-label="Previous page"><Icon name="up" size={16} /></button>
        <span className="pg">
          <input
            className="input"
            value={pageInput}
            onChange={e => setPageInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') goPage(Number(pageInput) || 1); }}
            onBlur={() => setPageInput(String(page))}
            aria-label="Page number"
          />
          <span className="of">/ {numPages || '—'}</span>
        </span>
        <button className="icon-btn" onClick={() => goPage(page + 1)} disabled={page >= numPages} title="Next page" aria-label="Next page"><Icon name="down" size={16} /></button>

        <span className="vsep" />
        <button className="icon-btn" onClick={() => setScale(s => Math.max(0.4, s - 0.15))} title="Zoom out" aria-label="Zoom out"><Icon name="zoomOut" size={16} /></button>
        <span className="zoom">{Math.round(scale * 100)} %</span>
        <button className="icon-btn" onClick={() => setScale(s => Math.min(3, s + 0.15))} title="Zoom in" aria-label="Zoom in"><Icon name="zoomIn" size={16} /></button>
        <button className="btn sm subtle" onClick={fitWidth}>Fit width</button>

        <span className="grow" />
        {findOpen ? (
          <span className="find">
            {compact ? <Icon name="search" size={13} /> : null}
            <input
              className="input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runSearch(); if (e.key === 'Escape' && !compact) { setFindOpen(false); setQuery(''); setMatches([]); } }}
              placeholder="Find…"
              aria-label="Search in document"
              autoFocus={!compact}
            />
          </span>
        ) : null}
        {matches.length > 0 && (
          <>
            <button className="icon-btn" onClick={() => stepMatch(-1)} title="Previous match" aria-label="Previous match"><Icon name="up" size={14} /></button>
            <span className="faint">{matchIndex + 1}/{matches.length}</span>
            <button className="icon-btn" onClick={() => stepMatch(1)} title="Next match" aria-label="Next match"><Icon name="down" size={14} /></button>
          </>
        )}
        {searching && <span className="faint">searching…</span>}
        {!searching && query && matches.length === 0 && (
          <span className="faint">no matches</span>
        )}

        {compact ? null : <button className="icon-btn" onClick={() => setFindOpen((o) => { if (o) { setQuery(''); setMatches([]); } return !o; })} title="Search" aria-label={findOpen ? 'Close search' : 'Search'} aria-pressed={findOpen}><Icon name="search" size={16} /></button>}
        {compact ? null : <button className="icon-btn" onClick={print} disabled={!src || !numPages} title="Print" aria-label="Print"><Icon name="print" size={16} /></button>}
        {toolbarExtra}
        {src && !autoFit && download && <a className="btn sm" href={src} download={downloadName}><Icon name="download" size={13} />Download</a>}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {tocOpen && src && (
          <div className="pdfv-toc">
            {!pdf ? null : outline.length === 0 ? (
              <div style={{ padding: 12, fontSize: 'var(--fs-xs)', color: 'var(--text-tertiary)' }}>
                This document has no table of contents.
              </div>
            ) : outline.map((item, i) => (
              <TocRow key={i} item={item} depth={0} pdf={pdf} current={page} onGoPage={goPage} />
            ))}
          </div>
        )}

        <div ref={containerRef} className={[numPages && src && !error ? 'pdfv-pages' : '', pagesClass ?? ''].filter(Boolean).join(' ') || undefined} style={{ flex: 1, overflow: 'auto', position: 'relative' }} onMouseUp={onPagesMouseUp}>
          {error ? (
            <div style={{ padding: 24, color: 'var(--danger)', fontSize: 13 }}>⚠ {error}</div>
          ) : !src ? (
            <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--text-secondary)', fontSize: 13 }}>
              {placeholder ?? 'No PDF yet.'}
            </div>
          ) : loading && !numPages ? (
            <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--text-secondary)', fontSize: 13 }}>
              Loading…
            </div>
          ) : (
            Array.from({ length: numPages }, (_, i) => i + 1).map(n => (
              <PageSlot
                key={n}
                pdf={pdf}
                pageNum={n}
                scale={scale}
                active={visible.has(n)}
                registerEl={registerEl}
                matches={matches}
                currentMatchKey={matches[matchIndex]?.key}
                onGoPage={goPage}
                full={!compact}
                total={numPages}
                overlay={pageOverlay}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default PdfJsViewer;
