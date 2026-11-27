// WP-20 (RES-007, G-UX-1, G-UX-3; audit 08 section 7.3 runtime sweep, 11 section 10.7): an in-repository accessibility check that runs in the page.
//
// Why not axe-core: `@axe-core/playwright` / `axe-core` are not in the offline npm cache of this machine nor in node_modules (checked 2026-11-27:
// no `axe-core` entry in %LOCALAPPDATA%\npm-cache\_cacache\index-v5, no node_modules/axe-core), and the gate must run without the network. The
// rules below are the subset of axe's WCAG 2.x A/AA rules that matter for this UI, with axe's rule ids and impact levels so the results read the
// same and the switch to axe later (vendored into the offline cache) is a one-line change in the spec. Like axe, this is a partial check:
// keyboard order, focus visibility while moving, screen-reader output and the contenteditable editors need the manual checklist of RES-007.
//
// The function is passed to page.evaluate, so it must not reference anything outside its own body.

export type Impact = 'critical' | 'serious' | 'moderate' | 'minor';
export interface Violation { rule: string; impact: Impact; target: string; detail: string }
export interface AuditResult { violations: Violation[]; incomplete: Array<{ rule: string; target: string; why: string }>; checked: Record<string, number> }

export function auditPage(): AuditResult {
  const violations: Violation[] = [];
  const incomplete: AuditResult['incomplete'] = [];
  const checked: Record<string, number> = {};
  const count = (rule: string) => { checked[rule] = (checked[rule] || 0) + 1; };

  // ------------------------------------------------------------ helpers
  const target = (el: Element): string => {
    const parts: string[] = [];
    for (let e: Element | null = el, i = 0; e && e !== document.body && i < 4; e = e.parentElement, i++) {
      const tid = e.getAttribute('data-testid');
      const cls = typeof (e as HTMLElement).className === 'string' ? (e as HTMLElement).className.trim().split(/\s+/).filter((c) => c && !/^(on|active|pressed|open|selected)$/.test(c)).slice(0, 2) : [];
      parts.unshift(`${e.tagName.toLowerCase()}${e.id && !/\d{3,}|:r/.test(e.id) ? `#${e.id}` : ''}${cls.map((c) => `.${c}`).join('')}${tid ? `[data-testid="${tid}"]` : ''}`);
      if (tid || (e.id && !/\d{3,}|:r/.test(e.id))) break;
    }
    return parts.join(' > ');
  };
  const add = (rule: string, impact: Impact, el: Element, detail: string) => violations.push({ rule, impact, target: target(el), detail: detail.slice(0, 160) });
  const visible = (el: Element): boolean => {
    const h = el as HTMLElement;
    if (!h.getClientRects || !h.getClientRects().length) return false;
    const r = h.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false;
    for (let e: Element | null = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
      if (cs.clipPath && cs.clipPath !== 'none' && /inset\(50%|circle\(0/.test(cs.clipPath)) return false;
      if (cs.clip && /rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(cs.clip)) return false;
    }
    return true;
  };
  /** In the accessibility tree and reachable even when it has no size (an empty link is still announced and focusable). */
  const rendered = (el: Element): boolean => {
    for (let e: Element | null = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return false; }
    return true;
  };
  const hiddenFromAT = (el: Element): boolean => !!el.closest('[aria-hidden="true"], [hidden], [inert]');
  const textOf = (el: Element | null): string => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const byIds = (ids: string | null): string => (ids || '').split(/\s+/).filter(Boolean).map((id) => textOf(document.getElementById(id))).join(' ').trim();
  /** The accessible name, enough of the accname algorithm for these rules. */
  const nameOf = (el: Element): string => {
    const lb = byIds(el.getAttribute('aria-labelledby')); if (lb) return lb;
    const al = (el.getAttribute('aria-label') || '').trim(); if (al) return al;
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
      if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (textOf(l)) return textOf(l); }
      const wrap = el.closest('label'); if (textOf(wrap)) return textOf(wrap);
      if (el instanceof HTMLInputElement && /^(submit|button|reset)$/.test(el.type) && el.value) return el.value;
    }
    const sub = Array.from(el.querySelectorAll('img[alt], svg[aria-label], [aria-label]')).map((x) => x.getAttribute('alt') || x.getAttribute('aria-label') || '').join(' ').trim();
    const own = textOf(el) || sub; if (own) return own;
    const title = (el.getAttribute('title') || '').trim(); if (title) return title;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return (el.getAttribute('placeholder') || '').trim();
    return '';
  };

  // ------------------------------------------------------------ document
  count('html-has-lang'); if (!(document.documentElement.getAttribute('lang') || '').trim()) add('html-has-lang', 'serious', document.documentElement, '<html> has no lang');
  count('document-title'); if (!document.title.trim()) add('document-title', 'serious', document.documentElement, 'empty <title>');

  // ------------------------------------------------------------ names
  const BUTTONS = 'button, [role="button"], [role="tab"], [role="menuitem"], [role="radio"], [role="checkbox"], [role="switch"], [role="option"], summary';
  for (const el of Array.from(document.querySelectorAll(BUTTONS))) {
    if (!rendered(el) || hiddenFromAT(el)) continue;
    count('button-name');
    if (!nameOf(el)) add('button-name', 'critical', el, `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''} has no accessible name`);
  }
  // WP-35 (UID-003): a button that shows only an icon or a glyph (no letter or digit in its text) needs a name AND a tooltip: the name for
  // assistive technology, the `title` for sighted users (hover; FocusTooltip on keyboard focus). The rail's items carry their own `data-tip`.
  for (const el of Array.from(document.querySelectorAll('button, [role="button"]'))) {
    if (!visible(el) || hiddenFromAT(el)) continue;
    if (/[\p{L}\p{N}]/u.test(textOf(el))) continue;
    count('icon-button-tooltip');
    const named = !!(byIds(el.getAttribute('aria-labelledby')) || (el.getAttribute('aria-label') || '').trim());
    const tip = !!((el.getAttribute('title') || '').trim() || (el.getAttribute('data-tip') || '').trim());
    if (!named || !tip) add('icon-button-tooltip', 'serious', el, `icon-only button: ${!named ? 'no aria-label' : ''}${!named && !tip ? ', ' : ''}${!tip ? 'no tooltip (title)' : ''}`);
  }
  for (const el of Array.from(document.querySelectorAll('a[href]'))) {
    if (!rendered(el) || hiddenFromAT(el)) continue;
    count('link-name'); if (!nameOf(el)) add('link-name', 'serious', el, 'link has no accessible name');
  }
  for (const el of Array.from(document.querySelectorAll('input, select, textarea, [role="textbox"], [role="combobox"], [role="listbox"], [role="slider"], [role="spinbutton"]'))) {
    if (el instanceof HTMLInputElement && /^(hidden|submit|button|reset|image)$/.test(el.type)) continue;
    if (!visible(el) || hiddenFromAT(el)) continue;
    if ((el as HTMLElement).isContentEditable && !el.getAttribute('role')) continue;
    const rule = el instanceof HTMLSelectElement ? 'select-name' : 'label';
    count(rule); if (!nameOf(el)) add(rule, 'critical', el, `${el.tagName.toLowerCase()}${(el as HTMLInputElement).type ? `[type=${(el as HTMLInputElement).type}]` : ''} has no label`);
  }
  for (const el of Array.from(document.querySelectorAll('img'))) {
    if (!visible(el) || hiddenFromAT(el)) continue;
    count('image-alt'); if (!el.hasAttribute('alt') && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && el.getAttribute('role') !== 'presentation') add('image-alt', 'critical', el, `img ${el.getAttribute('src')?.slice(0, 60) ?? ''} has no alt`);
  }
  for (const el of Array.from(document.querySelectorAll('iframe, frame'))) {
    if (!visible(el)) continue;
    count('frame-title'); if (!(el.getAttribute('title') || el.getAttribute('aria-label') || '').trim()) add('frame-title', 'serious', el, 'frame has no title');
  }

  // ------------------------------------------------------------ ARIA
  const ROLES = new Set(('alert alertdialog application article banner blockquote button caption cell checkbox code columnheader combobox complementary contentinfo definition deletion dialog directory document emphasis feed figure form generic grid gridcell group heading img insertion link list listbox listitem log main marquee math menu menubar menuitem menuitemcheckbox menuitemradio meter navigation none note option paragraph presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status strong subscript superscript switch tab table tablist tabpanel term textbox time timer toolbar tooltip tree treegrid treeitem').split(' '));
  for (const el of Array.from(document.querySelectorAll('[role]'))) {
    count('aria-roles');
    const roles = (el.getAttribute('role') || '').trim().split(/\s+/).filter(Boolean);
    if (roles.length && !roles.some((r) => ROLES.has(r))) add('aria-roles', 'critical', el, `role="${el.getAttribute('role')}" is not an ARIA role`);
  }
  for (const attr of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-activedescendant']) {
    for (const el of Array.from(document.querySelectorAll(`[${attr}]`))) {
      if (attr === 'aria-controls' && el.getAttribute('aria-expanded') === 'false') continue;   // a collapsed control may point at what is not rendered (ARIA 1.2)
      count('aria-valid-attr-value');
      const missing = (el.getAttribute(attr) || '').split(/\s+/).filter((id) => id && !document.getElementById(id));
      if (missing.length) add('aria-valid-attr-value', 'critical', el, `${attr} points at missing id ${missing.join(', ')}`);
    }
  }
  const ids = new Map<string, number>();
  for (const el of Array.from(document.querySelectorAll('[id]'))) ids.set(el.id, (ids.get(el.id) || 0) + 1);
  const referenced = new Set<string>();
  for (const el of Array.from(document.querySelectorAll('[aria-labelledby], [aria-describedby], [aria-controls], label[for]'))) {
    for (const a of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'for']) for (const id of (el.getAttribute(a) || '').split(/\s+/)) if (id) referenced.add(id);
  }
  for (const id of referenced) { count('duplicate-id-aria'); if ((ids.get(id) || 0) > 1) add('duplicate-id-aria', 'critical', document.getElementById(id)!, `id "${id}" is used ${ids.get(id)} times and is referenced`); }
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  for (const el of Array.from(document.querySelectorAll(`[aria-hidden="true"] :is(${FOCUSABLE})`))) {
    if (!visible(el) || el.closest('[inert]')) continue;
    count('aria-hidden-focus'); add('aria-hidden-focus', 'serious', el, 'focusable element inside aria-hidden');
  }
  const INTERACTIVE = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"]';
  for (const el of Array.from(document.querySelectorAll(`:is(button, a[href], [role="button"], [role="link"]) :is(${INTERACTIVE})`))) {
    if (!visible(el)) continue;
    count('nested-interactive'); add('nested-interactive', 'serious', el.parentElement!.closest('button, a[href], [role="button"], [role="link"]') || el, 'interactive control inside another');
  }

  // ------------------------------------------------------------ target size (WCAG 2.2 2.5.8, AA; axe "target-size")
  const targets = Array.from(document.querySelectorAll(INTERACTIVE)).filter((el) => visible(el) && !hiddenFromAT(el) && !(el as HTMLButtonElement).disabled
    && !(el instanceof HTMLInputElement && el.type === 'hidden'));
  const rects = targets.map((el) => el.getBoundingClientRect());
  targets.forEach((el, i) => {
    const r = rects[i];
    count('target-size');
    if (r.width >= 23.95 && r.height >= 23.95) return;
    // inline exception: a link inside a sentence
    if (el.tagName === 'A' && getComputedStyle(el).display === 'inline' && textOf(el.parentElement).length > textOf(el).length + 10) return;
    // spacing exception: a 24 px circle on the target's centre does not meet another target (or another undersized target's circle)
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const clash = rects.some((o, j) => {
      if (j === i || targets[j].contains(el) || el.contains(targets[j])) return false;
      const small = o.width < 23.95 || o.height < 23.95;
      if (small) { const ox = o.left + o.width / 2, oy = o.top + o.height / 2; return Math.hypot(ox - cx, oy - cy) < 24; }
      const nx = Math.max(o.left, Math.min(cx, o.right)), ny = Math.max(o.top, Math.min(cy, o.bottom));
      return Math.hypot(nx - cx, ny - cy) < 12;
    });
    if (clash) add('target-size', 'serious', el, `${Math.round(r.width)}x${Math.round(r.height)} px target too close to another (needs 24x24 or 24 px spacing)`);
  });

  // ------------------------------------------------------------ colour contrast (WCAG 1.4.3; the sweep of 08 section 7.3)
  type RGBA = { r: number; g: number; b: number; a: number };
  const parse = (c: string): RGBA | null => {
    let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(c);
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4] };
    m = /^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(c);
    if (m) return { r: +m[1] * 255, g: +m[2] * 255, b: +m[3] * 255, a: m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4] };
    return null;
  };
  const over = (f: RGBA, b: RGBA): RGBA => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const lin = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (c: RGBA) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a: RGBA, b: RGBA) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const canvas: RGBA = getComputedStyle(document.documentElement).colorScheme.includes('dark') ? { r: 18, g: 18, b: 18, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
  /** The colour behind an element: its own and its ancestors' backgrounds composited; null when an image, gradient or unknown colour is in the way. */
  const background = (el: Element): RGBA | null | 'image' => {
    const layers: RGBA[] = [];
    for (let e: Element | null = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return 'image';
      const c = parse(cs.backgroundColor); if (!c) return null;
      if (c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let out = canvas;
    for (let i = layers.length - 1; i >= 0; i--) out = over(layers[i], out);
    return out;
  };
  const opacity = (el: Element): number => { let o = 1; for (let e: Element | null = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
  const PAPER = '.paper, .design-page, .jss-paper, .jsg-sheet, .pdfViewer, .page[data-page-number], canvas, .cm-editor .cm-content, [data-a11y-skip]';
  const seen = new Set<Element>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const el = walker.currentNode.parentElement;
    if (!el || seen.has(el) || !(walker.currentNode.textContent || '').trim()) continue;
    seen.add(el);
    if (!visible(el) || hiddenFromAT(el)) continue;
    if (el.closest('[disabled], [aria-disabled="true"], option, script, style, noscript')) continue;   // disabled controls are exempt (1.4.3)
    if (el.closest(PAPER)) continue;                                                                    // print paper: the paper* token pairs check it
    count('color-contrast');
    const cs = getComputedStyle(el);
    const bg = background(el);
    if (bg === 'image' || bg === null) { incomplete.push({ rule: 'color-contrast', target: target(el), why: bg === 'image' ? 'text over an image or gradient' : `background colour not parsed` }); continue; }
    const fgRaw = parse(cs.color); if (!fgRaw) { incomplete.push({ rule: 'color-contrast', target: target(el), why: `colour ${cs.color} not parsed` }); continue; }
    const fg = over({ ...fgRaw, a: fgRaw.a * opacity(el) }, bg);
    const size = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700 || cs.fontWeight === 'bold';
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    const r = ratio(fg, bg);
    if (r + 0.005 < need) add('color-contrast', 'serious', el, `${r.toFixed(2)}:1 (needs ${need}) "${textOf(el).slice(0, 40)}"`);
  }

  // ------------------------------------------------------------ keyboard operation (WP-23: WCAG 2.1.1, 4.1.2)
  // focusable-role (Agastya rule): an element that says it is a widget (button, link, checkbox, ...) must be reachable with Tab. Widgets that a
  // composite parent moves focus to (menu items, options, tree items, tabs, radios in a group) carry tabindex="-1" and pass.
  const NATIVE_FOCUS = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, [contenteditable="true"], [contenteditable=""]';
  for (const el of Array.from(document.querySelectorAll('[role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"], [role="treeitem"], [role="slider"], [role="spinbutton"]'))) {
    if (!visible(el) || hiddenFromAT(el) || el.matches(NATIVE_FOCUS) || el.hasAttribute('tabindex') || el.getAttribute('aria-disabled') === 'true') continue;
    const role = el.getAttribute('role') || '';
    if (/^(option|treeitem|menuitem|tab|radio)$/.test(role) && el.closest('[aria-activedescendant]')) continue;   // focus stays on the composite
    count('focusable-role'); add('focusable-role', 'serious', el, `role="${role}" cannot be reached with the keyboard (no tabindex)`);
  }
  // clickable-row (Agastya rule, FE-014): a table row or list item that reacts to the pointer (cursor: pointer) must hold a keyboard target.
  for (const el of Array.from(document.querySelectorAll('tr, [role="row"], li'))) {
    if (!visible(el) || hiddenFromAT(el) || getComputedStyle(el).cursor !== 'pointer') continue;
    if (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') continue;   // the pointer comes from a parent that is judged itself
    count('clickable-row');
    if (el.matches(`${FOCUSABLE}`) || el.querySelector(FOCUSABLE) || el.closest(FOCUSABLE)) continue;
    add('clickable-row', 'serious', el, `${el.tagName.toLowerCase()} is clickable but holds nothing the keyboard can reach`);
  }
  // aria-required-attr (axe, subset): a focusable separator is a resize control and must say where it is; sliders and scrollbars too.
  for (const el of Array.from(document.querySelectorAll('[role="separator"][tabindex]:not([tabindex="-1"]), [role="slider"], [role="scrollbar"]'))) {
    if (!rendered(el) || hiddenFromAT(el)) continue;
    count('aria-required-attr'); if (!el.hasAttribute('aria-valuenow')) add('aria-required-attr', 'critical', el, `role="${el.getAttribute('role')}" needs aria-valuenow`);
  }

  // ------------------------------------------------------------ structure (WP-23: WCAG 1.3.1, 2.4.1; axe impact "moderate", enforced by the spec)
  const mains = Array.from(document.querySelectorAll('main, [role="main"]')).filter((m) => rendered(m) && !hiddenFromAT(m));
  count('landmark-one-main'); if (!mains.length) add('landmark-one-main', 'moderate', document.body, 'no main landmark');
  count('landmark-no-duplicate-main'); if (mains.length > 1) add('landmark-no-duplicate-main', 'moderate', mains[1], `${mains.length} main landmarks`);
  count('page-has-heading-one'); if (!Array.from(document.querySelectorAll('h1, [role="heading"][aria-level="1"]')).some((h) => rendered(h) && !hiddenFromAT(h))) add('page-has-heading-one', 'moderate', document.body, 'no level-one heading');
  // skip-link (Agastya rule for axe "bypass", WCAG 2.4.1): a page with a navigation block starts, for the keyboard, with a link to its main content.
  const navs = Array.from(document.querySelectorAll('nav, [role="navigation"]')).filter((n) => visible(n) && !hiddenFromAT(n));
  if (navs.length) {
    count('skip-link');
    const first = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).find((el) => rendered(el) && !hiddenFromAT(el) && el.tabIndex >= 0);
    const href = first instanceof HTMLAnchorElement ? first.getAttribute('href') || '' : '';
    const dest = href.startsWith('#') && href.length > 1 ? document.getElementById(href.slice(1)) : null;
    if (!first || !dest || !(dest.matches('main, [role="main"]') || dest.closest('main, [role="main"]'))) {
      add('skip-link', 'serious', first || document.body, `the first Tab stop is ${first ? target(first) : 'nothing'}, not a link to the main landmark`);
    }
  }
  return { violations, incomplete, checked };
}
