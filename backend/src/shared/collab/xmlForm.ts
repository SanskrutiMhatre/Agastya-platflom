// =============================================================================
// The written form of an S1000D XML document: how whitespace is normalised for editing, how a document is pretty-printed, and how a
// DOCTYPE internal subset is read and written. ONE source for the S1000D Studio (frontend/src/studio/core/xml.ts and display.ts re-export
// these, unchanged in behaviour) and for the collaboration server (Phase 3, P3-1: backend/src/services/collab), which writes the merged
// document back to the project file. Both must write the same bytes for the same tree, or every write-back of a live room would reformat
// the file and the revision history would fill with whitespace changes.
//
// No Node or browser dependency: the functions work on any W3C-style DOM (the browser's, or @xmldom/xmldom on the server) through the
// structural `XNode` interface below. The grammar is optional and only asked two questions (`has`, `allowsText`), answered by the Studio's
// compiled XSD grammar or by the server's reader of the same grammar files (services/collab/grammar.ts).
//
// Moved verbatim from the Studio (core/xml.ts: findDoctype, parseDoctype, serializeDoctype, exactText, exactAttr, normalizeWhitespace,
// serialize; core/display.ts: BLOCK, PRESERVE, isBlockName, isElementOnly, isPreserved). Only the parameter types changed.
// =============================================================================

/** The part of a DOM node these functions use (the browser's Node and @xmldom/xmldom's Node both have it). */
export interface XNode {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  parentNode: XNode | null;
  firstChild: XNode | null;
  previousSibling: XNode | null;
  nextSibling: XNode | null;
  childNodes: ArrayLike<XNode>;
  removeChild(child: XNode): XNode;
}
export interface XAttr { name: string; value: string; namespaceURI?: string | null }
export interface XElement extends XNode {
  attributes: ArrayLike<XAttr>;
  getAttribute(name: string): string | null;
  normalize(): void;
}
export interface XDocument extends XNode { documentElement: XElement | null }

/** What the written form needs to know of a schema: does it declare the element, and may the element hold character data. */
export interface GrammarLike { has(name: string): boolean; allowsText(name: string): boolean }

