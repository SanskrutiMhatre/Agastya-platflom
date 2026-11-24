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
export interface JsgEditorOptions { doc: JsgDoc; readOnly: boolean; host: JsgHost }

/** What the editor page needs from either editor. */
export interface JsgEditorLike {
  destroy(): void;
  isDirty(): boolean;
  markSaved(): void;
  getXml(): string;
  setFindings(f: JsgFinding[]): void;
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
`;

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
