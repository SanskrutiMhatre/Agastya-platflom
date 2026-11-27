/**
 * Side panels: document outline / structure tree, attribute inspector,
 * insertable-elements list and validation problems.
 */
import type { App } from './app';
import type { DocumentEditor } from './editor';
import { h, icon, clear, download } from './dom';
import { elementChildren, textOf } from '../core/xml';
import { friendlyName, elementDescription } from '../core/elementInfo';
import { ATOMIC } from '../core/display';
import { idPrefixFor } from '../core/ids';
import { xsdRegex } from '../../../../backend/src/shared/xsdRegex';
import { uniqueId } from '../core/ops';
import { buildLabels } from '../view/labels';
import type { AttrInfo } from '../core/grammar';
import type { ValidationIssue } from '../validation/types';
import { EMPHASIS_TYPES, SECURITY_LABELS } from '../core/s1000d';
import { storage } from './storage';
import { DEFAULT_SETTINGS as DEFAULT_PDF_SETTINGS, type PublicationSettings } from '../export/pdf-settings';
import type { PdfBuildOptions, PdfProgress } from '../export/pdf-input';

// ---------------------------------------------------------------------- outline
/**
 * Document outline: the data module itself as the root entry, with only its
 * headings and sub-headings (`levelledPara`) nested beneath — no individual
 * elements, paragraphs, tables or figures. For structural inspection of the
 * raw XML, use the XML or Tags view instead.
 */
export class OutlinePanel {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private rows = new Map<Element, HTMLElement>();
  private editor: DocumentEditor | null = null;
  private filter = '';

  constructor(private app: App) {
    const search = h('input', { class: 'panel-filter', type: 'search', placeholder: 'Filter headings…', 'aria-label': 'Filter navigation', on: { input: (e: Event) => { this.filter = (e.target as HTMLInputElement).value.toLowerCase(); this.render(); } } });
    this.body = h('div', { class: 'panel-body tree', role: 'tree' });
    this.el = h('section', { class: 'panel outline-panel', 'aria-label': 'Outline' },
      h('div', { class: 'panel-head' }, 'Outline'),
      h('div', { class: 'panel-toolbar' }, search),
      this.body,
    );
  }

  setEditor(ed: DocumentEditor | null) {
    this.editor = ed;
    this.render();
  }

  render() {
    clear(this.body);
    this.rows.clear();
    const ed = this.editor;
    if (!ed || !ed.doc.root) {
      this.body.appendChild(h('div', { class: 'panel-empty' }, 'No document open'));
      return;
    }
    const list = h('ul', { class: 'outline-list', role: 'group' });
    const ident = ed.doc.ident;
    const dmLabel = ident?.techName ? `${ident.techName}${ident.infoName ? ' – ' + ident.infoName : ''}` : ed.doc.fileName;
    list.appendChild(this.outlineRow(ed, ed.doc.root, dmLabel, 'file', 0, true));
    const content = ed.doc.xml.getElementsByTagName('content')[0];
    const labels = buildLabels(ed.doc.xml);
    let any = false;
    const walk = (el: Element, depth: number) => {
      for (const c of elementChildren(el)) {
        if (c.nodeName === 'levelledPara') {
          const num = labels.numbers.get(c);
          const title = elementChildren(c).find((k) => k.nodeName === 'title');
          const text = `${num ?? ''} ${title ? textOf(title) : '(untitled)'}`.trim();
          if (!this.filter || text.toLowerCase().includes(this.filter)) {
            list.appendChild(this.outlineRow(ed, c, text, 'section', depth + 1));
            any = true;
          } else if (this.hasMatchingDescendant(c)) {
            list.appendChild(this.outlineRow(ed, c, text, 'section', depth + 1));
          }
          walk(c, depth + 1);
        } else walk(c, depth);
      }
    };
    if (content) walk(content, 0);
    this.body.appendChild(list);
    if (!any && this.filter) this.body.appendChild(h('div', { class: 'panel-empty' }, 'No matching headings'));
    else if (!content || !elementChildren(content).some((c) => c.nodeName === 'levelledPara' || elementChildren(c).some((k) => k.nodeName === 'levelledPara'))) {
      this.body.appendChild(h('div', { class: 'panel-empty small' }, 'This data module has no headings yet'));
    }
    this.highlightCurrent();
  }

  private hasMatchingDescendant(el: Element): boolean {
    if (!this.filter) return true;
    for (const d of Array.from(el.getElementsByTagName('levelledPara'))) {
      const title = elementChildren(d).find((k) => k.nodeName === 'title');
      if (title && textOf(title).toLowerCase().includes(this.filter)) return true;
    }
    return false;
  }