// ------------------------------------------------------------------ classification (from core/display.ts)
/** Elements that are always laid out as blocks. */
export const BLOCK = new Set<string>([
  // structure
  'dmodule', 'identAndStatusSection', 'dmAddress', 'dmIdent', 'dmAddressItems', 'dmStatus', 'dmTitle', 'content',
  'description', 'procedure', 'faultIsolation', 'faultReporting', 'crew', 'illustratedPartsCatalog', 'brex', 'comment',
  'commentContent', 'checkList', 'learning', 'process', 'schedul', 'wiringData', 'container', 'frontMatter', 'refs',
  'referencedApplicGroup', 'warningsAndCautions', 'commonInfo', 'commonInfoDescrPara', 'responsiblePartnerCompany',
  'originator', 'applic', 'brexDmRef', 'qualityAssurance', 'reasonForUpdate', 'remarks', 'security', 'techName', 'infoName',
  'issueDate', 'language', 'issueInfo', 'dmCode', 'skillLevel', 'productSafety', 'applicCrossRefTableRef', 'dataRestrictions',
  // text blocks
  'para', 'simplePara', 'title', 'levelledPara', 'levelledParaAlts', 'notePara', 'warningAndCautionPara', 'attentionListItemPara',
  'warning', 'caution', 'note', 'captionGroup', 'caption', 'legend', 'footnoteRemarks', 'displayText',
  // lists
  'randomList', 'sequentialList', 'listItem', 'definitionList', 'definitionListItem', 'definitionListHeader', 'listItemTerm',
  'listItemDefinition', 'attentionRandomList', 'attentionSequentialList', 'attentionRandomListItem', 'attentionSequentialListItem',
  'termTitle', 'definitionTitle',
  // figures / tables
  'figure', 'figureAlts', 'graphic', 'multimedia', 'multimediaObject', 'table', 'tgroup', 'thead', 'tbody', 'tfoot', 'row', 'entry',
  'colspec', 'spanspec', 'hotspot',
  // procedures
  'preliminaryRqmts', 'mainProcedure', 'closeRqmts', 'proceduralStep', 'proceduralStepAlts', 'reqCondGroup', 'reqCondNoRef',
  'reqCondDm', 'reqCondPm', 'reqCondExternalPub', 'reqCondCircuitBreaker', 'reqPersons', 'person', 'personnel', 'reqTechInfoGroup',
  'reqSupportEquips', 'reqSupplies', 'reqSpares', 'reqSafety', 'safetyRqmts', 'supportEquipDescrGroup', 'supportEquipDescr',
  'supplyDescrGroup', 'supplyDescr', 'spareDescrGroup', 'spareDescr', 'noConds', 'noSupportEquips', 'noSupplies', 'noSpares',
  'noSafety', 'reqCond', 'estimatedTime', 'reqQuantity', 'personCategory', 'personSkill', 'trade', 'reqTechInfo',
  'isolationProcedure', 'isolationStep', 'isolationMainProcedure', 'isolationProcedureEnd', 'action', 'isolationStepQuestion',
  'isolationStepAnswer', 'yesNoAnswer', 'yesAnswer', 'noAnswer', 'listOfChoices', 'choice', 'faultDescr', 'descr', 'fault',
  'detectionInfo', 'isolateDetectedFault', 'locateAndRepair', 'locateAndRepairLruItem', 'crewRefCard', 'crewDrill', 'crewDrillStep',
  'challengeAndResponse', 'challenge', 'response', 'case', 'caseCond', 'if', 'elseIf',
  // brex
  'contextRules', 'structureObjectRuleGroup', 'structureObjectRule', 'objectPath', 'objectUse', 'objectValue', 'snsRules',
  'notationRuleList', 'notationRule', 'nonContextRules', 'nonContextRule', 'brDecisionRef', 'brexDmRef',
  // ipd
  'catalogSeqNumber', 'itemSeqNumber', 'figureRef',
  // comment
  'commentAddress', 'commentAddressItems', 'commentStatus', 'commentIdent', 'commentTitle', 'commentRefs', 'commentResponse',
  'attachmentRef',
]);

/** Elements whose content is whitespace-preserving. */
export const PRESERVE = new Set<string>(['verbatimText']);

/**
 * Elements that are normally inline but carry block-level elements inside
 * mixed content; treated as blocks so lists inside paragraphs lay out correctly.
 */
export function isBlockName(name: string): boolean {
  return BLOCK.has(name);
}

/** Whether an element's content is element-only (whitespace insignificant). */
export function isElementOnly(el: XElement, grammar: GrammarLike | null): boolean {
  const name = el.nodeName;
  if (PRESERVE.has(name) || el.getAttribute('xml:space') === 'preserve') return false;
  if (grammar && grammar.has(name)) return !grammar.allowsText(name);
  for (const c of Array.from(el.childNodes)) {
    if ((c.nodeType === 3 && /\S/.test(c.nodeValue || '')) || c.nodeType === 4) return false;
    // without a schema, an element that holds inline elements ("<emphasis>a</emphasis> <emphasis>b</emphasis>") is mixed content:
    // the space between them is text and must survive
    if (c.nodeType === 1 && !BLOCK.has(c.nodeName)) return false;
  }
  return true;
}

export function isPreserved(el: XElement): boolean {
  for (let n: XNode | null = el; n && n.nodeType === 1; n = n.parentNode) {
    const e = n as XElement;
    if (PRESERVE.has(e.nodeName)) return true;
    const sp = e.getAttribute('xml:space');
    if (sp === 'preserve') return true;
    if (sp === 'default') return false;
  }
  return false;
}

// ------------------------------------------------------------------ doctype (from core/xml.ts)
export interface DoctypeDecl {
  kind: 'entity' | 'notation' | 'other';
  name?: string;
  systemId?: string;
  publicId?: string;
  notation?: string;
  raw: string;
}

