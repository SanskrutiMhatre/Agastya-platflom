/**
 * XML -> HTML renderer for the Design and Tags views. Maintains a bijective
 * mapping between XML nodes and their DOM representation so the editing layer
 * can translate selections and apply minimal re-renders after model changes.
 *
 * Conventions:
 *  - every rendered XML element has a DOM element with class "x" and data-x=<name>;
 *  - generated content (labels, numbering, tag chips, placeholders) carries data-gen
 *    and is never mapped to the model;
 *  - text nodes map 1:1 to model text nodes.
 */
import type { Grammar } from '../core/grammar';
import { ATOMIC, ATOMIC_BLOCK, HIDDEN, elementDisplay } from '../core/display';
import { allowsText } from '../core/ops';
import { buildGrid } from '../core/table';
import { lengthToPx } from '../core/units';
import { dmRefLabel, formatDmc, readDmCode, SECURITY_LABELS, EMPHASIS_TYPES } from '../core/s1000d';
import { elementChildren, textOf } from '../core/xml';
import { LabelIndex, buildLabels, internalRefLabel } from './labels';

export interface ImageResolver {
  (icn: string): string | null;
}

export interface RenderOptions {
  grammar: Grammar | null;
  showTags: boolean;
  images: ImageResolver;
  identCollapsed: boolean;
}

const REFLECTED_ATTRS = ['emphasisType', 'listItemPrefix', 'changeMark', 'changeType', 'verbatimStyle', 'frame', 'warningType', 'vitalWarningFlag', 'internalRefTargetType', 'pgwide'];

const ADMONITION_LABEL: Record<string, string> = { warning: 'WARNING', caution: 'CAUTION', note: 'NOTE' };

const FIELD_LABELS: Record<string, string> = {
  dmCode: 'Data module code', language: 'Language', issueInfo: 'Issue', issueDate: 'Issue date', techName: 'Technical name',
  infoName: 'Information name', security: 'Security', responsiblePartnerCompany: 'Responsible partner company', originator: 'Originator',
  applic: 'Applicability', brexDmRef: 'BREX', qualityAssurance: 'Quality assurance', reasonForUpdate: 'Reason for update',
  remarks: 'Remarks', skillLevel: 'Skill level', dataRestrictions: 'Data restrictions', applicCrossRefTableRef: 'ACT reference',
  productSafety: 'Product safety', infoNameVariant: 'Info name variant',
};

const NO_LABEL: Record<string, string> = {
  noConds: 'No required conditions', noSupportEquips: 'No support equipment', noSupplies: 'No supplies', noSpares: 'No spares',
  noSafety: 'No safety requirements',
};

const SECTION_LABELS: Record<string, string> = {
  preliminaryRqmts: 'Preliminary requirements', closeRqmts: 'Requirements after job completion', mainProcedure: 'Procedure',
  reqCondGroup: 'Required conditions', reqPersons: 'Required persons', reqSupportEquips: 'Support equipment', reqSupplies: 'Consumables, materials and expendables',
  reqSpares: 'Spares', reqSafety: 'Safety conditions', reqTechInfoGroup: 'Technical information', refs: 'References',
  warningsAndCautions: 'Warnings and cautions', referencedApplicGroup: 'Applicability annotations', isolationMainProcedure: 'Fault isolation procedure',
  commonInfo: 'Common information', contextRules: 'Context rules', snsRules: 'SNS rules', nonContextRules: 'Non-context rules',
  catalogSeqNumber: 'Catalog sequence number', isolationStepQuestion: 'Question', isolationStepAnswer: 'Answer', challenge: 'Challenge', response: 'Response',
};

export class Renderer {
  domOf = new WeakMap<Node, Node>();
  xmlOf = new WeakMap<Node, Node>();
  placeholders = new WeakSet<Node>();
  labels: LabelIndex;
  opts: RenderOptions;
  private doc: Document;
  private applicText = new Map<string, string>();

  constructor(doc: Document, opts: RenderOptions) {
    this.doc = doc;
    this.opts = opts;
    this.labels = buildLabels(doc);
    this.indexApplic();
  }

  refreshIndexes() {
    this.labels = buildLabels(this.doc);
    this.indexApplic();
  }

