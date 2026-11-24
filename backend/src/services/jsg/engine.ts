// The JSG engine runner: <jsgdoc> -> XSL-FO (schemas/jsg/engine/jsg.xsl, xsltproc) -> PDF (Apache FOP).
//
// It shares NOTHING with the JSS or S1000D build code (services/publisher.ts, vendor/engine/build.js): it runs the two bundled programs directly and passes only
// JSG parameters. It only READS the toolchain locations (vendor/engine/paths.js) and the font configuration (vendor/engine/fontconf.js), which are
// format-neutral, and it changes neither.

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { pathToFileURL } from 'url';
import { vendor } from '../../config';
import { projectDirFor } from '../../context';
import { broadcast } from '../broadcast';
import { HttpError } from '../http';
import { readProjectJson } from '../projects';
import { assertJsgPublishable, JSG_ENGINE_DIR, SOURCE_NAME, readSource } from './service';

const paths = vendor('engine/paths');
const fontConf = vendor('engine/fontconf');

export const FO_NAME = 'jsg-output.fo';
export const PDF_NAME = 'jsg-output.pdf';

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
    execFile(file, args, { cwd, env, maxBuffer: 20 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
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

export interface JsgBuild { pdf: string; totalMs: number; pages?: number; warnings: string[] }

export function buildJsgPdf(projectId: string): Promise<JsgBuild> {
  return serial(`${projectId}:jsg`, async () => {
    const log = (message: string, extra: Record<string, unknown> = {}): void => { console.log(`[jsg:${projectId}] ${message}`); broadcast(projectId, { type: 'progress', message, ...extra } as any); };
    const t0 = Date.now();
    log('Validating the JSG document against its schema...');
    let gate;
    try { gate = await assertJsgPublishable(projectId); }
    catch (e) { log((e as Error).message, { error: true, done: true }); throw e; }
    for (const w of gate.warnings) log(`Note: ${w}`);

    const dir = projectDirFor(projectId);
    const project = readProjectJson(projectId);
    const classification = String(/<classification>([^<]*)<\/classification>/.exec(readSource(projectId).xml)?.[1] ?? '').trim() || 'RESTRICTED';
    const stylesheet = forward(path.relative(dir, path.join(JSG_ENGINE_DIR, 'jsg.xsl')));
    const warnings: string[] = [];
    // the stencil's own pictures (emblem, supplier logo, first-aid figures): an absolute file URL, so a workspace on another drive than the installation still finds them
    const assetsUrl = pathToFileURL(path.join(JSG_ENGINE_DIR, 'assets')).href;

    try {
      const sourceXml = readSource(projectId).xml;
      const render = async (total?: number): Promise<void> => {
        log('Rendering XSL-FO (JSG engine)...');
        const params = ['--stringparam', 'classification', classification, '--stringparam', 'assets.url', assetsUrl, ...(total ? ['--stringparam', 'pages.total', String(total)] : [])];
        const x = await run(paths.XSLTPROC, ['--nonet', ...params, '-o', FO_NAME, stylesheet, SOURCE_NAME], dir);
        for (const l of x.stderr.split(/\r?\n/)) if (l.trim()) warnings.push(l.trim());
        gate.verifyUnchanged();                       // what is rendered is what was validated
        log('Generating PDF (FOP)...');
        const fopArgs: string[] = paths.FOP_ARGS.slice();
        const conf = fontConf.fopConf();
        if (conf) fopArgs.push('-c', conf);
        fopArgs.push('-fo', FO_NAME, '-pdf', PDF_NAME);
        await run(paths.JAVA, fopArgs, dir);
      };
      await render();
      // the certificate may say how many pages the book has ({total}): the first render counts them, the second prints the number. (Every other page number is a citation FOP resolves itself.)
      if (/\{total\}/.test(sourceXml)) {
        const counted = pdfPageCount(path.join(dir, PDF_NAME));
        if (counted) { log(`The certificate cites the page count: ${counted} pages. Rendering again...`); await render(counted); }
      }
    } catch (e) {
      if (e instanceof HttpError) { log(e.message, { error: true, done: true }); throw e; }
      const message = `Build failed: ${why(e)}`;
      console.error(`[jsg:${projectId}] ${message}\n${(e as any)?.stderr ?? ''}`);
      log(message, { error: true, done: true });
      throw new HttpError(500, message, 'BUILD_FAILED', { details: String((e as any)?.stderr ?? '').slice(-4000) });
    }

    const abs = path.join(dir, PDF_NAME);
    if (!fs.existsSync(abs) || fs.statSync(abs).size === 0) throw new HttpError(500, 'Build failed: FOP wrote no PDF.', 'BUILD_FAILED');
    const totalMs = Date.now() - t0;
    log(`Done in ${(totalMs / 1000).toFixed(1)}s`, { done: true });
    broadcast(projectId, { type: 'reload', kind: 'pdf' } as any);
    void project;
    return { pdf: abs, totalMs, warnings };
  });
}