export interface Doctype {
  rootName: string;
  publicId?: string;
  systemId?: string;
  decls: DoctypeDecl[];
}

/** Locates the DOCTYPE declaration in raw XML text (handles internal subsets, quotes and comments). */
export function findDoctype(text: string): { start: number; end: number; raw: string } | null {
  // Walk the prolog the way a parser does: the XML declaration, processing instructions, comments and white space may come first
  // (a comment that merely mentions "<!DOCTYPE" or "<root" is neither the DOCTYPE nor the root element).
  let p = 0;
  for (;;) {
    while (p < text.length && /[\s﻿]/.test(text[p])) p++;
    if (text.startsWith('<?', p)) {
      const e = text.indexOf('?>', p + 2);
      if (e < 0) return null;
      p = e + 2;
    } else if (text.startsWith('<!--', p)) {
      const e = text.indexOf('-->', p + 4);
      if (e < 0) return null;
      p = e + 3;
    } else break;
  }
  if (!text.startsWith('<!DOCTYPE', p) || !/\s/.test(text[p + 9] ?? '')) return null;
  const start = p;
  let i = start + 9;
  let depth = 0;
  let quote: string | null = null;
  while (i < text.length) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (text.startsWith('<!--', i)) {
      const e = text.indexOf('-->', i + 4);
      if (e < 0) return null;
      i = e + 3;
      continue;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '[') depth++;
    else if (c === ']') depth--;
    else if (c === '>' && depth <= 0) return { start, end: i + 1, raw: text.slice(start, i + 1) };
    i++;
  }
  return null;
}

