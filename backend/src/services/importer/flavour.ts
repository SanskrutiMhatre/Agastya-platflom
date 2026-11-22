// =============================================================================
// Which tool produced this package?
//
// The flavour decides nothing by itself - the repairs are triggered by what is WRONG in the files, not by who
// wrote them - but it tells the author what to expect ("Vektra output: placeholder publication, check the
// ICNs") and lets the report be honest about a pattern. It is detected from evidence, each piece weighted, and
// the evidence is reported so a wrong guess can be seen and overruled.
//
//   xignal-jss      Xignal's JSS export: generator comment naming JSS, reserved front-matter info codes (title page,
//                   proprietary, foreword, record of changes ...), PM comments saying which title feeds the header
//   xignal-s1000d   Xignal / Docuneering S1000D export: DOCTYPE "Document Specific Declarations" block, a master PMC
//                   with pmRef annexures, `issueType` on the status, tabtop verification
//   vektra          the Vektra authoring plugin: module files without an issue/language suffix, a template PMC
//                   (MODEL / 00000 / "ENTERPRISE"), placeholder enterprise codes, BREX of another issue
//   generic-s1000d  anything else that is a S1000D package
// =============================================================================

import type { DmRec, Package } from './package';
import { isPlaceholderPmCode } from './identity';
import type { Flavour } from './types';

/** Info codes S1000D reserves for front matter that the JSS export emits as data modules. */
const JSS_FRONT_MATTER = new Set(['001', '021', '023', '00T', '00V', '012', '005', '009', '00A', '00Z', '007', 'X01', 'X02', 'X03', 'X04']);
const PLACEHOLDER_ENTERPRISE = new Set(['12345', '00000']);
const SUFFIXED = /_\d{3}-\d{2}_[A-Za-z]{2}-[A-Za-z]{2}\.xml$/i;

interface Evidence { family: 'xignal' | 'jss' | 'vektra'; weight: number; text: string }

