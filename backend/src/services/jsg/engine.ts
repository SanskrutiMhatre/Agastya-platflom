// The JSG engine runner: <jsgdoc> -> XSL-FO (schemas/jsg/engine/jsg.xsl, xsltproc) -> PDF (Apache FOP).
//
// The STYLESHEETS stay the JSG engine's own: nothing is included from the JSS or S1000D stylesheets and nothing of this is included by them
// (JSG_ENGINE.md section 6), and only JSG parameters are passed. The RUNNING is shared with the other two formats (audit WP-15, PUB-011):
//   - the build is a job in a worker process (WP-14, kind `jsg`): deadline, cancel, one build per project, its log kept as the build report;
//   - FOP is the warm renderer of the worker (vendor/engine/fopd), with the cold `java` launch as the fallback, exactly as the S1000D and JSS builds;
//   - the release decides the watermark (services/release.ts): a document without a current approved release is stamped NOT RELEASED, a released
//     one carries the project's own watermark if it has one. The stamp is put on the FO's page backgrounds after the stylesheet ran (the JSG
//     stylesheets have no watermark parameter, and they are not changed for it);
//   - the PDF's document properties (Title, Author, Subject, Keywords) are written into the FO the same way (services/pdfInfo.ts);
//   - what the build claimed (the fingerprint it rendered and whether it was released) is kept beside the PDF, so GET /jsg/pdf can say when the
//     PDF on disk no longer matches the document or its release.
// It only READS the toolchain locations (vendor/engine/paths.js) and the font configuration (vendor/engine/fontconf.js), and it changes neither.

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { pathToFileURL } from 'url';
import { vendor } from '../../config';
import { projectDirFor, workspaceDir } from '../../context';
import { broadcast } from '../broadcast';
import { HttpError } from '../http';
import { readProjectJson } from '../projects';
import { releaseStateOf } from '../release';
import { injectPdfInfo, firstText, type PdfInfo } from '../pdfInfo';
import { assertJsgPublishable, jsgTypeOfProject, JSG_ENGINE_DIR, SOURCE_NAME, readSource } from './service';
import { tempNameFor, commitFile, discardTemp } from '../../storage/atomicWrite';
import { buildKeys, pdfSignature } from '../buildCache';

const paths = vendor('engine/paths');
const fontConf = vendor('engine/fontconf');
const foGuard = vendor('engine/foGuard');
const fopd = vendor('engine/fopd');
const watermarkEngine = vendor('engine/watermark');

export const FO_NAME = 'jsg-output.fo';
export const PDF_NAME = 'jsg-output.pdf';
/** What the last build said about itself: the release fingerprint it rendered and whether it was released. */
export const BUILD_STATE = '.jsg-publish-state.json';

/** The printable box of the JSG portrait page (210 x 296.9 mm, margins 25 / 15 / 20 / 20, jsg-common.xsl), which the watermark is sized to. */
const JSG_BOX_MM = { w: 210 - 25 - 15, h: 296.9 - 20 - 20 };
/** Page masters that carry no watermark: the covers (as the JSS engine leaves its cover alone). */
const UNMARKED_MASTERS = new Set(['cover', 'i-cover']);

const inFlight = new Map<string, Promise<unknown>>();
function serial<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = inFlight.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  inFlight.set(key, next);
  const clear = (): void => { if (inFlight.get(key) === next) inFlight.delete(key); };
  next.then(clear, clear);
  return next;
}

function run(file: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  const env = paths.childEnv({ ...(paths.hasBundledJre ? { JAVA_HOME: paths.JRE_HOME } : null) });
  return new Promise((resolve, reject) => {
    execFile(file, file === paths.XSLTPROC ? paths.quoteSafeXsltArgs(args) : args, { cwd, env, maxBuffer: 20 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) { (err as any).stderr = stderr; return reject(err); }
      resolve({ stdout, stderr });
    });
  });
}

/** The number of pages of a PDF FOP wrote: the largest /Count of its page tree (FOP writes the page tree as plain objects). Null when it cannot be read. */
export function pdfPageCount(file: string): number | null {
  try {
    const text = fs.readFileSync(file).toString('latin1');
    let best = 0; for (const m of text.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages/g)) best = Math.max(best, Number(m[1] ?? m[2]));
    if (best) return best;
    const kids = text.match(/\/Type\s*\/Page\b(?!s)/g); return kids ? kids.length : null;
  } catch { return null; }
}

