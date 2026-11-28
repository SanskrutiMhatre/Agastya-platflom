// The JSG Illustrated Spare Parts List editor.
//
// An ISPL is mostly data: a certificate, a standard preface, a few tables, and then plates - each plate a picture (or a grid of pictures with their references) and the
// table of the parts shown on it. So this editor is a structured one: every part of the printed list is a card, the parts table is a grid of cells you type into (and paste rows
// into from a spreadsheet), and the PDF engine on the server sets the pages. It edits the model (./model.ts) directly.
//
// Independent of the User Handbook editor's text editing, of the JSS editor (src/jss) and of the S1000D Studio (src/studio): it shares only ./shared.ts (host, look, picture chooser, cover card).

import { PART_COLUMNS, newPara, newPart, newPlate, newView, newTable, parentRef, text, type Appendix, type Cell, type Inline, type JsgDoc, type Para, type Plate, type PlateView, type Table } from './model';
import { inlineHtml, readInline } from './editor';
import { plain as plainOf } from './model';
import { BASE_CSS, button, injectCss, mk, pickGraphic, type JsgEditorLike, type JsgEditorOptions, type JsgFinding, type JsgHost } from './shared';
import { mountIsplPreview, type PreviewHandle } from './ispl-preview';
import { serializeJsg } from './xml';
import { confirmDialog, promptDialog } from '../lib/dialogs';

const CSS = `
.jsg-isplsheet{margin:0 auto;max-width:1180px;padding:18px 24px 60px;background:var(--sheet);color:var(--sheet-ink);box-shadow:var(--paper-sheet-shadow);font:12pt/1.2 var(--font-paper-serif);caret-color:var(--sel)}
.jsg-isplsheet .jsg-card{margin:12px 0}
.jsg-isplsheet .jsg-card h3{font-size:13px}
.jsg-plate{border:1px solid var(--sheet-jsg-placeholder);border-radius:5px;margin:16px 0;background:var(--sheet)}
.jsg-plate>header{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 10px;background:var(--sheet-jsg-plate-head);border-bottom:1px solid var(--sheet-jsg-line);font:12px system-ui,sans-serif}
.jsg-plate>header input[type=text]{font:13px system-ui;padding:3px 6px;border:1px solid var(--sheet-jsg-line);border-radius:3px;background:var(--sheet);color:var(--sheet-ink)}
.jsg-plate>header .ref{width:90px;font-weight:bold}.jsg-plate>header .ttl{width:220px}.jsg-plate>header .cap{width:260px}
.jsg-plate.sel>header{background:var(--sheet-jsg-plate-sel)}
.jsg-view{margin:10px;padding:8px;border:1px dashed var(--sheet-jsg-card-border);border-radius:4px;font:12px system-ui,sans-serif}
.jsg-view .pics{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0}
.jsg-view .pic{width:150px;border:1px solid var(--sheet-jsg-line);border-radius:3px;padding:4px;text-align:center;background:var(--sheet-jsg-card-bg)}
.jsg-view .pic img{max-width:100%;max-height:90px;display:block;margin:0 auto 4px}
.jsg-view .pic input{width:100%;box-sizing:border-box;font:11px system-ui;padding:2px 4px;border:1px solid var(--sheet-jsg-line);border-radius:3px;background:var(--sheet);color:var(--sheet-ink)}
.jsg-view .pic button{margin-top:4px;font:11px system-ui;padding:1px 7px;border:1px solid var(--sheet-jsg-line);border-radius:3px;background:var(--sheet);color:var(--sheet-ink);cursor:pointer}
.jsg-grid{overflow:auto;margin-top:6px}
.jsg-grid table{border-collapse:collapse;font:12px "Times New Roman",serif}
.jsg-grid th,.jsg-grid td{border:1px solid var(--sheet-grid-rule);padding:0}
.jsg-grid th{background:var(--sheet-jsg-grid-head);font-weight:bold;padding:3px 4px;text-align:center}
.jsg-grid td input{border:0;width:100%;box-sizing:border-box;padding:3px 4px;font:12px "Times New Roman",serif;background:transparent;color:inherit}
.jsg-grid td input:focus{outline:2px solid var(--sheet-jsg-grid-focus);background:var(--sheet-jsg-focus)}
.jsg-grid td.act{width:24px;text-align:center}
.jsg-note{font:11px system-ui;color:var(--sheet-jsg-muted);margin:4px 0}
.jsg-rich{border:1px solid var(--sheet-jsg-line);border-radius:3px;padding:4px 6px;background:var(--sheet);min-height:20px;font:12pt/1.25 "Times New Roman",serif;outline:none;text-align:justify}
.jsg-rich:focus{background:var(--sheet-jsg-focus)}
.jsg-isplbody{flex:1;display:flex;min-height:0}
.jsg-isplbody>.jsg-scroll{flex:1 1 0;min-width:0}
.jsg-pvpane{flex:0 0 44%;min-width:320px;max-width:60%;overflow-y:auto;overflow-x:hidden;border-left:1px solid var(--preview-edge);background:var(--preview-canvas)}
.jsg-pvpane.off{display:none}
`;

