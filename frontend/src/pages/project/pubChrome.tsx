// The pieces the two Publication pages (S1000D: PublicationPage, JSS / JSG: DocPublicationPage) share, drawn as the owner-approved mockup 4
// (docs/audit/mockups/publication.html) draws them: the build list ("Build 14 · 142 pages · 38 s · 6.4 MB"), the top-bar actions (Download PDF,
// Build publication), the status bar ("Pages 1-2 of 142", "A4 · 210 x 297 mm"), the page number of each structure row from the PDF's bookmarks,
// and the width the first page is drawn at.

import { useEffect, useState } from 'react';
import { contentApi, type JobView } from '../../api';
import { Icon } from '../../components/Icon';
import type { OutlinePage, PdfView } from '../../components/pdf/PdfJsViewer';
import { ago } from '../../components/ui';
import { StatusItems, TopbarActions } from '../../layouts/shellSlots';

/** the jobs that made a PDF of the publication */
const BUILD_KINDS = new Set(['publish', 'jsg', 'configured']);

/** The project's builds, newest first, read again whenever `tick` changes (after a build on the page). */
export function useBuilds(id: string, tick: unknown): JobView[] | null {
  const [jobs, setJobs] = useState<JobView[] | null>(null);
  useEffect(() => {
    let live = true;
    contentApi.jobs(id, 200).then((j) => { if (live) setJobs(j.filter((x) => BUILD_KINDS.has(x.kind))); }).catch(() => { if (live) setJobs([]); });
    return () => { live = false; };
  }, [id, tick]);
  return jobs;
}

const secs = (j: JobView): string | null => (j.startedAt && j.finishedAt ? `${Math.max(1, Math.round((Date.parse(j.finishedAt) - Date.parse(j.startedAt)) / 1000))} s` : null);
const mb = (bytes: number): string => `${(bytes / 1048576).toFixed(1)} MB`;

export interface LastPdf { builtAt: string | null; size: number | null }

/** The badge beside "Last build": Succeeded / Failed / Building / Never, from the newest build. */
export function LastBuildBadge({ jobs, pdf, busy }: { jobs: JobView[] | null; pdf: LastPdf | null; busy: boolean }) {
  const last = jobs?.[0];
  if (busy || last?.state === 'running' || last?.state === 'queued') return <span className="badge info"><Icon name="clock" size={14} />Building</span>;
  if (last && last.state !== 'succeeded') return <span className="badge danger"><Icon name="xcircle" size={14} />{last.state === 'cancelled' ? 'Cancelled' : 'Failed'}</span>;
  if (last || pdf) return <span className="badge success"><Icon name="ok" size={14} />Succeeded</span>;
  return <span className="badge">Never built</span>;
}

