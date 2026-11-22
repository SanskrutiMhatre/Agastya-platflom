/**
 * XML source view (CodeMirror 6). Edits are committed to the model after a
 * short debounce when the text is well-formed; malformed text is reported as
 * diagnostics and keeps the other views read-only until fixed.
 */
import { EditorState, Compartment, StateEffect, StateField, Annotation, RangeSetBuilder } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, Decoration, DecorationSet, rectangularSelection, crosshairCursor, dropCursor, highlightSpecialChars } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { xml, ElementSpec } from '@codemirror/lang-xml';
import { foldGutter, foldKeymap, bracketMatching, indentOnInput, syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { lintGutter, setDiagnostics, Diagnostic } from '@codemirror/lint';
import { tags as t } from '@lezer/highlight';
import type { Grammar } from '../core/grammar';
import type { DocumentEditor } from '../ui/editor';
import type { ValidationIssue } from '../validation/types';
import { checkWellFormed, ParseError } from '../core/xml';

const External = Annotation.define<boolean>();
const setFocusRange = StateEffect.define<{ from: number; to: number } | null>();

const focusField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setFocusRange)) {
        if (!e.value || e.value.from >= e.value.to) deco = Decoration.none;
        else {
          const b = new RangeSetBuilder<Decoration>();
          b.add(e.value.from, e.value.to, Decoration.mark({ class: 'cm-sync-focus' }));
          deco = b.finish();
        }
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const highlight = HighlightStyle.define([
  { tag: t.tagName, color: 'var(--xml-tag)' },
  { tag: t.attributeName, color: 'var(--xml-attr)' },
  { tag: t.attributeValue, color: 'var(--xml-value)' },
  { tag: t.comment, color: 'var(--xml-comment)', fontStyle: 'italic' },
  { tag: t.processingInstruction, color: 'var(--xml-pi)' },
  { tag: t.angleBracket, color: 'var(--xml-bracket)' },
  { tag: t.content, color: 'var(--xml-text)' },
  { tag: t.documentMeta, color: 'var(--xml-pi)' },
  { tag: t.character, color: 'var(--xml-entity)' },
]);

export function grammarToSchema(g: Grammar | null): { elements: ElementSpec[] } {
  if (!g) return { elements: [] };
  const elements: ElementSpec[] = g.elementNames.map((name) => {
    const attrs = g.attributes(name).filter((a) => a.name !== '*');
    return {
      name,
      top: name === g.root,
      children: g.childCandidates(name),
      attributes: attrs.map((a) => ({ name: a.name, values: a.enumValues?.slice(0, 200) })),
      textContent: undefined,
    };
  });
  return { elements };
}

export class XmlView {
  readonly el: HTMLElement;
  view: EditorView;
  private langConf = new Compartment();
  private themeConf = new Compartment();
  private pending: number | null = null;
  private lastText = '';
  private visible = false;
  private stale = true;
  error: ParseError | null = null;
  private validationDiags: ValidationIssue[] = [];
  private syncTimer: number | null = null;

  constructor(private host: DocumentEditor) {
    this.el = document.createElement('div');
    this.el.className = 'xml-view';
    const app = host.app;
    this.view = new EditorView({
      parent: this.el,
      state: EditorState.create({
        doc: '',
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          foldGutter(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          syntaxHighlighting(highlight),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          lintGutter(),
          focusField,
          EditorView.lineWrapping,
          this.langConf.of(xml(grammarToSchema(host.doc.grammar))),
          this.themeConf.of(EditorView.darkTheme.of(host.app.isDark())),
          keymap.of([
            { key: 'Mod-z', run: () => (app.run('edit.undo'), true), preventDefault: true },
            { key: 'Mod-y', run: () => (app.run('edit.redo'), true), preventDefault: true },
            { key: 'Mod-Shift-z', run: () => (app.run('edit.redo'), true), preventDefault: true },
            { key: 'Mod-s', run: () => (app.run('file.save'), true), preventDefault: true },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...foldKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((tr) => tr.annotation(External))) this.onUserEdit();
            if (u.selectionSet && !u.transactions.some((tr) => tr.annotation(External)) && u.view.hasFocus) this.onCaretMove();
          }),
          EditorView.domEventHandlers({
            blur: () => {
              this.flush();
            },
          }),
        ],
      }),
    });
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.el.hidden = !v;
    if (v && this.stale) this.refresh();
    if (v) requestAnimationFrame(() => this.view.requestMeasure());
  }

  setGrammar(g: Grammar | null) {
    this.view.dispatch({ effects: this.langConf.reconfigure(xml(grammarToSchema(g))) });
  }

  get text(): string { return this.view.state.doc.toString(); }
  get hasPending(): boolean { return this.pending !== null || (this.error !== null); }

  /** Pull text from the model (after model changes not originating here). */
  refresh() {
    if (!this.visible) {
      this.stale = true;
      return;
    }
    this.stale = false;
    const text = this.host.serializedText();
    if (text === this.text) {
      this.lastText = text;
      return;
    }
    const cur = this.text;
    // minimal change: common prefix/suffix
    let s = 0;
    const max = Math.min(cur.length, text.length);
    while (s < max && cur.charCodeAt(s) === text.charCodeAt(s)) s++;
    let e = 0;
    while (e < max - s && cur.charCodeAt(cur.length - 1 - e) === text.charCodeAt(text.length - 1 - e)) e++;
    this.view.dispatch({ changes: { from: s, to: cur.length - e, insert: text.slice(s, text.length - e) }, annotations: External.of(true) });
    this.lastText = text;
    this.error = null;
    this.publishDiagnostics();
  }

  markStale() {
    this.stale = true;
    if (this.visible) this.refresh();
  }

  private onUserEdit() {
    if (this.pending) clearTimeout(this.pending);
    this.pending = window.setTimeout(() => this.flush(), this.host.app.settings.xmlCommitDelay);
    this.host.app.updateChrome();
  }

  /** Commits pending XML edits to the model. Returns false when the text is malformed. */
  flush(): boolean {
    if (this.pending) {
      clearTimeout(this.pending);
      this.pending = null;
    }
    const text = this.text;
    if (text === this.lastText && !this.error) return true;
    const err = checkWellFormed(text);
    this.error = err;
    if (err) {
      this.publishDiagnostics();
      this.host.onXmlError(err);
      return false;
    }
    this.lastText = text;
    this.host.commitXmlText(text);
    this.publishDiagnostics();
    return true;
  }

  /** Discards uncommitted (malformed) edits. */
  revert() {
    if (this.pending) clearTimeout(this.pending);
    this.pending = null;
    this.error = null;
    this.lastText = '';
    this.stale = true;
    this.refresh();
    this.host.onXmlError(null);
  }

  setValidation(issues: ValidationIssue[]) {
    this.validationDiags = issues;
    this.publishDiagnostics();
  }

  private publishDiagnostics() {
    const doc = this.view.state.doc;
    const diags: Diagnostic[] = [];
    const lineRange = (line: number) => {
      const l = doc.line(Math.max(1, Math.min(line, doc.lines)));
      return { from: l.from, to: l.to };
    };
    if (this.error) {
      const ln = Math.max(1, Math.min(this.error.line, doc.lines));
      const l = doc.line(ln);
      const from = Math.min(l.from + Math.max(0, this.error.column - 1), l.to);
      diags.push({ from, to: Math.min(from + 1, doc.length), severity: 'error', message: 'Not well-formed: ' + this.error.message, source: 'XML' });
    } else if (this.text === this.lastText) {
      for (const i of this.validationDiags) {
        if (i.line && i.line <= doc.lines) {
          const r = lineRange(i.line);
          diags.push({ ...r, severity: i.severity === 'info' ? 'info' : i.severity, message: i.message, source: i.source.toUpperCase() });
        } else if (i.node) {
          const span = this.host.spanOf(i.node);
          if (span) diags.push({ from: span[0], to: Math.min(span[1], span[0] + 200), severity: i.severity === 'info' ? 'info' : i.severity, message: i.message, source: i.source.toUpperCase() });
        }
      }
    }
    this.view.dispatch(setDiagnostics(this.view.state, diags));
  }

  private onCaretMove() {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => {
      if (this.pending || this.error) return;
      const pos = this.view.state.selection.main.head;
      this.host.onXmlCaret(pos);
    }, 120);
  }

  /** Highlights and reveals the source range of a node. */
  focusRange(from: number, to: number, scroll: boolean) {
    if (!this.visible) return;
    const len = this.view.state.doc.length;
    from = Math.max(0, Math.min(from, len));
    to = Math.max(from, Math.min(to, len));
    this.view.dispatch({
      effects: [setFocusRange.of({ from, to }), ...(scroll ? [EditorView.scrollIntoView(from, { y: 'center' })] : [])],
      annotations: External.of(true),
    });
  }

  select(from: number, to: number) {
    this.view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    this.view.focus();
  }

  gotoLine(line: number) {
    const doc = this.view.state.doc;
    const l = doc.line(Math.max(1, Math.min(line, doc.lines)));
    this.view.dispatch({ selection: { anchor: l.from, head: l.to }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
    this.view.focus();
  }

  focus() { this.view.focus(); }

  /** Tells CodeMirror whether the page is dark (its cursor, selection and panel defaults differ). */
  setDark(dark: boolean) {
    this.view.dispatch({ effects: this.themeConf.reconfigure(EditorView.darkTheme.of(dark)) });
  }

  destroy() {
    if (this.pending) clearTimeout(this.pending);
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.view.destroy();
  }
}

export { setFocusRange };