  private indexApplic() {
    this.applicText.clear();
    for (const a of Array.from(this.doc.getElementsByTagName('applic'))) {
      const id = a.getAttribute('id');
      if (id) this.applicText.set(id, textOf(a.getElementsByTagName('displayText')[0] ?? a) || id);
    }
  }

  private map(x: Node, d: Node) {
    this.domOf.set(x, d);
    this.xmlOf.set(d, x);
  }

  private gen(tag: string, cls: string, text?: string): HTMLElement {
    const e = document.createElement(tag);
    e.className = 'x-gen ' + cls;
    e.setAttribute('data-gen', '');
    e.contentEditable = 'false';
    if (text != null) e.textContent = text;
    return e;
  }

  renderDocument(): HTMLElement {
    const root = this.doc.documentElement;
    const out = root ? (this.renderNode(root) as HTMLElement) : document.createElement('div');
    return out;
  }

  renderNode(n: Node, inTable = false): Node | null {
    switch (n.nodeType) {
      case 1:
        return this.renderElement(n as Element, inTable);
      case 3:
      case 4: {
        const parent = n.parentNode as Element | null;
        if (parent && !allowsText(parent, this.opts.grammar) && !/\S/.test(n.nodeValue ?? '')) return null;
        const t = document.createTextNode(n.nodeValue ?? '');
        this.map(n, t);
        return t;
      }
      case 8: {
        if (!this.opts.showTags) return null;
        const c = this.gen('span', 'x-comment', '<!--' + (n.nodeValue ?? '') + '-->');
        return c;
      }
      case 7: {
        if (!this.opts.showTags) return null;
        return this.gen('span', 'x-pi', `<?${(n as ProcessingInstruction).target} ${n.nodeValue ?? ''}?>`);
      }
    }
    return null;
  }

  private baseEl(tag: string, el: Element, display: string): HTMLElement {
    const d = document.createElement(tag);
    d.className = `x x-${display} x-${el.nodeName.replace(':', '_')}`;
    d.setAttribute('data-x', el.nodeName);
    for (const a of REFLECTED_ATTRS) {
      const v = el.getAttribute(a);
      if (v != null) d.setAttribute('data-a-' + a.toLowerCase(), v);
    }
    if (el.getAttribute('changeMark') === '1') d.classList.add('x-changed');
    const id = el.getAttribute('id');
    if (id) d.setAttribute('data-id', id);
    this.map(el, d);
    return d;
  }

  private tagStart(el: Element, block: boolean): HTMLElement {
    const t = this.gen('span', 'x-tag x-tag-start' + (block ? ' x-tag-block' : ''));
    t.textContent = el.nodeName;
    const attrs = Array.from(el.attributes).filter((a) => !a.name.startsWith('xmlns'));
    if (attrs.length) {
      t.title = attrs.map((a) => `${a.name}="${a.value}"`).join('\n');
      t.classList.add('x-tag-has-attrs');
    }
    t.setAttribute('data-tag-for', '');
    return t;
  }

  private tagEnd(el: Element, block: boolean): HTMLElement {
    const t = this.gen('span', 'x-tag x-tag-end' + (block ? ' x-tag-block' : ''));
    t.textContent = '/' + el.nodeName;
    t.setAttribute('data-tag-for', '');
    return t;
  }

  private appendChildren(el: Element, into: HTMLElement, inTable = false) {
    for (const c of Array.from(el.childNodes)) {
      const d = this.renderNode(c, inTable);
      if (d) into.appendChild(d);
    }
  }

  private placeholder(el: Element, d: HTMLElement, block: boolean) {
    if (el.firstChild) {
      // all children hidden? still need a caret target
      let hasVisible = false;
      for (const c of Array.from(d.childNodes)) if (!(c as Element).hasAttribute?.('data-gen')) hasVisible = true;
      if (hasVisible) return;
    }
    if (!allowsText(el, this.opts.grammar)) return;
    if (block) {
      const br = document.createElement('br');
      br.setAttribute('data-gen', 'br');
      d.appendChild(br);
      d.classList.add('x-empty');
    } else {
      const t = document.createTextNode('​');
      this.placeholders.add(t);
      d.appendChild(t);
      d.classList.add('x-empty');
    }
  }