  private outlineRow(ed: DocumentEditor, el: Element, text: string, ic: string, depth: number, isRoot = false): HTMLElement {
    const row: HTMLElement = h('li', {
      class: 'outline-row' + (isRoot ? ' outline-root' : ''), role: 'treeitem', 'aria-level': String(depth + 1), 'aria-selected': 'false', style: { paddingLeft: `${8 + depth * 14}px` }, title: text, tabindex: isRoot ? '0' : '-1',
      on: {
        click: () => this.go(ed, el),
        keydown: (e: Event) => {
          const k = (e as KeyboardEvent).key;
          const all = Array.from(this.body.querySelectorAll<HTMLElement>('.outline-row'));
          const i = all.indexOf(row);
          const move = (j: number) => {
            const t = all[Math.max(0, Math.min(all.length - 1, j))];
            if (!t) return;
            for (const r of all) r.tabIndex = -1;
            t.tabIndex = 0;
            t.focus();
          };
          if (k === 'ArrowDown') move(i + 1);
          else if (k === 'ArrowUp') move(i - 1);
          else if (k === 'Home') move(0);
          else if (k === 'End') move(all.length - 1);
          else if (k === 'Enter' || k === ' ') this.go(ed, el);
          else return;
          e.preventDefault();
        },
      },
    }, icon(ic, 14), h('span', { class: 'outline-text' }, text || friendlyName(el.nodeName)));
    this.rows.set(el, row);
    return row;
  }

  private go(ed: DocumentEditor, el: Element) {
    if (el === ed.doc.root) {
      const ident = ed.doc.xml.getElementsByTagName('identAndStatusSection')[0];
      if (ident) ed.design.reveal(ident, false);
      this.app.run('tools.dmProps');
      return;
    }
    ed.showIssueLocation({ severity: 'info', source: 'editor', message: '', node: el });
    ed.focus();
  }

  /** Marks the outline entry of the current heading (or the data module root, if none). */
  highlightCurrent() {
    this.body.querySelectorAll('.current').forEach((e) => {
      e.classList.remove('current');
      e.setAttribute('aria-selected', 'false');
    });
    const ed = this.editor;
    if (!ed) return;
    for (let c: Node | null = ed.currentElement(); c && c.nodeType === 1; c = c.parentNode) {
      const row = this.rows.get(c as Element);
      if (row) {
        row.classList.add('current');
        row.setAttribute('aria-selected', 'true');
        if (row.scrollIntoView && this.el.offsetParent) row.scrollIntoView({ block: 'nearest' });
        return;
      }
    }
    const rootRow = ed.doc.root && this.rows.get(ed.doc.root);
    rootRow?.classList.add('current');
    rootRow?.setAttribute('aria-selected', 'true');
  }

  revealCurrent(_force = false) {
    this.highlightCurrent();
  }
}

// ------------------------------------------------------------------- attributes
const FRIENDLY_VALUES: Record<string, Record<string, string>> = {
  emphasisType: EMPHASIS_TYPES,
  securityClassification: SECURITY_LABELS,
  changeType: { add: 'Added', modify: 'Modified', delete: 'Deleted' },
  changeMark: { '0': 'No', '1': 'Yes' },
  listItemPrefix: { pf01: 'None', pf02: 'Bullet', pf03: 'Dash', pf04: 'Circle', pf05: 'Square', pf06: 'Tick', pf07: 'Check box' },
};

export class AttributesPanel {
  readonly el: HTMLElement;
  private head: HTMLElement;
  private body: HTMLElement;
  private current: Element | null = null;
  private editor: DocumentEditor | null = null;
  private filter = '';

  constructor(private app: App) {
    this.head = h('div', { class: 'attr-head' });
    this.body = h('div', { class: 'panel-body attr-body' });
    const search = h('input', { class: 'panel-filter', type: 'search', placeholder: 'Filter attributes…', 'aria-label': 'Filter attributes', on: { input: (e: Event) => { this.filter = (e.target as HTMLInputElement).value.toLowerCase(); this.render(true); } } });
    this.el = h('section', { class: 'panel attr-panel', 'aria-label': 'Attributes' }, this.head, h('div', { class: 'panel-toolbar' }, search), this.body);
  }

  setEditor(ed: DocumentEditor | null) {
    this.editor = ed;
    this.current = null;
    this.render(true);
  }

  private sig = '';

  update() {
    const el = this.editor?.currentElement() ?? null;
    if (el === this.current && attrSig(el) === this.sig && !this.dirtyValues()) return;
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.attr;
    this.render(el !== this.current);
    if (focused && el === this.current) this.body.querySelector<HTMLElement>(`[data-attr="${focused}"]`)?.focus();
  }

  private dirtyValues(): boolean {
    if (!this.current) return false;
    for (const inp of Array.from(this.body.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-attr]'))) {
      if (document.activeElement === inp) return false;
      const v = this.current.getAttribute(inp.dataset.attr!) ?? '';
      if (inp.value !== v && !(inp.tagName === 'SELECT' && v === '' && inp.value === '')) return true;
    }
    return false;
  }

  focusFirst() {
    const f = this.body.querySelector<HTMLElement>('input,select');
    f?.focus();
  }

