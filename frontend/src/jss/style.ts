// The editor's stylesheet. The page is drawn with the stencil's own measurements (JSS-0251 UHB/MM/ORM): A4, 25 mm inner and 15 mm outer margin, Arial 12 pt,
// chapter titles 18 pt, section headings 14 pt capitals then 12 pt, with the heading numbers and text in the stencil's hanging columns (8, 12.7, 17 and 20 mm)
// and body text indented to where the heading text starts (8, 20.7, 25 and 28 mm). The surroundings use the application's theme tokens; the sheet itself is
// always paper-white with black text, as it prints.

export const JSS_CSS = `
.jss-root { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg); color: var(--text); font-size: 13px; }
.jss-root * { box-sizing: border-box; }
.jss-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 4px; padding: 5px 10px; border-bottom: 1px solid var(--border); background: var(--bg-elev); flex: none; }
.jss-toolbar { flex-direction: column; align-items: stretch; flex-wrap: nowrap; gap: 0; padding: 0; }
.jss-tabs { display: flex; align-items: flex-end; gap: 2px; padding: 4px 10px 0; border-bottom: 1px solid var(--border); }
.jss-quick { display: inline-flex; gap: 1px; margin: 0 10px 3px 0; padding-right: 10px; border-right: 1px solid var(--border); }
.jss-tab { height: 30px; padding: 0 14px; border: 1px solid transparent; border-bottom: 0; border-radius: 6px 6px 0 0; background: none; color: var(--text-muted); font: inherit; font-size: 12.5px; cursor: pointer; margin-bottom: -1px; }
.jss-tab:hover { color: var(--text); background: var(--bg-hover); }
.jss-tab.on { background: var(--bg); color: var(--accent); font-weight: 600; border-color: var(--border); border-bottom: 1px solid var(--bg); }
.jss-panels { background: var(--bg); }
.jss-panel { display: flex; flex-wrap: wrap; align-items: stretch; gap: 2px 0; padding: 6px 10px 4px; min-height: 60px; }
.jss-panel[hidden] { display: none; }
.jss-tgroup { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 0 10px; border-right: 1px solid var(--border); }
.jss-tgroup:first-child { padding-left: 0; }
.jss-tgroup:last-of-type { border-right: 0; }
.jss-tbtns { display: flex; align-items: center; flex-wrap: wrap; gap: 1px; }
.jss-tlabel { font-size: 10.5px; color: var(--text-faint); letter-spacing: .03em; }
.jss-thint { align-self: center; max-width: 52ch; font-size: 11.5px; color: var(--text-faint); padding: 0 12px; }
.jss-tb { min-width: 28px; height: 28px; padding: 0 7px; border: 1px solid transparent; border-radius: 6px; background: none; color: var(--text); cursor: pointer; font: inherit; font-size: 12.5px; display: inline-flex; align-items: center; justify-content: center; gap: 4px; white-space: nowrap; }
.jss-tb:hover:not(:disabled) { background: var(--bg-hover); }
.jss-tb:disabled { color: var(--text-faint); cursor: default; opacity: .55; }
.jss-tb.on { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
.jss-tb:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.jss-tb b, .jss-tb i, .jss-tb u { font-size: 14px; }
.jss-menu { position: absolute; z-index: 40; min-width: 200px; background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: 8px; box-shadow: var(--shadow-menu); padding: 4px; }
.jss-menu button { display: flex; width: 100%; align-items: center; gap: 8px; padding: 7px 10px; border: 0; background: none; border-radius: 5px; color: var(--text); font: inherit; cursor: pointer; text-align: left; }
.jss-menu button:hover:not(:disabled) { background: var(--bg-hover); }
.jss-menu button:disabled { color: var(--text-faint); cursor: default; }
.jss-menu .k { margin-left: auto; color: var(--text-faint); font-size: 11.5px; }

.jss-main { display: flex; flex: 1; min-height: 0; }
.jss-outline { width: 250px; flex: none; border-right: 1px solid var(--border); background: var(--bg-elev); overflow: auto; padding: 8px 0; }
.jss-outline h3 { margin: 4px 12px 6px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--text-faint); font-weight: 600; }
.jss-ol { display: flex; gap: 6px; align-items: baseline; min-height: 24px; padding: 3px 12px; cursor: pointer; color: var(--text-muted); border-left: 3px solid transparent; line-height: 1.3; }
.jss-ol:hover { background: var(--bg-hover); color: var(--text); }
.jss-ol.cur { background: var(--accent-soft); color: var(--accent); border-left-color: var(--accent); }
.jss-ol .n { flex: none; font-variant-numeric: tabular-nums; color: var(--text-faint); min-width: 30px; }
.jss-ol.ch { font-weight: 600; color: var(--text); margin-top: 4px; }
.jss-ol.bad::after, .jss-ol.warn::after { content: '●'; margin-left: auto; font-size: 9px; }
.jss-ol.bad::after { color: var(--danger); } .jss-ol.warn::after { color: var(--warning); }
.jss-scroll { flex: 1; min-width: 0; overflow: auto; background: var(--bg-sunken); padding: 22px 16px 80px; }
.jss-sheetnote { max-width: 210mm; margin: 0 0 10px; font-size: 12px; color: var(--text-faint); }

/* ---- the sheet ---- */
.jss-paper { width: 210mm; max-width: none; margin: 0 0 0 max(0px, calc((100% - 210mm) / 2)); background: var(--paper); color: var(--paper-ink); padding: 20mm 15mm 20mm 25mm; box-shadow: var(--paper-shadow); min-height: 297mm; font-family: var(--font-paper); font-size: 12pt; line-height: 1.15; text-align: justify; }
.jss-paper [contenteditable="true"] { outline: none; min-height: 1.15em; }
.jss-paper [contenteditable="true"]:empty::before { content: attr(data-ph); color: var(--paper-placeholder); pointer-events: none; }
.jss-paper [contenteditable="true"]:focus { background: var(--paper-focus-fill); box-shadow: -3px 0 0 var(--paper-focus-edge); }
.jss-ro .jss-paper [contenteditable] { cursor: default; }

.jss-chapter { margin: 0 0 8mm; }
.jss-chapter + .jss-chapter { margin-top: 14mm; border-top: 1px dashed var(--paper-guide); padding-top: 10mm; }
.jss-ch-no { font-size: 18pt; font-weight: 700; margin-bottom: 1mm; text-align: left; }
.jss-ch-title { font-size: 18pt; font-weight: 700; border-bottom: 1pt solid var(--paper-ink); padding-bottom: 2mm; margin-bottom: 6mm; text-align: left; }
.jss-ch-lock { font-size: 9pt; font-weight: 400; color: var(--paper-hint); margin-left: 8px; font-family: system-ui, sans-serif; }
.jss-chapter { position: relative; }
.jss-chapter:hover > .jss-ch-tools, .jss-chapter:focus-within > .jss-ch-tools { display: inline-flex; }
.jss-addch { display: block; margin: 10mm 0 0; padding: 6px 14px; border: 1px dashed var(--border-strong); border-radius: 6px; background: none; color: var(--text, inherit); font: 13px system-ui, sans-serif; cursor: pointer; }
.jss-addch:hover { background: var(--bg-hover); }

.jss-sec { margin-top: 0; position: relative; }
.jss-sec-head { display: flex; align-items: baseline; margin-top: 4.2mm; margin-bottom: 2.1mm; font-weight: 700; text-align: left; break-after: avoid; }
.jss-sec-no { flex: none; }
.jss-sec-title { flex: 1; min-width: 0; }
.jss-sec-code { flex: none; margin-left: 3mm; padding: 0 1.5mm; border: 1px solid var(--paper-code-border); border-radius: 3px; background: var(--paper-code-bg); color: var(--paper-code-text); font: 400 7pt/1.5 ui-monospace, Consolas, monospace; text-transform: none; user-select: none; }
.jss-sec.d1 > .jss-sec-head { font-size: 14pt; text-transform: uppercase; }
.jss-sec.d1 > .jss-sec-head .jss-sec-no { width: 8mm; }
.jss-sec.d2 > .jss-sec-head { margin-left: 8mm; font-size: 12pt; } .jss-sec.d2 > .jss-sec-head .jss-sec-no { width: 12.7mm; }
.jss-sec.d3 > .jss-sec-head { margin-left: 8mm; font-size: 12pt; } .jss-sec.d3 > .jss-sec-head .jss-sec-no { width: 17mm; }
.jss-sec.d4 > .jss-sec-head, .jss-sec.d5 > .jss-sec-head { margin-left: 8mm; font-size: 12pt; } .jss-sec.d4 > .jss-sec-head .jss-sec-no, .jss-sec.d5 > .jss-sec-head .jss-sec-no { width: 20mm; }
.jss-sec.d1 > .jss-sec-body { margin-left: 8mm; } .jss-sec.d2 > .jss-sec-body { margin-left: 20.7mm; } .jss-sec.d3 > .jss-sec-body { margin-left: 25mm; } .jss-sec.d4 > .jss-sec-body, .jss-sec.d5 > .jss-sec-body { margin-left: 28mm; }
.jss-sec-body { }
.jss-sec-tools { position: absolute; right: -2px; top: 0; display: none; gap: 2px; font-family: system-ui, sans-serif; font-size: 12px; background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: 6px; padding: 2px; z-index: 5; }
.jss-sec:hover > .jss-sec-tools, .jss-sec:focus-within > .jss-sec-tools { display: inline-flex; }
.jss-sec-tools button { border: 0; background: none; color: var(--text); cursor: pointer; border-radius: 4px; padding: 3px 6px; font: inherit; }
.jss-sec-tools button:hover:not(:disabled) { background: var(--bg-hover); } .jss-sec-tools button:disabled { color: var(--text-faint); cursor: default; }
.jss-sec-tools select { font: inherit; font-size: 12px; border: 0; background: none; color: var(--text); }

.jss-block { position: relative; margin: 0 0 3mm; }
.jss-block.jss-sel { box-shadow: -4px 0 0 var(--paper-sel-edge); }
.jss-para { text-align: justify; }
.jss-para[data-align="left"] { text-align: left; } .jss-para[data-align="center"] { text-align: center; } .jss-para[data-align="right"] { text-align: right; }
.jss-xref { color: var(--paper-focus-edge); text-decoration: underline; cursor: default; white-space: nowrap; }
.jss-xref.missing { color: var(--paper-error); text-decoration: underline wavy; }
.jss-ph-xref { font-size: 11px; background: var(--paper-xref-bg); border-radius: 3px; padding: 0 3px; }

.jss-list { margin: 0 0 3mm; }
.jss-li { display: flex; align-items: flex-start; margin-bottom: 1.5mm; }
.jss-li-label { flex: none; text-align: left; user-select: none; }
.jss-list[data-type="alpha"] > .jss-li > .jss-li-label, .jss-list[data-type="number"] > .jss-li > .jss-li-label { width: 6.3mm; }
.jss-list[data-type="roman"] > .jss-li > .jss-li-label { width: 8mm; }
.jss-list[data-type="bullet"] > .jss-li > .jss-li-label, .jss-list[data-type="dash"] > .jss-li > .jss-li-label { width: 5mm; }
.jss-li-body { flex: 1; min-width: 0; }
.jss-li-body > .jss-list { margin-bottom: 0; margin-top: 1.5mm; }

.jss-tablewrap { margin: 4mm 0 5mm; }
.jss-cap { text-align: center; font-weight: 700; font-size: 10pt; margin: 0 0 2mm; }
.jss-cap .no { white-space: nowrap; } .jss-cap [contenteditable] { display: inline-block; min-width: 40mm; text-align: left; }
.jss-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10pt; }
.jss-table th, .jss-table td { border: 0.6pt solid var(--paper-ink); padding: 1.5mm; vertical-align: top; text-align: left; }
.jss-table thead td { font-weight: 700; text-align: center; }
.jss-table td:focus-within { background: var(--paper-focus-fill); }
.jss-table .jss-cellpart { min-height: 1.15em; }
.jss-ttools { display: none; gap: 4px; flex-wrap: wrap; margin-bottom: 2mm; font-family: system-ui, sans-serif; font-size: 12px; text-align: left; }
.jss-block:focus-within > .jss-tablewrap > .jss-ttools, .jss-tablewrap:hover > .jss-ttools { display: flex; }
.jss-ttools button { border: 1px solid var(--border-strong); background: var(--bg-elev); color: var(--text); border-radius: 5px; padding: 2px 7px; cursor: pointer; font: inherit; }
.jss-ttools button:disabled { color: var(--text-faint); cursor: default; opacity: .6; }
.jss-ttools .hint { color: var(--paper-hint); align-self: center; }

.jss-figure { text-align: center; margin: 4mm 0 5mm; }
.jss-figure img { max-width: 100%; max-height: 170mm; display: inline-block; }
.jss-figure .jss-imgbox { border: 1px dashed var(--paper-guide); padding: 3mm; display: inline-block; max-width: 100%; }
.jss-figure .jss-missing { color: var(--paper-error); font-size: 10pt; padding: 8mm; }
.jss-legend { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0 8mm; text-align: left; font-size: 10pt; margin-top: 2mm; }
.jss-legend .row { display: flex; gap: 2mm; align-items: baseline; }
.jss-legend .row b { min-width: 7mm; }
.jss-ftools { display: none; gap: 6px; flex-wrap: wrap; justify-content: center; font-family: system-ui, sans-serif; font-size: 12px; margin-bottom: 2mm; align-items: center; }
.jss-block:focus-within .jss-ftools, .jss-figure:hover .jss-ftools { display: flex; }
.jss-ftools button, .jss-ftools input { border: 1px solid var(--border-strong); background: var(--bg-elev); color: var(--text); border-radius: 5px; padding: 2px 7px; font: inherit; }
.jss-ftools input { width: 90px; }

.jss-notice { margin: 4mm 0; }
/* A notice or a table spans the full text width wherever it sits: it steps back out of its section's indent, as it prints. */
.jss-sec.d1 > .jss-sec-body > .jss-wide { margin-left: -8mm; }
.jss-sec.d2 > .jss-sec-body > .jss-wide { margin-left: -20.7mm; }
.jss-sec.d3 > .jss-sec-body > .jss-wide { margin-left: -25mm; }
.jss-sec.d4 > .jss-sec-body > .jss-wide, .jss-sec.d5 > .jss-sec-body > .jss-wide { margin-left: -28mm; }
.jss-notice .band { color: var(--paper); font-weight: 700; font-size: 9pt; padding: 1mm 2mm; text-align: left; font-family: var(--font-paper); }
.jss-notice.note .band { background: var(--paper-band-note); font-style: italic; } .jss-notice.warning .band, .jss-notice.caution .band { background: var(--paper-band-warning); }
.jss-notice .txt { padding: 1mm 2mm; border-bottom: 0.8pt solid var(--paper-ink); font-weight: 700; text-transform: uppercase; text-align: left; }
.jss-notice .txt > .jss-para { margin: 0 0 1.5mm; }
.jss-pb { border-top: 1px dashed var(--paper-placeholder); margin: 5mm 0; text-align: center; font: 10px system-ui, sans-serif; color: var(--paper-hint); line-height: 0; }
.jss-pb span { background: var(--paper); padding: 0 8px; }
.jss-problem-mark { position: absolute; left: -9mm; top: 0; font: 700 11px system-ui, sans-serif; width: 6mm; text-align: center; border-radius: 3px; color: var(--paper); }
.jss-has-error > .jss-problem-mark.e { background: var(--paper-mark-error); } .jss-has-warn > .jss-problem-mark.w { background: var(--paper-mark-warning); }
.jss-flash { animation: jss-flash 1.6s ease-out; }
@keyframes jss-flash { 0% { background: var(--paper-flash); } 100% { background: transparent; } }

.jss-problems { flex: none; border-top: 1px solid var(--border); background: var(--bg-elev); max-height: 190px; overflow: auto; }
.jss-problems summary { padding: 6px 12px; cursor: pointer; font-weight: 600; user-select: none; position: sticky; top: 0; background: var(--bg-elev); }
.jss-pr { display: flex; gap: 8px; padding: 4px 12px; cursor: pointer; align-items: baseline; }
.jss-pr:hover { background: var(--bg-hover); }
.jss-pr .sev { flex: none; width: 8px; height: 8px; border-radius: 50%; position: relative; top: 0; }
.jss-pr .sev.error { background: var(--danger); } .jss-pr .sev.warning { background: var(--warning); }
.jss-pr .rule { flex: none; color: var(--text-faint); font-size: 11.5px; min-width: 130px; }
.jss-pr .at { color: var(--text-faint); margin-left: auto; flex: none; font-size: 12px; }
.jss-source { flex: 1; margin: 0; padding: 16px 20px; overflow: auto; background: var(--bg-sunken); font: 12px/1.45 ui-monospace, Consolas, monospace; white-space: pre; color: var(--text); }

.jss-dialog-back { position: fixed; inset: 0; background: var(--scrim); z-index: 100; display: flex; align-items: center; justify-content: center; }
.jss-dialog { background: var(--bg-elev); color: var(--text); border: 1px solid var(--border-strong); border-radius: 10px; width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 48px); display: flex; flex-direction: column; box-shadow: var(--shadow-dialog); }
.jss-dialog header { padding: 14px 18px 8px; font-weight: 600; font-size: 15px; }
.jss-dialog .body { padding: 4px 18px 10px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
.jss-dialog footer { padding: 10px 18px 14px; display: flex; justify-content: flex-end; gap: 8px; }
.jss-dialog label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; font-weight: 600; color: var(--text-muted); }
.jss-dialog input, .jss-dialog select, .jss-dialog textarea { height: 32px; padding: 0 10px; border: 1px solid var(--border-strong); border-radius: 6px; background: var(--bg); color: var(--text); font: inherit; font-weight: 400; }
.jss-dialog .hint { font-weight: 400; color: var(--text-faint); font-size: 11.5px; }
.jss-dialog .err { color: var(--danger); font-size: 12.5px; }
.jss-dialog .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.jss-dialog .pick { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; max-height: 280px; overflow: auto; }
.jss-dialog .pick button { border: 1px solid var(--border-strong); background: var(--bg); border-radius: 8px; padding: 6px; cursor: pointer; display: flex; flex-direction: column; gap: 4px; align-items: center; color: var(--text); font: inherit; font-size: 11.5px; }
.jss-dialog .pick button.sel { outline: 2px solid var(--accent); }
.jss-dialog .pick img { width: 100%; height: 70px; object-fit: contain; background: var(--image-backdrop); }
.jss-dialog .list { max-height: 300px; overflow: auto; border: 1px solid var(--border); border-radius: 6px; }
.jss-dialog .list button { display: flex; width: 100%; gap: 10px; padding: 7px 10px; border: 0; border-bottom: 1px solid var(--border); background: none; color: var(--text); font: inherit; cursor: pointer; text-align: left; }
.jss-dialog .list button:hover, .jss-dialog .list button.sel { background: var(--accent-soft); }
.jss-dialog .list .kind { flex: none; width: 56px; color: var(--text-faint); font-size: 11.5px; text-transform: uppercase; }
.jss-btn { height: 32px; padding: 0 14px; border-radius: 6px; border: 1px solid var(--border-strong); background: var(--bg-elev); color: var(--text); cursor: pointer; font: inherit; }
.jss-btn.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
.jss-btn:disabled { opacity: .55; cursor: default; }
@media print { .jss-toolbar, .jss-outline, .jss-problems { display: none; } }
`;

let injected = false;
export function ensureStyles(): void {
  if (injected || typeof document === 'undefined') return;
  const el = document.createElement('style'); el.setAttribute('data-jss-editor', ''); el.textContent = JSS_CSS; document.head.appendChild(el); injected = true;
}
