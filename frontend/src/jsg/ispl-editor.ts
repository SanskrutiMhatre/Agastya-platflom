// The JSG Illustrated Spare Parts List editor.
//
// An ISPL is mostly data: a certificate, a standard preface, a few tables, and then plates - each plate a picture (or a grid of pictures with their references) and the
// table of the parts shown on it. So this editor is a structured one: every part of the printed list is a card, the parts table is a grid of cells you type into (and paste rows
// into from a spreadsheet), and the PDF engine on the server sets the pages. It edits the model (./model.ts) directly.
//
// Independent of the User Handbook editor's text editing, of the JSS editor (src/jss) and of the S1000D Studio (src/studio): it shares only ./shared.ts (host, look, picture chooser, cover card).

import { PART_COLUMNS, newList, newPara, newPart, newPlate, newView, parentRef, text, type Inline, type JsgDoc, type List, type Para, type Plate, type PlateView } from './model';
import { inlineHtml, readInline } from './editor';
import { BASE_CSS, button, coverCard, injectCss, mk, pickGraphic, type JsgEditorLike, type JsgEditorOptions, type JsgFinding, type JsgHost } from './shared';
import { mountIsplPreview, type PreviewHandle } from './ispl-preview';
import { serializeJsg } from './xml';

const CSS = `
.jsg-isplsheet{margin:0 auto;max-width:1180px;padding:18px 24px 60px;background:#fff;color:#000;box-shadow:0 1px 6px rgba(0,0,0,.18);font:12pt/1.2 "Times New Roman",Times,serif}
.jsg-isplsheet .jsg-card{margin:12px 0}
.jsg-isplsheet .jsg-card h3{font-size:13px}
.jsg-plate{border:1px solid #9aa4ae;border-radius:5px;margin:16px 0;background:#fff}
.jsg-plate>header{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 10px;background:#eef3fb;border-bottom:1px solid #cfd4da;font:12px system-ui,sans-serif}
.jsg-plate>header input[type=text]{font:13px system-ui;padding:3px 6px;border:1px solid #cfd4da;border-radius:3px}
.jsg-plate>header .ref{width:90px;font-weight:bold}.jsg-plate>header .ttl{width:220px}.jsg-plate>header .cap{width:260px}
.jsg-plate.sel>header{background:#dce8ff}
.jsg-view{margin:10px;padding:8px;border:1px dashed #b8c0c8;border-radius:4px;font:12px system-ui,sans-serif}
.jsg-view .pics{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0}
.jsg-view .pic{width:150px;border:1px solid #cfd4da;border-radius:3px;padding:4px;text-align:center;background:#fafbfc}
.jsg-view .pic img{max-width:100%;max-height:90px;display:block;margin:0 auto 4px}
.jsg-view .pic input{width:100%;box-sizing:border-box;font:11px system-ui;padding:2px 4px;border:1px solid #cfd4da;border-radius:3px}
.jsg-grid{overflow:auto;margin-top:6px}
.jsg-grid table{border-collapse:collapse;font:12px "Times New Roman",serif}
.jsg-grid th,.jsg-grid td{border:1px solid #666;padding:0}
.jsg-grid th{background:#f1f3f5;font-weight:bold;padding:3px 4px;text-align:center}
.jsg-grid td input{border:0;width:100%;box-sizing:border-box;padding:3px 4px;font:12px "Times New Roman",serif;background:transparent}
.jsg-grid td input:focus{outline:2px solid #7aa7ff;background:#f3f8ff}
.jsg-grid td.act{width:24px;text-align:center}
.jsg-note{font:11px system-ui;color:#5a6572;margin:4px 0}
.jsg-rich{border:1px solid #cfd4da;border-radius:3px;padding:4px 6px;background:#fff;min-height:20px;font:12pt/1.25 "Times New Roman",serif;outline:none;text-align:justify}
.jsg-rich:focus{background:#f3f8ff}
.jsg-isplbody{flex:1;display:flex;min-height:0}
.jsg-isplbody>.jsg-scroll{flex:1 1 0;min-width:0}
.jsg-pvpane{flex:0 0 44%;min-width:320px;max-width:60%;overflow-y:auto;overflow-x:hidden;border-left:1px solid #374151;background:#6b7280}
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
  private nav!: HTMLElement; private bar!: HTMLElement; private sheet!: HTMLElement;
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
    body.append(scroll, this.pvPane); main.append(this.bar, body); this.root.append(this.nav, main);
    try { this.pvOn = localStorage.getItem('agastya.jsg.ispl.preview') !== 'off'; } catch { /* the choice is only remembered when storage works */ }
    this.preview = mountIsplPreview(this.pvPane, (s) => this.host.imageUrl(s), (i) => { this.sel = i; this.schedulePreview(); document.getElementById(`jsg-pl-${i}`)?.scrollIntoView({ block: 'start' }); });
    this.pvPane.classList.toggle('off', !this.pvOn);
    document.addEventListener('keydown', this.onKey);          // the page, not just the editor: Ctrl+S must save after a dialog closed with focus on the body
    this.buildBar(); this.render();
  }

  destroy(): void { window.clearTimeout(this.pvTimer); this.preview.destroy(); document.removeEventListener('keydown', this.onKey); this.root.innerHTML = ''; this.root.classList.remove('jsg-ed', 'jsg-ro'); }
  isDirty(): boolean { return this.dirty; }
  markSaved(): void { this.dirty = false; this.host.onDirty(false); }
  getXml(): string { return serializeJsg(this.doc); }
  getDoc(): JsgDoc { return this.doc; }
  setFindings(f: JsgFinding[]): void { this.findings = f; this.renderNav(); }
  private touch(): void { if (!this.dirty) { this.dirty = true; this.host.onDirty(true); } this.schedulePreview(); }
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
    add('Delete plate', 'Delete the selected plate', () => this.deletePlate());
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
    if (!window.confirm(`Delete plate ${p.ref} ${p.title} with its views and parts?`)) return;
    this.doc.plates.splice(this.sel, 1); this.sel = Math.min(this.sel, this.doc.plates.length - 1); this.redraw();
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
    const f = this.doc.front;
    coverCard(this.sheet, this.doc, this.readOnly, () => this.touch(), ['subtitle']);

    const cert = this.card('Certificate'); cert.append(mk('div', 'jsg-note', 'Printed under C E R T I F I C A T E, followed by the Date / Name / Designation / Group block.'));
    cert.appendChild(this.rich(() => f.certificate ?? [], (i) => { f.certificate = i; f.has.certificate = true; }, 'Certified that this document no. ... contains ... pages ...'));

    this.prefaceCard();
    this.amendmentsCard();
    this.gridCard('Abbreviations', ['Abbreviation', 'For'], () => f.abbreviations.map((a) => [a.short, a.long]), (rows) => { f.abbreviations = rows.map((r) => ({ short: r[0], long: r[1] })); f.has.abbreviations = true; });
    this.suppliedCard();

    const head = mk('h2', '', 'Plates'); head.style.cssText = 'font:600 14px system-ui;margin:22px 0 4px'; this.sheet.appendChild(head);
    this.sheet.appendChild(mk('div', 'jsg-note', 'Each view prints a picture page and a parts-table page. The Contents page (with page ranges) is produced from the plates; the first plate marked "divider" also prints the big PLATE page and an index of its sub-plates.'));
    this.doc.plates.forEach((p, i) => this.plateCard(p, i));
    if (!this.doc.plates.length) this.sheet.appendChild(mk('div', 'jsg-note', 'No plates yet: press + Plate.'));
    this.renderNav(); this.schedulePreview();
  }

  private prefaceCard(): void {
    const f = this.doc.front; const c = this.card('Preface');
    c.append(mk('div', 'jsg-note', 'Numbered paragraphs (1., 2., ...), lettered lists, and continuation paragraphs (the NOTE). The stencil’s standard wording is the starting text.'));
    const draw = (): void => {
      c.querySelectorAll('.jsg-row, .jsg-add').forEach((r) => r.remove());
      let n = 0;
      f.preface.forEach((p, i) => {
        const r = mk('div', 'jsg-row');
        if (p.k === 'list') {
          r.append(mk('span', '', '(a)'));
          const box = mk('div'); box.style.flex = '1';
          p.items.forEach((it, k) => {
            const line = mk('div', 'jsg-row'); line.append(mk('span', '', `(${String.fromCharCode(97 + k)})`));
            const part = it.parts[0] ?? { k: 'text' as const, inline: [] }; if (!it.parts.length) it.parts.push(part);
            line.appendChild(this.rich(() => (part.k === 'text' || part.k === 'para' ? part.inline : []), (v) => { if (part.k === 'text' || part.k === 'para') part.inline = v; }));
            if (!this.readOnly) line.appendChild(button('×', () => { p.items.splice(k, 1); this.touch(); draw(); }));
            box.appendChild(line);
          });
          if (!this.readOnly) box.appendChild(button('+ item', () => { p.items.push({ parts: [{ k: 'text', inline: [] }] }); this.touch(); draw(); }));
          r.appendChild(box);
        } else {
          const numbered = p.indent === 2; if (numbered) n++;
          r.append(mk('span', '', numbered ? `${n}.` : '•'));
          r.appendChild(this.rich(() => p.inline, (v) => { p.inline = v; }));
          if (!this.readOnly) { const t = button(numbered ? '→' : '←', () => { p.indent = numbered ? 3 : 2; this.touch(); draw(); }); t.title = numbered ? 'Make this a continuation paragraph (no number)' : 'Make this a numbered paragraph'; r.appendChild(t); }
        }
        if (!this.readOnly) r.appendChild(button('×', () => { f.preface.splice(i, 1); this.touch(); draw(); }));
        c.appendChild(r);
      });
      if (!this.readOnly) {
        const a = mk('div', 'jsg-add'); a.append(button('+ paragraph', () => { f.preface.push(newPara('')); f.has.preface = true; this.touch(); draw(); }), button('+ (a) list', () => { const l: List = newList('alpha', 2); l.indent = 3; f.preface.push(l); f.has.preface = true; this.touch(); draw(); })); c.appendChild(a);
      }
    };
    draw();
  }

  private amendmentsCard(): void {
    const f = this.doc.front; const c = this.card('Amendments');
    const row = mk('div', 'jsg-row'); row.append(document.createTextNode('Blank rows to print in the table: '));
    const n = document.createElement('input'); n.type = 'number'; n.min = '0'; n.max = '60'; n.value = String(f.amendmentsMinRows); n.style.maxWidth = '70px'; n.disabled = this.readOnly;
    n.addEventListener('input', () => { f.amendmentsMinRows = Math.max(0, Math.min(60, Number(n.value) || 0)); f.has.amendments = true; this.touch(); }); row.appendChild(n); c.appendChild(row);
    this.gridInto(c, ['Amendment No.', 'Authority', 'Date of Amendment', 'By Whom Amended'], () => f.amendments.map((a) => [a.no, a.authority, a.date, a.by]),
      (rows) => { f.amendments = rows.map((r) => ({ no: r[0], page: '', para: '', required: '', authority: r[1], date: r[2], by: r[3] })); f.has.amendments = true; });
  }

  private suppliedCard(): void {
    const f = this.doc.front; const c = this.card('List of equipment already supplied against AT/SO');
    const l = document.createElement('label'); l.append(document.createTextNode('Name of the equipment')); const i = document.createElement('input'); i.value = f.supplied?.equipment ?? ''; i.disabled = this.readOnly;
    i.addEventListener('input', () => { if (!f.supplied) f.supplied = { equipment: '', rows: [] }; f.supplied.equipment = i.value; f.has.supplied = true; this.touch(); }); l.appendChild(i); c.appendChild(l);
    c.append(mk('div', 'jsg-note', 'With no rows the table prints one row reading "Nil", as the stencil does.'));
    this.gridInto(c, ['S. No.', 'DCAN No. / NSN', 'Name of Item', 'Supply Order Details'], () => (f.supplied?.rows ?? []).map((r) => [r.no, r.dcan, r.name, r.order]),
      (rows) => { if (!f.supplied) f.supplied = { equipment: '', rows: [] }; f.supplied.rows = rows.map((r) => ({ no: r[0], dcan: r[1], name: r[2], order: r[3] })); f.has.supplied = true; });
  }

  private gridCard(title: string, heads: string[], get: () => string[][], set: (rows: string[][]) => void): void { this.gridInto(this.card(title), heads, get, set); }

  /** A small table of text cells with add / delete row. `set` receives the whole table after every change. */
  private gridInto(parent: HTMLElement, heads: string[], get: () => string[][], set: (rows: string[][]) => void): void {
    const wrap = mk('div', 'jsg-grid'); parent.appendChild(wrap);
    let rows = get(); if (!rows.length) rows = [];
    const draw = (): void => {
      wrap.innerHTML = ''; const t = document.createElement('table'); const hr = document.createElement('tr');
      for (const h of heads) { const th = document.createElement('th'); th.textContent = h; hr.appendChild(th); } hr.appendChild(mk('th')); t.appendChild(hr);
      rows.forEach((r, ri) => {
        const tr = document.createElement('tr');
        heads.forEach((_, ci) => { const td = document.createElement('td'); const inp = document.createElement('input'); inp.value = r[ci] ?? ''; inp.disabled = this.readOnly; inp.addEventListener('input', () => { r[ci] = inp.value; set(rows); this.touch(); }); td.appendChild(inp); tr.appendChild(td); });
        const act = mk('td', 'act'); if (!this.readOnly) act.appendChild(button('×', () => { rows.splice(ri, 1); set(rows); this.touch(); draw(); })); tr.appendChild(act); t.appendChild(tr);
      });
      wrap.appendChild(t);
      if (!this.readOnly) wrap.appendChild(button('+ row', () => { rows.push(heads.map(() => '')); set(rows); this.touch(); draw(); }));
    };
    draw();
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
    const cap = document.createElement('input'); cap.type = 'text'; cap.placeholder = 'Red caption under the picture (e.g. 100M INFANTRY FOOT BRIDGE FLOATING (ISOMETRIC VIEW 1))'; cap.value = v.caption; cap.disabled = this.readOnly; cap.style.cssText = 'width:100%;box-sizing:border-box;margin:4px 0;font:13px system-ui;padding:3px 6px;border:1px solid #cfd4da;border-radius:3px';
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
        const act = mk('td', 'act'); if (!this.readOnly) act.appendChild(button('×', () => { v.parts.splice(ri, 1); this.touch(); draw(); })); tr.appendChild(act); t.appendChild(tr);
      });
      wrap.appendChild(t);
      if (!this.readOnly) {
        const bar = mk('div');
        bar.append(button('+ part', () => { const n = v.parts.length + 1; const r = newPart(String(n).padStart(2, '0')); r.plateRef = `${p.ref}/${n}`; v.parts.push(r); this.touch(); draw(); }),
          button('Paste rows', () => {
            const txt = window.prompt(`Paste rows copied from a spreadsheet (tab-separated, one part per line).\nColumns in order: ${cols.map((c) => c.label).join(' | ')}`, '');
            if (!txt) return;
            for (const line of txt.split(/\r?\n/)) { if (!line.trim()) continue; const cells = line.split('\t'); const r = newPart(); cols.forEach((c, k) => { r[c.key] = (cells[k] ?? '').trim(); }); v.parts.push(r); }
            this.touch(); draw();
          }), button('Remove view', () => { if (p.views.length > 1 || window.confirm('Remove the only view of this plate?')) { p.views.splice(vi, 1); this.redraw(); } }));
        wrap.appendChild(bar);          // inside the grid's own wrapper: a redraw replaces it, it never piles up
      }
    };
    draw();
    return box;
  }

  // ── the outline ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  private renderNav(): void {
    this.nav.innerHTML = '';
    this.nav.append(mk('h4', '', 'Plates'));
    this.doc.plates.forEach((p, i) => {
      const a = mk('a', parentRef(p.ref) ? 'l2' : '', `${p.ref}  ${p.title}`); a.title = `${p.ref} ${p.title}`; a.onclick = () => { this.sel = i; document.getElementById(`jsg-pl-${i}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }; this.nav.appendChild(a);
    });
    if (this.findings.length) {
      this.nav.append(mk('h4', '', `Problems (${this.findings.length})`));
      for (const f of this.findings) { const d = mk('div', `jsg-find ${f.severity}`, f.message); d.title = `${f.rule}, line ${f.line}`; this.nav.appendChild(d); }
    }
  }
}

export { text };
export type { Para };