  render(_structural = true) {
    const ed = this.editor;
    const el = ed?.currentElement() ?? null;
    this.current = el;
    this.sig = attrSig(el);
    clear(this.head);
    clear(this.body);
    if (!ed || !el) {
      this.body.appendChild(h('div', { class: 'panel-empty' }, 'No element selected'));
      return;
    }
    const g = ed.grammar;
    // breadcrumbs of ancestors
    const crumbs = h('div', { class: 'attr-crumbs' });
    const chain: Element[] = [];
    for (let c: Node | null = el; c && c.nodeType === 1; c = c.parentNode) chain.unshift(c as Element);
    chain.slice(-4).forEach((c, i, arr) => {
      crumbs.appendChild(h('button', { class: 'crumb' + (c === el ? ' active' : ''), on: { click: () => ed.selectElement(c, { scroll: true }) } }, c.nodeName));
      if (i < arr.length - 1) crumbs.appendChild(h('span', { class: 'crumb-sep' }, '›'));
    });
    this.head.append(
      h('div', { class: 'attr-title' }, h('span', { class: 'attr-el' }, `<${el.nodeName}>`), h('span', { class: 'attr-friendly' }, friendlyName(el.nodeName))),
      ...(elementDescription(el.nodeName) ? [h('div', { class: 'attr-desc' }, elementDescription(el.nodeName))] : []),
      crumbs,
    );
    const defs: AttrInfo[] = g?.has(el.nodeName) ? g.attributes(el.nodeName).filter((a) => a.name !== '*') : [];
    const known = new Set(defs.map((d) => d.name));
    const extra = Array.from(el.attributes).filter((a) => !known.has(a.name) && !a.name.startsWith('xmlns'));
    const list = h('div', { class: 'attr-list' });
    const set = defs.filter((d) => el.hasAttribute(d.name));
    const unset = defs.filter((d) => !el.hasAttribute(d.name));
    const req = unset.filter((d) => d.required);
    const opt = unset.filter((d) => !d.required);
    const match = (n: string) => !this.filter || n.toLowerCase().includes(this.filter);
    const section = (label: string, items: AttrInfo[]) => {
      const f = items.filter((d) => match(d.name));
      if (!f.length) return;
      list.appendChild(h('div', { class: 'attr-section' }, label));
      for (const d of f) list.appendChild(this.row(ed, el, d));
    };
    section('Set', set);
    section('Required', req);
    if (extra.length) {
      list.appendChild(h('div', { class: 'attr-section' }, g ? 'Not in schema' : 'Attributes'));
      for (const a of extra) if (match(a.name)) list.appendChild(this.row(ed, el, { name: a.name, required: false, base: 'string', facets: {} }, !!g));
    }
    section('Available', opt);
    if (!defs.length && !extra.length) list.appendChild(h('div', { class: 'panel-empty' }, `<${el.nodeName}> has no attributes`));
    // free-form add (no grammar or for xmlns etc.)
    if (!g || !g.has(el.nodeName)) {
      const name = h('input', { class: 'attr-input', placeholder: 'name', 'aria-label': 'New attribute name' });
      const value = h('input', { class: 'attr-input', placeholder: 'value', 'aria-label': 'New attribute value' });
      list.appendChild(h('div', { class: 'attr-add' }, name, value, h('button', { class: 'btn btn-sm', on: { click: () => { if (name.value.trim()) ed.setAttribute(el, name.value.trim(), value.value); } } }, 'Add')));
    }
    this.body.appendChild(list);
    // text summary for atomic / special elements
    if (ATOMIC.has(el.nodeName) || el.nodeName === 'graphic' || el.nodeName === 'dmRef') {
      this.body.appendChild(h('div', { class: 'attr-actions' }, h('button', { class: 'btn btn-sm', on: { click: () => this.app.openProperties(el, true) } }, icon('props', 14), ' Edit in dialog…')));
    }
  }

