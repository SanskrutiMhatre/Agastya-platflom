// Pieces both JSG editors use (the User Handbook editor and the Illustrated Spare Parts List editor): the host interface, the common look, the picture chooser, the cover card.
//
// JSG-only: nothing here is shared with the JSS editor (src/jss) or the S1000D Studio (src/studio).

import { META_FIELDS, type JsgDoc } from './model';

export interface GraphicInfo { src: string; name: string; url: string }
export interface JsgFinding { severity: 'error' | 'warning'; rule: string; message: string; line: number; location: string }
export interface JsgHost {
  graphics(): Promise<GraphicInfo[]>;
  uploadGraphic(file: File): Promise<GraphicInfo>;
  imageUrl(src: string): string;
  onDirty(dirty: boolean): void;
  onSaveRequested(): void;
  onCheckRequested(): void;
  notify(message: string, kind: 'info' | 'error'): void;
}
/** The text shown beside a section's (or appendix's) heading: its document code. `chapter` is the number the section's chapter has in the document's outline (appendices count on after the chapters). */
export type SectionBadge = (s: { id?: string; title: string }, chapter: number) => string | null;
export interface JsgEditorOptions { doc: JsgDoc; readOnly: boolean; host: JsgHost; sectionBadge?: SectionBadge }

/** What the editor page needs from either editor. */
export interface JsgEditorLike {
  destroy(): void;
  isDirty(): boolean;
  markSaved(): void;
  getXml(): string;
  setFindings(f: JsgFinding[]): void;
  /** Show (or stop showing) a document code beside each section heading; the document itself is not touched. */
  setSectionBadge?(fn: SectionBadge | undefined): void;
}

export const escH = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function injectCss(id: string, css: string): void {
  if (document.getElementById(id)) return;
  const s = document.createElement('style'); s.id = id; s.textContent = css; document.head.appendChild(s);
}

export function mk(tag: string, cls = '', txt = ''): HTMLElement {
  const e = document.createElement(tag); if (cls) e.className = cls; if (txt) e.textContent = txt; return e;
}
export function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (cls) b.className = cls;
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', onClick); return b;
}

