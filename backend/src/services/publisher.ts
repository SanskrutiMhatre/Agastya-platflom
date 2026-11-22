// =============================================================================
// Publisher - drives the vendored JSS engine to produce the PDF.
//
// Adapted from Agastya V1's Publisher.ts, brought up to the newer engine:
// releases and watermarks are decided here, once, so a full build and a quick
// preview can never disagree about what is released (an unreleased publication
// is stamped NOT RELEASED whatever the project's own watermark setting says).
//
// Builds are serialised per project - the engine writes fixed output filenames,
// so two builds of one project would overwrite each other's PDF mid-view.
// =============================================================================

import { furnitureParams as defaultFurnitureParams, publisherLogoParams, mergeParams } from './sideText';
import fs from 'fs';
import path from 'path';
import { config, vendor } from '../config';
import { projectDirFor, workspaceDir } from '../context';
import { broadcast } from './broadcast';
import { HttpError, bad } from './http';
import { readProjectJson } from './projects';
import { printableBoxMm, releaseStateOf } from './release';

const engineBuild = vendor('engine/build');
const engineConfig = vendor('engine/config');
const fopd = vendor('engine/fopd');
const paths = vendor('engine/paths');
const watermarkEngine = vendor('engine/watermark');
const { explainBuildFailure } = vendor('engine/buildErrors');
const { resolveDmRefs, repairIncludePaths, guardMissingIncludes } = vendor('engine/resolveDmRefs');
import { rewriteRevisionRefs } from './lifecycle';
const { generateFrontMatter } = vendor('engine/frontmatter');
const { injectJssFrontMatter } = vendor('engine/frontmatterInject');
const brandEngine = vendor('engine/brand');

import { assertPublishable, type GatePass } from './publishGate';
import { buildSelection, planConfiguration, assertResolved, type ConfigInput } from './applicEval';
import { readSidecar } from './jssdm/sidecar';
import { dropConsumedModules } from './jssdm/prune';
import { unwrapChapterFolders } from './jssdm/unwrap';

export const PDF_NAME = 'jss-output.pdf';
export const PREVIEW_NAME = 'jss-preview.pdf';

export function startRenderer(): void {
  try { fopd.start(); fopd.warmup(); }
  catch (e) { console.warn('[publisher] warm FOP renderer unavailable:', (e as Error).message); }
}
export function stopRenderer(): void { try { fopd.stop(); } catch { /* nothing to stop */ } }
export const rendererStatus = () => ({ warm: !!fopd.isAvailable(), java: paths.JAVA, bundledJre: !!paths.hasBundledJre });

// ── Serialisation ─────────────────────────────────────────────────────────

const inFlight = new Map<string, Promise<unknown>>();
function serial<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = inFlight.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  inFlight.set(key, next);
  const clear = () => { if (inFlight.get(key) === next) inFlight.delete(key); };
  next.then(clear, clear);
  return next;
}

// ── Config ────────────────────────────────────────────────────────────────

export function effectiveConfig(projectId: string): { project: any; effective: any } {
  const project = engineConfig.loadProject(path.join(projectDirFor(projectId), 'project.json'));
  const templatesDir = path.join(workspaceDir, 'templates');
  // An EMPTY publisher list means "not set", not "no publishers" - the merge
  // picks `project.publishers || house.branding.publishers`, and [] is truthy,
  // which wipes the house list and leaves a table row with zero cells that FOP
  // rejects. Deleting the key restores the intended fallback.
  if (Array.isArray(project.publishers) && project.publishers.length === 0) delete project.publishers;
  let house: any = {};
  try { house = engineConfig.loadHouse(templatesDir, project.templateRef || 'default'); }
  catch { console.warn(`[publisher] house template "${project.templateRef}" not found; using stylesheet defaults`); }
  return { project, effective: engineConfig.mergeConfig(house, project) };
}

const relFromProject = (projectId: string, abs: string, from: string = projectDirFor(projectId)): string =>
  path.relative(from, abs).replace(/\\/g, '/');

// ── Input preparation ─────────────────────────────────────────────────────