  private row(ed: DocumentEditor, el: Element, d: AttrInfo, foreign = false): HTMLElement {
    const value = el.getAttribute(d.name);
    const isSet = value != null;
    const label = h('label', { class: 'attr-name' + (d.required ? ' required' : '') + (foreign ? ' foreign' : ''), title: describeType(d) }, d.name);
    let control: HTMLInputElement | HTMLSelectElement;
    const commit = (v: string | null) => {
      if (v === (el.getAttribute(d.name) ?? null)) return;
      // an emptied optional attribute is removed, not left as attr="" (empty is rarely valid and never what was meant)
      if (v === '' && !d.required) v = null;
      if (!ed.setAttribute(el, d.name, v)) this.render(true); // refused (e.g. an id that is already used): show the real value again
    };
    if (d.enumValues && !d.openEnum && d.enumValues.length <= 600) {
      const sel = h('select', { class: 'attr-input', 'data-attr': d.name, 'aria-label': d.name });
      sel.appendChild(h('option', { value: '' }, d.default ? `(default: ${d.default})` : '(not set)'));
      const friendly = FRIENDLY_VALUES[d.name] ?? {};
      for (const v of d.enumValues) sel.appendChild(h('option', { value: v }, friendly[v] ? `${v} – ${friendly[v]}` : v));
      if (isSet && !d.enumValues.includes(value!)) sel.appendChild(h('option', { value: value! }, `${value} (invalid)`));
      sel.value = value ?? '';
      sel.addEventListener('change', () => commit(sel.value === '' ? null : sel.value));
      control = sel;
    } else {
      const inp = h('input', { class: 'attr-input', 'data-attr': d.name, 'aria-label': d.name, value: value ?? '', placeholder: d.default ? `default: ${d.default}` : d.fixed ?? '', spellcheck: 'false' });
      const listId = this.datalistFor(ed, d, el);
      if (listId) inp.setAttribute('list', listId);
      const check = () => {
        const err = validateAttr(d, inp.value);
        inp.classList.toggle('invalid', !!err && inp.value !== '');
        inp.title = err ?? '';
      };
      check();
      inp.addEventListener('input', check);
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit(inp.value === '' && !isSet ? null : inp.value);
        } else if (e.key === 'Escape') {
          inp.value = el.getAttribute(d.name) ?? '';
          check();
        }
      });
      inp.addEventListener('change', () => commit(inp.value === '' && !el.hasAttribute(d.name) ? null : inp.value));
      control = inp;
    }
    const actions = h('span', { class: 'attr-row-actions' });
    if (d.base === 'ID' && !isSet) actions.appendChild(h('button', { class: 'icon-btn', title: 'Generate ID', on: { click: () => ed.setAttribute(el, d.name, uniqueSuggest(ed, el)) } }, icon('id', 13)));
    if (isSet && !d.required) actions.appendChild(h('button', { class: 'icon-btn', title: 'Remove attribute', on: { click: () => ed.setAttribute(el, d.name, null) } }, icon('close', 13)));
    return h('div', { class: 'attr-row' + (isSet ? ' set' : '') }, label, control, actions);
  }

  private datalistFor(ed: DocumentEditor, d: AttrInfo, el: Element): string | null {
    let values: string[] = [];
    if (d.base === 'IDREF' || d.base === 'IDREFS') {
      values = Array.from(ed.doc.xml.querySelectorAll('[id]')).map((e) => e.getAttribute('id')!).filter((v) => v !== el.getAttribute('id'));
    } else if (d.base === 'ENTITY' || d.base === 'ENTITIES') {
      values = [...new Set([...(ed.doc.doctype?.decls ?? []).filter((x) => x.kind === 'entity').map((x) => x.name!), ...this.app.images.names()])];
    } else if (d.enumValues && d.openEnum) values = d.enumValues;
    else if (d.enumValues && d.enumValues.length > 600) values = d.enumValues;
    if (!values.length) return null;
    const id = 'dl-' + d.name;
    let dl = document.getElementById(id) as HTMLDataListElement | null;
    if (!dl) {
      dl = h('datalist', { id });
      document.body.appendChild(dl);
    }
    clear(dl);
    for (const v of values.slice(0, 2000)) dl.appendChild(h('option', { value: v }));
    return id;
  }
}

function attrSig(el: Element | null): string {
  if (!el) return '';
  return el.nodeName + '|' + Array.from(el.attributes).map((a) => a.name + '=' + a.value).join('|');
}

function uniqueSuggest(ed: DocumentEditor, el: Element): string {
  return uniqueId(ed.doc.xml, idPrefixFor(el.nodeName));
}

function describeType(d: AttrInfo): string {
  const parts = [d.required ? 'Required' : 'Optional', `type: ${d.base}${d.list ? ' list' : ''}`];
  if (d.default) parts.push(`default: ${d.default}`);
  if (d.fixed) parts.push(`fixed: ${d.fixed}`);
  if (d.patterns) parts.push(`pattern: ${d.patterns.join(' | ')}`);
  if (d.enumValues) parts.push(`${d.enumValues.length} allowed values`);
  return parts.join('\n');
}

export function validateAttr(d: AttrInfo, v: string): string | null {
  if (v === '') return d.required ? 'Required attribute' : null;
  if (d.fixed != null && v !== d.fixed) return `Must be "${d.fixed}"`;
  const items = d.list ? v.split(/\s+/) : [v];
  for (const x of items) {
    if (d.enumValues && !d.openEnum && !d.enumValues.includes(x)) return `Not an allowed value`;
    if (d.patterns && !d.patterns.some((p) => safeTest(p, x))) return `Does not match pattern ${d.patterns.join(' | ')}`;
    switch (d.base) {
      case 'ID': case 'IDREF': case 'NCName': case 'ENTITY':
        if (!/^[A-Za-z_][\w.-]*$/.test(x)) return 'Must be an XML name (letters, digits, "-", "_", ".")';
        break;
      case 'NMTOKEN': case 'NMTOKENS':
        if (!/^[\w.:-]+$/.test(x)) return 'Must be a name token';
        break;
      case 'positiveInteger': if (!/^\+?0*[1-9]\d*$/.test(x)) return 'Must be a positive integer'; break;
      case 'nonNegativeInteger': if (!/^\+?\d+$/.test(x)) return 'Must be a non-negative integer'; break;
      case 'integer': if (!/^[+-]?\d+$/.test(x)) return 'Must be an integer'; break;
      case 'decimal': if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(x)) return 'Must be a decimal number'; break;
      case 'date': if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) return 'Must be a date (YYYY-MM-DD)'; break;
    }
    if (d.facets.minLength && x.length < +d.facets.minLength) return `At least ${d.facets.minLength} characters`;
    if (d.facets.maxLength && x.length > +d.facets.maxLength) return `At most ${d.facets.maxLength} characters`;
    if (d.facets.length && x.length !== +d.facets.length) return `Exactly ${d.facets.length} characters`;
  }
  return null;
}