const forward = (p: string): string => p.replace(/\\/g, '/');

/** What FOP said, boiled down to the first line that names the cause. */
function why(e: any): string {
  const text = String(e?.stderr || e?.message || e);
  const line = text.split(/\r?\n/).find((l) => /SEVERE|Exception|Error/i.test(l) && !/^\s*at /.test(l)) ?? text.split(/\r?\n/)[0];
  return line.replace(/^.*?(SEVERE:|Exception:)\s*/i, '').slice(0, 400);
}

/**
 * The watermark on the FO: every region-body of a page master that is not a cover gets the picture as its centred background (the same four
 * attributes the JSS stylesheet writes for its watermark). Returns the number of page masters marked.
 */
export function markFo(foAbs: string, uri: string, repeat: string): number {
  const fo = fs.readFileSync(foAbs, 'utf8');
  let n = 0;
  const attrs = ` background-image="url('${uri.replace(/[&"'<>]/g, '')}')" background-repeat="${repeat === 'repeat' ? 'repeat' : 'no-repeat'}" background-position-horizontal="center" background-position-vertical="center"`;
  const out = fo.replace(/(<fo:simple-page-master\b[^>]*>)([\s\S]*?)(<\/fo:simple-page-master>)/g, (all, open: string, body: string, close: string) => {
    const name = /master-name="([^"]*)"/.exec(open)?.[1] ?? '';
    if (UNMARKED_MASTERS.has(name) || /background-image=/.test(body)) return all;
    n++;
    return `${open}${body.replace(/<fo:region-body\b/, `<fo:region-body${attrs}`)}${close}`;
  });
  if (n) fs.writeFileSync(foAbs, out, 'utf8');
  return n;
}

/** The document properties of a JSG PDF: the document's title and project, the issuing authority, the kind of document, its number. */
export function jsgPdfInfo(projectId: string, xml: string): PdfInfo {
  const meta = /<meta>[\s\S]*?<\/meta>/.exec(xml)?.[0] ?? '';
  const lines = [...(/<issuedBy>([\s\S]*?)<\/issuedBy>/.exec(meta)?.[1] ?? '').matchAll(/<line>([^<]*)<\/line>/g)].map((m) => m[1].trim()).filter(Boolean);
  const title = [firstText(meta, 'projectName'), firstText(meta, 'title')].filter((s) => s && !/^(PROJECT NAME)$/.test(s)).join(' - ') || String(readProjectJson(projectId).name ?? '');
  return { title, author: lines.join(', ') || undefined, subject: `JSG ${jsgTypeOfProject(projectId)?.label ?? 'document'}`, keywords: [firstText(meta, 'docNo'), firstText(meta, 'nsn')].filter((s) => s && s !== 'DOCUMENT NO.').join(', ') };
}

export interface JsgBuildState { fingerprint: string; released: boolean; builtAt: string }
export function lastJsgBuildState(projectId: string): JsgBuildState | null {
  try { return JSON.parse(fs.readFileSync(path.join(projectDirFor(projectId), BUILD_STATE), 'utf8')); } catch { return null; }
}

export interface JsgBuild { pdf: string; totalMs: number; pages?: number; warnings: string[]; releaseLabel: string; released: boolean; warmFop: boolean; /** phase 7: the last build's PDF, nothing changed */ upToDate?: boolean }

// phase 7: the Quick preview's own record (leading underscore: generated, out of a project archive and of every input key)
const QUICK_PREVIEW_STATE = '_quick-preview.state.json';
interface KeptBuild { inputKey?: string; pdfSig?: string | null; gateWarnings?: string[]; warnings?: string[]; releaseLabel?: string; released?: boolean; warmFop?: boolean }
function readState(abs: string): KeptBuild | null { try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { return null; } }

/** The JSG editor's Quick preview: the same build, kept beside the document's PDF as a draft (the leading underscore keeps it out of a project archive). */
export const QUICK_PREVIEW_PDF = '_quick-preview.pdf';
const QUICK_PREVIEW_FO = '_quick-preview.fo';

/**
 * Build the document's PDF. `preview` (the editor's Quick preview) renders the same document through the same gate and stylesheet, but as a
 * draft: into _quick-preview.pdf, never claiming a release (the NOT RELEASED marks), with no build state and no reload of the PDF views, so the
 * document's PDF, its download and the release flow are untouched. It waits in the same queue as a build (the two share the watermark file).
 */