export function parseDoctype(raw: string): Doctype {
  const head = raw.match(/^<!DOCTYPE\s+([^\s[>]+)\s*(?:(PUBLIC)\s+("[^"]*"|'[^']*')\s*("[^"]*"|'[^']*')?|(SYSTEM)\s+("[^"]*"|'[^']*'))?/);
  const dt: Doctype = { rootName: head?.[1] ?? 'dmodule', decls: [] };
  const unq = (s?: string) => (s ? s.slice(1, -1) : undefined);
  if (head?.[2]) {
    dt.publicId = unq(head[3]);
    dt.systemId = unq(head[4]);
  } else if (head?.[5]) dt.systemId = unq(head[6]);
  const lb = raw.indexOf('[');
  const rb = raw.lastIndexOf(']');
  if (lb >= 0 && rb > lb) {
    const subset = raw.slice(lb + 1, rb);
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!(ENTITY|NOTATION|ELEMENT|ATTLIST)\b(?:[^>"']|"[^"]*"|'[^']*')*>|%[\w.-]+;/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(subset))) {
      const text = m[0];
      if (m[1] === 'ENTITY') {
        const em = text.match(/^<!ENTITY\s+(%\s+)?([^\s]+)\s+(?:SYSTEM\s+("[^"]*"|'[^']*')|PUBLIC\s+("[^"]*"|'[^']*')\s+("[^"]*"|'[^']*'))?(?:\s*NDATA\s+([^\s>]+))?/);
        if (em && !em[1]) {
          dt.decls.push({ kind: 'entity', name: em[2], systemId: unq(em[3] ?? em[5]), publicId: unq(em[4]), notation: em[6], raw: text });
          continue;
        }
      } else if (m[1] === 'NOTATION') {
        const nm = text.match(/^<!NOTATION\s+([^\s]+)/);
        if (nm) {
          dt.decls.push({ kind: 'notation', name: nm[1], raw: text });
          continue;
        }
      }
      dt.decls.push({ kind: 'other', raw: text });
    }
  }
  return dt;
}

export function serializeDoctype(dt: Doctype): string {
  let s = '<!DOCTYPE ' + dt.rootName;
  if (dt.publicId != null) s += ` PUBLIC "${dt.publicId}"` + (dt.systemId != null ? ` "${dt.systemId}"` : '');
  else if (dt.systemId != null) s += ` SYSTEM "${dt.systemId}"`;
  if (dt.decls.length) {
    s += ' [\n';
    for (const d of dt.decls) s += '  ' + d.raw + '\n';
    s += ']';
  }
  return s + '>';
}

// ------------------------------------------------------- whitespace handling (from core/xml.ts)
const WS = /[ \t\r\n]+/g;

function isBlockNode(n: XNode | null): boolean {
  return !!n && n.nodeType === 1 && isBlockName(n.nodeName);
}

/**
 * Normalises whitespace for editing:
 *  - removes whitespace-only text in element-only content;
 *  - collapses whitespace runs in mixed content (except preserved elements);
 *  - trims text at block boundaries.
 */
export function normalizeWhitespace(root: XNode, grammar: GrammarLike | null): void {
  const walk = (el: XElement) => {
    if (isPreserved(el)) return;
    const elementOnly = isElementOnly(el, grammar);
    const kids = Array.from(el.childNodes);
    if (elementOnly) {
      for (const c of kids) {
        if (c.nodeType === 3 && !/\S/.test(c.nodeValue || '')) el.removeChild(c);
      }
    } else {
      for (const c of kids) if (c.nodeType === 3) c.nodeValue = (c.nodeValue || '').replace(WS, ' ');
      // merge adjacent text nodes
      el.normalize();
      const blockParent = isBlockName(el.nodeName) || !grammar?.has(el.nodeName);
      const list = Array.from(el.childNodes);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.nodeType !== 3) continue;
        let v = c.nodeValue || '';
        const prev = c.previousSibling;
        const next = c.nextSibling;
        const atStart = !prev || isBlockNode(prev);
        const atEnd = !next || isBlockNode(next);
        if ((atStart && (prev ? true : blockParent)) || (prev && isBlockNode(prev))) v = v.replace(/^ /, '');
        if ((atEnd && (next ? true : blockParent)) || (next && isBlockNode(next))) v = v.replace(/ $/, '');
        if (!v) el.removeChild(c);
        else if (v !== c.nodeValue) c.nodeValue = v;
      }
    }
    for (const c of Array.from(el.childNodes)) if (c.nodeType === 1) walk(c as XElement);
  };
  if (root.nodeType === 9) {
    const de = (root as XDocument).documentElement;
    if (de) walk(de);
  } else if (root.nodeType === 1) walk(root as XElement);
}

// ---------------------------------------------------------------- serialising (from core/xml.ts)
export interface SerializeOptions {
  grammar?: GrammarLike | null;
  indent?: string;
  doctype?: Doctype | null;
  xmlDecl?: string | null;
  /** Record offsets for nodes. */
  map?: boolean;
}

export interface SerializeResult {
  text: string;
  spans: Map<XNode, [number, number]> | null;
}

// exactText / exactAttr: the serialiser's own escapes, not the general escaper (shared/xmlEscape.ts): they keep a document's bytes
// readable back exactly. Characters XML 1.0 cannot carry (not even as references) are dropped on output, so a document can always be read back; a bare
// carriage return is written as a reference, because a parser would turn it into a line feed.
const TEXT_SPECIAL = /[&<\r\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|\]\]>/g;
const ATTR_SPECIAL = /[&<"\t\n\r\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function exactText(s: string): string {
  return s.replace(TEXT_SPECIAL, (m) => (m === '&' ? '&amp;' : m === '<' ? '&lt;' : m === '\r' ? '&#13;' : m === ']]>' ? ']]&gt;' : ''));
}

export function exactAttr(s: string): string {
  return s.replace(ATTR_SPECIAL, (m) => (m === '&' ? '&amp;' : m === '<' ? '&lt;' : m === '"' ? '&quot;' : m === '\t' ? '&#9;' : m === '\n' ? '&#10;' : m === '\r' ? '&#13;' : ''));
}