export function detectFlavour(pkg: Package): { id: Flavour; confidence: number; evidence: string[] } {
  const ev: Evidence[] = [];
  const add = (family: Evidence['family'], weight: number, text: string): void => { ev.push({ family, weight, text }); };

  const heads = [...pkg.dms.map((d) => d.text.slice(0, 6000)), ...pkg.pmcs.map((p) => p.text.slice(0, 6000))];
  const comments = heads.flatMap((h) => [...h.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1].trim()));
  const named = (re: RegExp): string | undefined => comments.find((c) => re.test(c));

  const xig = named(/xignal|docuneering/i);
  if (xig) add('xignal', 5, `generator comment: "${xig.slice(0, 80)}"`);
  if (named(/JSS-?\d{3,4}/i) && xig) add('jss', 4, 'the generator comment names a JSS publication');
  if (heads.some((h) => /Begin Document Specific Declarations/.test(h))) add('xignal', 2, 'DOCTYPE carries the "Document Specific Declarations" block');
  if (pkg.pmcs.some((p) => p.model?.entries.some(function hasRef(e): boolean { return e.type === 'pmRef' || (e.type === 'folder' && (e.children ?? []).some(hasRef)); })))
    add('xignal', 3, 'the PMC points at sub-publications with pmRef (annexures)');
  if (pkg.pmcs.some((p) => /<pmStatus\s+issueType=/.test(p.text))) add('xignal', 1, 'pmStatus carries issueType');
  if (pkg.dms.some((d) => /verificationType="tabtop"/.test(d.text.slice(0, 8000)))) add('xignal', 1, 'tabtop verification statement');
  if (pkg.pmcs.some((p) => /<!--[^>]*Used in (the )?(header|footer|title page)/i.test(p.text))) { add('jss', 4, 'PMC comments say which title is used in header / footer'); add('xignal', 3, 'PMC comments in Xignal style'); }

  const codes = new Set(pkg.dms.map((d) => d.ident.infoCode));
  const frontMatter = [...codes].filter((c) => JSS_FRONT_MATTER.has(c));
  if (frontMatter.length >= 5) add('jss', 3, `${frontMatter.length} reserved front-matter info codes as data modules (${frontMatter.slice(0, 6).join(', ')}...)`);
  const jssModels = pkg.dms.filter((d) => /^JSS/i.test(d.ident.dmCodeAttrs.modelIdentCode ?? '')).length;
  if (jssModels) add('jss', 3, `${jssModels} modules with a JSS model identification code`);

  // Vektra
  const content = pkg.dms.filter((d) => !d.isBrex);
  const unsuffixed = content.filter((d) => !SUFFIXED.test(d.file.base)).length;
  if (content.length && unsuffixed / content.length >= 0.8) add('vektra', 3, `${unsuffixed} of ${content.length} module files have no issue/language suffix`);
  const placeholderPm = pkg.pmcs.filter((p) => p.model && isPlaceholderPmCode(p.model.meta.pmCode));
  if (placeholderPm.length) add('vektra', 3, `placeholder publication module (${placeholderPm.map((p) => p.model?.meta.pmCode.modelIdentCode + '/' + p.model?.meta.pmCode.pmIssuer).join(', ')})`);
  const placeholderEnt = content.filter((d) => PLACEHOLDER_ENTERPRISE.has(d.ident.originatorCode ?? '')).length;
  if (content.length && placeholderEnt / content.length >= 0.5) add('vektra', 2, `placeholder enterprise code on ${placeholderEnt} of ${content.length} modules`);
  if (pkg.pmcs.some((p) => /<enterpriseName>ENTERPRISE<\/enterpriseName>/.test(p.text))) add('vektra', 1, 'template enterprise name "ENTERPRISE"');
  if (content.filter((d) => /<copyrightPara><\/copyrightPara>/.test(d.text.slice(0, 8000))).length > content.length / 2 && content.length) add('vektra', 1, 'empty copyrightPara / authority placeholders in the status section');
  if (content.some(brexOfOtherIssue)) add('vektra', 1, 'BREX reference of an issue other than the schema the modules declare');
  const vk = named(/vektra/i);
  if (vk) add('vektra', 5, `generator comment: "${vk.slice(0, 60)}"`);

  const score = (f: Evidence['family']): number => ev.filter((e) => e.family === f).reduce((s, e) => s + e.weight, 0);
  const x = score('xignal'); const j = score('jss'); const v = score('vektra');

  let id: Flavour = 'generic-s1000d';
  let top = 0; let family: Evidence['family'] | null = null;
  if (x >= 3 && j >= 4) { id = 'xignal-jss'; top = x + j; family = null; }
  else if (v >= 4 && v > x) { id = 'vektra'; top = v; family = 'vektra'; }
  else if (x >= 3) { id = 'xignal-s1000d'; top = x; family = 'xignal'; }
  const used = id === 'xignal-jss' ? ev.filter((e) => e.family !== 'vektra') : family ? ev.filter((e) => e.family === family) : [];
  // Confidence: how much of the evidence this flavour could have had was seen, capped; a generic fallback is a low-information answer.
  const confidence = id === 'generic-s1000d' ? (pkg.dms.length ? 0.5 : 0.2) : Math.min(0.99, Math.round((top / (top + 3)) * 100) / 100);
  return { id, confidence, evidence: used.length ? used.map((e) => e.text) : [pkg.dms.length ? 'no tool-specific markers found' : 'the package holds no data modules'] };
}

function brexOfOtherIssue(d: DmRec): boolean {
  const m = /^S1000D-([A-Z])-04-10-0301-00A-022A-D$/.exec(d.ident.brexDmc ?? '');
  if (!m) return false;
  const want: Record<string, string> = { '4.2': 'F', '5': 'G', '5.0': 'G', '6': 'H', '7': 'J' };
  return !!d.ident.issue && !!want[d.ident.issue] && want[d.ident.issue] !== m[1];
}