  renderElement(el: Element, inTable = false): Node | null {
    const name = el.nodeName;
    const g = this.opts.grammar;
    if (HIDDEN.has(name)) return null;
    if (!inTable && name === 'tgroup') return this.renderTgroup(el);
    if (ATOMIC.has(name)) return this.renderAtomic(el);
    if (ATOMIC_BLOCK.has(name)) return this.renderAtomicBlock(el);
    if (name === 'table') return this.renderTable(el);
    const display = elementDisplay(el, g);
    const block = display !== 'inline';
    let tag = block ? 'div' : 'span';
    if (name === 'subScript') tag = 'sub';
    else if (name === 'superScript') tag = 'sup';
    const d = this.baseEl(tag, el, block ? 'block' : 'inline');
    const tags = this.opts.showTags;
    if (tags) d.appendChild(this.tagStart(el, block));
    this.decorateStart(el, d);
    this.appendChildren(el, d);
    this.placeholder(el, d, block);
    if (tags) d.appendChild(this.tagEnd(el, block));
    return d;
  }

  /** Generated labels and badges that precede element content. */
  private decorateStart(el: Element, d: HTMLElement) {
    const name = el.nodeName;
    const applic = el.getAttribute('applicRefId');
    if (applic) {
      const b = this.gen('span', 'x-applic-badge', this.applicText.get(applic) ?? applic);
      b.title = 'Applicability: ' + (this.applicText.get(applic) ?? applic);
      d.appendChild(b);
    }
    if (ADMONITION_LABEL[name]) {
      d.appendChild(this.gen('div', 'x-admonition-label', ADMONITION_LABEL[name]));
      return;
    }
    if (name === 'identAndStatusSection') {
      const head = this.gen('div', 'x-ident-head');
      const caretBtn = document.createElement('span');
      caretBtn.className = 'x-ident-toggle';
      caretBtn.textContent = this.opts.identCollapsed && !this.opts.showTags ? '▸' : '▾';
      head.appendChild(caretBtn);
      const code = readDmCode(el.getElementsByTagName('dmCode')[0] ?? null);
      const title = [textOf(el.getElementsByTagName('techName')[0]), textOf(el.getElementsByTagName('infoName')[0])].filter(Boolean).join(' – ');
      head.append(document.createTextNode(' Identification and status'));
      const meta = document.createElement('span');
      meta.className = 'x-ident-meta';
      meta.textContent = (code ? formatDmc(code) : '') + (title ? '  ·  ' + title : '');
      head.appendChild(meta);
      head.setAttribute('data-action', 'toggle-ident');
      d.appendChild(head);
      if (this.opts.identCollapsed && !this.opts.showTags) d.classList.add('x-collapsed');
      return;
    }
    if (FIELD_LABELS[name] && el.parentNode && isIdentDescendant(el)) {
      d.appendChild(this.gen('span', 'x-field-label', FIELD_LABELS[name]));
    }
    if (SECTION_LABELS[name]) {
      d.appendChild(this.gen('div', 'x-section-label', SECTION_LABELS[name]));
    }
    if (name === 'title') {
      const p = el.parentNode as Element | null;
      if (p && p.nodeType === 1) {
        const num = this.labels.numbers.get(p);
        if (p.nodeName === 'figure') d.appendChild(this.gen('span', 'x-num x-caption-num', `Fig ${num ?? ''}`));
        else if (p.nodeName === 'table') d.appendChild(this.gen('span', 'x-num x-caption-num', `Table ${num ?? ''}`));
        else if (num) d.appendChild(this.gen('span', 'x-num', num));
      }
    }
    if ((name === 'proceduralStep' || name === 'crewDrillStep' || name === 'isolationStep') && this.labels.numbers.get(el)) {
      d.appendChild(this.gen('span', 'x-num x-step-num', this.labels.numbers.get(el)!));
    }
    if (name === 'levelledPara' && !elementChildren(el).some((c) => c.nodeName === 'title') && this.labels.numbers.get(el)) {
      d.appendChild(this.gen('span', 'x-num x-lp-num', this.labels.numbers.get(el)!));
    }
    if (name === 'listItem' || name === 'attentionRandomListItem' || name === 'attentionSequentialListItem') {
      const list = el.parentNode as Element;
      const items = elementChildren(list).filter((c) => c.nodeName === name);
      const idx = items.indexOf(el) + 1;
      const seq = list.nodeName === 'sequentialList' || list.nodeName === 'attentionSequentialList';
      const prefix = list.getAttribute('listItemPrefix');
      let marker = '•';
      if (seq) marker = `${listNumber(idx, depthOf(list, list.nodeName))}.`;
      else if (prefix === 'pf01') marker = '';
      else if (prefix === 'pf03') marker = '–';
      else if (prefix === 'pf04') marker = '◦';
      else if (prefix === 'pf05') marker = '▪';
      else if (prefix === 'pf06') marker = '✓';
      else if (prefix === 'pf07') marker = '☐';
      d.appendChild(this.gen('span', 'x-list-marker', marker));
    }
  }