/** Decides whether element children should be laid out on indented lines. */
function indentChildren(el: XElement, grammar: GrammarLike | null): boolean {
  if (isPreserved(el)) return false;
  if (isElementOnly(el, grammar)) return true;
  // mixed element containing only block children (e.g. an entry with paras)
  let hasEl = false;
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 3) {
      if (/\S/.test(c.nodeValue || '')) return false;
    } else if (c.nodeType === 4) return false;
    else if (c.nodeType === 1) {
      if (!isBlockName(c.nodeName)) return false;
      hasEl = true;
    }
  }
  return hasEl;
}

const ODD_WS = /^[ \t\r\n]|[ \t\r\n]$|[ \t\r\n]{2}|[\t\r\n]/;

/**
 * The text a text node is written as. Mixed-content whitespace is written the way loading reads it (normalizeWhitespace): a run of
 * whitespace is one space, and whitespace at the very start or end of a text block is dropped. A space left behind by Enter, a deleted
 * word or a join, or a double space typed before saving, therefore reads back unchanged and a second save does not differ. Inside
 * preserved elements (`pretty` false) nothing is touched.
 */
function textAsWritten(t: XNode, pretty: boolean, grammar: GrammarLike | null): string {
  const v = t.nodeValue || '';
  const el = t.parentNode;
  if (!pretty || !el || el.nodeType !== 1 || !ODD_WS.test(v)) return v;
  // a neighbouring empty text node is nothing (a parser would not create it); a neighbouring text node makes this one a middle part
  const sibling = (dir: 'previousSibling' | 'nextSibling') => {
    let s = t[dir];
    while (s && s.nodeType === 3 && !s.nodeValue) s = s[dir];
    return s;
  };
  const prev = sibling('previousSibling');
  const next = sibling('nextSibling');
  const blockParent = isBlockName(el.nodeName) || !grammar?.has(el.nodeName);
  let s = v.replace(/[ \t\r\n]+/g, ' ');
  if (prev ? isBlockNode(prev) || (prev.nodeType === 3 && /[ \t\r\n]$/.test(prev.nodeValue || '')) : blockParent) s = s.replace(/^ /, '');
  if (next ? isBlockNode(next) : blockParent) s = s.replace(/ $/, '');
  return s;
}

export function serialize(node: XNode, opts: SerializeOptions = {}): SerializeResult {
  const grammar = opts.grammar ?? null;
  const ind = opts.indent ?? '  ';
  const parts: string[] = [];
  let len = 0;
  const spans = opts.map ? new Map<XNode, [number, number]>() : null;
  const out = (s: string) => {
    parts.push(s);
    len += s.length;
  };

  const writeAttrs = (el: XElement) => {
    for (const a of Array.from(el.attributes)) out(' ' + a.name + '="' + exactAttr(a.value) + '"');
  };

  const writeNode = (n: XNode, depth: number, pretty: boolean) => {
    const start = len;
    switch (n.nodeType) {
      case 1: {
        const el = n as XElement;
        out('<' + el.nodeName);
        writeAttrs(el);
        const kids = Array.from(el.childNodes);
        const indent = pretty && indentChildren(el, grammar);
        const childPretty = pretty && !isPreserved(el);
        const visible = indent
          ? kids.filter((k) => !(k.nodeType === 3 && !/\S/.test(k.nodeValue || '')))
          : kids.filter((k) => k.nodeType !== 3 || textAsWritten(k, childPretty, grammar) !== '');
        if (visible.length === 0) {
          out('/>');
        } else {
          out('>');
          if (indent) {
            for (const k of visible) {
              out('\n' + ind.repeat(depth + 1));
              writeNode(k, depth + 1, true);
            }
            out('\n' + ind.repeat(depth));
          } else {
            for (const k of visible) writeNode(k, depth, childPretty);
          }
          out('</' + el.nodeName + '>');
        }
        break;
      }
      case 3:
        out(exactText(textAsWritten(n, pretty, grammar)));
        break;
      case 4:
        out('<![CDATA[' + (n.nodeValue || '') + ']]>');
        break;
      case 7: {
        const pi = n as XNode & { target: string; data: string };
        out('<?' + pi.target + (pi.data ? ' ' + pi.data : '') + '?>');
        break;
      }
      case 8:
        out('<!--' + (n.nodeValue || '') + '-->');
        break;
      case 9: {
        const d = n as XDocument;
        out(opts.xmlDecl ?? '<?xml version="1.0" encoding="UTF-8"?>');
        let doctypeWritten = false;
        for (const k of Array.from(d.childNodes)) {
          if (k.nodeType === 10) continue;
          if (k.nodeType === 1 && !doctypeWritten) {
            if (opts.doctype) {
              out('\n' + serializeDoctype(opts.doctype));
            }
            doctypeWritten = true;
          }
          out('\n');
          writeNode(k, 0, true);
        }
        out('\n');
        break;
      }
      case 11:
        for (const k of Array.from(n.childNodes)) writeNode(k, depth, pretty);
        break;
    }
    if (spans) spans.set(n, [start, len]);
  };

  writeNode(node, 0, true);
  return { text: parts.join(''), spans };
}