function injectDirectFrontMatter(projectId: string, pmText: string, effective: any, log: (m: string) => void, dir: string = projectDirFor(projectId)) {
  const fmRel = 's1000d/frontmatter';
  const fmAbs = path.join(dir, fmRel);
  try {
    fs.mkdirSync(fmAbs, { recursive: true });
    const statics = path.join(config.pipelineDir, 'jss', 'frontmatter');
    if (fs.existsSync(statics)) {
      for (const f of fs.readdirSync(statics)) {
        const dest = path.join(fmAbs, f);
        if (!fs.existsSync(dest)) fs.copyFileSync(path.join(statics, f), dest);
      }
    }
    const settings = effective.s1000dFrontMatter && Object.keys(effective.s1000dFrontMatter).length ? effective.s1000dFrontMatter : effective.frontMatter;
    const generated = generateFrontMatter(settings, fmAbs);
    if (generated.kept?.length) log(`Kept your edits to ${generated.kept.join(', ')} - these no longer follow Settings (delete the file to restore the generated version)`);
    const available = fs.readdirSync(fmAbs).filter((f) => /\.xml$/i.test(f));
    const r = injectJssFrontMatter(pmText, effective, available, fmRel);
    if (r.injected > 0) log(`Added ${r.injected} front-matter page${r.injected === 1 ? '' : 's'} from settings`);
    const artwork = [effective.branding?.emblem, ...((effective.branding?.publishers ?? []).map((p: any) => p.logo))].filter(Boolean) as string[];
    const absent = artwork.filter((rel) => !fs.existsSync(path.join(dir, rel)));
    if (absent.length) log(`Front-matter artwork missing from the project: ${absent.join(', ')} - upload it under Settings > Branding`);
    return r;
  } catch (e) {
    log(`Front matter skipped: ${(e as Error).message}`);
    return { text: pmText, injected: 0 };
  }
}

function prepareInput(projectId: string, project: any, effective: any, useDirect: boolean, log: (m: string) => void, dir: string = projectDirFor(projectId)) {
  const pm = project.input?.pm || 'publication.xml';
  const pmAbs = path.join(dir, pm);
  if (!fs.existsSync(pmAbs)) throw bad(`Publication module not found: ${pm}`, 'NO_PM');
  const original = fs.readFileSync(pmAbs, 'utf8');
  const isS1000D = !/<\s*jssbook[\s>]/.test(original);
  if (!isS1000D) return { input: pm, isS1000D };

  const csdbRelDir = project.input?.csdbDir || 'csdb';
  // modules with several revision files: pinned references -> that revision, unpinned -> the highest (services/lifecycle.ts)
  const rev = rewriteRevisionRefs(projectId, original, csdbRelDir);
  for (const n of rev.notes) log(n);
  const step1 = resolveDmRefs(rev.text, path.join(dir, csdbRelDir), csdbRelDir);
  if (rev.rewritten) step1.resolved += rev.rewritten;
  // Order matters: repair BEFORE guarding, or includes get fallback-guarded and dropped before they can be repaired.
  // Front-matter modules the front-matter import has read into Settings print as the JSS engine's own pages: not a second time as body.
  // Only the JSS pipeline: the direct S1000D engine under the Xignal profile prints the title-page module itself as page 1.
  const pruned = useDirect ? { text: step1.text, removed: 0, entriesDropped: 0 } : dropConsumedModules(step1.text, Object.keys(readSidecar(dir).consumed));
  if (pruned.removed > 0) log(`Left out ${pruned.removed} front-matter module${pruned.removed === 1 ? '' : 's'} already read into Settings (printed as front-matter pages, not as body)`);
  // Xignal wraps its chapters in a publication-titled entry and a "Chapter" folder; the JSS engine makes a chapter of every top-level entry, so
  // the real chapters are lifted to the top (and numbered by their folder names, "1" and "3" being chapters 1 and 3).
  const lifted = useDirect ? { text: pruned.text, unwrapped: false, chapters: 0, numbered: false } : unwrapChapterFolders(pruned.text);
  if (lifted.unwrapped) log(`Lifted ${lifted.chapters} chapter${lifted.chapters === 1 ? '' : 's'} out of the wrapper entries (Xignal's "Chapter" folder)${lifted.numbered ? ', numbered by their folder names' : ''}`);
  const step1b = repairIncludePaths(lifted.text, dir, csdbRelDir);
  const step2 = guardMissingIncludes(step1b.text, dir);
  const step3 = useDirect ? injectDirectFrontMatter(projectId, step2.text, effective, log, dir) : { text: step2.text, injected: 0 };

  if (step1.unresolved?.length) {
    const named = step1.unresolved.slice(0, 6).map((u: any) => (u.title ? `${u.title} (${u.code})` : u.code)).join(', ');
    log(`${step1.unresolved.length} publication entr${step1.unresolved.length === 1 ? 'y refers' : 'ies refer'} to data modules this project does not have - nothing was published for ${step1.unresolved.length === 1 ? 'it' : 'them'}: ${named}${step1.unresolved.length > 6 ? ', and more' : ''}`);
  }
  if (step1.resolved === 0 && step1b.repaired === 0 && step2.missing === 0 && step3.injected === 0 && pruned.removed === 0 && !lifted.unwrapped) return { input: pm, isS1000D };

  const derived = '_resolved-pm.xml';
  fs.writeFileSync(path.join(dir, derived), step3.text, 'utf8');
  if (step1.resolved > 0) log(`Resolved ${step1.resolved} dmRef ${step1.resolved === 1 ? 'entry' : 'entries'} to xi:include`);
  if (step1b.repaired > 0) log(`Repointed ${step1b.repaired} reference${step1b.repaired === 1 ? '' : 's'} to ${csdbRelDir}/`);
  if (step2.missing > 0) log(`${step2.missing} referenced data module${step2.missing === 1 ? '' : 's'} missing from disk - skipped`);
  return { input: derived, isS1000D };
}