  private renderAtomic(el: Element): HTMLElement {
    const name = el.nodeName;
    const block = elementDisplay(el, this.opts.grammar) !== 'inline' && !allowsText(el.parentNode as Element, this.opts.grammar);
    const d = this.baseEl('span', el, 'atomic');
    d.contentEditable = 'false';
    d.classList.add('x-chip');
    if (block) d.classList.add('x-chip-block');
    const label = FIELD_LABELS[name] && isIdentDescendant(el) ? FIELD_LABELS[name] : '';
    let text = '';
    let title = '';
    switch (name) {
      case 'dmCode':
      case 'pmCode': {
        const p = readDmCode(el);
        text = name === 'dmCode' && p ? formatDmc(p) : Array.from(el.attributes).map((a) => a.value).join('-');
        break;
      }
      case 'issueInfo': text = `${el.getAttribute('issueNumber') ?? '???'}-${el.getAttribute('inWork') ?? '00'}`; break;
      case 'language': text = `${el.getAttribute('languageIsoCode') ?? ''}-${el.getAttribute('countryIsoCode') ?? ''}`; break;
      case 'issueDate': text = `${el.getAttribute('year') ?? ''}-${el.getAttribute('month') ?? ''}-${el.getAttribute('day') ?? ''}`; break;
      case 'security': {
        const c = el.getAttribute('securityClassification') ?? '';
        text = `${c} ${SECURITY_LABELS[c] ?? ''}`.trim();
        break;
      }
      case 'unverified': text = 'Unverified'; break;
      case 'firstVerification': text = `First verification (${el.getAttribute('verificationType') ?? ''})`; break;
      case 'secondVerification': text = `Second verification (${el.getAttribute('verificationType') ?? ''})`; break;
      case 'dmRef': {
        const l = dmRefLabel(el);
        text = l.dmc;
        title = l.title;
        if (l.title) text += ' — ' + l.title;
        break;
      }
      case 'brexDmRef': {
        const l = dmRefLabel(el);
        text = l.dmc;
        break;
      }
      case 'pmRef': {
        const code = el.getElementsByTagName('pmCode')[0];
        text = code ? 'PMC-' + ['modelIdentCode', 'pmIssuer', 'pmNumber', 'pmVolume'].map((a) => code.getAttribute(a) ?? '').join('-') : 'PMC-?';
        break;
      }
      case 'internalRef': {
        text = internalRefLabel(el, this.labels);
        title = 'Internal reference → ' + (el.getAttribute('internalRefId') ?? '');
        if (text.startsWith('⚠')) d.classList.add('x-chip-broken');
        break;
      }
      case 'footnoteRef': text = '†'; break;
      case 'indexFlag': text = '⚑ ' + (el.getAttribute('indexLevelOne') ?? 'index'); break;
      case 'applicRef': text = 'ACT: ' + (el.getAttribute('applicIdentValue') ?? ''); break;
      case 'skillLevel': text = 'Skill ' + (el.getAttribute('skillLevelCode') ?? ''); break;
      case 'symbol': {
        const icn = el.getAttribute('infoEntityIdent') ?? '';
        const url = this.opts.images(icn);
        if (url) {
          const img = document.createElement('img');
          img.src = url;
          img.alt = icn;
          img.className = 'x-symbol-img';
          d.appendChild(img);
          return this.finishAtomic(el, d, label);
        }
        text = '◈ ' + icn;
        break;
      }
      default:
        if (NO_LABEL[name]) text = NO_LABEL[name];
        else {
          text = textOf(el) || name;
        }
    }
    if (title) d.title = title;
    d.appendChild(document.createTextNode(text));
    return this.finishAtomic(el, d, label);
  }