// ---------------------------------------------------------------- schema detection (from core/s1000d.ts)
export interface SchemaRef {
  issue: string;
  schema: string;
  url: string | null;
}

/** The root of a document as detectSchemaOf reads it. */
export interface XRoot extends XElement { getAttributeNS(ns: string | null, name: string): string | null }

const childElements = (el: XNode): XElement[] => Array.from(el.childNodes).filter((c): c is XElement => c.nodeType === 1);

/** Detects S1000D issue + schema from xsi:noNamespaceSchemaLocation (or root element heuristics). */
export function detectSchemaOf(root: XRoot | null): SchemaRef | null {
  if (!root) return null;
  const loc = root.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'noNamespaceSchemaLocation') || root.getAttribute('xsi:noNamespaceSchemaLocation');
  if (loc) {
    const m = loc.match(/S1000D_([0-9]+(?:-[0-9]+)?(?:-[0-9A-Z]+)?)\/xml_schema_(?:flat|master)\/([a-zA-Z]+)\.xsd/);
    if (m) {
      let issue = m[1];
      if (issue === '4-1-A') issue = '4-1';
      if (/^\d+-0$/.test(issue) && issue !== '5-0') issue = issue.replace(/-0$/, '');
      return { issue, schema: m[2], url: loc };
    }
    const f = loc.match(/([a-zA-Z]+)\.xsd$/);
    if (f) return { issue: '5-0', schema: f[1], url: loc };
  }
  // heuristics on content
  const name = root.nodeName;
  if (name === 'pm') return { issue: '5-0', schema: 'pm', url: null };
  if (name === 'dml') return { issue: '5-0', schema: 'dml', url: null };
  if (name === 'dmodule') {
    const content = childElements(root).find((e) => e.nodeName === 'content');
    const first = content ? childElements(content).find((e) => !['refs', 'referencedApplicGroup', 'referencedApplicGroupRef', 'warningsAndCautions', 'warningsAndCautionsRef'].includes(e.nodeName)) : null;
    const map: Record<string, string> = {
      description: 'descript', procedure: 'proced', faultIsolation: 'fault', faultReporting: 'fault', illustratedPartsCatalog: 'ipd',
      crew: 'crew', brex: 'brex', commonRepository: 'comrep', checkList: 'checklist', learning: 'learning', process: 'process',
      maintPlanning: 'schedul', serviceBulletin: 'sb', wiringData: 'wrngdata', wiringFields: 'wrngflds', container: 'container',
      frontMatter: 'frontmatter', applicCrossRefTable: 'appliccrossreftable', condCrossRefTable: 'condcrossreftable',
      productCrossRefTable: 'prdcrossreftable', brDoc: 'brdoc', scoContent: 'scocontent',
    };
    const schema = first ? map[first.nodeName] : undefined;
    if (schema) return { issue: '5-0', schema, url: null };
  }
  return null;
}