/** The look both editors share: the outline on the left, a toolbar, and a white sheet (Times New Roman, as the stencils set it). */
export const BASE_CSS = `
.jsg-ed{display:flex;height:100%;min-height:0;background:var(--bg,#f4f5f7);color:#111;font-size:13px}
.jsg-nav{flex:0 0 232px;overflow:auto;border-right:1px solid #cfd4da;background:#fff;padding:8px 6px;font-size:12px}
.jsg-nav h4{margin:8px 4px 4px;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#5a6572}
.jsg-nav a{display:block;padding:2px 6px;border-radius:3px;color:#1b1f24;cursor:pointer;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.jsg-nav a:hover{background:#e8f0fe}.jsg-nav a.l2{padding-left:16px}.jsg-nav a.l3{padding-left:26px}
.jsg-nav .jsg-find{margin:2px 4px;padding:3px 6px;border-radius:3px;font-size:11px;cursor:pointer}
.jsg-nav .jsg-find.error{background:#fde8e8;color:#8a1c1c}.jsg-nav .jsg-find.warning{background:#fff4e0;color:#7a4b00}
.jsg-main{flex:1;display:flex;flex-direction:column;min-width:0}
.jsg-bar{display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:6px 8px;border-bottom:1px solid #cfd4da;background:#fff}
.jsg-bar button{border:1px solid #cfd4da;background:#fff;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:12px;color:#1b1f24}
.jsg-bar button:hover:not(:disabled){background:#e8f0fe}.jsg-bar button:disabled{opacity:.45;cursor:default}
.jsg-bar .sep{width:1px;height:18px;background:#cfd4da;margin:0 4px}
.jsg-scroll{flex:1;overflow:auto;padding:18px}
.jsg-sheet{margin:0 auto;max-width:794px;background:#fff;color:#000;padding:56px 56px 72px 94px;box-shadow:0 1px 6px rgba(0,0,0,.18);font:12pt/1.15 "Times New Roman",Times,serif}
.jsg-sheet [contenteditable]{outline:none}.jsg-sheet [contenteditable]:focus{background:#f3f8ff}
.jsg-sheet [contenteditable]:empty:before{content:attr(data-ph);color:#9aa4ae}
.jsg-card{border:1px dashed #b8c0c8;border-radius:4px;margin:14px -18px 18px;padding:10px 14px;background:#fafbfc;font:13px/1.35 system-ui,sans-serif}
.jsg-card h3{margin:0 0 8px;font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:#46515e}
.jsg-card label{display:grid;grid-template-columns:170px 1fr;gap:8px;align-items:center;margin:3px 0}
.jsg-card input{font:13px system-ui,sans-serif;padding:3px 6px;border:1px solid #cfd4da;border-radius:3px;width:100%;box-sizing:border-box}
.jsg-card .jsg-row{display:flex;gap:6px;margin:3px 0;align-items:flex-start}.jsg-card .jsg-row>span{flex:0 0 22px;color:#5a6572}
.jsg-card .jsg-row>[contenteditable],.jsg-card .jsg-row>input{flex:1;border:1px solid #cfd4da;border-radius:3px;padding:3px 6px;background:#fff;min-height:20px}
.jsg-card button{border:1px solid #cfd4da;background:#fff;border-radius:3px;padding:1px 7px;cursor:pointer;font-size:12px}
.jsg-chapter{color:#0000ff;font-weight:bold;text-transform:uppercase;font-size:22pt;line-height:1.15;text-align:center;margin:60px 0 6px}
.jsg-sectionh{color:#0000ff;font-weight:bold;text-transform:uppercase;font-size:22pt;text-align:center;margin:36px 0 12px}
.jsg-num{display:block;font-size:22pt}
.jsg-code{display:block;width:fit-content;margin:4px auto 0;padding:0 6px;border:1px solid #d0d7e2;border-radius:3px;background:#eef2f7;color:#475569;font:400 9pt/1.5 ui-monospace,Consolas,monospace;text-transform:none;user-select:none}
.jsg-clause{color:#0000ff;font-weight:bold;text-transform:uppercase;margin:12pt 0 6pt;display:flex;gap:10px}
.jsg-clause .n{flex:0 0 auto;min-width:34px}.jsg-clause .t{flex:1}
.jsg-p{text-align:justify;margin:3pt 0}
.jsg-list{margin:3pt 0}.jsg-li{display:flex;gap:8px;margin:3pt 0;text-align:justify}.jsg-li .m{flex:0 0 40px}.jsg-li .b{flex:1}
.jsg-cap{font-weight:bold;text-align:center;margin:6pt 0}
.jsg-fig{text-align:center;margin:6pt 0}.jsg-fig img{max-width:100%;max-height:340px}
.jsg-fig .empty{border:1px dashed #9aa4ae;color:#5a6572;padding:26px;font:12px system-ui,sans-serif}
.jsg-table{border-collapse:collapse;width:100%;font-size:10pt;margin:4pt 0}
.jsg-table td,.jsg-table th{border:1px solid #444;padding:2px 4px;vertical-align:middle}.jsg-table th{font-weight:bold;text-align:center}
.jsg-notice{border:1px solid #000;padding:4px 8px;margin:6pt 0}.jsg-notice b{display:block;text-transform:uppercase}
.jsg-break{border-top:1px dashed #9aa4ae;color:#9aa4ae;font:10px system-ui,sans-serif;text-align:center;margin:8px 0}
.jsg-tag{font:10px system-ui,sans-serif;color:#5a6572;margin:10px 0 0;text-transform:uppercase}
.jsg-sel{box-shadow:-4px 0 0 #7aa7ff}.jsg-ro .jsg-bar button.edit{display:none}
.jsg-app{text-align:center;font-weight:bold;font-size:14pt;margin:34px 0 10px}


/* ---- the toolbar in tabs (both JSG editors): Write, Insert, Table, Arrange, Document; every button stays in the page, a tab only hides its panel ---- */
.jsg-ed{color:var(--text,#111)}
.jsg-nav{background:var(--bg-elev,#fff);border-right-color:var(--border,#cfd4da);color:var(--text,#1b1f24)}
.jsg-nav a{color:var(--text,#1b1f24)}.jsg-nav a:hover{background:var(--accent-soft,#e8f0fe)}
.jsg-bar.jsg-tabbed{display:block;padding:0;background:var(--bg-elev,#fff);border-bottom-color:var(--border,#cfd4da)}
.jsg-tabs{display:flex;align-items:flex-end;gap:2px;padding:4px 10px 0;border-bottom:1px solid var(--border,#cfd4da)}
.jsg-quick{display:inline-flex;gap:1px;margin:0 10px 3px 0;padding-right:10px;border-right:1px solid var(--border,#cfd4da)}
.jsg-tab{height:30px;padding:0 14px;border:1px solid transparent;border-bottom:0;border-radius:6px 6px 0 0;background:none;color:var(--text-muted,#5a6572);font:inherit;font-size:12.5px;cursor:pointer;margin-bottom:-1px}
.jsg-tab:hover{color:var(--text,#1b1f24);background:var(--bg-hover,#eef2f7)}
.jsg-tab.on{background:var(--bg,#f4f5f7);color:var(--accent,#2563eb);font-weight:600;border-color:var(--border,#cfd4da);border-bottom:1px solid var(--bg,#f4f5f7)}
.jsg-tab:focus-visible{outline:2px solid var(--accent,#2563eb);outline-offset:1px}
.jsg-panels{background:var(--bg,#f4f5f7)}
.jsg-panel{display:flex;flex-wrap:wrap;align-items:stretch;gap:2px 0;padding:6px 10px 4px;min-height:60px}
.jsg-panel[hidden]{display:none}
.jsg-tgroup{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:0 10px;border-right:1px solid var(--border,#cfd4da)}
.jsg-tgroup:first-child{padding-left:0}.jsg-tgroup:last-of-type{border-right:0}
.jsg-tbtns{display:flex;align-items:center;flex-wrap:wrap;gap:1px}
.jsg-tlabel{font-size:10.5px;color:var(--text-faint,#8a94a0);letter-spacing:.03em}
.jsg-bar .jsg-tb{min-width:28px;height:28px;padding:0 8px;border:1px solid transparent;border-radius:6px;background:none;color:var(--text,#1b1f24);cursor:pointer;font:inherit;font-size:12.5px;display:inline-flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap}
.jsg-bar .jsg-tb:hover:not(:disabled){background:var(--bg-hover,#eef2f7)}
.jsg-bar .jsg-tb:disabled{color:var(--text-faint,#8a94a0);cursor:default;opacity:.55}
.jsg-bar .jsg-tb.on{background:var(--accent-soft,#e8f0fe);color:var(--accent,#2563eb);border-color:var(--accent,#2563eb)}
.jsg-bar .jsg-tb:focus-visible{outline:2px solid var(--accent,#2563eb);outline-offset:1px}
.jsg-thint{align-self:center;max-width:52ch;font-size:11.5px;color:var(--text-faint,#8a94a0);padding:0 12px}
.jsg-menu{position:fixed;z-index:60;min-width:210px;background:var(--bg-elev,#fff);border:1px solid var(--border-strong,#b8c0c8);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:4px;font:13px system-ui,sans-serif}
.jsg-menu button{display:flex;width:100%;align-items:center;gap:8px;padding:7px 10px;border:0;background:none;border-radius:5px;color:var(--text,#1b1f24);font:inherit;cursor:pointer;text-align:left}
.jsg-menu button:hover:not(:disabled){background:var(--bg-hover,#eef2f7)}.jsg-menu button:disabled{color:var(--text-faint,#8a94a0);cursor:default}
.jsg-menu .k{margin-left:auto;color:var(--text-faint,#8a94a0);font-size:11.5px}
.jsg-menu hr{border:0;border-top:1px solid var(--border,#cfd4da);margin:4px 2px}
@media (max-width:900px){.jsg-nav{display:none}.jsg-tabs{overflow-x:auto}.jsg-panel{flex-wrap:nowrap;overflow-x:auto}.jsg-scroll{padding:10px 6px}.jsg-sheet{padding:28px 20px 40px 28px}}
.jsg-sel{box-shadow:-4px 0 0 var(--accent,#7aa7ff)}
.jsg-status{display:flex;align-items:center;gap:14px;padding:3px 12px;border-top:1px solid var(--border,#cfd4da);background:var(--bg-elev,#fff);color:var(--text-muted,#5a6572);font:11.5px system-ui,sans-serif;flex:none;white-space:nowrap;overflow:hidden}
.jsg-status .grow{flex:1;overflow:hidden;text-overflow:ellipsis}.jsg-status select{font:inherit;border:1px solid var(--border,#cfd4da);border-radius:4px;background:var(--bg,#fff);color:inherit;padding:0 2px}
.jsg-find{display:none;align-items:center;flex-wrap:wrap;gap:6px;padding:6px 10px;border-bottom:1px solid var(--border,#cfd4da);background:var(--bg-elev,#fff);font:12.5px system-ui,sans-serif}
.jsg-find.open{display:flex}.jsg-find input[type=text]{height:26px;padding:0 8px;border:1px solid var(--border-strong,#b8c0c8);border-radius:5px;background:var(--bg,#fff);color:inherit;min-width:150px}
.jsg-find button{height:26px;border:1px solid var(--border-strong,#b8c0c8);border-radius:5px;background:var(--bg-elev,#fff);color:inherit;padding:0 9px;cursor:pointer;font:inherit}.jsg-find button:hover:not(:disabled){background:var(--bg-hover,#eef2f7)}.jsg-find button:disabled{opacity:.5;cursor:default}
.jsg-find .cnt{color:var(--text-faint,#8a94a0);min-width:70px}
::highlight(jsg-hit){background:#ffe58f;color:#000}::highlight(jsg-cur){background:#ff9f43;color:#000}
.jsg-orient{font:10px system-ui,sans-serif;color:#6b7280;text-align:center;margin:6px 0;border-top:1px dashed #9aa4ae;padding-top:2px}
`;

