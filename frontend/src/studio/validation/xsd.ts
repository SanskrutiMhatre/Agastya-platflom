/**
 * XSD validation with libxml2 (xmllint compiled to WebAssembly).
 * In the browser it runs in a dedicated Web Worker (public/vendor/xmllint);
 * in Node (tests) the xmllint-wasm Node entry is injected as the runner.
 */
import type { ValidationIssue } from './types';

export interface XmllintFile { fileName: string; contents: string }
export interface XmllintRun { inputFiles: XmllintFile[]; args: string[]; initialMemory: number; maxMemory: number }
export interface XmllintOut { exitCode: number; stdout: string; stderr: string }
export type XmllintRunner = (run: XmllintRun) => Promise<XmllintOut>;
export type SchemaLoader = (issue: string, file: string) => Promise<string | null>;

const SUPPORT_FILES = ['xlink.xsd', 'rdf.xsd', 'dc.xsd', 'xml.xsd'];

/**
 * S1000D modules declare their special-character entities from the publisher's website
 * (<!ENTITY % ISOEntities PUBLIC "..." "http://www.s1000d.org/.../ISOEntities">). The checker is offline
 * (--nonet), so that fetch failed and every module with the declaration got a warning (and any &deg;-style
 * entity was undefined). The same files ship with the app; the URL is pointed at the local copy. Only
 * the URL text changes, so line numbers in the messages stay the same.
 */
const ISO_ENTITY_URL = /("|')https?:\/\/[^"'\s]*\/ISOEntities\1/;
const ISO_ENTITY_FILES = ['ISOEntities', 'iso-amsa.ent', 'iso-amsb.ent', 'iso-amsc.ent', 'iso-amsn.ent', 'iso-amso.ent', 'iso-amsr.ent', 'iso-box.ent',
  'iso-cyr1.ent', 'iso-cyr2.ent', 'iso-dia.ent', 'iso-grk1.ent', 'iso-grk2.ent', 'iso-grk3.ent', 'iso-grk4.ent', 'iso-lat1.ent', 'iso-lat2.ent',
  'iso-num.ent', 'iso-pub.ent', 'iso-tech.ent'];
const textCache = new Map<string, Promise<string | null>>();

export function browserSchemaLoader(base = '/schemas'): SchemaLoader {
  return (issue, file) => {
    const key = `${base}/${issue}/${file}`;
    let p = textCache.get(key);
    if (!p) {
      p = fetch(key).then((r) => (r.ok ? r.text() : null)).catch(() => null);
      textCache.set(key, p);
    }
    return p;
  };
}

export function browserRunner(workerUrl = '/vendor/xmllint/xmllint-browser.mjs'): XmllintRunner {
  return (run) =>
    new Promise((resolve, reject) => {
      const worker = new Worker(new URL(workerUrl, document.baseURI), { type: 'module' });
      const timer = setTimeout(() => {
        worker.terminate();
        reject(new Error('XSD validation timed out'));
      }, 120000);
      worker.addEventListener('message', (ev: MessageEvent) => {
        const d = ev.data;
        if (!d || d['xmllint-wasm'] !== true) return;
        clearTimeout(timer);
        worker.terminate();
        resolve({ exitCode: d.exitCode, stdout: d.stdout ?? '', stderr: d.stderr ?? '' });
      });
      worker.addEventListener('error', (e) => {
        clearTimeout(timer);
        worker.terminate();
        reject(new Error(e.message || 'XSD validator failed to start'));
      });
      worker.postMessage({ ...run, 'xmllint-wasm': true });
    });
}

/** Cleans libxml2 messages: "f.xml:12: element para: Schemas validity error : Element 'para': ..." */
export function parseXmllintOutput(stderr: string, docName: string): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const raw of stderr.split('\n')) {
    const lineText = raw.trim();
    if (!lineText || lineText.endsWith(' validates') || lineText.endsWith('fails to validate')) continue;
    const m = lineText.match(/^([^:]+):(\d+):\s*(.*)$/);
    if (m && m[1] === docName) {
      let msg = m[3];
      // only libxml2's own severity label counts: an element called <warning> must not turn an error into a warning
      const sev: ValidationIssue['severity'] = /\b(?:validity|parser|namespace|Schemas parser)\s+warning\s*:/i.test(msg) ? 'warning' : 'error';
      msg = msg.replace(/^element [^:]+:\s*/, '').replace(/^(Schemas validity|parser) (error|warning)\s*:\s*/i, '');
      out.push({ severity: sev, source: 'xsd', message: msg, line: parseInt(m[2], 10) });
    } else if (m) {
      // schema-file diagnostics
      out.push({ severity: 'warning', source: 'xsd', message: `${m[1]}:${m[2]}: ${m[3]}` });
    } else if (!/^\s*\^/.test(lineText) && !/^\s*$/.test(lineText)) {
      // continuation lines (context) are attached to the previous message
      const prev = out[out.length - 1];
      if (prev && !prev.detail) prev.detail = lineText;
      else if (!prev) out.push({ severity: 'error', source: 'xsd', message: lineText });
    }
  }
  return out;
}

export interface XsdResult {
  valid: boolean;
  issues: ValidationIssue[];
  ms: number;
}

export async function validateXsd(xmlText: string, issue: string, schema: string, load: SchemaLoader, run: XmllintRunner): Promise<XsdResult> {
  const t0 = performance.now();
  const main = await load(issue, schema + '.xsd');
  if (!main) throw new Error(`Schema ${schema}.xsd is not available for S1000D issue ${issue}`);
  const support: XmllintFile[] = [];
  for (const f of SUPPORT_FILES) {
    const c = await load(issue, f);
    if (c) support.push({ fileName: f, contents: c });
  }
  const docName = 'document.xml';
  // Entity declarations live in the prolog; look only there.
  const head = xmlText.slice(0, 20000);
  if (ISO_ENTITY_URL.test(head)) {
    const ents: XmllintFile[] = [];
    for (const f of ISO_ENTITY_FILES) {
      const c = await load('ent', f);
      if (c) ents.push({ fileName: f, contents: c });
    }
    // every file must be there, otherwise leave the document alone (the original message is then the truth)
    if (ents.length === ISO_ENTITY_FILES.length) {
      xmlText = head.replace(ISO_ENTITY_URL, '"ISOEntities"') + xmlText.slice(20000);
      support.push(...ents);
    }
  }
  const res = await run({
    inputFiles: [{ fileName: docName, contents: xmlText }, { fileName: schema + '.xsd', contents: main }, ...support],
    args: ['--schema', schema + '.xsd', '--noout', '--nonet', docName],
    initialMemory: 512,
    maxMemory: 16384,
  });
  const issues = parseXmllintOutput(res.stderr, docName);
  if (res.exitCode !== 0 && res.exitCode !== 3 && res.exitCode !== 4 && !issues.length) {
    throw new Error(res.stderr || `xmllint exited with code ${res.exitCode}`);
  }
  return { valid: res.exitCode === 0, issues, ms: performance.now() - t0 };
}
