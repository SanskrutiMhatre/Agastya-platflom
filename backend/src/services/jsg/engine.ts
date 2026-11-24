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
      log('Rendering XSL-FO (JSG engine)...');
      const x = await run(paths.XSLTPROC, ['--nonet', '--stringparam', 'classification', classification, '--stringparam', 'assets.url', assetsUrl, '-o', FO_NAME, stylesheet, SOURCE_NAME], dir);
      for (const l of x.stderr.split(/\r?\n/)) if (l.trim()) warnings.push(l.trim());

      gate.verifyUnchanged();                       // what is rendered is what was validated

      log('Generating PDF (FOP)...');
      const fopArgs: string[] = paths.FOP_ARGS.slice();
      const conf = fontConf.fopConf();
      if (conf) fopArgs.push('-c', conf);
      fopArgs.push('-fo', FO_NAME, '-pdf', PDF_NAME);
      await run(paths.JAVA, fopArgs, dir);
    } catch (e) {
      if (e instanceof HttpError) { log(e.message, { error: true, done: true }); throw e; }
      const message = `Build failed: ${why(e)}`;
      console.error(`[jsg:${projectId}] ${message}\n${(e as any)?.stderr ?? ''}`);
      log(message, { error: true, done: true });
      throw new HttpError(500, message, 'BUILD_FAILED', { details: String((e as any)?.stderr ?? '').slice(0, 4000) });
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