// ── The toolbar in tabs ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface MenuItem { label: string; hint?: string; run: () => void; disabled?: boolean; separator?: boolean }

/** A small menu under a button: closes on a click away, on Escape, or when an item runs. */
export function openMenu(anchor: HTMLElement, items: MenuItem[]): void {
  document.querySelectorAll('.jsg-menu').forEach((m) => m.remove());
  const r = anchor.getBoundingClientRect();
  const menu = mk('div', 'jsg-menu'); menu.setAttribute('role', 'menu');
  menu.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - 240))}px`; menu.style.top = `${r.bottom + 4}px`;
  const close = (): void => { menu.remove(); document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', esc, true); };
  const away = (e: Event): void => { if (!menu.contains(e.target as Node)) close(); };
  const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); close(); anchor.focus(); } };
  for (const it of items) {
    if (it.separator) { menu.appendChild(document.createElement('hr')); continue; }
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.disabled = !!it.disabled; b.textContent = it.label;
    if (it.hint) { const k = mk('span', 'k', it.hint); b.appendChild(k); }
    b.addEventListener('mousedown', (e) => e.preventDefault());                    // keep the caret where it is
    b.addEventListener('click', () => { close(); it.run(); });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  setTimeout(() => { document.addEventListener('mousedown', away, true); document.addEventListener('keydown', esc, true); (menu.querySelector('button:not(:disabled)') as HTMLElement | null)?.focus(); }, 0);
}

export interface BarButton { id: string; label: string; title: string; run: (btn: HTMLButtonElement) => void; /** false for a button that does not change the document (Check, Outline) */ edit?: boolean }
export interface BarGroup { label: string; buttons: BarButton[] }
export interface BarTab { id: string; label: string; groups: BarGroup[]; /** a line of advice at the end of the panel */ hint?: string }

/**
 * Fill `bar` with tabs, each holding labelled groups of buttons. Every button is in the page whichever tab is open (a tab only hides its panel), so the commands are reachable
 * by tests and by script; in a read-only view only the buttons that do not edit are offered. The last tab used is remembered. Returns the buttons by id.
 */
export function tabbedBar(bar: HTMLElement, tabs: BarTab[], opts: { readOnly: boolean; storageKey: string; /** buttons always in reach, left of the tabs (Undo, Redo) */ quick?: BarButton[] }): Map<string, HTMLButtonElement> {
  const buttons = new Map<string, HTMLButtonElement>();
  bar.classList.add('jsg-tabbed');
  const strip = mk('div', 'jsg-tabs'); strip.setAttribute('role', 'tablist'); strip.setAttribute('aria-label', 'Toolbar sections');
  const panels = mk('div', 'jsg-panels'); bar.append(strip, panels);
  const made: Array<{ id: string; panel: HTMLElement; tab: HTMLButtonElement }> = [];
  const quick = (opts.quick ?? []).filter((b) => !opts.readOnly || b.edit === false);
  if (quick.length) {
    const box = mk('div', 'jsg-quick');
    for (const b of quick) {
      const el = document.createElement('button'); el.type = 'button'; el.className = `jsg-tb${b.edit === false ? '' : ' edit'}`; el.textContent = b.label; el.title = b.title; el.setAttribute('aria-label', b.title); el.dataset.cmd = b.id;
      el.addEventListener('mousedown', (e) => e.preventDefault()); el.addEventListener('click', () => b.run(el)); buttons.set(b.id, el); box.appendChild(el);
    }
    strip.appendChild(box);
  }
  const pick = (id: string): void => {
    for (const t of made) { const on = t.id === id; t.panel.hidden = !on; t.tab.classList.toggle('on', on); t.tab.setAttribute('aria-selected', String(on)); }
    try { localStorage.setItem(opts.storageKey, id); } catch { /* private mode */ }
  };
  for (const t of tabs) {
    const groups = t.groups.map((g) => ({ ...g, buttons: g.buttons.filter((b) => !opts.readOnly || b.edit === false) })).filter((g) => g.buttons.length);
    if (!groups.length) continue;
    const panel = mk('div', 'jsg-panel'); panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-label', t.label);
    const tab = document.createElement('button'); tab.type = 'button'; tab.className = 'jsg-tab'; tab.setAttribute('role', 'tab'); tab.dataset.tab = t.id; tab.textContent = t.label;
    tab.addEventListener('click', () => pick(t.id));
    for (const g of groups) {
      const row = mk('div', 'jsg-tbtns');
      for (const b of g.buttons) {
        const el = document.createElement('button'); el.type = 'button'; el.className = `jsg-tb${b.edit === false ? '' : ' edit'}`; el.textContent = b.label; el.title = b.title; el.setAttribute('aria-label', b.title); el.dataset.cmd = b.id;
        el.addEventListener('mousedown', (e) => e.preventDefault());              // keep the text selection
        el.addEventListener('click', () => b.run(el));
        buttons.set(b.id, el); row.appendChild(el);
      }
      const grp = mk('div', 'jsg-tgroup'); grp.setAttribute('role', 'group'); grp.setAttribute('aria-label', g.label); grp.append(row, mk('span', 'jsg-tlabel', g.label)); panel.appendChild(grp);
    }
    if (t.hint && !opts.readOnly) panel.appendChild(mk('span', 'jsg-thint', t.hint));
    strip.appendChild(tab); panels.appendChild(panel); made.push({ id: t.id, panel, tab });
  }
  let saved: string | null = null; try { saved = localStorage.getItem(opts.storageKey); } catch { /* private mode */ }
  if (made.length) pick(made.some((m) => m.id === saved) ? (saved as string) : made[0].id);
  return buttons;
}

/** The chooser of a project picture, with an upload; resolves to the picture or null. */
export async function pickGraphic(host: JsgHost): Promise<GraphicInfo | null> {
  const list = await host.graphics().catch(() => [] as GraphicInfo[]);
  const dlg = document.createElement('dialog'); dlg.style.cssText = 'max-width:560px;width:90%;border:1px solid #888;border-radius:6px;padding:12px;font:13px system-ui';
  dlg.innerHTML = `<h3 style="margin:0 0 8px">Choose a picture</h3><div class="jsg-picks" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;max-height:320px;overflow:auto"></div>
    <p style="margin:8px 0 0"><label>Upload a new one: <input type="file" accept="image/*"></label></p><p style="text-align:right;margin:8px 0 0"><button type="button" class="x">Cancel</button></p>`;
  document.body.appendChild(dlg);
  return new Promise((resolve) => {
    const done = (g: GraphicInfo | null): void => { dlg.close(); dlg.remove(); resolve(g); };
    const box = dlg.querySelector('.jsg-picks') as HTMLElement;
    for (const g of list) { const b = document.createElement('button'); b.type = 'button'; b.style.cssText = 'border:1px solid #ccc;background:#fff;padding:4px;cursor:pointer'; b.innerHTML = `<img src="${escH(g.url)}" alt="" style="max-width:100%;max-height:70px"><div style="font-size:10px;overflow:hidden;text-overflow:ellipsis">${escH(g.name)}</div>`; b.onclick = () => done(g); box.appendChild(b); }
    if (!list.length) box.textContent = 'This project has no pictures yet: upload one below.';
    (dlg.querySelector('input[type=file]') as HTMLInputElement).onchange = (ev) => { const f = (ev.target as HTMLInputElement).files?.[0]; if (f) void host.uploadGraphic(f).then(done, (e) => { host.notify(String(e?.message ?? e), 'error'); done(null); }); };
    (dlg.querySelector('.x') as HTMLElement).onclick = () => done(null);
    dlg.addEventListener('cancel', () => done(null));
    dlg.showModal();
  });
}

/** Rows of single-line text (the supplier's and the issuing authority's lines on the cover). */
export function linesEditor(parent: HTMLElement, label: string, arr: string[], readOnly: boolean, touch: () => void): void {
  const box = mk('div'); box.append(mk('div', 'jsg-tag', label)); parent.appendChild(box);
  const draw = (): void => {
    box.querySelectorAll('.jsg-row').forEach((r) => r.remove());
    arr.forEach((v, i) => {
      const r = mk('div', 'jsg-row'); const inp = document.createElement('input'); inp.value = v; inp.disabled = readOnly;
      inp.addEventListener('input', () => { arr[i] = inp.value; touch(); }); r.appendChild(inp);
      if (!readOnly) r.appendChild(button('×', () => { arr.splice(i, 1); touch(); draw(); }));
      box.insertBefore(r, box.querySelector('button.add'));
    });
  };
  if (!readOnly) { const a = button('+ line', () => { arr.push(''); touch(); draw(); }, 'add'); box.appendChild(a); }
  draw();
}

/** The cover card: one input per cover field, then the supplier and issuer lines. `skip` leaves out the fields a document type does not have. */
export function coverCard(parent: HTMLElement, doc: JsgDoc, readOnly: boolean, touch: () => void, skip: string[] = []): HTMLElement {
  const c = mk('div', 'jsg-card'); c.append(mk('h3', '', 'Cover')); parent.appendChild(c);
  for (const f of META_FIELDS) {
    if (skip.includes(f.key)) continue;
    const l = document.createElement('label'); l.append(document.createTextNode(f.label));
    const i = document.createElement('input'); i.value = doc.meta[f.key] ?? ''; if (f.hint) i.placeholder = f.hint; i.disabled = readOnly;
    i.addEventListener('input', () => { doc.meta[f.key] = i.value; touch(); }); l.appendChild(i); c.appendChild(l);
  }
  linesEditor(c, 'Supplied by (lines)', doc.supplier, readOnly, touch); linesEditor(c, 'Issued by (lines)', doc.issuedBy, readOnly, touch);
  return c;
}