/** Whether `v` matches an XSD pattern; a pattern this editor cannot translate never rejects anything (the XSD validation decides). */
function safeTest(p: string, v: string): boolean {
  const re = xsdRegex(p);
  return re ? re.test(v) : true;
}

// --------------------------------------------------------------------- elements
export class ElementsPanel {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private editor: DocumentEditor | null = null;
  private filter = '';

  private context: HTMLElement;

  constructor(private app: App) {
    this.body = h('div', { class: 'panel-body elements-body' });
    this.context = h('div', { class: 'el-context' });
    const search = h('input', { class: 'panel-filter', type: 'search', placeholder: 'Filter elements…', 'aria-label': 'Filter elements', on: { input: (e: Event) => { this.filter = (e.target as HTMLInputElement).value.toLowerCase(); this.render(); } } });
    this.el = h('section', { class: 'panel elements-panel', 'aria-label': 'Elements' }, this.context, h('div', { class: 'panel-toolbar' }, search), this.body);
  }

  setEditor(ed: DocumentEditor | null) {
    this.editor = ed;
    this.render();
  }

  render() {
    clear(this.body);
    clear(this.context);
    const ed = this.editor;
    if (!ed) {
      this.body.appendChild(h('div', { class: 'panel-empty' }, 'No document open'));
      return;
    }
    if (!ed.grammar) {
      this.body.appendChild(h('div', { class: 'panel-empty' }, 'No schema grammar for this document — structured insertion is unavailable. Use the XML view to edit.'));
      return;
    }
    if (ed.readOnlyReason()) {
      this.body.appendChild(h('div', { class: 'panel-empty' }, ed.readOnlyReason()!));
      return;
    }
    const container = ed.insertionContainer();
    this.context.appendChild(container
      ? h('span', null, 'Editing inside ', h('span', { class: 'el-context-name' }, `<${container.nodeName}>`), ' ', h('span', { class: 'el-context-friendly' }, friendlyName(container.nodeName)))
      : h('span', { class: 'el-context-friendly' }, 'No insertion point selected'));
    const { inline, block } = ed.insertableElements();
    const mk = (title: string, names: string[], hint: string) => {
      const f = names.filter((n) => !this.filter || n.toLowerCase().includes(this.filter) || friendlyName(n).toLowerCase().includes(this.filter));
      this.body.appendChild(h('div', { class: 'el-section' }, title, h('span', { class: 'el-count' }, String(f.length))));
      if (!f.length) {
        this.body.appendChild(h('div', { class: 'panel-empty small' }, hint));
        return;
      }
      const ul = h('ul', { class: 'el-list' });
      for (const n of f) {
        ul.appendChild(h('li', { class: 'el-item', title: elementDescription(n) || n, tabindex: '0', on: {
          click: () => { ed.insertElementNamed(n); ed.focus(); },
          keydown: (e: Event) => { if ((e as KeyboardEvent).key === 'Enter') { ed.insertElementNamed(n); ed.focus(); } },
        } }, h('span', { class: 'el-name' }, n), h('span', { class: 'el-friendly' }, friendlyName(n))));
      }
      this.body.appendChild(ul);
    };
    mk('At cursor', inline, 'No inline elements allowed at the cursor');
    mk('Insert nearby', block, 'No structural elements allowed here');
    void this.app;
  }
}

// ---------------------------------------------------------------------- pdf
/**
 * S1000D publication PDF, placed beside the Attributes and Elements tabs.
 *  - "Quick preview" renders only the active data module in the publication's page format (mirrored margins,
 *    running header/footer, numbering, tables, figures) — no title page, contents lists or blank pages — and
 *    opens it in a new tab.
 *  - "Generate" builds the complete publication from the data modules the user has ticked (the active one is always
 *    included): title page, table of contents, list of illustrations and abbreviations, then every data module on a
 *    right-hand page, with continuous page numbers.
 * The publication settings (titles, issue, classification, logo, cover, watermark) are kept in IndexedDB.
 */
type PdfSettings = PublicationSettings;
type PdfTextSetting = 'title' | 'shortTitle' | 'pmCode' | 'issueNumber' | 'issueDate' | 'publisher' | 'classification' | 'headerText' | 'watermarkText';

const SETTINGS_KEY = 'pdf-settings';

export class PdfPanel {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private editor: DocumentEditor | null = null;
  /** Data modules the user ticked for "Generate" (the active one is implied; closed editors are pruned on render). */
  private included = new Set<DocumentEditor>();
  private busy = false;
  /** Cancels the export in progress, and the progress line it shows. */
  private abort: AbortController | null = null;
  private status = '';
  private settings: PdfSettings = { ...DEFAULT_PDF_SETTINGS };
  private settingsOpen = false;

  constructor(private app: App) {
    this.body = h('div', { class: 'panel-body pdf-body' });
    this.el = h('section', { class: 'panel pdf-panel', 'aria-label': 'PDF' }, h('div', { class: 'panel-head' }, 'PDF'), this.body);
    void storage.get<Partial<PdfSettings>>('kv', SETTINGS_KEY).then((s) => {
      if (s) {
        this.settings = { ...DEFAULT_PDF_SETTINGS, ...s };
        this.render();
      }
    });
  }

