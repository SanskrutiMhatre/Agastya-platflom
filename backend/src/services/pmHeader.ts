// WP-15 (PUB-015): a publication module header (<pmStatus>) the S1000D schema accepts.
//
// The vendored publication writer (vendor/engine/pmc.js serialisePm) writes the model it is given: security, the enterprises when the model has them,
// and the quality assurance. It writes no <applic> and no <brexDmRef>, both of which pm.xsd requires (Issue 4.x: sourcePmIdent?, security,
// derivativeClassification?, dataRestrictions?, logo?, responsiblePartnerCompany, originator?, applicCrossRefTableRef?, applic|applicRef, brexDmRef,
// pubMedia*, qualityAssurance, systemBreakdownCode|functionalItemCode*, reasonForUpdate*, remarks?). A publication imported from a package, or saved
// in the editor, therefore failed its own schema ("Element 'qualityAssurance': This element is not expected").
//
// `completePmStatus` puts the status back together in schema order: each element the new text has is kept; one it lacks is taken from the earlier
// version of the same publication (the package's own file, or the file on disk before the save) when that had it; a required one neither has gets a
// neutral default (the enterprise of the data modules or 00000, an applicability whose display text is EMPTY, the default S1000D BREX of the issue).
// The applicability is empty, not "All": the author never said what the book applies to, and the page heads read the publication's
// applicability (headers_footers.xsl), so a filled-in "All" printed a new word on every page of existing books; empty is valid (pm.xsd:
// displayText with one simplePara, mixed content) and prints what it printed before - the Xignal layout still shows "All" by its own rule. Nothing outside
// <pmStatus> changes. The vendored writer itself is not changed.

import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const ORDER = ['sourcePmIdent', 'security', 'derivativeClassification', 'dataRestrictions', 'logo', 'responsiblePartnerCompany', 'originator', 'applicCrossRefTableRef',
  'applic', 'applicRef', 'brexDmRef', 'pubMedia', 'qualityAssurance', 'systemBreakdownCode', 'functionalItemCode', 'reasonForUpdate', 'remarks'];

const DEFAULT_BREX = '<brexDmRef><dmRef><dmRefIdent><dmCode modelIdentCode="S1000D" systemDiffCode="F" systemCode="04" subSystemCode="1" subSubSystemCode="0" assyCode="0301" disassyCode="00" disassyCodeVariant="A" infoCode="022" infoCodeVariant="A" itemLocationCode="D"/></dmRefIdent></dmRef></brexDmRef>';

const STATUS = /(<pmStatus\b[^>]*>)([\s\S]*?)(<\/pmStatus>)/;

/** The top-level children of <pmStatus> in `xml`, as serialised element text by name (several for the repeatable ones); null when there is none. */
function statusChildren(xml: string | null | undefined): Map<string, string[]> | null {
  if (!xml) return null;
  const m = STATUS.exec(xml); if (!m) return null;
  let doc: Document;
  try { doc = new DOMParser({ onError: () => undefined }).parseFromString(`<pmStatus>${m[2]}</pmStatus>`, 'text/xml') as unknown as Document; } catch { return null; }
  const root = doc.documentElement; if (!root) return null;
  const out = new Map<string, string[]>(); const ser = new XMLSerializer();
  for (let n = root.firstChild; n; n = n.nextSibling) {
    if (n.nodeType !== 1) continue;
    const name = (n as Element).tagName;
    out.set(name, [...(out.get(name) ?? []), ser.serializeToString(n as unknown as Parameters<XMLSerializer["serializeToString"]>[0])]);
  }
  return out;
}

export interface PmStatusDefaults { enterpriseCode?: string; brexDmRef?: string }

/** `xml` with a schema-ordered, complete <pmStatus>; `prior` is an earlier version of the same publication (or null). Returns `xml` unchanged when it has no <pmStatus> or it is already complete and in order. */
export function completePmStatus(xml: string, prior?: string | null, defaults: PmStatusDefaults = {}): string {
  const m = STATUS.exec(xml); if (!m) return xml;
  const now = statusChildren(xml); if (!now) return xml;
  const before = statusChildren(prior) ?? new Map<string, string[]>();
  const pick = (name: string): string[] => now.get(name) ?? before.get(name) ?? [];
  const has = (name: string): boolean => (now.get(name) ?? before.get(name) ?? []).length > 0;
  const parts: string[] = [];
  for (const name of ORDER) {
    if (name === 'applicRef' && has('applic')) continue;                 // a choice: the one the text has wins
    if (name === 'applic' && !now.get('applic') && now.get('applicRef')) continue;
    let got = pick(name);
    if (!got.length) {
      const code = defaults.enterpriseCode || '00000';
      if (name === 'responsiblePartnerCompany') got = [`<responsiblePartnerCompany enterpriseCode="${code.replace(/[^A-Za-z0-9]/g, '')}"/>`];
      else if (name === 'applic' && !has('applicRef')) got = ['<applic><displayText><simplePara/></displayText></applic>'];
      else if (name === 'brexDmRef') got = [defaults.brexDmRef || DEFAULT_BREX];
      else if (name === 'qualityAssurance') got = ['<qualityAssurance><unverified/></qualityAssurance>'];
      else if (name === 'security') got = ['<security securityClassification="01"/>'];
    }
    parts.push(...got);
  }
  // anything the schema does not list (a newer issue's element) is kept, after the known ones, rather than dropped
  for (const [name, list] of now) if (!ORDER.includes(name)) parts.push(...list);
  const pad = /\n([ \t]*)<security\b/.exec(m[2])?.[1] ?? '      ';
  const close = /\n([ \t]*)$/.exec(m[2])?.[1] ?? '    ';
  const body = `\n${parts.map((p) => `${pad}${p}`).join('\n')}\n${close}`;
  const before0 = now; const same = [...before0.values()].flat().join('') === parts.join('');
  if (same) return xml;
  return xml.replace(STATUS, (_a, open: string, _b: string, end: string) => `${open}${body}${end}`);
}