/** The list of builds: the newest `limit` of them; the last good one carries the page count, the time it took and the size of its PDF. */
export function BuildList({ jobs, pdf, pages, limit }: { jobs: JobView[] | null; pdf: LastPdf | null; pages: number; limit?: number }) {
  if (jobs === null) return <ul className="hist"><li><Icon name="clock" size={16} /><div className="faint">Reading the builds…</div><span /></li></ul>;
  const lastGood = jobs.find((j) => j.state === 'succeeded');
  if (jobs.length === 0) {
    return (
      <ul className="hist">
        {pdf ? <li><Icon name="ok" size={16} /><div><strong>Publication PDF</strong><div className="faint">{[pages ? `${pages} pages` : '', pdf.size ? mb(pdf.size) : ''].filter(Boolean).join(' · ') || 'Built earlier'}</div></div><span className="faint" title={pdf.builtAt ?? undefined}>{pdf.builtAt ? ago(pdf.builtAt) : ''}</span></li>
          : <li><Icon name="clock" size={16} /><div><strong>Not built yet</strong><div className="faint">Build publication makes the PDF.</div></div><span /></li>}
      </ul>
    );
  }
  const shown = limit ? jobs.slice(0, limit) : jobs;
  return (
    <ul className="hist" data-testid="pub-builds">
      {shown.map((j) => {
        const n = jobs.length - jobs.indexOf(j);
        const ok = j.state === 'succeeded';
        const running = j.state === 'running' || j.state === 'queued';
        const what = ok
          ? [j === lastGood && pages ? `${pages} pages` : '', secs(j), j === lastGood && pdf?.size ? mb(pdf.size) : ''].filter(Boolean).join(' · ')
          : running ? (j.state === 'queued' ? 'Waiting for a free slot' : 'Building…') : `${j.state === 'cancelled' ? 'Cancelled' : 'Stopped'}${j.error?.message ? `: ${j.error.message}` : ''}`;
        return (
          <li key={j.id}>
            <Icon name={ok ? 'ok' : running ? 'clock' : 'xcircle'} size={16} />
            <div><strong>Build {n}</strong><div className="faint" title={what}>{what}</div></div>
            <span className="faint" title={j.createdAt}>{ago(j.finishedAt ?? j.createdAt)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** The page's actions in the top bar of the project shell (mockup: Download PDF, Build publication). */
export function PubTopbar({ downloadHref, downloadTestId = 'download-pdf-top', canBuild, busy, onBuild }: { downloadHref: string | null; downloadTestId?: string; canBuild: boolean; busy: boolean; onBuild: () => void }) {
  return (
    <TopbarActions>
      {downloadHref ? <a className="btn pub-top" href={downloadHref} data-testid={downloadTestId} title="Download PDF"><Icon name="download" /><span className="pub-top-lbl">Download PDF</span></a>
        : <button type="button" className="btn pub-top" disabled title="Build the publication first"><Icon name="download" /><span className="pub-top-lbl">Download PDF</span></button>}
      <button type="button" className="btn primary pub-top" onClick={onBuild} disabled={busy || !canBuild} data-testid="build-publication-top" title="Build publication"><Icon name="play" /><span className="pub-top-lbl">Build publication</span></button>
    </TopbarActions>
  );
}

const PAPERS: Array<[string, number, number]> = [['A4', 210, 297], ['A3', 297, 420], ['A5', 148, 210], ['Letter', 216, 279]];
/** "A4 · 210 x 297 mm" (portrait or landscape by the first page) */
export function paperText(w: number, h: number): string {
  if (!w || !h) return '';
  const lo = Math.min(w, h); const hi = Math.max(w, h);
  const named = PAPERS.find(([, a, b]) => Math.abs(a - lo) <= 2 && Math.abs(b - hi) <= 2)?.[0];
  return `${named ? `${named} · ` : ''}${w} x ${h} mm`;
}

/** "A4 portrait" (the output profile names its paper, as the mockup's "Xignal S1000D - A4 portrait") */
export function paperShort(view: PdfView | null): string {
  if (!view?.widthMm || !view.heightMm) return '';
  const lo = Math.min(view.widthMm, view.heightMm); const hi = Math.max(view.widthMm, view.heightMm);
  const named = PAPERS.find(([, a, b]) => Math.abs(a - lo) <= 2 && Math.abs(b - hi) <= 2)?.[0] ?? `${view.widthMm} x ${view.heightMm} mm`;
  return `${named} ${view.widthMm <= view.heightMm ? 'portrait' : 'landscape'}`;
}

/** The status bar while the page is shown: the state of the last build, which build is previewed, the pages on screen and the paper. */
export function PubStatus({ jobs, pdf, view, busy }: { jobs: JobView[] | null; pdf: LastPdf | null; view: PdfView | null; busy: boolean }) {
  const good = jobs?.find((j) => j.state === 'succeeded');
  const n = good && jobs ? jobs.length - jobs.indexOf(good) : 0;
  const last = jobs?.[0];
  const failed = !!last && last.state !== 'succeeded' && last.state !== 'running' && last.state !== 'queued';
  return (
    <StatusItems>
      <span className="item"><span className={`dot ${busy ? 'info' : failed ? 'danger' : pdf || good ? 'success' : ''}`} />{busy ? 'Building…' : failed ? 'Last build stopped' : pdf || good ? 'Renderer ready' : 'Not built yet'}</span>
      {pdf || good ? <span className="item">{n ? `Preview of build ${n}` : 'Preview of the last build'}</span> : null}
      <span className="grow" />
      {view && view.numPages ? <span className="item">{view.first === view.last ? `Page ${view.first}` : `Pages ${view.first}-${view.last}`} of {view.numPages}</span> : null}
      {view && view.widthMm ? <span className="item">{paperText(view.widthMm, view.heightMm)}</span> : null}
    </StatusItems>
  );
}

/** The width the first page is drawn at: the mockup's sheet (480 px, 420 px on a narrower desktop). */
export const sheetWidth = (): number => (typeof window !== 'undefined' && window.innerWidth <= 1280 ? 420 : 480);

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

export interface PageNode { key: string; title: string; kids?: PageNode[] }
/** The page each chapter and module starts on, from the PDF's bookmarks: chapters and modules are matched in order, by their titles. */
export function pagesFromOutline(outline: OutlinePage[] | null, nodes: PageNode[]): Map<string, number> {
  const out = new Map<string, number>();
  if (!outline?.length) return out;
  const walk = (items: OutlinePage[], list: PageNode[]) => {
    let at = 0;
    for (const n of list) {
      const t = norm(n.title);
      if (!t) continue;
      const i = items.findIndex((x, ix) => ix >= at && norm(x.title).includes(t));
      if (i < 0) continue;
      at = i + 1;
      if (items[i].page != null) out.set(n.key, items[i].page!);
      if (n.kids?.length) walk(items[i].items, n.kids);
    }
  };
  walk(outline, nodes);
  return out;
}