  setEditor(ed: DocumentEditor | null) {
    this.editor = ed;
    this.render();
  }

  private saveSettings() {
    void storage.put('kv', SETTINGS_KEY, this.settings);
  }

  render() {
    clear(this.body);
    const ed = this.editor;
    for (const e of [...this.included]) if (!this.app.editors.includes(e)) this.included.delete(e);
    if (!ed) {
      this.body.appendChild(h('div', { class: 'panel-empty' }, 'No document open'));
      return;
    }
    const ident = ed.doc.ident;
    if (this.busy) {
      this.body.append(
        h('div', { class: 'pdf-section pdf-progress', role: 'status', 'aria-live': 'polite' },
          h('div', { class: 'pdf-progress-text', 'data-testid': 'pdf-progress' }, this.status || 'Working…'),
          h('button', { class: 'btn', 'data-testid': 'pdf-cancel', on: { click: () => this.abort?.abort() } }, 'Cancel'),
        ),
      );
    }
    this.body.append(
      h('div', { class: 'pdf-current' },
        h('div', { class: 'pdf-current-label' }, 'Active data module'),
        h('div', { class: 'pdf-current-dmc' }, ident?.dmc ?? ed.doc.fileName),
      ),
      h('div', { class: 'pdf-section' },
        h('button', { class: 'btn', disabled: this.busy || undefined, on: { click: () => this.quickPreview() } }, icon('eye', 14), ' Quick preview'),
        h('p', { class: 'pdf-hint' }, 'Formats only the active data module with the publication page layout (headers, footers, numbering, tables, figures) and opens it in a new tab. No title page or contents lists.'),
      ),
    );
    const others = this.app.editors.filter((e) => e !== ed);
    const list = h('div', { class: 'pdf-list' });
    const row = (e: DocumentEditor, locked: boolean) => {
      const id = e.doc.ident;
      const cb = h('input', { type: 'checkbox', checked: locked || this.included.has(e) || undefined, disabled: locked || undefined }) as HTMLInputElement;
      cb.checked = locked || this.included.has(e);
      cb.addEventListener('change', () => {
        if (cb.checked) this.included.add(e);
        else this.included.delete(e);
        this.render();
      });
      return h('label', { class: 'pdf-dm-row' }, cb, h('span', { class: 'pdf-dm-dmc' }, id?.dmc ?? e.doc.fileName), locked ? h('span', { class: 'pdf-dm-active' }, 'active') : null);
    };
    list.append(row(ed, true), ...others.map((e) => row(e, false)));
    this.body.append(
      h('div', { class: 'pdf-section' },
        h('div', { class: 'pdf-current-label' }, `Data modules to generate (${this.generateSet(ed).length})`),
        list,
        h('button', { class: 'btn btn-primary', disabled: this.busy || undefined, on: { click: () => this.generate() } }, icon('pdf', 14), ' Generate'),
        h('p', { class: 'pdf-hint' }, 'Builds the complete publication from the ticked data modules: title page, table of contents, list of illustrations and abbreviations, then each data module on a right-hand page with its own contents lists, headers, footers and continuous page numbers.'),
      ),
      this.settingsSection(),
    );
  }

  /** The data modules "Generate" prints: the active one plus the ticked ones, in tab order. */
  private generateSet(ed: DocumentEditor): DocumentEditor[] {
    return this.app.editors.filter((e) => e === ed || this.included.has(e));
  }