  private finishAtomic(el: Element, d: HTMLElement, label: string): HTMLElement {
    if (label) d.prepend(this.gen('span', 'x-field-label', label));
    if (this.opts.showTags) d.prepend(this.gen('span', 'x-tag x-tag-inline-atomic', el.nodeName));
    return d;
  }

  private renderAtomicBlock(el: Element): HTMLElement {
    const d = this.baseEl('div', el, 'atomic-block');
    d.contentEditable = 'false';
    if (this.opts.showTags) d.appendChild(this.tagStart(el, true));
    if (el.nodeName === 'graphic') {
      const icn = el.getAttribute('infoEntityIdent') ?? '';
      const url = this.opts.images(icn);
      if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = icn;
        img.draggable = false;
        img.className = 'x-graphic-img';
        // reproduction size in any S1000D unit (mm, cm, in, pt, pc); both given = that exact box, one = the other follows the aspect ratio
        const rw = lengthToPx(el.getAttribute('reproductionWidth'));
        const rh = lengthToPx(el.getAttribute('reproductionHeight'));
        if (rw) img.style.width = `min(100%, ${rw}px)`;
        if (rh && rw) img.style.aspectRatio = `${rw} / ${rh}`;
        else if (rh) img.style.height = `${rh}px`;
        const wrap = document.createElement('div');
        wrap.className = 'x-graphic-wrap';
        wrap.appendChild(img);
        for (const pos of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
          const handle = this.gen('span', `x-resize-handle x-resize-${pos}`);
          handle.dataset.resizeHandle = pos;
          handle.title = 'Drag to resize (aspect ratio kept; hold Shift to change it)';
          wrap.appendChild(handle);
        }
        d.appendChild(wrap);
      } else {
        const ph = document.createElement('div');
        ph.className = 'x-graphic-ph';
        ph.innerHTML = '<div class="x-graphic-ph-icon">🖼</div>';
        const n = document.createElement('div');
        n.className = 'x-graphic-ph-name';
        n.textContent = icn || '(no ICN)';
        const hint = document.createElement('div');
        hint.className = 'x-graphic-ph-hint';
        hint.textContent = 'Image not linked — double-click to link an image file';
        ph.append(n, hint);
        d.appendChild(ph);
      }
      const cap = document.createElement('div');
      cap.className = 'x-graphic-icn';
      cap.textContent = icn;
      d.appendChild(cap);
    } else {
      d.appendChild(document.createTextNode(`${el.nodeName} ${el.getAttribute('infoEntityIdent') ?? el.getAttribute('id') ?? ''}`));
    }
    return d;
  }

  private renderTable(el: Element): HTMLElement {
    const d = this.baseEl('div', el, 'block');
    if (this.opts.showTags) d.appendChild(this.tagStart(el, true));
    this.decorateStart(el, d);
    if (!elementChildren(el).some((c) => c.nodeName === 'title')) {
      // every table is numbered, even without a title (S1000D makes the title optional)
      const num = this.labels.numbers.get(el);
      d.appendChild(this.gen('div', 'x-caption-standalone', `Table ${num ?? ''}`));
    }
    for (const c of Array.from(el.childNodes)) {
      const r = c.nodeType === 1 && c.nodeName === 'tgroup' ? this.renderTgroup(c as Element) : this.renderNode(c);
      if (r) d.appendChild(r);
    }
    if (this.opts.showTags) d.appendChild(this.tagEnd(el, true));
    return d;
  }

  private renderTgroup(tg: Element): HTMLElement {
    const t = document.createElement('table');
    t.className = 'x x-tgroup';
    t.setAttribute('data-x', 'tgroup');
    this.map(tg, t);
    const table = tg.parentNode as Element;
    const frame = table?.getAttribute('frame') ?? 'all';
    t.setAttribute('data-frame', frame);
    const grid = buildGrid(tg);
    // column widths from colspec colwidth (proportional "n*" or absolute)
    const cg = document.createElement('colgroup');
    cg.setAttribute('data-gen', '');
    const widths = grid.colspecs.map((c) => c.getAttribute('colwidth') ?? '');
    const stars = widths.map((w) => (/^\s*([\d.]+)\*\s*$/.test(w) ? parseFloat(w) : 0));
    const total = stars.reduce((a, b) => a + b, 0);
    for (let i = 0; i < grid.cols; i++) {
      const col = document.createElement('col');
      const w = widths[i];
      if (w && total && stars[i]) col.style.width = `${(stars[i] / total) * 100}%`;
      else if (lengthToPx(w) != null) col.style.width = `${lengthToPx(w)}px`;
      cg.appendChild(col);
    }
    t.appendChild(cg);
    let firstRow = true;
    for (const sec of Array.from(tg.childNodes)) {
      if (sec.nodeType !== 1) continue;
      const s = sec as Element;
      const n = s.nodeName;
      if (n !== 'thead' && n !== 'tbody' && n !== 'tfoot') continue;
      const hs = document.createElement(n);
      hs.className = `x x-${n}`;
      hs.setAttribute('data-x', n);
      this.map(s, hs);
      for (const row of elementChildren(s)) {
        if (row.nodeName !== 'row') continue;
        const tr = document.createElement('tr');
        tr.className = 'x x-row';
        tr.setAttribute('data-x', 'row');
        this.map(row, tr);
        for (const entry of elementChildren(row)) {
          const cell = grid.cellOf.get(entry);
          const td = document.createElement(n === 'thead' ? 'th' : 'td');
          td.className = 'x x-entry';
          td.setAttribute('data-x', 'entry');
          this.map(entry, td);
          if (cell && cell.colspan > 1) td.colSpan = cell.colspan;
          if (cell && cell.rowspan > 1) td.rowSpan = cell.rowspan;
          const align = entry.getAttribute('align') ?? grid.colspecs[cell?.col ?? 0]?.getAttribute('align');
          if (align) td.style.textAlign = align === 'justify' ? 'justify' : align === 'char' ? 'right' : align;
          const valign = entry.getAttribute('valign') ?? row.getAttribute('valign');
          if (valign) td.style.verticalAlign = valign;
          if (this.opts.showTags) td.appendChild(this.tagStart(entry, false));
          this.appendChildren(entry, td);
          this.placeholder(entry, td, true);
          if (!td.childNodes.length || Array.from(td.childNodes).every((c) => (c as Element).hasAttribute?.('data-gen'))) {
            // element-only entry without content: caret target
            const br = document.createElement('br');
            br.setAttribute('data-gen', 'br');
            td.appendChild(br);
          }
          if (firstRow && cell) {
            const lastCol = cell.col + cell.colspan - 1;
            if (lastCol < grid.cols - 1) {
              const handle = this.gen('span', 'x-col-resize');
              handle.dataset.colResize = String(lastCol);
              handle.title = 'Drag to resize column';
              td.appendChild(handle);
            }
          }
          tr.appendChild(td);
        }
        hs.appendChild(tr);
        firstRow = false;
      }
      t.appendChild(hs);
    }
    return t;
  }
}

function isIdentDescendant(el: Element): boolean {
  for (let c: Node | null = el.parentNode; c && c.nodeType === 1; c = c.parentNode) if (c.nodeName === 'identAndStatusSection') return true;
  return false;
}

function depthOf(list: Element, name: string): number {
  let d = 0;
  for (let c: Node | null = list.parentNode; c && c.nodeType === 1; c = c.parentNode) if (c.nodeName === name) d++;
  return d;
}

function listNumber(i: number, depth: number): string {
  switch (depth % 3) {
    case 1: return String.fromCharCode(96 + ((i - 1) % 26) + 1);
    case 2: return toRoman(i).toLowerCase();
    default: return String(i);
  }
}

function toRoman(n: number): string {
  const m: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, r] of m) while (n >= v) { s += r; n -= v; }
  return s;
}

export { EMPHASIS_TYPES };