/**
 * Write the project's generated front-matter pages exactly as a build would.
 *
 * A release is approved for a content fingerprint, and the fingerprint covers the front-matter files. A build
 * regenerates those files, so a manual approved BEFORE its first build would lose its approval the moment the
 * first PDF was made (the files change under the fingerprint). Submitting for review calls this first, so the
 * fingerprint that gets approved is already the one every later build reproduces.
 */
export function syncFrontMatter(projectId: string): void {
  try {
    const { project, effective } = effectiveConfig(projectId);
    const dir = projectDirFor(projectId);
    if (project.pipeline === 's1000dtofo') {
      const pmAbs = path.join(dir, project.input?.pm || 'publication.xml');
      injectDirectFrontMatter(projectId, fs.existsSync(pmAbs) ? fs.readFileSync(pmAbs, 'utf8') : '', effective, () => undefined);
    } else {
      const fmDir = path.join(dir, 'jss', 'frontmatter');
      fs.mkdirSync(fmDir, { recursive: true });
      generateFrontMatter(effective.frontMatter, fmDir, 's1000dtojss');
    }
  } catch (e) { console.error('[publisher] front matter not synced before review:', (e as Error).message); }
}

/**
 * The wording and artwork of the page furniture (header logo, margin marks), resolved once per build.
 *
 * Only the "xignal" layout profile uses them, so every other project is untouched. Nothing here can stop a
 * build: a missing logo or company line is logged and left out (see engine/brand.js for the precedence).
 */