  private settingsSection(): HTMLElement {
    const S = this.settings;
    const text = (label: string, key: PdfTextSetting, placeholder = '') => {
      const input = h('input', { type: 'text', value: S[key], placeholder, 'aria-label': label, on: {
        change: (e: Event) => { this.settings[key] = (e.target as HTMLInputElement).value.trim(); this.saveSettings(); },
      } });
      return h('label', { class: 'pdf-field' }, h('span', null, label), input);
    };
    const file = (label: string, key: 'logo' | 'cover') => {
      const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/svg+xml', class: 'pdf-file', 'aria-label': label, on: {
        change: async (e: Event) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (!f) return;
          this.settings[key] = await readAsDataUrl(f);
          this.saveSettings();
          this.render();
        },
      } });
      const current = S[key];
      return h('div', { class: 'pdf-field' }, h('span', null, label),
        current
          ? h('div', { class: 'pdf-file-row' }, h('img', { class: 'pdf-thumb', src: current, alt: '' }),
            h('button', { class: 'btn btn-small', type: 'button', on: { click: () => { this.settings[key] = null; this.saveSettings(); this.render(); } } }, 'Remove'))
          : input);
    };
    const wm = h('select', { 'aria-label': 'Watermark', on: { change: (e: Event) => { this.settings.watermark = (e.target as HTMLSelectElement).value as PdfSettings['watermark']; this.saveSettings(); } } },
      h('option', { value: 'auto', selected: S.watermark === 'auto' || undefined }, 'Automatic (unreleased data modules)'),
      h('option', { value: 'on', selected: S.watermark === 'on' || undefined }, 'Always'),
      h('option', { value: 'off', selected: S.watermark === 'off' || undefined }, 'Never'),
    );
    const details = h('details', { class: 'pdf-settings', open: this.settingsOpen || undefined, on: { toggle: (e: Event) => { this.settingsOpen = (e.target as HTMLDetailsElement).open; } } },
      h('summary', null, 'Publication settings'),
      h('p', { class: 'pdf-hint' }, 'Used by Generate and Quick preview. Empty fields are taken from the data modules.'),
      text('Publication title', 'title', 'Technical name of the first data module'),
      text('Short title', 'shortTitle', 'Information name'),
      text('Publication module code', 'pmCode', 'e.g. GNT-1671Y-00006-01'),
      text('Issue number', 'issueNumber', '000'),
      text('Issue date', 'issueDate', 'YYYY-MM-DD'),
      text('Publisher', 'publisher'),
      text('Classification', 'classification', 'Security classification of each data module'),
      text('Header text', 'headerText', '<model identification code> PUBLICATION'),
      h('label', { class: 'pdf-field' }, h('span', null, 'Watermark'), wm),
      text('Watermark text', 'watermarkText', 'NOT RELEASED'),
      file('Header logo', 'logo'),
      file('Cover image', 'cover'),
    );
    return h('div', { class: 'pdf-section' }, details);
  }

  private async withBusy(fn: (run: Pick<PdfBuildOptions, 'signal' | 'onProgress'>) => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    this.status = 'Preparing…';
    const abort = (this.abort = new AbortController());
    this.render();
    const onProgress = (p: PdfProgress) => {
      this.status = progressText(p);
      const el = this.body.querySelector('.pdf-progress-text');
      if (el) el.textContent = this.status;
    };
    try {
      await fn({ signal: abort.signal, onProgress });
    } finally {
      this.busy = false;
      this.abort = null;
      this.render();
    }
  }

  private async quickPreview() {
    const ed = this.editor;
    if (!ed) return;
    // Open the tab synchronously, in direct response to the click, before any
    // await: browsers drop the "opened by a user gesture" status (and so
    // silently block the popup) once control has gone through an async hop.
    const w = window.open('', '_blank');
    if (w) w.document.write('<title>Generating preview…</title><body style="font:14px system-ui;padding:2em;color:#555">Generating PDF preview…</body>');
    await this.withBusy(async (run) => {
      if (!ed.xml.flush()) { w?.close(); return this.app.toast('Fix the XML errors first', 'warning'); }
      try {
        const { exportPdfBlob } = await import('../export/pdf');
        const { blob, warnings } = await exportPdfBlob([ed.doc], this.app.images, { mode: 'preview', settings: this.settings, ...run });
        this.showPreview(blob, w);
        for (const wr of warnings.slice(0, 4)) this.app.toast(wr, 'warning');
      } catch (e) {
        w?.close();
        if ((e as Error).name === 'AbortError') return this.app.toast('Preview cancelled', 'info');
        console.error(e);
        this.app.toast(`Preview failed: ${(e as Error).message}`, 'error');
      }
    });
  }

  private async generate() {
    const ed = this.editor;
    if (!ed) return;
    const docs = this.generateSet(ed);
    await this.withBusy(async (run) => {
      for (const e of docs) if (!e.xml.flush()) return this.app.toast(`Fix the XML errors in "${e.doc.fileName}" first`, 'warning');
      this.app.toast(docs.length > 1 ? `Generating publication (${docs.length} data modules)…` : 'Generating PDF…', 'info');
      try {
        const { exportPdfBlob } = await import('../export/pdf');
        const { blob, warnings } = await exportPdfBlob(docs.map((e) => e.doc), this.app.images, { mode: 'publication', settings: this.settings, ...run });
        const name = docs.length > 1 ? 'Publication.pdf' : ed.doc.suggestedFileName().replace(/\.xml$/i, '.pdf');
        download(name, blob, 'application/pdf');
        this.app.toast(`Saved ${name}`, 'info');
        for (const w of warnings.slice(0, 4)) this.app.toast(w, 'warning');
        if (warnings.length > 4) this.app.toast(`…and ${warnings.length - 4} more.`, 'info');
      } catch (e) {
        if ((e as Error).name === 'AbortError') return this.app.toast('PDF generation cancelled', 'info');
        console.error(e);
        this.app.toast(`PDF generation failed: ${(e as Error).message}`, 'error');
      }
    });
  }

  private showPreview(blob: Blob, w: Window | null) {
    // A same-origin top-level tab, not an <iframe>: the browser's built-in PDF
    // viewer runs some features (e.g. remembering zoom/scroll in storage) that
    // misbehave with the opaque origin a sandboxed iframe gets for a blob: URL.
    const url = URL.createObjectURL(blob);
    if (!w) this.app.toast('Preview blocked by the browser — allow pop-ups to use Quick preview, or use Generate to download the PDF.', 'warning');
    else w.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

function progressText(p: PdfProgress): string {
  switch (p.phase) {
    case 'prepare': return 'Preparing data modules…';
    case 'measure': return p.page ? `Measuring pages… (page ${p.page})` : 'Measuring pages…';
    case 'layout': return p.page ? `Laying out page ${p.page}${p.pages ? ` of ${p.pages}` : ''}…` : 'Laying out pages…';
    case 'write': return 'Writing the PDF…';
    case 'finish': return 'Applying the page margins…';
  }
}

function readAsDataUrl(f: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

// --------------------------------------------------------------------- problems
export class ProblemsPanel {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private summary: HTMLElement;
  private editor: DocumentEditor | null = null;
  private filters = { error: true, warning: true, info: true };
  private shown: ValidationIssue[] = [];
  private index = -1;

  constructor(private app: App) {
    this.summary = h('div', { class: 'problems-summary' });
    this.list = h('div', { class: 'problems-list', role: 'list' });
    const tog = (k: 'error' | 'warning' | 'info', label: string, ic: string) => {
      const b = h('button', { class: 'chip-toggle active', 'aria-pressed': 'true', title: `Show ${label}` }, icon(ic, 13), h('span', { class: 'chip-count', 'data-count': k }, '0'), ' ' + label);
      b.addEventListener('click', () => {
        this.filters[k] = !this.filters[k];
        b.classList.toggle('active', this.filters[k]);
        b.setAttribute('aria-pressed', String(this.filters[k]));
        this.render();
      });
      return b;
    };
    const bar = h('div', { class: 'problems-bar' },
      h('span', { class: 'problems-title' }, 'Problems'),
      tog('error', 'Errors', 'error'), tog('warning', 'Warnings', 'warn'), tog('info', 'Info', 'info'),
      h('span', { class: 'spacer' }),
      this.summary,
      h('button', { class: 'btn btn-sm', title: 'Validate (F7)', on: { click: () => this.app.run('review.validate') } }, icon('validate', 14), ' Validate'),
      h('button', { class: 'icon-btn', title: 'Hide problems pane', on: { click: () => this.app.togglePane('bottom') } }, icon('close', 14)),
    );
    this.el = h('section', { class: 'panel problems-panel', 'aria-label': 'Problems' }, bar, this.list);
  }

  setEditor(ed: DocumentEditor | null) {
    this.editor = ed;
    this.index = -1;
    this.render();
  }

  render() {
    clear(this.list);
    const ed = this.editor;
    const r = ed?.report;
    const all = r?.issues ?? [];
    const counts = { error: 0, warning: 0, info: 0 };
    for (const i of all) counts[i.severity]++;
    this.el.querySelectorAll<HTMLElement>('[data-count]').forEach((c) => (c.textContent = String(counts[c.dataset.count as 'error'])));
    clear(this.summary);
    if (ed?.validating) this.summary.append(h('span', { class: 'spinner' }), ' Validating…');
    else if (r) {
      const parts: string[] = [];
      if (r.xsd?.ran) parts.push(`XSD ${r.xsd.valid ? '✓' : '✕'} (S1000D ${r.xsd.issue.replace('-', '.')} ${r.xsd.schema}.xsd)`);
      if (r.brex?.ran) parts.push(`BREX: ${r.brex.rules} rules${r.brex.skipped ? `, ${r.brex.skipped} skipped` : ''}`);
      this.summary.textContent = parts.join(' · ');
      this.summary.title = r.brex?.brexDmc.join(' → ') ?? '';
    } else this.summary.textContent = ed ? 'Not validated yet' : '';
    if (!ed) return;
    this.shown = all.filter((i) => this.filters[i.severity]);
    if (!this.shown.length) {
      this.list.appendChild(h('div', { class: 'panel-empty' }, r ? (all.length ? 'All problems are filtered out' : 'No problems found — the data module is valid.') : 'Run validation (F7) to check the data module against its S1000D schema and BREX.'));
      return;
    }
    this.shown.forEach((i, idx) => {
      const loc = i.line ? `Line ${i.line}` : i.path ? i.path.split('/').slice(-2).join('/') : '';
      const row = h('div', { class: `problem sev-${i.severity}` + (idx === this.index ? ' active' : ''), role: 'listitem', tabindex: '0', title: [i.message, i.detail, i.path].filter(Boolean).join('\n') },
        icon(i.severity === 'error' ? 'error' : i.severity === 'warning' ? 'warn' : 'info', 14),
        h('span', { class: 'problem-msg' }, i.message, i.detail ? h('span', { class: 'problem-detail' }, ' — ' + i.detail) : null),
        h('span', { class: 'problem-src' }, i.source.toUpperCase() + (i.ruleId && i.source === 'brex' ? ' ' + i.ruleId : '')),
        h('span', { class: 'problem-loc' }, loc),
      );
      row.addEventListener('click', () => this.open(idx));
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.open(idx); });
      this.list.appendChild(row);
    });
  }

  open(idx: number) {
    const ed = this.editor;
    const i = this.shown[idx];
    if (!ed || !i) return;
    this.index = idx;
    this.list.querySelectorAll('.problem').forEach((r, k) => r.classList.toggle('active', k === idx));
    ed.showIssueLocation(i);
  }

  step(dir: 1 | -1) {
    if (!this.shown.length) return this.app.toast('No problems', 'info');
    const n = this.shown.length;
    this.open(((this.index + dir) % n + n) % n);
    this.list.querySelector('.problem.active')?.scrollIntoView({ block: 'nearest' });
  }
}