export class IsplEditor implements JsgEditorLike {
  private readonly root: HTMLElement;
  private readonly doc: JsgDoc;
  private readonly host: JsgHost;
  private readonly readOnly: boolean;
  private dirty = false;
  private findings: JsgFinding[] = [];
  private sel = -1;
  private nav!: HTMLElement; private bar!: HTMLElement; private sheet!: HTMLElement; private status!: HTMLElement;
  private pvPane!: HTMLElement; private preview!: PreviewHandle; private pvTimer = 0; private pvOn = true; private pvBtn!: HTMLButtonElement;
  private onKey = (e: KeyboardEvent): void => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); this.host.onSaveRequested(); } };

  constructor(host: HTMLElement, opts: JsgEditorOptions) {
    this.root = host; this.doc = opts.doc; this.host = opts.host; this.readOnly = opts.readOnly;
    injectCss('jsg-editor-css', BASE_CSS); injectCss('jsg-ispl-css', CSS);
    this.root.innerHTML = ''; this.root.classList.add('jsg-ed'); if (this.readOnly) this.root.classList.add('jsg-ro');
    this.nav = mk('aside', 'jsg-nav'); const main = mk('div', 'jsg-main'); this.bar = mk('div', 'jsg-bar'); const scroll = mk('div', 'jsg-scroll');
    this.sheet = mk('div', 'jsg-isplsheet'); this.sheet.setAttribute('data-testid', 'jsg-sheet');
    scroll.appendChild(this.sheet);
    // the grid on the left, the stencil-style page preview of the selected plate on the right; editing the grid redraws the preview
    const body = mk('div', 'jsg-isplbody'); this.pvPane = mk('div', 'jsg-pvpane'); this.pvPane.setAttribute('data-testid', 'jsg-preview');
    body.append(scroll, this.pvPane); this.status = mk('div', 'jsg-status'); this.status.setAttribute('data-testid', 'jsg-status'); main.append(this.bar, body, this.status); this.root.append(this.nav, main);
    try { this.pvOn = localStorage.getItem('agastya.jsg.ispl.preview') !== 'off'; } catch { /* the choice is only remembered when storage works */ }
    this.preview = mountIsplPreview(this.pvPane, (s) => this.host.imageUrl(s), (i) => { this.sel = i; this.schedulePreview(); document.getElementById(`jsg-pl-${i}`)?.scrollIntoView({ block: 'start' }); });
    this.pvPane.classList.toggle('off', !this.pvOn);
    document.addEventListener('keydown', this.onKey);          // the page, not just the editor: Ctrl+S must save after a dialog closed with focus on the body
    this.buildBar(); this.render();
  }

  destroy(): void { window.clearTimeout(this.pvTimer); this.preview.destroy(); document.removeEventListener('keydown', this.onKey); this.root.innerHTML = ''; this.root.classList.remove('jsg-ed', 'jsg-ro'); }
  isDirty(): boolean { return this.dirty; }
  markSaved(): void { this.dirty = false; this.host.onDirty(false); }
  /** A recovered draft was loaded (FE-006): it counts as unsaved until it is saved. */
  markDirty(): void { this.dirty = true; this.host.onDirty(true); }
  getXml(): string { return serializeJsg(this.doc); }
  getDoc(): JsgDoc { return this.doc; }
  setFindings(f: JsgFinding[]): void { this.findings = f; this.renderNav(); }
  private touch(): void { if (!this.dirty) { this.dirty = true; this.host.onDirty(true); } this.refreshStatus(); this.schedulePreview(); }
  /** Redraw the preview shortly after the last edit (typing in the grid must not redraw on every key). */
  private schedulePreview(): void {
    if (!this.pvOn) return; window.clearTimeout(this.pvTimer);
    this.pvTimer = window.setTimeout(() => this.preview.update(this.doc, Math.max(0, Math.min(this.sel < 0 ? 0 : this.sel, this.doc.plates.length - 1))), 120);
  }

  // ── toolbar ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  private buildBar(): void {
    const add = (label: string, title: string, fn: () => void, edit = true): void => {
      const b = button(label, () => { if (this.readOnly && edit) return; fn(); }); b.title = title; if (edit) b.className = 'edit'; this.bar.appendChild(b);
    };
    const sep = (): void => { this.bar.appendChild(mk('span', 'sep')); };
    add('+ Plate', 'Add a plate after the selected one (the reference is suggested from it)', () => this.addPlate(false));
    add('+ Sub-plate', 'Add a plate under the selected one (I-A -> I-A/1)', () => this.addPlate(true));
    add('+ View', 'Add a view (a picture page and its parts table) to the selected plate', () => { const p = this.plate(); if (p) { p.views.push(newView()); this.redraw(); } });
    sep();
    add('↑', 'Move the selected plate up', () => this.movePlate(-1)); add('↓', 'Move the selected plate down', () => this.movePlate(1));
    add('Duplicate', 'Copy the selected plate with its views and parts', () => this.duplicatePlate());
    add('Delete plate', 'Delete the selected plate', () => this.deletePlate());
    sep();
    add('+ Appendix', 'Add an appendix (APPX \u2018A\u2019 ...: a list of spares, tools, suppliers ...) with a table', () => { const n = this.doc.appendices.length; const a: Appendix = { k: 'appendix', label: String.fromCharCode(65 + n), title: 'NEW APPENDIX', orientation: 'landscape', children: [newPara('', 2), newTable(2, 4)] }; a.children[1] && ((a.children[1] as Table).head = [{ cells: ['Sr. No.', 'Description', 'Quantity', 'Remark'].map((t) => ({ parts: [{ k: 'text' as const, inline: text(t) }] })) }]); this.doc.appendices.push(a); this.redraw(); });
    sep();
    add('Check', 'Check the document without saving', () => this.host.onCheckRequested(), false);
    this.pvBtn = button('Page preview', () => { this.pvOn = !this.pvOn; try { localStorage.setItem('agastya.jsg.ispl.preview', this.pvOn ? 'on' : 'off'); } catch { /* not remembered */ } this.pvPane.classList.toggle('off', !this.pvOn); this.pvBtn.setAttribute('aria-pressed', String(this.pvOn)); if (this.pvOn) this.schedulePreview(); });
    this.pvBtn.title = 'Show the stencil-style pages of the selected plate beside the grid'; this.pvBtn.setAttribute('aria-pressed', String(this.pvOn)); this.pvBtn.setAttribute('data-testid', 'jsg-preview-toggle'); this.bar.appendChild(this.pvBtn);
  }

  private plate(): Plate | null { const p = this.doc.plates[this.sel]; if (!p) this.host.notify('Click a plate first.', 'info'); return p ?? null; }
  private redraw(): void { this.touch(); const keep = this.sheet.parentElement?.scrollTop ?? 0; this.render(); if (this.sheet.parentElement) this.sheet.parentElement.scrollTop = keep; }

  private addPlate(under: boolean): void {
    const cur = this.doc.plates[this.sel]; let ref = '';
    // the stencil's references: I -> I-A (a letter) -> I-A/1 (a number) -> I-A/1/1
    if (cur && under) { const n = this.doc.plates.filter((x) => parentRef(x.ref) === cur.ref).length + 1; ref = cur.ref.includes('-') ? `${cur.ref}/${n}` : `${cur.ref}-${String.fromCharCode(64 + n)}`; }
    else if (cur) ref = cur.ref;
    const p = newPlate(ref, 'New plate'); p.setColumn = cur ? cur.setColumn : false;
    const at = this.sel >= 0 ? this.sel + 1 : this.doc.plates.length; this.doc.plates.splice(at, 0, p); this.sel = at; this.redraw();
  }
  private movePlate(d: number): void {
    const i = this.sel, j = i + d; if (i < 0 || j < 0 || j >= this.doc.plates.length) return;
    const [p] = this.doc.plates.splice(i, 1); this.doc.plates.splice(j, 0, p); this.sel = j; this.redraw();
  }
  private deletePlate(): void {
    const p = this.doc.plates[this.sel]; if (!p) return;
    // WP-35 (GAP-002): the application's dialog with the exact consequence; the plate is found again after the answer (the list may have moved)
    const parts = p.views.reduce((n, v) => n + v.parts.length, 0);
    void confirmDialog({ title: 'Delete the plate?', message: `This removes plate ${p.ref} ${p.title} with its ${p.views.length} view${p.views.length === 1 ? '' : 's'} and ${parts} part${parts === 1 ? '' : 's'}.`, confirmLabel: 'Delete plate', danger: true })
      .then((ok) => {
        const i = this.doc.plates.indexOf(p); if (!ok || i < 0) return;
        this.doc.plates.splice(i, 1); this.sel = Math.min(this.sel, this.doc.plates.length - 1); this.redraw();
      });
  }

  // ── rendering ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  private card(title: string): HTMLElement { const c = mk('div', 'jsg-card'); c.append(mk('h3', '', title)); this.sheet.appendChild(c); return c; }

  private rich(get: () => Inline[], set: (i: Inline[]) => void, ph = ''): HTMLElement {
    const e = mk('div', 'jsg-rich'); e.innerHTML = inlineHtml(get()); if (ph) e.dataset.ph = ph;
    if (!this.readOnly) {
      e.setAttribute('contenteditable', 'true');
      e.addEventListener('input', () => { set(readInline(e)); this.touch(); });
      e.addEventListener('paste', (ev) => { ev.preventDefault(); document.execCommand('insertText', false, ev.clipboardData?.getData('text/plain') ?? ''); });
    }
    return e;
  }

  private render(): void {
    this.sheet.innerHTML = '';
    const note = this.card('Cover and ancillary pages');
    note.append(mk('div', 'jsg-note', 'The cover, certificate, preface, amendments, abbreviations, the list of equipment already supplied and the contents are edited under "Ancillary pages" in the project menu on the left. This editor holds the plates and the appendices.'));

    const head = mk('h2', '', 'Plates'); head.style.cssText = 'font:600 14px system-ui;margin:22px 0 4px'; this.sheet.appendChild(head);
    this.sheet.appendChild(mk('div', 'jsg-note', 'Each view prints a picture page and a parts-table page. The Contents page (with page ranges) is produced from the plates; the first plate marked "divider" also prints the big PLATE page and an index of its sub-plates.'));
    this.doc.plates.forEach((p, i) => this.plateCard(p, i));
    if (!this.doc.plates.length) this.sheet.appendChild(mk('div', 'jsg-note', 'No plates yet: press + Plate.'));
    this.appendicesSection();
    this.renderNav(); this.refreshStatus(); this.schedulePreview();
  }

  private duplicatePlate(): void {
    const p = this.doc.plates[this.sel]; if (!p) { this.host.notify('Click a plate first.', 'info'); return; }
    const copy: Plate = { ...p, id: undefined, ref: `${p.ref}`, title: `${p.title}`, views: p.views.map((v) => ({ ...v, graphics: v.graphics.map((g) => ({ ...g })), parts: v.parts.map((r) => ({ ...r })), notes: (v.notes ?? []).map((n) => JSON.parse(JSON.stringify(n)) as Inline[]) })) };
    delete copy.id; this.doc.plates.splice(this.sel + 1, 0, copy); this.sel += 1; this.redraw();
    this.host.notify('Copied: change its reference and title.', 'info');
  }

  /** Plates, views, parts and pictures counted under the sheet. */
  private refreshStatus(): void {
    const views = this.doc.plates.reduce((n, p) => n + p.views.length, 0); const parts = this.doc.plates.reduce((n, p) => n + p.views.reduce((m, v) => m + v.parts.length, 0), 0);
    const pics = this.doc.plates.reduce((n, p) => n + p.views.reduce((m, v) => m + v.graphics.length, 0), 0);
    this.status.textContent = `${this.doc.plates.length} plates \u00b7 ${views} views \u00b7 ${parts} parts \u00b7 ${pics} pictures \u00b7 ${this.doc.appendices.length} appendices`;
  }

  // ── appendices ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
  private appendicesSection(): void {
    const apps = this.doc.appendices; if (!apps.length && this.readOnly) return;
    const head = mk('h2', '', 'Appendices'); head.style.cssText = 'font:600 14px system-ui;margin:26px 0 4px'; this.sheet.appendChild(head);
    this.sheet.appendChild(mk('div', 'jsg-note', 'Each appendix prints on its own landscape page: APPX \u2018A\u2019 at the right, its title, a sentence, and a table. Press + Appendix to add one.'));
    apps.forEach((a, ai) => {
      const card = mk('div', 'jsg-plate'); card.id = `jsg-ap-${ai}`; const h = mk('header'); card.appendChild(h);
      const inp = (cls: string, ph: string, get: () => string, set: (v: string) => void): HTMLInputElement => { const i = document.createElement('input'); i.type = 'text'; i.className = cls; i.placeholder = ph; i.value = get(); i.disabled = this.readOnly; i.addEventListener('input', () => { set(i.value); this.touch(); }); return i; };
      h.append(mk('b', '', 'APPX \u2018'), inp('ref', 'A', () => a.label, (v) => { a.label = v; }), mk('b', '', '\u2019'), inp('ttl', 'LIST OF CARRIED SPARES', () => a.title, (v) => { a.title = v; }));
      if (!this.readOnly) {
        h.append(button('\u2191', () => { if (ai) { [apps[ai - 1], apps[ai]] = [apps[ai], apps[ai - 1]]; this.redraw(); } }), button('\u2193', () => { if (ai < apps.length - 1) { [apps[ai + 1], apps[ai]] = [apps[ai], apps[ai + 1]]; this.redraw(); } }),
          button('Delete', () => {
            void confirmDialog({ title: 'Delete the appendix?', message: `This removes appendix ${a.label} ${a.title} and everything in it.`, confirmLabel: 'Delete appendix', danger: true })
              .then((ok) => { const i = apps.indexOf(a); if (ok && i >= 0) { apps.splice(i, 1); this.redraw(); } });
          }));
      }
      a.children.forEach((b, bi) => {
        if (b.k === 'para') {
          const box = mk('div', 'jsg-view'); box.append(mk('b', '', 'Sentence under the title'));
          box.appendChild(this.rich(() => b.inline, (v) => { b.inline = v; })); card.appendChild(box);
        } else if (b.k === 'table') card.appendChild(this.appendixTable(b, () => a.children.splice(bi, 1)));
      });
      if (!this.readOnly) { const bar = mk('div', 'jsg-view'); bar.append(button('+ sentence', () => { a.children.unshift(newPara('', 2)); this.redraw(); }), button('+ table', () => { a.children.push(newTable(2, 4)); this.redraw(); })); card.appendChild(bar); }
      this.sheet.appendChild(card);
    });
  }

  private cellText(c: Cell): string { return c.parts.map((x) => (x.k === 'text' || x.k === 'para' ? plainOf(x.inline) : '')).join(' ').trim(); }

  /** A table of text cells: heading rows (bold), body rows, group rows (one cell across the table). Typing keeps the cell's other settings. */
  private appendixTable(t: Table, remove: () => void): HTMLElement {
    const box = mk('div', 'jsg-view'); const wrap = mk('div', 'jsg-grid'); box.appendChild(wrap);
    const cols = (): number => Math.max(1, ...[...t.head, ...t.body].map((r) => r.cells.reduce((n, c) => n + (c.colspan ?? 1), 0)));
    const draw = (): void => {
      wrap.innerHTML = ''; const tb = document.createElement('table');
      const rowsOf = (rows: typeof t.body, isHead: boolean): void => rows.forEach((r, ri) => {
        const tr = document.createElement('tr');
        r.cells.forEach((c) => {
          const td = document.createElement(isHead ? 'th' : 'td'); if (c.colspan && c.colspan > 1) td.colSpan = c.colspan; if (c.rowspan && c.rowspan > 1) td.rowSpan = c.rowspan;
          const i = document.createElement('input'); i.value = this.cellText(c); i.disabled = this.readOnly; if (isHead) i.style.fontWeight = 'bold';
          i.addEventListener('input', () => { c.parts = [{ k: 'text', inline: text(i.value) }]; this.touch(); }); td.appendChild(i); tr.appendChild(td);
        });
        const act = mk('td', 'act'); if (!this.readOnly) { act.appendChild(button('\u00d7', () => { rows.splice(ri, 1); if (!isHead && !t.body.length) t.body.push({ cells: Array.from({ length: cols() }, () => ({ parts: [{ k: 'text' as const, inline: [] }] })) }); this.touch(); draw(); })); } tr.appendChild(act); tb.appendChild(tr);
      });
      rowsOf(t.head, true); rowsOf(t.body, false); wrap.appendChild(tb);
      if (!this.readOnly) {
        const bar = mk('div');
        bar.append(button('+ row', () => { t.body.push({ cells: Array.from({ length: cols() }, () => ({ parts: [{ k: 'text' as const, inline: [] }] })) }); this.touch(); draw(); }),
          button('+ group row', () => { t.body.push({ cells: [{ colspan: cols(), parts: [{ k: 'text' as const, inline: [] }] }] }); this.touch(); draw(); }),
          button('Paste rows', () => void promptDialog({ title: 'Paste rows', label: 'Rows', hint: 'Tab-separated, one row per line.', message: 'Paste rows copied from a spreadsheet (tab-separated, one row per line).', multiline: true, confirmLabel: 'Add rows' }).then((txt) => {
            if (!txt) return; const n = cols();
            for (const line of txt.split(/\r?\n/)) { if (!line.trim()) continue; const cells = line.split('\t'); t.body.push({ cells: Array.from({ length: n }, (_, k) => ({ parts: [{ k: 'text' as const, inline: text((cells[k] ?? '').trim()) }] })) }); }
            this.touch(); draw();
          })), button('Remove table', () => { remove(); this.redraw(); }));
        wrap.appendChild(bar);
      }
    };
    draw(); return box;
  }

  private plateCard(p: Plate, index: number): void {
    const card = mk('div', `jsg-plate${index === this.sel ? ' sel' : ''}`); card.id = `jsg-pl-${index}`;
    const h = mk('header'); card.appendChild(h);
    const inp = (cls: string, ph: string, get: () => string, set: (v: string) => void): HTMLInputElement => { const i = document.createElement('input'); i.type = 'text'; i.className = cls; i.placeholder = ph; i.value = get(); i.disabled = this.readOnly; i.addEventListener('input', () => { set(i.value); this.touch(); }); return i; };
    const ref = inp('ref', 'Ref (I-A)', () => p.ref, (v) => { p.ref = v; });
    ref.addEventListener('change', () => this.redraw());
    h.append(mk('b', '', 'PLATE –'), ref, inp('ttl', 'Title (Bridging System)', () => p.title, (v) => { p.title = v; }), inp('cap', 'Caption line (optional)', () => p.caption, (v) => { p.caption = v; }));
    const chk = (label: string, get: () => boolean, set: (v: boolean) => void, title: string): void => { const l = document.createElement('label'); l.title = title; const c = document.createElement('input'); c.type = 'checkbox'; c.checked = get(); c.disabled = this.readOnly; c.addEventListener('change', () => { set(c.checked); this.redraw(); }); l.append(c, document.createTextNode(` ${label}`)); h.appendChild(l); };
    chk('divider page', () => p.divider, (v) => { p.divider = v; }, 'Print the big PLATE page and the index of the sub-plates');
    chk('"for 1 set" column', () => p.setColumn, (v) => { p.setColumn = v; }, 'The parts table has the extra column No. Off (For 1 Set)');
    card.addEventListener('focusin', () => { if (this.sel !== index) { this.sel = index; this.sheet.querySelectorAll('.jsg-plate.sel').forEach((e) => e.classList.remove('sel')); card.classList.add('sel'); this.schedulePreview(); } });
    p.views.forEach((v, vi) => card.appendChild(this.viewCard(p, v, vi)));
    this.sheet.appendChild(card);
  }

  private viewCard(p: Plate, v: PlateView, vi: number): HTMLElement {
    const box = mk('div', 'jsg-view'); box.append(mk('b', '', `View ${vi + 1}`));
    const cap = document.createElement('input'); cap.type = 'text'; cap.placeholder = 'Red caption under the picture (e.g. 100M INFANTRY FOOT BRIDGE FLOATING (ISOMETRIC VIEW 1))'; cap.value = v.caption; cap.disabled = this.readOnly; cap.style.cssText = 'width:100%;box-sizing:border-box;margin:4px 0;font:13px system-ui;padding:3px 6px;border:1px solid var(--sheet-jsg-line);border-radius:3px;background:var(--sheet);color:var(--sheet-ink)';
    cap.addEventListener('input', () => { v.caption = cap.value; this.touch(); }); box.appendChild(cap);
    const pics = mk('div', 'pics'); box.appendChild(pics);
    v.graphics.forEach((g, gi) => {
      const d = mk('div', 'pic'); const img = document.createElement('img'); img.src = this.host.imageUrl(g.src); img.alt = g.src; d.appendChild(img);
      const lab = document.createElement('input'); lab.placeholder = 'label (I-B/1)'; lab.value = g.label ?? ''; lab.disabled = this.readOnly; lab.addEventListener('input', () => { g.label = lab.value || undefined; this.touch(); }); d.appendChild(lab);
      if (!this.readOnly) d.appendChild(button('remove', () => { v.graphics.splice(gi, 1); this.redraw(); }));
      pics.appendChild(d);
    });
    if (!this.readOnly) pics.appendChild(button('+ picture', () => void pickGraphic(this.host).then((g) => { if (g) { v.graphics.push({ src: g.src }); this.redraw(); } })));
    if (!v.graphics.length) box.append(mk('div', 'jsg-note', 'No picture yet: a view with parts should have one.'));

    const cols = PART_COLUMNS.filter((c) => !c.set || p.setColumn);
    const wrap = mk('div', 'jsg-grid'); box.appendChild(wrap);
    const draw = (): void => {
      wrap.innerHTML = ''; const t = document.createElement('table'); const hr = document.createElement('tr');
      for (const c of cols) { const th = document.createElement('th'); th.textContent = c.label; th.style.minWidth = `${c.width}px`; hr.appendChild(th); } hr.appendChild(mk('th')); t.appendChild(hr);
      v.parts.forEach((row, ri) => {
        const tr = document.createElement('tr');
        for (const c of cols) { const td = document.createElement('td'); const i = document.createElement('input'); i.value = row[c.key]; i.disabled = this.readOnly; if (c.align) i.style.textAlign = c.align; i.addEventListener('input', () => { row[c.key] = i.value; this.touch(); }); td.appendChild(i); tr.appendChild(td); }
        const act = mk('td', 'act'); act.style.width = '92px';
        if (!this.readOnly) act.append(button('\u2191', () => { if (ri) { [v.parts[ri - 1], v.parts[ri]] = [v.parts[ri], v.parts[ri - 1]]; this.touch(); draw(); } }), button('\u2193', () => { if (ri < v.parts.length - 1) { [v.parts[ri + 1], v.parts[ri]] = [v.parts[ri], v.parts[ri + 1]]; this.touch(); draw(); } }),
          button('\u2398', () => { v.parts.splice(ri + 1, 0, { ...row }); this.touch(); draw(); }), button('×', () => { v.parts.splice(ri, 1); this.touch(); draw(); }));
        tr.appendChild(act); t.appendChild(tr);
      });
      wrap.appendChild(t);
      if (!this.readOnly) {
        const bar = mk('div');
        bar.append(button('+ part', () => { const n = v.parts.length + 1; const r = newPart(String(n).padStart(2, '0')); r.plateRef = `${p.ref}/${n}`; v.parts.push(r); this.touch(); draw(); }),
          button('Paste rows', () => void promptDialog({ title: 'Paste parts', label: 'Rows', hint: `Columns in order: ${cols.map((c) => c.label).join(' | ')}`, message: 'Paste rows copied from a spreadsheet (tab-separated, one part per line).', multiline: true, confirmLabel: 'Add parts' }).then((txt) => {
            if (!txt) return;
            for (const line of txt.split(/\r?\n/)) { if (!line.trim()) continue; const cells = line.split('\t'); const r = newPart(); cols.forEach((c, k) => { r[c.key] = (cells[k] ?? '').trim(); }); v.parts.push(r); }
            this.touch(); draw();
          })), button('Remove view', () => {
            const drop = (): void => { const i = p.views.indexOf(v); if (i >= 0) { p.views.splice(i, 1); this.redraw(); } };
            if (p.views.length > 1) { drop(); return; }
            void confirmDialog({ title: 'Remove the only view?', message: `This removes the only view of plate ${p.ref} with its ${v.parts.length} part${v.parts.length === 1 ? '' : 's'}.`, confirmLabel: 'Remove view', danger: true }).then((ok) => { if (ok) drop(); });
          }));
        wrap.appendChild(bar);          // inside the grid's own wrapper: a redraw replaces it, it never piles up
      }
    };
    draw();
    // the lines printed under the parts table ("Note: Above mentioned quantity is for one Pontoon Assy.")
    const notes = mk('div', 'jsg-view'); notes.style.margin = '8px 0 0'; box.appendChild(notes);
    const drawNotes = (): void => {
      notes.innerHTML = ''; notes.append(mk('b', '', 'Notes under the table'));
      (v.notes ??= []).forEach((n, ni) => {
        const r = mk('div', 'jsg-row'); r.appendChild(this.rich(() => n, (x) => { v.notes[ni] = x; }, 'Note: Above mentioned quantity is for one ...'));
        if (!this.readOnly) r.appendChild(button('×', () => { v.notes.splice(ni, 1); this.touch(); drawNotes(); })); notes.appendChild(r);
      });
      if (!this.readOnly) notes.appendChild(button('+ note', () => { v.notes.push(text('Note: ')); this.touch(); drawNotes(); }));
    };
    drawNotes();
    return box;
  }

  // ── the outline ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  private renderNav(): void {
    this.nav.innerHTML = '';
    this.nav.append(mk('h4', '', 'Plates'));
    this.doc.plates.forEach((p, i) => {
      const a = mk('a', parentRef(p.ref) ? 'l2' : '', `${p.ref}  ${p.title}`); a.title = `${p.ref} ${p.title}`; a.onclick = () => { this.sel = i; document.getElementById(`jsg-pl-${i}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }; this.nav.appendChild(a);
    });
    if (this.doc.appendices.length) {
      this.nav.append(mk('h4', '', 'Appendices'));
      this.doc.appendices.forEach((a, i) => { const l = mk('a', 'l2', `APPX \u2018${a.label}\u2019  ${a.title}`); l.onclick = () => document.getElementById(`jsg-ap-${i}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); this.nav.appendChild(l); });
    }
    if (this.findings.length) {
      this.nav.append(mk('h4', '', `Problems (${this.findings.length})`));
      for (const f of this.findings) { const d = mk('div', `jsg-find ${f.severity}`, f.message); d.title = `${f.rule}, line ${f.line}`; this.nav.appendChild(d); }
    }
  }
}

export { text };
export type { Para };