function brandFurnitureParams(project: any, effective: any, dir: string, log: (m: string) => void, released?: boolean): Array<[string, string]> {
  if (effective.layout?.profile !== 'xignal') return [];
  try {
    const pmAbs = path.join(dir, project.input?.pm || 'publication.xml');
    const pmText = fs.existsSync(pmAbs) ? fs.readFileSync(pmAbs, 'utf8') : '';
    const brand = effective.brandPack ? brandEngine.loadBrandPack(path.join(workspaceDir, 'templates'), effective.brandPack) : null;
    if (effective.brandPack && !brand) log(`Brand pack "${effective.brandPack}" not found - building without its logo and company line`);
    const r = brandEngine.resolveMarkings({ layout: effective.layout, pmText, brand, now: new Date(), released });
    if (r.logo?.from) {
      const dest = path.join(dir, r.logo.rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(r.logo.from, dest);
    }
    for (const n of r.notes) log(n);
    return r.params;
  } catch (e) {
    log(`Page furniture wording skipped: ${(e as Error).message}`);
    return [];
  }
}

/**
 * The page furniture (margin marks, header logo and publication code) the direct S1000D engine is given, chosen ONCE per build:
 *   - the "xignal" profile prints its own, measured on the reference publication and driven by the brand pack (brandFurnitureParams), appended to the project's parameters;
 *   - every other S1000D project gets the platform's default side text and header logo (sideText.ts), which only fill what the project's own parameters leave empty.
 * Never both: two mechanisms that both draw the rotated margin text and the logo would print every mark twice.
 */
function furnitureFor(projectId: string, project: any, effective: any, released: boolean, dir: string, base: Array<[string, string]>, log: (m: string) => void): Array<[string, string]> {
  if (effective.layout?.profile === 'xignal') return [...base, ...brandFurnitureParams(project, effective, dir, log, released), ...publisherLogoParams(projectId, dir)];
  return mergeParams(base, defaultFurnitureParams(projectId, { released, dir }));
}

/** Release state decides the watermark, not the other way round. */
function resolveMarks(projectId: string, effective: any, pipeline: string, log: (m: string) => void, opts: { derived?: boolean; dir?: string } = {}) {
  let wm: { uri: string; repeat: string; text: string; style: string } | null = null;
  let releaseLabel = '';
  try {
    // A configuration-specific PDF is DERIVED from the approved sources by filtering: the approval does not cover it, so it never claims a release.
    const st = opts.derived ? { released: false, staleRelease: false, approved: null as any } : releaseStateOf(projectId);
    if (st.released) releaseLabel = `Release ${st.approved.release_number}`;
    const project = readProjectJson(projectId);
    const w = project.watermark || {};
    wm = watermarkEngine.writeWatermark(
      opts.dir ?? projectDirFor(projectId),
      watermarkEngine.resolveWatermark({ settings: { enabled: !!w.enabled, text: w.text, style: w.style }, released: st.released }),
      printableBoxMm(effective, pipeline),
    );
    if (st.staleRelease) log(`Release ${st.approved.release_number} was approved for different content - this build is NOT RELEASED.`);
    if (wm) log(`Watermark: ${wm.text} (${wm.style})`);
  } catch (e) { console.error('[publisher] watermark/release resolution failed:', (e as Error).message); }
  return { wm, releaseLabel };
}

// ── Builds ────────────────────────────────────────────────────────────────

export interface BuildResult { pdf: string; totalMs?: number; releaseLabel: string }

function failure(projectId: string, err: any): never {
  const why = explainBuildFailure(err, { workDir: projectDirFor(projectId) });
  console.error('[publisher] build failed:', why.summary, '\n', why.raw);
  broadcast(projectId, { type: 'progress', message: 'Build failed: ' + why.summary, error: true, done: true, file: why.file, line: why.line, hint: why.hint });
  throw new HttpError(500, 'Build failed: ' + why.summary, 'BUILD_FAILED', { hint: why.hint, file: why.file, line: why.line, details: why.raw });
}

/**
 * What the last full build said about itself. A PDF built before an approval carries NOT RELEASED; the
 * download uses this to know whether the file on disk still matches the project's release state.
 */
const BUILD_STATE = '.publish-state.json';
export interface BuildState { fingerprint: string; released: boolean }
function writeBuildState(projectId: string, st: BuildState): void {
  try { fs.writeFileSync(path.join(projectDirFor(projectId), BUILD_STATE), JSON.stringify(st), 'utf8'); } catch { /* the next download simply rebuilds */ }
}
export function lastBuildState(projectId: string): BuildState | null {
  try { return JSON.parse(fs.readFileSync(path.join(projectDirFor(projectId), BUILD_STATE), 'utf8')); } catch { return null; }
}

export function buildPublication(projectId: string, opts: { compression?: number; allowRuleBreaks?: boolean } = {}): Promise<BuildResult> {
  return serial(`${projectId}:full`, async () => {
    const log = (m: string) => { console.log(`[build:${projectId}] ${m}`); broadcast(projectId, { type: 'progress', message: m }); };
    // A PDF is only built from modules that have JUST been checked against their schema (a draft that does not match blocks it).
    log('Validating the publication against the S1000D schemas...');
    let gate;
    // `waivable`: a draft build may stand on a recorded waiver for a BREX the project lacks; a build of a released publication never does.
    try { gate = await assertPublishable(projectId, 'publication', { allowRuleBreaks: opts.allowRuleBreaks, waivable: !releaseStateOf(projectId).released }); }
    catch (e) { broadcast(projectId, { type: 'progress', message: (e as Error).message, error: true, done: true }); throw e; }
    for (const w of gate.warnings) log(`Note: ${w}`);              // what the gate let through: a recorded waiver, a BREX rule this engine cannot run
    if (gate.ruleBreaks.length) log(`Building anyway: ${gate.ruleBreaks.length} business rule break${gate.ruleBreaks.length === 1 ? '' : 's'} not fixed.`);
    const built = await renderFull(projectId, gate, log, opts);
    return Object.assign(built, { ruleBreaks: gate.ruleBreaks });
  });
}

/**
 * Render the publication from `workDir` (default: the project itself). A configuration-specific build passes a work directory that holds the
 * FILTERED copies of the publication module and data modules; everything else about the build is the same code path as the unfiltered one.
 */
async function renderFull(projectId: string, gate: GatePass, log: (m: string) => void, opts: { compression?: number; workDir?: string } = {}): Promise<BuildResult> {
  {
    const dir = opts.workDir ?? projectDirFor(projectId);
    const { project, effective } = effectiveConfig(projectId);
    const pm = project.input?.pm || 'publication.xml';
    const pmAbs = path.join(dir, pm);
    const isS1000D = fs.existsSync(pmAbs) && !/<\s*jssbook[\s>]/.test(fs.readFileSync(pmAbs, 'utf8'));
    const useDirect = project.pipeline === 's1000dtofo' && isS1000D;
    log(useDirect ? 'Engine: direct S1000D -> FO' : 'Engine: S1000D -> JSS book -> FO');

    const renderedState = releaseStateOf(projectId);          // what this PDF will claim: released or NOT RELEASED, for which content
    const { wm, releaseLabel } = resolveMarks(projectId, effective, project.pipeline, log, { derived: !!opts.workDir, dir });
    const { input, isS1000D: s1000d } = prepareInput(projectId, project, effective, useDirect, log, dir);
    const compression = opts.compression ?? Number(project.output?.compression ?? 0);
    const classification = effective.publication?.securityClassification ?? '';
    gate.verifyUnchanged();                       // what is rendered is what was validated

    const common = {
      workDir: dir, xsltproc: paths.XSLTPROC, fop: paths.FOP_BAT, inputXml: input,
      foOut: 'jss-output.fo', pdfOut: PDF_NAME, classification,
      // Code No. / Rev No. belong to the JSS book's cover; the direct S1000D engine never prints them.
      layoutParams: useDirect
        ? furnitureFor(projectId, project, effective, !!releaseLabel, dir, engineConfig.stage2Params(effective).filter(([n]: [string, string]) => !/^cover\.(codeNo|revNo)$/.test(n)), log)
        : engineConfig.stage2Params(effective), compression,
      pdfCompressLevel: Number(project.output?.pdfCompressLevel ?? 0),
      watermarkUri: wm ? wm.uri : undefined, watermarkRepeat: wm ? wm.repeat : undefined, releaseLabel,
      onMessage: log,
    };
    try {
      const result = useDirect
        ? await engineBuild.buildS1000dToFo({ ...common,
            stylesheetXsl: relFromProject(projectId, path.join(config.pipelineDir, 's1000dtofo', 's1000dtofo.xsl'), dir),
            csdbDir: project.input?.csdbDir || 'csdb', mediaDir: project.input?.mediaDir || 'Media' })
        : await engineBuild.buildJss({ ...common,
            stage1Xsl: relFromProject(projectId, path.join(config.pipelineDir, 's1000dtojss', 's1000dtojss.xsl'), dir),
            stage2Xsl: relFromProject(projectId, path.join(config.pipelineDir, 'jsstofo', 'jsstofo.xsl'), dir),
            stage1Out: 'jss-book.xml', isS1000D: s1000d,
            stage1Params: engineConfig.stage1Params(effective),
            frontMatter: effective.frontMatter, branding: effective.branding,
            systemImage: effective.frontMatter?.systemImage ?? '' });
      if (!opts.workDir) writeBuildState(projectId, { fingerprint: renderedState.fingerprint, released: renderedState.released });
      broadcast(projectId, { type: 'progress', message: result?.totalMs != null ? `Done in ${(result.totalMs / 1000).toFixed(1)}s` : 'Done', done: true });
      if (!opts.workDir) broadcast(projectId, { type: 'reload', kind: 'pdf' });
      return { pdf: path.join(dir, PDF_NAME), totalMs: result?.totalMs, releaseLabel };
    } catch (e) { return failure(projectId, e); }
  }
}

const minimalPm = (href: string, cls: string): string => `<?xml version="1.0"?>
<pm xmlns:xi="http://www.w3.org/2001/XInclude">
  <identAndStatusSection>
    <pmAddress>
      <pmIdent>
        <pmCode modelIdentCode="PREVIEW" pmIssuer="00000" pmNumber="00000" pmVolume="00"/>
        <language countryIsoCode="IN" languageIsoCode="en"/>
        <issueInfo issueNumber="001" inWork="00"/>
      </pmIdent>
      <pmAddressItems>
        <issueDate year="2000" month="01" day="01"/>
        <pmTitle>Preview</pmTitle>
      </pmAddressItems>
    </pmAddress>
    <pmStatus>
      <security securityClassification="${cls}"/>
      <responsiblePartnerCompany enterpriseCode="00000"/>
    </pmStatus>
  </identAndStatusSection>
  <content>
    <pmEntry>
      <xi:include href="${href}"/>
    </pmEntry>
  </content>
</pm>`;

/** Server-rendered preview of ONE data module, through the SAME engine the publication uses (no front matter). */
export function buildPreview(projectId: string, dmFile: string): Promise<BuildResult> {
  return serial(`${projectId}:preview`, async () => {
    const log = (m: string) => broadcast(projectId, { type: 'progress', message: m, preview: true });
    const gate = await assertPublishable(projectId, { file: dmFile }, { waivable: !releaseStateOf(projectId).released });   // the server renders only a module that is valid right now
    for (const w of gate.warnings) log(`Note: ${w}`);
    const dir = projectDirFor(projectId);
    const { project, effective } = effectiveConfig(projectId);
    const csdbRelDir = project.input?.csdbDir || 'csdb';
    const classification = effective.publication?.securityClassification ?? '';
    const cls = /^\d{2}$/.test(classification) ? classification : '01';
    const href = `${csdbRelDir}/${dmFile}`;
    if (!fs.existsSync(path.join(dir, href))) throw bad('No such data module.', 'NO_DM');

    fs.writeFileSync(path.join(dir, '_preview-pm.xml'), minimalPm(href, cls), 'utf8');
    // An explicit empty page order suppresses the eleven pages of front matter the JSS stage would otherwise add.
    fs.writeFileSync(path.join(dir, '_preview-order.xml'), '<?xml version="1.0"?>\n<pages/>\n', 'utf8');
    const { wm, releaseLabel } = resolveMarks(projectId, effective, project.pipeline, log);

    gate.verifyUnchanged();
    const common = {
      workDir: dir, xsltproc: paths.XSLTPROC, fop: paths.FOP_BAT, inputXml: '_preview-pm.xml',
      foOut: 'jss-preview.fo', pdfOut: PREVIEW_NAME, classification: cls,
      layoutParams: project.pipeline === 's1000dtofo'
        ? furnitureFor(projectId, project, effective, !!releaseLabel, dir, engineConfig.stage2Params(effective), () => undefined)
        : engineConfig.stage2Params(effective), compression: 0,
      watermarkUri: wm ? wm.uri : undefined, watermarkRepeat: wm ? wm.repeat : undefined, releaseLabel,
      onMessage: () => undefined,
    };
    try {
      const result = project.pipeline === 's1000dtofo'
        ? await engineBuild.buildS1000dToFo({ ...common,
            stylesheetXsl: relFromProject(projectId, path.join(config.pipelineDir, 's1000dtofo', 's1000dtofo.xsl')),
            csdbDir: csdbRelDir, mediaDir: project.input?.mediaDir || 'Media' })
        : await engineBuild.buildJss({ ...common,
            stage1Xsl: relFromProject(projectId, path.join(config.pipelineDir, 's1000dtojss', 's1000dtojss.xsl')),
            stage2Xsl: relFromProject(projectId, path.join(config.pipelineDir, 'jsstofo', 'jsstofo.xsl')),
            stage1Out: '_preview-book.xml', isS1000D: true,
            stage1Params: [...engineConfig.stage1Params(effective), ['frontmatter.order', '_preview-order.xml']] });
      return { pdf: path.join(dir, PREVIEW_NAME), totalMs: result?.totalMs, releaseLabel };
    } catch (e) { return failure(projectId, e); }
  });
}

// ── Configuration-specific publication ────────────────────────────────────

export const CONFIG_DIR = 'configurations';
export interface ConfiguredBuildResult extends BuildResult { name: string; file: string; plan: ConfiguredSummary }
export interface ConfiguredSummary { label: string; productId: string | null; values: Array<{ ident: string; value: string }>; included: number; excluded: string[]; elementsRemoved: number; entriesRemoved: number }

/** "MIC-ISSUER-NUMBER-VOL" of the publication module, or the project name. */
function pmCodeOf(pmXml: string, fallback: string): string {
  const m = /<pmCode\b([^>]*)\/?>/.exec(pmXml);
  if (!m) return fallback;
  const a = (k: string) => new RegExp(`${k}\\s*=\\s*"([^"]*)"`).exec(m[1])?.[1] ?? '';
  return [a('modelIdentCode'), a('pmIssuer'), a('pmNumber'), a('pmVolume')].filter(Boolean).join('-') || fallback;
}

/**
 * Build a PDF of the publication for ONE configuration (a PCT product and/or ad-hoc values). The unfiltered publication is untouched: this works in
 * `.configured/<name>/`, filters copies, renders them through the same pipeline, and stores the PDF as `configurations/<PM code>_<name>.pdf`.
 *   - the source is validated first (XSD, BREX, applicability references), exactly as for a normal build;
 *   - a configuration that leaves a deciding property without a value is refused, listing every place (APPLICABILITY_UNRESOLVED).
 */
export function buildConfiguredPublication(projectId: string, input: ConfigInput): Promise<ConfiguredBuildResult> {
  return serial(`${projectId}:configured`, async () => {
    const log = (m: string) => { console.log(`[configured:${projectId}] ${m}`); broadcast(projectId, { type: 'progress', message: m }); };
    log('Validating the publication against the S1000D schemas, business rules and applicability...');
    let gate: GatePass;
    // a configuration PDF is derived and always NOT RELEASED, so it is a draft build: a recorded waiver may stand in for a BREX the project lacks
    try { gate = await assertPublishable(projectId, 'publication', { waivable: true }); }
    catch (e) { broadcast(projectId, { type: 'progress', message: (e as Error).message, error: true, done: true }); throw e; }
    for (const w of gate.warnings) log(`Note: ${w}`);
    const dir = projectDirFor(projectId);
    const { project } = effectiveConfig(projectId);
    const pmRelPath = project.input?.pm || 'publication.xml';
    const pmAbs = path.join(dir, pmRelPath);
    if (!fs.existsSync(pmAbs)) throw bad(`Publication module not found: ${pmRelPath}`, 'NO_PM');
    const pmText = fs.readFileSync(pmAbs, 'utf8');
    if (/<\s*jssbook[\s>]/.test(pmText)) throw bad('A configuration-specific publication needs an S1000D publication module, not a JSS book.', 'NOT_S1000D');
    const csdbRelDir = project.input?.csdbDir || 'csdb';
    const mediaRelDir = project.input?.mediaDir || 'Media';

    const sel = buildSelection(projectId, input);
    log(`Configuration: ${sel.label}`);
    const dms = gate.files.map((rel) => ({ file: rel.split('/').pop() ?? rel, xml: fs.readFileSync(path.join(dir, rel), 'utf8') }));
    const plan = planConfiguration(sel, pmRelPath, pmText, dms);
    assertResolved(plan);
    log(`${plan.summary.included} data module(s) apply, ${plan.summary.excluded} do not; ${plan.summary.elementsRemoved} element(s) and ${plan.summary.entriesRemoved} publication entr${plan.summary.entriesRemoved === 1 ? 'y' : 'ies'} left out.`);

    // the work directory: filtered copies of what changes, links to everything else (artwork is not copied)
    const work = path.join(dir, '.configured', sel.slug);
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(path.join(work, csdbRelDir), { recursive: true });
    fs.copyFileSync(path.join(dir, 'project.json'), path.join(work, 'project.json'));
    fs.mkdirSync(path.dirname(path.join(work, pmRelPath)), { recursive: true });
    fs.writeFileSync(path.join(work, pmRelPath), plan.pm.xml, 'utf8');
    const byFile = new Map(plan.files.map((f) => [f.file.toLowerCase(), f]));
    for (const name of fs.readdirSync(path.join(dir, csdbRelDir))) {
      const src = path.join(dir, csdbRelDir, name); const dst = path.join(work, csdbRelDir, name);
      const f = byFile.get(name.toLowerCase());
      if (f) { if (f.included) fs.writeFileSync(dst, f.xml, 'utf8'); continue; }
      if (/^DMC-.*\.xml$/i.test(name)) fs.copyFileSync(src, dst);       // a data module outside the publication: kept so references still resolve
      else try { fs.symlinkSync(src, dst); } catch { fs.copyFileSync(src, dst); }
    }
    // generated / edited front matter the engines read from the project (small XML files): copied, so a configuration build never writes into the project
    for (const sub of ['jss', 's1000d']) if (fs.existsSync(path.join(dir, sub))) fs.cpSync(path.join(dir, sub), path.join(work, sub), { recursive: true });
    if (fs.existsSync(path.join(dir, mediaRelDir))) { try { fs.symlinkSync(path.join(dir, mediaRelDir), path.join(work, mediaRelDir), 'dir'); } catch { /* the build reports missing artwork */ } }

    const out = await renderFull(projectId, gate, log, { workDir: work });
    const name = `${slugOf2(pmCodeOf(pmText, readProjectJson(projectId).name || projectId))}_${sel.slug}.pdf`;
    fs.mkdirSync(path.join(dir, CONFIG_DIR), { recursive: true });
    const dest = path.join(dir, CONFIG_DIR, name);
    fs.copyFileSync(out.pdf, dest);
    fs.rmSync(work, { recursive: true, force: true });
    broadcast(projectId, { type: 'progress', message: `Configuration PDF: ${name}`, done: true });
    return {
      pdf: dest, name, file: `${CONFIG_DIR}/${name}`, totalMs: out.totalMs, releaseLabel: out.releaseLabel,
      plan: { label: sel.label, productId: sel.productId, values: sel.summary, included: plan.summary.included, excluded: plan.excluded, elementsRemoved: plan.summary.elementsRemoved, entriesRemoved: plan.summary.entriesRemoved },
    };
  });
}
const slugOf2 = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'publication';

/** The configuration PDFs this project has built, newest first. */
export function listConfiguredPdfs(projectId: string): Array<{ name: string; file: string; size: number; builtAt: string }> {
  const d = path.join(projectDirFor(projectId), CONFIG_DIR);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => /\.pdf$/i.test(f)).map((f) => { const st = fs.statSync(path.join(d, f)); return { name: f, file: `${CONFIG_DIR}/${f}`, size: st.size, builtAt: st.mtime.toISOString() }; })
    .sort((a, b) => b.builtAt.localeCompare(a.builtAt));
}
