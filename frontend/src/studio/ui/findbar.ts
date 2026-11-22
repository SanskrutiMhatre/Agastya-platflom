/** Find & replace bar (docked above the editor). Works on the XML model. */
import type { App } from './app';
import { h, icon, debounce } from './dom';
import { FindOptions, Match, findAll, applyReplace, replacementFor } from './find';
import { openSearchPanel } from '@codemirror/search';
import * as ops from '../core/ops';

export class FindBar {
  readonly el: HTMLElement;
  private q: HTMLInputElement;
  private r: HTMLInputElement;
  private count: HTMLElement;
  private replaceRow: HTMLElement;
  private opts: FindOptions = { query: '', matchCase: false, wholeWord: false, regex: false, scope: 'all', attributes: false };
  private matches: Match[] = [];
  private index = -1;
  private scopeEl: Element | null = null;
  private refreshSoon = debounce(() => this.search(false), 200);

  constructor(private app: App) {
    this.q = h('input', { class: 'find-input', type: 'text', placeholder: 'Find', 'aria-label': 'Find', spellcheck: 'false' });
    this.r = h('input', { class: 'find-input', type: 'text', placeholder: 'Replace with', 'aria-label': 'Replace with', spellcheck: 'false' });
    this.count = h('span', { class: 'find-count', 'aria-live': 'polite' }, '');
    const toggle = (key: 'matchCase' | 'wholeWord' | 'regex' | 'attributes', label: string, title: string) => {
      const b = h('button', { class: 'find-toggle', title, 'aria-pressed': 'false' }, label);
      b.addEventListener('click', () => {
        this.opts[key] = !this.opts[key];
        b.classList.toggle('active', this.opts[key]);
        b.setAttribute('aria-pressed', String(this.opts[key]));
        this.search(false);
      });
      return b;
    };
    const scope = h('select', { class: 'find-scope', 'aria-label': 'Search scope' },
      h('option', { value: 'all' }, 'Whole document'),
      h('option', { value: 'content' }, 'Content only'),
      h('option', { value: 'element' }, 'Current element'),
    );
    scope.addEventListener('change', () => {
      this.opts.scope = scope.value as FindOptions['scope'];
      this.scopeEl = this.opts.scope === 'element' ? this.app.active?.currentElement() ?? null : null;
      this.search(false);
    });
    this.q.addEventListener('input', () => this.search(false));
    this.q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.next(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') this.close();
    });
    this.r.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) this.replaceAll();
        else this.replaceOne();
      } else if (e.key === 'Escape') this.close();
    });
    this.replaceRow = h('div', { class: 'find-row' }, this.r,
      h('button', { class: 'btn btn-sm', title: 'Replace (Enter)', on: { click: () => this.replaceOne() } }, 'Replace'),
      h('button', { class: 'btn btn-sm', title: 'Replace all (Ctrl+Enter)', on: { click: () => this.replaceAll() } }, 'Replace all'),
    );
    this.el = h('div', { class: 'find-bar', hidden: true, role: 'search' },
      h('div', { class: 'find-row' }, icon('find', 14), this.q,
        toggle('matchCase', 'Aa', 'Match case'), toggle('wholeWord', 'W', 'Whole word'), toggle('regex', '.*', 'Regular expression'), toggle('attributes', '@', 'Include attribute values'),
        scope, this.count,
        h('button', { class: 'icon-btn', title: 'Previous match (Shift+Enter)', on: { click: () => this.next(-1) } }, icon('up', 14)),
        h('button', { class: 'icon-btn', title: 'Next match (Enter)', on: { click: () => this.next(1) } }, icon('down', 14)),
        h('button', { class: 'icon-btn', title: 'Close (Esc)', on: { click: () => this.close() } }, icon('close', 14)),
      ),
      this.replaceRow,
    );
  }

  get isOpen() { return !this.el.hidden; }

  open(replace: boolean) {
    const ed = this.app.active;
    if (ed && ed.mode === 'xml') {
      openSearchPanel(ed.xml.view);
      return;
    }
    this.el.hidden = false;
    this.replaceRow.hidden = !replace;
    const sel = ed?.doc.selection;
    if (sel && !ops.isCollapsed(sel) && sel.anchor.node === sel.focus.node && sel.anchor.node.nodeType === 3) {
      const s = sel.anchor.node.nodeValue!.slice(Math.min(sel.anchor.offset, sel.focus.offset), Math.max(sel.anchor.offset, sel.focus.offset));
      if (s && s.length < 200) this.q.value = s;
    }
    this.q.focus();
    this.q.select();
    this.search(false);
  }

  close() {
    this.el.hidden = true;
    this.matches = [];
    this.app.active?.design.highlight([], -1);
    this.app.active?.focus();
  }

  /** Re-runs the search after document changes (keeps the current index). */
  onDocChanged() {
    if (this.isOpen && this.opts.query) this.refreshSoon();
  }

  private search(keepIndex: boolean) {
    const ed = this.app.active;
    this.opts.query = this.q.value;
    if (!ed || !this.opts.query) {
      this.matches = [];
      this.index = -1;
      this.updateCount();
      ed?.design.highlight([], -1);
      return;
    }
    if (this.opts.scope === 'element' && (!this.scopeEl || !this.scopeEl.isConnected)) this.scopeEl = ed.currentElement();
    this.matches = findAll(ed.doc.xml, this.opts.scope === 'element' ? this.scopeEl : null, this.opts, ed.grammar);
    if (!keepIndex) {
      // first match after the caret
      const pos = ed.doc.selection?.focus;
      this.index = this.matches.length ? 0 : -1;
      if (pos) {
        const i = this.matches.findIndex((m) => m.kind === 'text' && comparePos(m.start, pos) >= 0);
        if (i >= 0) this.index = i;
      }
    } else if (this.index >= this.matches.length) this.index = this.matches.length - 1;
    this.paint(false);
  }

  private paint(select: boolean) {
    const ed = this.app.active;
    if (!ed) return;
    const textMatches = this.matches.filter((m): m is Extract<Match, { kind: 'text' }> => m.kind === 'text');
    const cur = this.matches[this.index];
    ed.design.highlight(textMatches.map((m) => [m.start, m.end]), cur && cur.kind === 'text' ? textMatches.indexOf(cur) : -1);
    this.updateCount();
    if (select && cur) {
      if (cur.kind === 'text') {
        ed.doc.selection = { anchor: cur.start, focus: cur.end };
        ed.elementSelection = null;
        ed.design.applySelection(ed.doc.selection, true);
        ed.design.scrollToCaret();
        if (ed.mode === 'split') ed.syncXmlFocus(true);
      } else {
        ed.selectElement(cur.element, { scroll: true });
      }
      this.app.onSelectionChange(ed);
    }
  }

  private updateCount() {
    const n = this.matches.length;
    this.count.textContent = !this.q.value ? '' : n ? `${this.index + 1} of ${n}` : 'No results';
    this.count.classList.toggle('none', !!this.q.value && !n);
  }

  next(dir: 1 | -1) {
    if (!this.isOpen) {
      this.open(false);
      return;
    }
    if (!this.matches.length) this.search(false);
    if (!this.matches.length) return;
    this.index = (this.index + dir + this.matches.length) % this.matches.length;
    this.paint(true);
  }

  replaceOne() {
    const ed = this.app.active;
    if (!ed || !this.matches.length) return;
    if (this.index < 0) this.index = 0;
    const m = this.matches[this.index];
    const text = replacementFor(m, this.opts, this.r.value);
    let ok = true;
    ed.exec('Replace', (s) => {
      const p = applyReplace(m, text);
      if (p === null && m.kind === 'text') {
        ok = false;
        return s;
      }
      return p ? ops.caret(p) : s;
    });
    if (!ok) this.app.toast('The match changed; searching again', 'info');
    this.search(true);
    if (this.matches.length) this.paint(true);
  }

  replaceAll() {
    const ed = this.app.active;
    if (!ed || !this.matches.length) return;
    const list = [...this.matches].reverse();
    let n = 0;
    ed.exec('Replace all', (s) => {
      for (const m of list) {
        const t = replacementFor(m, this.opts, this.r.value);
        const before = m.kind === 'attr' ? m.element.getAttribute(m.attr) : null;
        const p = applyReplace(m, t);
        if (p || (m.kind === 'attr' && m.element.getAttribute(m.attr) !== before)) n++;
      }
      return s;
    });
    this.app.toast(`Replaced ${n} occurrence${n === 1 ? '' : 's'}`, 'info');
    this.search(false);
  }
}

function comparePos(a: { node: Node; offset: number }, b: { node: Node; offset: number }): number {
  if (a.node === b.node) return a.offset - b.offset;
  return a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}
