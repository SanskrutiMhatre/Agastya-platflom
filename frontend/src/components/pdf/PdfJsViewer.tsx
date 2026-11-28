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
}

const PageSlot: React.FC<PageSlotProps> = ({ pdf, pageNum, scale, active, registerEl, matches, currentMatchKey, onGoPage }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [overlays, setOverlays] = useState<LinkBox[]>([]);
  const [links, setLinks] = useState<LinkBox[]>([]);

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
    <div
      ref={wrapRef}
      data-page={pageNum}
      style={{
        position: 'relative', margin: '20px auto', background: 'var(--viewer-page)',
        boxShadow: 'var(--viewer-page-shadow)',
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

      {overlays.map(o => (
        <div key={o.key} style={{
          position: 'absolute', left: o.left, top: o.top, width: o.width, height: o.height,
          zIndex: 10, pointerEvents: 'none',
          background: o.key === currentMatchKey ? 'var(--viewer-match-current)' : 'var(--viewer-match)',
          outline: o.key === currentMatchKey ? '2px solid var(--viewer-match-outline)' : undefined,
        }} />
      ))}

      <div style={{ position: 'absolute', bottom: 4, right: 8, fontSize: 10, color: 'var(--viewer-page-label)', userSelect: 'none', pointerEvents: 'none' }}>
        {pageNum}
      </div>
    </div>
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 6 + depth * 14, borderRadius: 4, background: active ? 'var(--viewer-active)' : undefined }}>
        {hasKids ? (
          <button
            onClick={() => setOpen(o => !o)} aria-label={open ? "Collapse" : "Expand"} title={open ? "Collapse" : "Expand"} aria-expanded={open}
            style={{ width: 16, height: 16, border: 'none', background: 'none', color: 'var(--viewer-ink-55)', cursor: 'pointer', padding: 0, transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .12s' }}
          >▶</button>
        ) : <span style={{ width: 16, flexShrink: 0 }} />}
        <button
          onClick={() => page != null && onGoPage(page)}
          disabled={page == null}
          title={item.title}
          style={{
            flex: 1, minWidth: 0, textAlign: 'left', padding: '6px 0', fontSize: 12,
            border: 'none', background: 'none', cursor: page == null ? 'default' : 'pointer',
            color: active ? 'var(--viewer-accent)' : 'var(--viewer-ink-80)',
            fontWeight: active ? 600 : 400, opacity: page == null ? 0.4 : 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >{item.title}</button>
        {page != null && <span style={{ fontSize: 10, color: 'var(--viewer-ink-55)' }}>{page}</span>}
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
}

export const PdfJsViewer: React.FC<PdfJsViewerProps> = ({ src, downloadName = 'output.pdf', toolbarExtra, placeholder, autoFit }) => {
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
  const [tocOpen, setTocOpen] = useState(!autoFit); // the compact (embedded) viewer starts with the pages, not the bookmarks
  const [outline, setOutline] = useState<TocItem[]>([]);

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
      try { setOutline((await doc.getOutline()) ?? []); } catch { setOutline([]); }
      setLoading(false);
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

    for (const [n, el] of pageEls.current) {
      const elTop = el.offsetTop;
      const elBottom = elTop + el.offsetHeight;
      // One viewport of slack either side, so scrolling reveals rendered pages.
      if (elBottom > top - box.clientHeight && elTop < bottom + box.clientHeight) near.add(n);
      const overlap = Math.min(elBottom, bottom) - Math.max(elTop, top);
      if (overlap > bestOverlap) { bestOverlap = overlap; best = n; }
    }

    setVisible(near);
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

  const goPage = useCallback((n: number) => {
    const target = Math.min(Math.max(1, n), numPages || 1);
    const el = pageEls.current.get(target);
    if (el && containerRef.current) {
      containerRef.current.scrollTo({ top: el.offsetTop - 8, behavior: 'smooth' });
    } else {
      // Not laid out yet — remember and jump once it is.
      pendingScrollPage.current = target;
    }
    setPage(target);
  }, [numPages]);

  // Restore position after a reload, once the new pages have laid out.
  useEffect(() => {
    const want = pendingScrollPage.current;
    if (want == null || !numPages) return;
    const el = pageEls.current.get(want);
    if (!el || !containerRef.current) return;
    containerRef.current.scrollTop = Math.max(0, el.offsetTop - 8);
    pendingScrollPage.current = null;
    recompute();
  }, [numPages, visible, recompute]);

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
    <div className={`pdfv${autoFit ? ' compact' : ''}`}>
      {/* Toolbar: the mockup's viewer bar (contents, page, zoom, find); the paper below stays white in both themes */}
      <div className="vbar" role="toolbar" aria-label="PDF viewer">
        <button className="icon-btn" onClick={() => setTocOpen(o => !o)} title="Table of contents" aria-label="Table of contents" aria-pressed={tocOpen}><Icon name="panel" size={15} /></button>
        <span className="vsep" />
        <button className="icon-btn" onClick={() => goPage(page - 1)} disabled={page <= 1} title="Previous page" aria-label="Previous page"><Icon name="up" size={15} /></button>
        <span className="pg">
          <input
            className="input"
            value={pageInput}
            onChange={e => setPageInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') goPage(Number(pageInput) || 1); }}
            onBlur={() => setPageInput(String(page))}
            aria-label="Page number"
          />
          <span className="faint">/ {numPages || '—'}</span>
        </span>
        <button className="icon-btn" onClick={() => goPage(page + 1)} disabled={page >= numPages} title="Next page" aria-label="Next page"><Icon name="down" size={15} /></button>

        <span className="vsep" />
        <button className="icon-btn" onClick={() => setScale(s => Math.max(0.4, s - 0.15))} title="Zoom out" aria-label="Zoom out"><Icon name="zoomOut" size={15} /></button>
        <span className="zoom">{Math.round(scale * 100)} %</span>
        <button className="icon-btn" onClick={() => setScale(s => Math.min(3, s + 0.15))} title="Zoom in" aria-label="Zoom in"><Icon name="zoomIn" size={15} /></button>
        <button className="btn sm subtle" onClick={fitWidth}>Fit width</button>

        <span className="grow" />
        <span className="find">
          <Icon name="search" size={13} />
          <input
            className="input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
            placeholder="Find…"
            aria-label="Search in document"
          />
        </span>
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

        {toolbarExtra}
        {src && !autoFit && <a className="btn sm" href={src} download={downloadName}><Icon name="download" size={13} />Download</a>}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {tocOpen && (
          <div style={{ width: 230, flexShrink: 0, overflow: 'auto', background: 'var(--viewer-sidebar)', padding: '8px 4px' }}>
            {!pdf ? null : outline.length === 0 ? (
              <div style={{ padding: 12, fontSize: 11.5, color: 'var(--viewer-ink-55)' }}>
                This document has no table of contents.
              </div>
            ) : outline.map((item, i) => (
              <TocRow key={i} item={item} depth={0} pdf={pdf} current={page} onGoPage={goPage} />
            ))}
          </div>
        )}

        <div ref={containerRef} style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          {error ? (
            <div style={{ padding: 24, color: 'var(--viewer-error)', fontSize: 13 }}>⚠ {error}</div>
          ) : !src ? (
            <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--viewer-ink-55)', fontSize: 13 }}>
              {placeholder ?? 'No PDF yet.'}
            </div>
          ) : loading && !numPages ? (
            <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--viewer-ink-70)', fontSize: 13 }}>
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
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default PdfJsViewer;