export function buildJsgPdf(projectId: string, opts: { preview?: boolean } = {}): Promise<JsgBuild> {
  const preview = !!opts.preview;
  const PDF_OUT = preview ? QUICK_PREVIEW_PDF : PDF_NAME; const FO_OUT = preview ? QUICK_PREVIEW_FO : FO_NAME;
  return serial(`${projectId}:jsg`, async () => {
    const log = (message: string, extra: Record<string, unknown> = {}): void => { console.log(`[jsg:${projectId}] ${message}`); broadcast(projectId, { type: 'progress', message, ...extra, ...(preview ? { preview: true } : {}) } as any); };
    const t0 = Date.now();
    // Phase 7 (PERF-012, services/buildCache.ts): nothing this build reads changed since the last one of the same kind, and its PDF is still
    // the file it wrote: that PDF is the answer (two FOP passes for a handbook whose certificate cites the page count otherwise)
    const statePath = path.join(projectDirFor(projectId), preview ? QUICK_PREVIEW_STATE : BUILD_STATE);
    const keys = buildKeys(projectId, preview ? 'jsg-preview' : 'jsg'); const key = keys?.key ?? null;
    const kept = readState(statePath);
    const outAbs = path.join(projectDirFor(projectId), PDF_OUT);
    if (key && kept?.inputKey === key && kept.pdfSig && kept.pdfSig === pdfSignature(outAbs)) {
      for (const w of kept.gateWarnings ?? []) log(`Note: ${w}`);
      log(`Done (up to date: nothing changed since the last ${preview ? 'preview' : 'build'})`, { done: true });
      return { pdf: outAbs, totalMs: 0, warnings: kept.warnings ?? [], releaseLabel: kept.releaseLabel ?? '', released: !!kept.released, warmFop: !!kept.warmFop, upToDate: true };
    }
    log(preview ? 'Quick preview: validating the JSG document against its schema...' : 'Validating the JSG document against its schema...');
    let gate;
    try { gate = await assertJsgPublishable(projectId); }
    catch (e) { log((e as Error).message, { error: true, done: true }); throw e; }
    for (const w of gate.warnings) log(`Note: ${w}`);

    const dir = projectDirFor(projectId);
    const project = readProjectJson(projectId);
    const sourceXml = readSource(projectId).xml;
    const classification = String(/<classification>([^<]*)<\/classification>/.exec(sourceXml)?.[1] ?? '').trim() || 'RESTRICTED';
    // WP-07 (DEP-011): an absolute location, as the S1000D and JSS builds pass theirs: xsltproc joins a relative one to the working folder as
    // a string, so a deep project folder plus the steps back out passed the 260-character limit of the 32-bit tool
    const stylesheet = forward(path.resolve(JSG_ENGINE_DIR, 'jsg.xsl'));
    const warnings: string[] = [];
    // the stencil's own pictures (emblem, supplier logo, first-aid figures): an absolute file URL, so a workspace on another drive than the installation still finds them
    const assetsUrl = pathToFileURL(path.join(JSG_ENGINE_DIR, 'assets')).href;

    // WP-15 (PUB-011): the release decides the watermark, as for the other two formats
    const state = releaseStateOf(projectId);
    // a Quick preview is a draft: it never claims the release, whatever the document's state
    const rendered = preview ? { ...state, released: false, staleRelease: false } : state;
    const releaseLabel = rendered.released ? `Release ${rendered.approved.release_number}` : '';
    let wm: { uri: string; repeat: string; text: string; style: string } | null = null;
    try {
      const w = project.watermark || {};
      wm = watermarkEngine.writeWatermark(dir, watermarkEngine.resolveWatermark({ settings: { enabled: !!w.enabled, text: w.text, style: w.style }, released: rendered.released }), JSG_BOX_MM);
      if (rendered.staleRelease) log(`Release ${rendered.approved.release_number} was approved for different content - this build is NOT RELEASED.`);
      if (wm) log(`Watermark: ${wm.text} (${wm.style})`);
    } catch (e) { console.error(`[jsg:${projectId}] watermark/release resolution failed:`, (e as Error).message); }
    const info = jsgPdfInfo(projectId, sourceXml);
    let warmFop = false;
    // WP-30 (QA-008, found by the chaos suite): FOP writes a temporary sibling, renamed to the PDF only when complete (commitFile): a server
    // killed mid-build never leaves a torn jsg-output.pdf
    const pdfTmp = tempNameFor(path.join(dir, PDF_OUT)); const pdfTmpName = path.basename(pdfTmp);

    try {
      const render = async (total?: number): Promise<void> => {
        log('Rendering XSL-FO (JSG engine)...');
        const params = ['--stringparam', 'classification', classification, '--stringparam', 'assets.url', assetsUrl, ...(total ? ['--stringparam', 'pages.total', String(total)] : [])];
        const x = await run(paths.XSLTPROC, ['--nonet', ...params, '-o', FO_OUT, stylesheet, SOURCE_NAME], dir);
        for (const l of x.stderr.split(/\r?\n/)) if (l.trim()) warnings.push(l.trim());
        gate.verifyUnchanged();                       // what is rendered is what was validated
        const foAbs = path.join(dir, FO_OUT);
        { const m = foGuard.formatConfine(foGuard.confineFo(foAbs, { baseDir: dir, roots: [JSG_ENGINE_DIR, path.join(workspaceDir, 'templates')] })); if (m) { log(`Security: ${m}`); warnings.push(m); } }   // WP-02 / SEC-003
        if (wm) markFo(foAbs, wm.uri, wm.repeat);
        try { injectPdfInfo(foAbs, info); } catch (e) { log(`PDF document properties not written: ${(e as Error).message}`); }
        log('Generating PDF (FOP)...');
        let used = false;
        if (fopd.isAvailable()) {
          try { await fopd.render({ baseDir: dir, foPath: foAbs, pdfPath: pdfTmp }); used = true; }
          catch (e) { log(`Warm FOP unavailable (${(e as Error).message}); running FOP via java`); }
        }
        if (!used) {
          const fopArgs: string[] = paths.FOP_ARGS.slice();
          const conf = fontConf.fopConf();
          if (conf) fopArgs.push('-c', conf);
          fopArgs.push('-fo', FO_OUT, '-pdf', pdfTmpName);
          await run(paths.JAVA, fopArgs, dir);
        }
        warmFop = used;
      };
      await render();
      // the certificate may say how many pages the book has ({total}): the first render counts them, the second prints the number. (Every other page number is a citation FOP resolves itself.)
      if (/\{total\}/.test(sourceXml)) {
        const counted = pdfPageCount(pdfTmp);
        if (counted) { log(`The certificate cites the page count: ${counted} pages. Rendering again...`); await render(counted); }
      }
    } catch (e) {
      discardTemp(pdfTmp);
      if (e instanceof HttpError) { log(e.message, { error: true, done: true }); throw e; }
      const message = `Build failed: ${why(e)}`;
      console.error(`[jsg:${projectId}] ${message}\n${(e as any)?.stderr ?? ''}`);
      log(message, { error: true, done: true });
      throw new HttpError(500, message, 'BUILD_FAILED', { details: String((e as any)?.stderr ?? '').slice(-4000) });
    }

    const abs = path.join(dir, PDF_OUT);
    if (!fs.existsSync(pdfTmp) || fs.statSync(pdfTmp).size === 0) { discardTemp(pdfTmp); throw new HttpError(500, 'Build failed: FOP wrote no PDF.', 'BUILD_FAILED'); }
    commitFile(pdfTmp, abs);
    // phase 7: the input key (taken before this build) and the PDF's signature, for the next build's "up to date" check
    const cacheFields = keys ? { inputKey: keys.record(), pdfSig: pdfSignature(abs), gateWarnings: gate.warnings, warnings, releaseLabel, warmFop } : {};
    if (!preview) try { fs.writeFileSync(path.join(dir, BUILD_STATE), JSON.stringify({ fingerprint: rendered.fingerprint, released: rendered.released, builtAt: new Date().toISOString(), ...cacheFields }), 'utf8'); } catch { /* the PDF is then reported as stale */ }
    else if (key) try { fs.writeFileSync(statePath, JSON.stringify({ released: false, ...cacheFields }), 'utf8'); } catch { /* the next preview renders */ }
    const totalMs = Date.now() - t0;
    log(`Done in ${(totalMs / 1000).toFixed(1)}s (${warmFop ? 'warm FOP' : 'FOP via java'})`, { done: true });
    if (!preview) broadcast(projectId, { type: 'reload', kind: 'pdf' } as any);
    return { pdf: abs, totalMs, warnings, releaseLabel, released: rendered.released, warmFop };
  });
}
