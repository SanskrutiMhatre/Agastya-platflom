/** Modal dialogs, quick pickers and the command palette. */
import type { App } from './app';
import type { DocumentEditor } from './editor';
import { h, icon, clear, shortcutLabel } from './dom';
import { TEMPLATES, buildDataModule, defaultNewDmOptions, defaultBrexCode, NewDmOptions } from '../core/templates';
import { ISSUES, ISSUE_LABEL, SECURITY_LABELS, formatDmc, parseDmc, readDmCode, validateDmcParts, writeDmCode, find, todayParts, DEFAULT_BREX, schemaUrl, dmRefLabel } from '../core/s1000d';
import { friendlyName, elementDescription } from '../core/elementInfo';
import { renameCandidates } from '../core/ops';
import * as ops from '../core/ops';
import { buildLabels } from '../view/labels';
import { elementChildren, textOf, createEl, NS, readXmlFile } from '../core/xml';
import { parseColWidth } from '../core/units';
import { ImageStore, StoredBrex } from './storage';

export interface ButtonSpec {
  label: string;
  primary?: boolean;
  danger?: boolean;
  /** Return false to keep the dialog open. */
  action?: () => boolean | void | Promise<boolean | void>;
}

export interface ModalHandle {
  el: HTMLElement;
  close(): void;
}

let openModals = 0;
export function modalOpen(): boolean { return openModals > 0; }

export function modal(title: string, body: HTMLElement, buttons: ButtonSpec[], opts: { width?: string; onClose?: () => void; className?: string } = {}): ModalHandle {
  const prevFocus = document.activeElement as HTMLElement | null;
  const backdrop = h('div', { class: 'modal-backdrop' });
  const btnRow = h('div', { class: 'modal-buttons' });
  const dlg = h('div', { class: 'modal ' + (opts.className ?? ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: opts.width ? { width: opts.width } : undefined },
    h('div', { class: 'modal-head' }, h('h2', { class: 'modal-title' }, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', on: { click: () => close() } }, icon('close', 16))),
    h('div', { class: 'modal-body' }, body),
    buttons.length ? btnRow : null,
  );
  backdrop.appendChild(dlg);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openModals--;
    const act = document.activeElement as HTMLElement | null;
    const actionMovedFocus = !!act && act !== document.body && !dlg.contains(act);
    backdrop.remove();
    opts.onClose?.();
    if (openModals > 0 || actionMovedFocus) return;
    // return focus to where the user was; dialogs opened from the ribbon/menus go back to the editor
    if (prevFocus && prevFocus.isConnected && prevFocus.closest('.pane input, .pane select, .find-bar, .cm-editor, .modal')) prevFocus.focus();
    else window.dispatchEvent(new CustomEvent('studio:modal-closed'));
  };
  for (const b of buttons) {
    const btn = h('button', { class: 'btn' + (b.primary ? ' btn-primary' : '') + (b.danger ? ' btn-danger' : '') }, b.label);
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      // an action may take a moment (it stores an image, builds a document): a second click or Enter must not run it again
      btn.disabled = true;
      let r: boolean | void | undefined;
      try {
        r = b.action ? await b.action() : undefined;
      } finally {
        btn.disabled = false;
      }
      if (r !== false) close();
      else btn.focus();
    });
    btnRow.appendChild(btn);
  }
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement) && !(e.target as HTMLElement).closest('.picker')) {
      const primary = btnRow.querySelector<HTMLButtonElement>('.btn-primary');
      if (primary) {
        e.preventDefault();
        primary.click();
      }
    } else if (e.key === 'Tab') {
      const f = Array.from(dlg.querySelectorAll<HTMLElement>('button,input,select,textarea,[tabindex="0"]')).filter((x) => !x.hasAttribute('disabled') && x.offsetParent !== null);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && i === f.length - 1) {
        e.preventDefault();
        f[0].focus();
      }
    }
    e.stopPropagation();
  });
  document.body.appendChild(backdrop);
  openModals++;
  requestAnimationFrame(() => {
    const first = dlg.querySelector<HTMLElement>('[autofocus],input:not([type=checkbox]),select,textarea,.picker-list [tabindex]') ?? btnRow.querySelector<HTMLElement>('.btn-primary') ?? dlg.querySelector<HTMLElement>('.modal-body button') ?? btnRow.querySelector<HTMLElement>('button');
    if (first) first.focus();
    else {
      dlg.tabIndex = -1;
      dlg.focus();
    }
    if (first instanceof HTMLInputElement) first.select();
  });
  return { el: dlg, close };
}

// ------------------------------------------------------------------ form helpers
function field(label: string, control: HTMLElement, hint?: string, cls = ''): HTMLElement {
  const id = 'f-' + Math.random().toString(36).slice(2);
  control.id = id;
  return h('div', { class: 'field ' + cls }, h('label', { for: id }, label), control, hint ? h('div', { class: 'field-hint' }, hint) : null);
}

function input(value = '', attrs: Record<string, unknown> = {}): HTMLInputElement {
  return h('input', { class: 'input', value, spellcheck: 'false', ...attrs });
}

function select(options: [string, string][], value: string): HTMLSelectElement {
  const s = h('select', { class: 'input' });
  for (const [v, l] of options) s.appendChild(h('option', { value: v }, l));
  s.value = value;
  return s;
}

function checkbox(label: string, checked: boolean): { el: HTMLElement; input: HTMLInputElement } {
  const i = h('input', { type: 'checkbox' }) as HTMLInputElement;
  i.checked = checked;
  return { el: h('label', { class: 'check' }, i, ' ' + label), input: i };
}

// ------------------------------------------------------------------ picker
export interface PickItem {
  id: string;
  label: string;
  detail?: string;
  hint?: string;
  icon?: string;
  disabled?: boolean;
}

export function picker(title: string, items: PickItem[], onPick: (id: string) => void, opts: { placeholder?: string; emptyText?: string } = {}): ModalHandle {
  const q = h('input', { class: 'input picker-input', placeholder: opts.placeholder ?? 'Type to filter…', 'aria-label': 'Filter', spellcheck: 'false' });
  const list = h('div', { class: 'picker-list', role: 'listbox' });
  const body = h('div', { class: 'picker' }, q, list);
  let shown: PickItem[] = [];
  let idx = 0;
  const render = () => {
    const t = q.value.toLowerCase().trim();
    const words = t.split(/\s+/).filter(Boolean);
    shown = items.filter((i) => words.every((w) => (i.label + ' ' + (i.detail ?? '') + ' ' + i.id).toLowerCase().includes(w)));
    shown.sort((a, b) => {
      const as = a.label.toLowerCase().startsWith(t) || a.id.toLowerCase().startsWith(t) ? 0 : 1;
      const bs = b.label.toLowerCase().startsWith(t) || b.id.toLowerCase().startsWith(t) ? 0 : 1;
      return as - bs;
    });
    idx = Math.min(idx, Math.max(0, shown.length - 1));
    clear(list);
    if (!shown.length) list.appendChild(h('div', { class: 'panel-empty' }, opts.emptyText ?? 'No matches'));
    shown.forEach((it, i) => {
      const row = h('div', { class: 'picker-item' + (i === idx ? ' active' : '') + (it.disabled ? ' disabled' : ''), role: 'option', 'aria-selected': String(i === idx), tabindex: '-1' },
        it.icon ? icon(it.icon, 15) : null,
        h('span', { class: 'picker-label' }, it.label),
        it.detail ? h('span', { class: 'picker-detail' }, it.detail) : null,
        it.hint ? h('span', { class: 'picker-hint' }, it.hint) : null,
      );
      row.addEventListener('mousemove', () => {
        if (idx !== i) {
          idx = i;
          list.querySelectorAll('.picker-item').forEach((r, k) => r.classList.toggle('active', k === idx));
        }
      });
      row.addEventListener('click', () => choose(i));
      list.appendChild(row);
    });
  };
  const choose = (i: number) => {
    const it = shown[i];
    if (!it || it.disabled) return;
    m.close();
    onPick(it.id);
  };
  q.addEventListener('input', () => {
    idx = 0;
    render();
  });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      idx = Math.max(0, Math.min(shown.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)));
      list.querySelectorAll('.picker-item').forEach((r, k) => r.classList.toggle('active', k === idx));
      list.querySelector('.picker-item.active')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(idx);
    }
  });
  render();
  const m = modal(title, body, [], { width: '560px', className: 'picker-modal' });
  return m;
}

// ------------------------------------------------------------------ dialogs
export class Dialogs {
  constructor(private app: App) {}

  confirm(title: string, message: string, buttons: { id: string; label: string; primary?: boolean; danger?: boolean }[]): Promise<string | null> {
    return new Promise((resolve) => {
      let result: string | null = null;
      modal(title, h('p', { class: 'confirm-text' }, message), buttons.map((b) => ({ label: b.label, primary: b.primary, danger: b.danger, action: () => { result = b.id; } })), { width: '480px', onClose: () => resolve(result) });
    });
  }

  alert(title: string, message: string | HTMLElement) {
    modal(title, typeof message === 'string' ? h('p', { class: 'confirm-text' }, message) : message, [{ label: 'OK', primary: true }], { width: '520px' });
  }

  // ---------------------------------------------------------------- new DM
  async newDm() {
    const host = this.app.host;
    await host?.beforeNew?.();
    // What the Administrator maintains (languages, countries, DM types, enterprises ...), when the host has it: each becomes a dropdown.
    const ref = host?.reference?.() ?? null;
    // The project's own S1000D configuration (MIC, issue, language, enterprises, SNS, enabled codes/types, applicability), when the host has one.
    const pr = host?.projectRefs?.() ?? null;
    const o = defaultNewDmOptions('descript', pr?.issue ?? this.app.settings.defaultIssue);
    const s = this.app.settings;
    if (s.modelIdentCode) o.code.modelIdentCode = s.modelIdentCode;
    // Inside a project the code belongs to the PROJECT, not to whatever this browser last used; an empty project asks once.
    if (host?.modelIdent) o.code.modelIdentCode = host.modelIdent() ?? '';
    if (pr?.mic) o.code.modelIdentCode = pr.mic;
    if (s.enterpriseCode) o.enterpriseCode = s.enterpriseCode;
    if (s.enterpriseName) o.enterpriseName = s.enterpriseName;
    if (host) { o.language = 'en'; o.country = 'IN'; }                       // inside the platform: English / India unless the author picks otherwise
    else { o.language = s.language || o.language; o.country = s.country || o.country; }
    if (pr) {
      if (pr.language) o.language = pr.language;
      if (pr.country) o.country = pr.country;
      if (pr.responsiblePartner.code) { o.enterpriseCode = pr.responsiblePartner.code; o.enterpriseName = pr.responsiblePartner.name; }
      if (pr.security) o.security = pr.security;
      if (pr.brex.mode === 'project' && pr.brex.dmc) { const b = parseDmc(pr.brex.dmc); if (b) o.brex = b; }
    }

    type Ctl = HTMLInputElement | HTMLSelectElement;
    type Pair = [string, string];
    const pairs = <T,>(rows: T[] | undefined, value: (r: T) => string, label: (r: T) => string): Pair[] | undefined =>
      rows?.length ? rows.map((r) => [value(r), label(r)] as Pair) : undefined;
    /** A dropdown of `items` when the Administrator has any (the value falls back to the first entry when it is not one of them), a text box otherwise. */
    const choose = (items: Pair[] | undefined, value: string, attrs: Record<string, unknown> = {}): Ctl =>
      items ? select(items, items.some(([v]) => v === value) ? value : items[0][0]) : input(value, attrs);
    /** Set a control's value; a dropdown that lacks that entry gets it (a type's own info code must always be selectable). */
    const setValue = (c: Ctl, value: string, label = value) => {
      if (c instanceof HTMLSelectElement && ![...c.options].some((op) => op.value === value)) c.appendChild(h('option', { value }, label));
      c.value = value;
    };

    const offered = (schema: string) => !pr || pr.dmTypes.find((d) => d.schema === schema)?.enabled !== false;
    const typeRows = (ref?.dmTypes?.length ? TEMPLATES.filter((t) => ref.dmTypes.some((d) => d.schema === t.schema)) : TEMPLATES).filter((t) => offered(t.schema));
    const types = typeRows.length ? typeRows : TEMPLATES;
    const typeName = (t: (typeof TEMPLATES)[number]) => ref?.dmTypes?.find((d) => d.schema === t.schema)?.name || t.label;
    const typeSel = select(types.map((t): Pair => [t.schema, typeName(t)]), types.some((t) => t.schema === 'descript') ? 'descript' : types[0].schema);
    let schema = typeSel.value;
    const typeHint = h('div', { class: 'field-hint' });
    const preview = h('div', { class: 'dmc-preview' });
    const errors = h('div', { class: 'form-errors', role: 'alert' });

    // Information codes come from the project's catalogue (grouped below); the system code from the project's SNS when it has one.
    const snsOn = !!pr && pr.sns.length > 0;
    const sysNodes = pr?.sns.filter((n) => n.level === 1) ?? [];
    const snsItems = snsOn ? sysNodes.map((n): Pair => [n.code, `${n.code} – ${n.title || '(no title)'}`]) : undefined;
    const infoItems = undefined as Pair[] | undefined;
    const rpcItems = pairs(ref?.rpc, (r) => r.cage, (r) => `${r.cage} – ${r.name}`);
    const orgItems = pairs(ref?.originators, (r) => r.cage, (r) => `${r.cage} – ${r.name}`);
    const nameOf = (rows: Array<{ cage: string; name: string }> | undefined, code: string) => rows?.find((r) => r.cage === code)?.name ?? '';
    const secItems: Pair[] = pairs(ref?.security, (r) => r.code, (r) => `${r.code} – ${r.name}`) ?? Object.entries(SECURITY_LABELS).map(([k, v]): Pair => [k, `${k} – ${v}`]);

    const f: Record<string, Ctl> = {
      issue: select(ISSUES.filter((i) => i !== '4-1').map((i) => [i, 'S1000D Issue ' + ISSUE_LABEL[i]]), o.issue),
      mic: input(o.code.modelIdentCode, { maxlength: 14, ...(pr?.mic ? { readonly: 'true', title: "Set by the project's configuration" } : {}) }), sdc: input(o.code.systemDiffCode, { maxlength: 4 }), sys: choose(snsItems, o.code.systemCode, { maxlength: 3 }),
      sub: input(o.code.subSystemCode, { maxlength: 1 }), subsub: input(o.code.subSubSystemCode, { maxlength: 1 }), assy: input(o.code.assyCode, { maxlength: 4 }),
      dis: input(o.code.disassyCode, { maxlength: 2 }), disv: input(o.code.disassyCodeVariant, { maxlength: 3 }), info: choose(infoItems, o.code.infoCode, { maxlength: 3 }),
      infov: input(o.code.infoCodeVariant, { maxlength: 1 }),
      ilc: pr?.codes.itemLocationCode.length ? select(pr.codes.itemLocationCode.map((c): Pair => [c.code, `${c.code} – ${c.title.slice(0, 60)}`]), pr.codes.itemLocationCode.some((c) => c.code === o.code.itemLocationCode) ? o.code.itemLocationCode : pr.codes.itemLocationCode[0].code)
        : select([['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['T', 'T']], o.code.itemLocationCode),
      lang: choose(pairs(ref?.languages, (r) => r.code, (r) => `${r.code} – ${r.name}`), o.language, { maxlength: 3 }),
      country: choose(pairs(ref?.countries, (r) => r.code, (r) => `${r.code} – ${r.name}`), o.country, { maxlength: 2 }),
      issueNo: input(o.issueNumber, { maxlength: 3 }), inWork: input(o.inWork, { maxlength: 2 }),
      tech: input(o.techName), infoName: input(o.infoName),
      sec: select(secItems, secItems.some(([k]) => k === o.security) ? o.security : secItems[0][0]),
      entCode: choose(rpcItems, o.enterpriseCode, { maxlength: 5 }), entName: input(o.enterpriseName),
      applic: input(o.applicability || 'All'),
    };
    // With registered enterprises the name follows the code; the originator is its own pick (defaulting to the same enterprise).
    // The project's own enterprise wins over the Administrator's list, even when it is not registered there (the dropdown gains that entry).
    const projEnt = (c: string) => (pr?.responsiblePartner.code === c ? pr.responsiblePartner.name : '');
    if (pr?.responsiblePartner.code && rpcItems) setValue(f.entCode, pr.responsiblePartner.code, `${pr.responsiblePartner.code} – ${pr.responsiblePartner.name}`);
    if (rpcItems) { f.entName.value = nameOf(ref!.rpc, f.entCode.value) || projEnt(f.entCode.value); f.entName.setAttribute('readonly', 'true'); f.entCode.addEventListener('change', () => { f.entName.value = nameOf(ref!.rpc, f.entCode.value) || projEnt(f.entCode.value); }); }
    if (orgItems) {
      f.orgCode = select(orgItems, orgItems.some(([v]) => v === f.entCode.value) ? f.entCode.value : orgItems[0][0]);
      if (pr?.originator.code) setValue(f.orgCode, pr.originator.code, `${pr.originator.code} – ${pr.originator.name}`);
      else if (pr?.responsiblePartner.code) setValue(f.orgCode, pr.responsiblePartner.code, `${pr.responsiblePartner.code} – ${pr.responsiblePartner.name}`);
      const projOrg = (c: string) => (pr?.originator.code === c ? pr.originator.name : projEnt(c));
      f.orgName = input(nameOf(ref!.originators, f.orgCode.value) || projOrg(f.orgCode.value), { readonly: 'true' });
      f.orgCode.addEventListener('change', () => { f.orgName.value = nameOf(ref!.originators, f.orgCode.value) || projOrg(f.orgCode.value); });
    }

    // ───── the project's configuration drives these controls (the server enforces the same rules when the module is saved)
    const infoNote = h('div', { class: 'field-hint' });
    let infoSel: HTMLSelectElement | null = null;
    if (pr && pr.codes.infoCode.length) { infoSel = h('select', { class: 'input' }) as HTMLSelectElement; f.info = infoSel; }
    const infoTitle = new Map((pr?.codes.infoCode ?? []).map((c) => [c.code, c.title]));
    const fillInfo = (t: (typeof TEMPLATES)[number]) => {
      const sel = infoSel!;
      const adv = pr!.dmTypes.find((d) => d.schema === t.schema);
      // the type's own default is always shown (flagged when the project has not enabled it); other suggestions only when enabled
      const suggested = [...new Set([t.infoCode, ...[adv?.defaultCode ?? '', ...(adv?.recommended ?? [])].filter((c) => infoTitle.has(c))].filter(Boolean))];
      clear(sel);
      const label = (c: string) => `${c} – ${infoTitle.get(c)?.slice(0, 70) ?? (c === t.infoCode ? t.infoName + ' (not enabled for this project)' : 'not enabled for this project')}`;
      sel.appendChild(h('optgroup', { label: 'Suggested for this type' }, ...suggested.map((c) => h('option', { value: c }, label(c)))));
      const others = [...infoTitle.keys()].filter((c) => !suggested.includes(c));
      if (others.length) sel.appendChild(h('optgroup', { label: 'Every code enabled for this project' }, ...others.map((c) => h('option', { value: c }, label(c)))));
      sel.value = t.infoCode;
    };
    const showInfoNote = () => {
      const t = TEMPLATES.find((x) => x.schema === schema);
      const adv = pr?.dmTypes.find((d) => d.schema === schema);
      infoNote.textContent = '';
      if (!infoSel || !t) return;
      if (adv?.unresolved && infoSel.value === t.infoCode) infoNote.textContent = `Unconfirmed default: ${adv.unresolved} Change it if you know the right code.`;
      else infoNote.textContent = infoTitle.get(infoSel.value) ?? '';
    };
    // SNS: system -> subsystem (sub + sub-sub) -> assembly suggestions
    let snsSub: HTMLSelectElement | null = null;
    const assyList = h('datalist', { id: 'dl-assy-' + Math.random().toString(36).slice(2) }) as HTMLDataListElement;
    if (snsOn) {
      snsSub = h('select', { class: 'input' }) as HTMLSelectElement;
      f.assy.setAttribute('list', assyList.id);
      const fillAssy = () => {
        clear(assyList);
        const base = `${f.sys.value}/${f.sub.value}${f.subsub.value}/`;
        for (const n of pr!.sns.filter((x) => x.level === 3 && x.path.startsWith(base))) assyList.appendChild(h('option', { value: n.code }, n.title));
      };
      const fillSub = () => {
        clear(snsSub!);
        const kids = pr!.sns.filter((n) => n.level === 2 && n.path.startsWith(f.sys.value + '/'));
        for (const n of kids) snsSub!.appendChild(h('option', { value: n.code }, `${n.code} – ${n.title || '(no title)'}`));
        if (!kids.length) snsSub!.appendChild(h('option', { value: '' }, '(no subsystem in the SNS)'));
        const code = snsSub!.value || '00';
        f.sub.value = code[0]; f.subsub.value = code[1] ?? '0';
        fillAssy();
      };
      f.sys.addEventListener('change', () => { fillSub(); update(); });
      snsSub.addEventListener('change', () => { const c = snsSub!.value || '00'; f.sub.value = c[0]; f.subsub.value = c[1] ?? '0'; fillAssy(); update(); });
      f.sub.setAttribute('readonly', 'true'); f.subsub.setAttribute('readonly', 'true');
      fillSub();
    }
    // Learn codes (learning data modules): chosen from the project's catalogue, or typed when the host has none
    const learnOf = (list: Array<{ code: string; title: string }> | undefined, none: string): HTMLElement =>
      list?.length ? select([['', none], ...list.map((c): Pair => [c.code, `${c.code} – ${c.title.slice(0, 50)}`])], '') : input('', { maxlength: 3 });
    f.learn = learnOf(pr?.codes.learnCode, '(none)') as Ctl; f.learnEvent = learnOf(pr?.codes.learnEventCode, '(none)') as Ctl;
    const learnRow = h('div', { class: 'form-grid' }, field('Learn code', f.learn, 'Only for learning data modules.'), field('Learn event code', f.learnEvent));
    const applicField = field('Applicability', f.applic);
    const assyBase = o.code.assyCode;
    let assyEdited = false;
    f.assy.addEventListener('input', () => { assyEdited = true; });
    const read = (): NewDmOptions => ({
      ...o,
      issue: f.issue.value,
      schema,
      code: {
        modelIdentCode: f.mic.value.toUpperCase(), systemDiffCode: f.sdc.value.toUpperCase(), systemCode: f.sys.value.toUpperCase(), subSystemCode: f.sub.value.toUpperCase(),
        subSubSystemCode: f.subsub.value.toUpperCase(), assyCode: f.assy.value.toUpperCase(), disassyCode: f.dis.value.toUpperCase(), disassyCodeVariant: f.disv.value.toUpperCase(),
        infoCode: f.info.value.toUpperCase(), infoCodeVariant: f.infov.value.toUpperCase(), itemLocationCode: f.ilc.value,
        ...(schema === 'learning' && f.learn.value.trim() ? { learnCode: f.learn.value.toUpperCase(), ...(f.learnEvent.value.trim() ? { learnEventCode: f.learnEvent.value.toUpperCase() } : {}) } : {}),
      },
      language: f.lang.value.toLowerCase(), country: f.country.value.toUpperCase(), issueNumber: f.issueNo.value, inWork: f.inWork.value,
      techName: f.tech.value, infoName: f.infoName.value, security: f.sec.value, enterpriseCode: f.entCode.value.toUpperCase(), enterpriseName: f.entName.value, applicability: f.applic.value,
      ...(f.orgCode ? { originatorCode: f.orgCode.value.toUpperCase(), originatorName: f.orgName.value } : {}),
    });
    // One data module per code + issue + language within a project: the same identity the server enforces.
    const keyOf = (v: NewDmOptions) => `${formatDmc(v.code, false)}|${v.issueNumber}-${v.inWork}|${v.language}-${v.country}`.toUpperCase();
    /** If the code in the form is taken, move to the next free assembly code (00 -> 01 -> 02 ...); non-numeric codes are left for the author. */
    const suggestFree = () => {
      if (!host?.identityTaken) return;
      const v = read();
      if (!host.identityTaken(keyOf(v))) return;
      const m = /^\d+$/.exec(v.code.assyCode);
      if (!m) return;
      const width = Math.max(2, v.code.assyCode.length);
      for (let n = Number(v.code.assyCode) + 1; n < 10 ** Math.min(width, 4); n++) {
        f.assy.value = String(n).padStart(width, '0');
        if (!host.identityTaken(keyOf(read()))) return;
      }
      f.assy.value = v.code.assyCode;
    };
    const errs = (v: NewDmOptions) => {
      const e = validateDmcParts(v.code);
      const clash = host?.identityTaken?.(keyOf(v));
      if (clash) e.push(`Already in this project: ${clash}. A data module exists once per project - change the code, issue or language.`);
      if (!/^[a-z]{2,3}$/.test(v.language)) e.push('Language: ISO 639 code (e.g. en)');
      if (!/^[A-Z]{2}$/.test(v.country)) e.push('Country: ISO 3166 code (e.g. US)');
      if (!/^\d{3}$/.test(v.issueNumber)) e.push('Issue number: 3 digits');
      if (!/^\d{2}$/.test(v.inWork)) e.push('In-work: 2 digits');
      if (!v.techName.trim()) e.push('Technical name is required');
      if (!/^[A-Z0-9]{5}$/.test(v.enterpriseCode)) e.push('Enterprise code: 5 characters (CAGE / NCAGE)');
      if (!v.enterpriseName.trim()) e.push('Enterprise name is required');
      if (pr && pr.codes.infoCode.length && !infoTitle.has(v.code.infoCode)) e.push(`Information code ${v.code.infoCode} is not enabled for this project (Project configuration → Information codes).`);
      if (snsOn && pr!.snsEnforced && v.schema !== 'brex' && !/applic|condcross|prdcross/i.test(v.schema)) {
        const sub = `${v.code.subSystemCode}${v.code.subSubSystemCode}`;
        if (!pr!.sns.some((n) => n.path === v.code.systemCode)) e.push(`System ${v.code.systemCode} is not in this project's SNS`);
        else if (!pr!.sns.some((n) => n.path === `${v.code.systemCode}/${sub}`)) e.push(`Subsystem ${v.code.systemCode}-${sub} is not in this project's SNS`);
      }
      return e;
    };
    const update = () => {
      const v = read();
      preview.textContent = `${formatDmc(v.code)}_${v.issueNumber}-${v.inWork}_${v.language.toUpperCase()}-${v.country}.XML`;
      const e = errs(v);
      clear(errors);
      if (e.length) errors.appendChild(h('ul', null, ...e.map((x) => h('li', null, x))));
    };
    // Choosing a type fills in its own information code and name.
    const applyType = () => {
      const t = TEMPLATES.find((x) => x.schema === typeSel.value) ?? TEMPLATES[0];
      schema = t.schema;
      if (infoSel) fillInfo(t); else setValue(f.info, t.infoCode, `${t.infoCode} – ${t.infoName}`);
      f.infoName.value = t.infoName;
      learnRow.style.display = t.schema === 'learning' ? '' : 'none';
      showInfoNote();
      typeHint.textContent = `${t.description} · ${t.schema}.xsd · info code ${t.infoCode}`;
      // A free-code suggestion made for the PREVIOUS type must not carry over: start from the code the wizard opened with (or the
      // author typed), then move on only if THIS type's identity is taken. (A BREX data module, for one, must keep assembly 00.)
      if (!assyEdited) f.assy.value = assyBase;
      suggestFree();
      update();
    };
    typeSel.addEventListener('change', applyType);
    Object.values(f).forEach((c) => c.addEventListener('input', update));
    const dmcRow = h('div', { class: 'dmc-row' },
      field('Model ident', f.mic, undefined, 'w-mic'), field('Sys diff', f.sdc, undefined, 'w-s'), field('System', f.sys, undefined, 'w-s'),
      ...(snsSub ? [field('Subsystem', snsSub, undefined, 'w-m')] : [field('Sub', f.sub, undefined, 'w-xs'), field('Sub-sub', f.subsub, undefined, 'w-xs')]),
      field('Assy', f.assy, undefined, 'w-s'), field('Disassy', f.dis, undefined, 'w-xs'), field('Var', f.disv, undefined, 'w-xs'),
      field('Info code', f.info, undefined, snsSub ? 'w-m' : 'w-s'), field('Var', f.infov, undefined, 'w-xs'), field('Location', f.ilc, undefined, 'w-s'),
    );
    if (pr?.issue) { f.issue.setAttribute('disabled', 'true'); f.issue.title = "The project's S1000D issue"; }
    const body = h('div', { class: 'newdm' },
      h('div', { class: 'form-section' }, 'Data module type'),
      h('div', { class: 'form-grid' }, field('Type', typeSel), field('S1000D issue', f.issue)),
      typeHint,
      h('div', { class: 'form-section' }, 'Data module code'), dmcRow, snsOn ? assyList : null, infoNote, learnRow, preview,
      h('div', { class: 'form-section' }, 'Identification'),
      h('div', { class: 'form-grid' }, field('Technical name', f.tech), field('Information name', f.infoName), field('Language', f.lang), field('Country', f.country), field('Issue number', f.issueNo), field('In work', f.inWork), field('Security classification', f.sec), applicField),
      h('div', { class: 'form-section' }, 'Responsible partner company / originator'),
      h('div', { class: 'form-grid' },
        field(rpcItems ? 'Responsible partner company' : 'Enterprise code', f.entCode), field(rpcItems ? 'Enterprise name' : 'Enterprise name', f.entName),
        ...(f.orgCode ? [field('Originator', f.orgCode), field('Originator name', f.orgName)] : [])),
      errors,
    );
    applyType();
    modal('New data module', body, [
      { label: 'Cancel' },
      {
        label: 'Create', primary: true, action: async () => {
          const v = read();
          if (errs(v).length) {
            update();
            errors.scrollIntoView({ block: 'nearest' });
            return false;
          }
          Object.assign(this.app.settings, { defaultIssue: v.issue, modelIdentCode: v.code.modelIdentCode, enterpriseCode: v.enterpriseCode, enterpriseName: v.enterpriseName, language: v.language, country: v.country });
          this.app.saveSettings();
          const xml = buildDataModule(v);
          const name = preview.textContent!;
          await this.app.openText(xml, name, null, { isNew: true });
        },
      },
    ], { width: '880px' });
  }

  // ---------------------------------------------------------------- samples & recent
  samples() {
    const items: PickItem[] = this.app.samples.map((s) => ({ id: s.file, label: s.title, detail: s.description, icon: 'sample' }));
    picker('Open sample data module', items, (id) => void this.app.openSample(id));
  }

  recent() {
    const items: PickItem[] = this.app.recent.map((r, i) => ({ id: String(i), label: r.title || r.name, detail: r.dmc || r.name, hint: new Date(r.openedAt).toLocaleString(), icon: 'file' }));
    picker('Recent files', items, async (id) => {
      const r = this.app.recent[+id];
      if (await this.app.openRecent(r)) return;
      this.app.toast(`"${r.name}" cannot be reopened automatically — select it in the Open dialog.`, 'info');
      void this.app.openFiles();
    }, { emptyText: 'No recent files' });
  }

  // ---------------------------------------------------------------- element picker
  elementPicker(mode: 'insert' | 'wrap' | 'change') {
    const ed = this.app.active;
    if (!ed) return;
    if (!ed.grammar) return this.app.toast('No schema grammar available for this document', 'warning');
    let names: string[] = [];
    let title = '';
    if (mode === 'insert') {
      const { inline, block } = ed.insertableElements();
      names = [...inline, ...block];
      title = 'Insert element';
      const items: PickItem[] = [
        ...inline.map((n) => ({ id: n, label: n, detail: friendlyName(n) + (elementDescription(n) ? ' — ' + elementDescription(n) : ''), hint: 'at cursor', icon: 'element' })),
        ...block.map((n) => ({ id: n, label: n, detail: friendlyName(n) + (elementDescription(n) ? ' — ' + elementDescription(n) : ''), hint: 'nearby', icon: 'insert' })),
      ];
      picker(title, items, (id) => { ed.insertElementNamed(id); ed.focus(); }, { emptyText: 'No elements can be inserted here' });
      return;
    }
    if (mode === 'wrap') {
      const sel = ed.doc.selection;
      const container = sel ? ops.containerElement(sel.anchor) : ed.currentElement();
      const g = ed.grammar;
      if (ed.elementSelection) {
        const p = ed.elementSelection.parentNode as Element;
        names = g.childCandidates(p.nodeName).filter((n) => g.has(n) && g.isRepairable(n, [ed.elementSelection!.nodeName]));
      } else if (sel && !ops.isCollapsed(sel) && container && ops.allowsText(container, g)) {
        names = g.childCandidates(container.nodeName).filter((n) => g.allowsText(n));
      } else {
        const block = sel ? ops.textBlockOf(sel.anchor.node, g) : null;
        const p = block?.parentNode as Element | undefined;
        if (block && p) names = g.childCandidates(p.nodeName).filter((n) => g.has(n) && g.isRepairable(n, [block.nodeName]));
      }
      title = 'Wrap in element';
      picker(title, names.sort().map((n) => ({ id: n, label: n, detail: friendlyName(n), icon: 'wrap' })), (id) => { ed.wrapIn(id); ed.focus(); }, { emptyText: 'Nothing can wrap the current selection' });
      return;
    }
    const target = ed.elementSelection ?? ed.currentElement();
    if (!target) return;
    names = renameCandidates(target, ed.grammar);
    picker(`Change <${target.nodeName}> to`, names.map((n) => ({ id: n, label: n, detail: friendlyName(n), icon: 'change' })), (id) => { ed.changeTo(id); ed.focus(); }, { emptyText: 'No compatible elements' });
  }

  palette() {
    const ed = this.app.active;
    // the page's own commands (its panel toggles and layout), each in place of the Studio command it replaces
    const extra = this.app.host?.commands?.() ?? [];
    const replaced = new Set(extra.map((c) => c.replaces).filter(Boolean));
    const items: PickItem[] = this.app.commands.filter((c) => (c.global || ed) && !replaced.has(c.id)).map((c) => ({
      id: c.id, label: c.label, detail: c.group, hint: c.keys?.[0] ? shortcutLabel(c.keys[0]) : c.description ?? '', icon: c.icon,
      disabled: !!(ed && c.enabled && !c.enabled(this.app, ed)),
    }));
    items.push(...extra.map((c) => ({ id: `host:${c.id}`, label: c.label, detail: c.group, hint: c.keys?.[0] ? shortcutLabel(c.keys[0]) : '', icon: 'props' })));
    picker('Command palette', items, (id) => { const x = id.startsWith('host:') ? extra.find((c) => `host:${c.id}` === id) : null; if (x) x.run(); else this.app.run(id); }, { placeholder: 'Type a command…' });
  }

  gotoTarget() {
    const ed = this.app.active;
    if (!ed) return;
    const labels = buildLabels(ed.doc.xml);
    const items: PickItem[] = [];
    for (const el of Array.from(ed.doc.xml.querySelectorAll('[id]'))) {
      const id = el.getAttribute('id')!;
      items.push({ id, label: labels.label(el) || el.nodeName, detail: `#${id} <${el.nodeName}>`, icon: 'id' });
    }
    picker('Go to target', items, (id) => {
      const el = ops.findById(ed.doc.xml, id);
      if (el) ed.selectElement(el, { scroll: true });
    }, { emptyText: 'No elements with IDs. Use Tools › Generate missing IDs.' });
  }

  // ---------------------------------------------------------------- tables
  table(ed: DocumentEditor) {
    const rows = input('3', { type: 'number', min: 1, max: 200 });
    const cols = input('3', { type: 'number', min: 1, max: 50 });
    const title = input('');
    const header = checkbox('Header row', true);
    const frame = select([['all', 'All borders'], ['topbot', 'Top and bottom'], ['top', 'Top'], ['bottom', 'Bottom'], ['sides', 'Sides'], ['none', 'None']], 'all');
    const gridPick = h('div', { class: 'grid-pick', 'aria-hidden': 'true' });
    for (let r = 0; r < 8; r++) for (let c = 0; c < 10; c++) {
      const cell = h('div', { class: 'gp-cell', 'data-r': String(r + 1), 'data-c': String(c + 1) });
      cell.addEventListener('mouseenter', () => {
        rows.value = String(r + 1);
        cols.value = String(c + 1);
        paint();
      });
      gridPick.appendChild(cell);
    }
    const paint = () => gridPick.querySelectorAll<HTMLElement>('.gp-cell').forEach((c) => c.classList.toggle('on', +c.dataset.r! <= +rows.value && +c.dataset.c! <= +cols.value));
    rows.addEventListener('input', paint);
    cols.addEventListener('input', paint);
    paint();
    const err = h('div', { class: 'form-errors', role: 'alert' });
    const body = h('div', { class: 'form-grid two' }, h('div', null, field('Rows (body)', rows), field('Columns', cols), field('Title', title, 'Tables with a title are numbered and can be cross-referenced'), field('Frame', frame), header.el, err), gridPick);
    const whole = (v: string, min: number, max: number) => (/^\s*\d+\s*$/.test(v) && +v >= min && +v <= max ? +v : null);
    modal('Insert table', body, [
      { label: 'Cancel' },
      {
        label: 'Insert', primary: true, action: () => {
          // a fractional or huge count would give an invalid <tgroup cols> or freeze the page
          const r = whole(rows.value, 1, 200);
          const c = whole(cols.value, 1, 50);
          if (r == null || c == null) {
            err.textContent = r == null ? 'Rows: enter a whole number from 1 to 200' : 'Columns: enter a whole number from 1 to 50';
            return false;
          }
          ed.insertTable({ rows: r, cols: c, header: header.input.checked, title: title.value, frame: frame.value });
        },
      },
    ], { width: '600px' });
  }

  tableProps(ed: DocumentEditor) {
    const entry = ed.elementSelection ?? ed.currentElement();
    const table = ops.closestName(entry, 'table');
    const tg = ops.closestName(entry, 'tgroup') ?? (table ? elementChildren(table).find((c) => c.nodeName === 'tgroup') ?? null : null);
    if (!table || !tg) return;
    const titleEl = elementChildren(table).find((c) => c.nodeName === 'title');
    const title = input(titleEl ? textOf(titleEl) : '');
    const frame = select([['', '(default)'], ['all', 'All'], ['topbot', 'Top and bottom'], ['top', 'Top'], ['bottom', 'Bottom'], ['sides', 'Sides'], ['none', 'None']], table.getAttribute('frame') ?? '');
    const colsep = select([['', '(default)'], ['1', 'Yes'], ['0', 'No']], table.getAttribute('colsep') ?? '');
    const rowsep = select([['', '(default)'], ['1', 'Yes'], ['0', 'No']], table.getAttribute('rowsep') ?? '');
    const pgwide = select([['', '(default)'], ['1', 'Page wide'], ['0', 'Column wide']], table.getAttribute('pgwide') ?? '');
    const specs = elementChildren(tg).filter((c) => c.nodeName === 'colspec');
    const widthInputs = specs.map((s) => input(s.getAttribute('colwidth') ?? '', { placeholder: 'e.g. 1*, 30mm' }));
    const alignInputs = specs.map((s) => select([['', '—'], ['left', 'Left'], ['center', 'Center'], ['right', 'Right'], ['justify', 'Justify'], ['char', 'Character']], s.getAttribute('align') ?? ''));
    const widthErr = h('div', { class: 'form-errors', role: 'alert' });
    const colTable = h('table', { class: 'mini-table' }, h('tr', null, h('th', null, 'Column'), h('th', null, 'Width'), h('th', null, 'Align')),
      ...specs.map((s, i) => h('tr', null, h('td', null, s.getAttribute('colname') ?? String(i + 1)), h('td', null, widthInputs[i]), h('td', null, alignInputs[i]))));
    const body = h('div', null, h('div', { class: 'form-grid' }, field('Title', title), field('Frame', frame), field('Column separators', colsep), field('Row separators', rowsep), field('Width', pgwide)), h('div', { class: 'form-section' }, 'Columns'), colTable, widthErr);
    modal('Table properties', body, [
      { label: 'Cancel' },
      {
        label: 'Apply', primary: true, action: () => {
          // a width that is neither "n*" nor a length ("30mm", "1.5in", "1*+10pt") would be written into the file as is
          const bad = widthInputs.findIndex((w) => w.value.trim() !== '' && !parseColWidth(w.value.trim()));
          if (bad >= 0) {
            widthErr.textContent = `Column ${specs[bad].getAttribute('colname') ?? bad + 1}: "${widthInputs[bad].value.trim()}" is not a width. Use 2*, 30mm, 1.5in or 1*+10pt`;
            widthInputs[bad].focus();
            return false;
          }
          return ed.exec('Table properties', (s) => {
          const setOrRemove = (el: Element, n: string, v: string) => (v ? el.setAttribute(n, v) : el.removeAttribute(n));
          setOrRemove(table, 'frame', frame.value);
          setOrRemove(table, 'colsep', colsep.value);
          setOrRemove(table, 'rowsep', rowsep.value);
          setOrRemove(table, 'pgwide', pgwide.value);
          let t = elementChildren(table).find((c) => c.nodeName === 'title');
          if (title.value) {
            if (!t) {
              t = createEl(ed.doc.xml, 'title');
              table.insertBefore(t, table.firstChild);
            }
            if (t.textContent !== title.value) t.textContent = title.value;
          } else if (t) table.removeChild(t);
          specs.forEach((sp, i) => {
            setOrRemove(sp, 'colwidth', widthInputs[i].value.trim());
            setOrRemove(sp, 'align', alignInputs[i].value);
          });
          return s;
          });
        },
      },
    ], { width: '600px' });
  }

  // ---------------------------------------------------------------- figure / graphic
  figure(ed: DocumentEditor, file?: File, existing?: Element) {
    const graphic = existing?.nodeName === 'graphic' ? existing : existing?.nodeName === 'figure' ? existing.getElementsByTagName('graphic')[0] : null;
    const figEl = graphic ? (graphic.parentNode as Element) : null;
    const titleEl = figEl ? elementChildren(figEl).find((c) => c.nodeName === 'title') : null;
    const title = input(titleEl ? textOf(titleEl) : '');
    const icn = input(graphic?.getAttribute('infoEntityIdent') ?? '', { placeholder: 'ICN-…' });
    const fileInput = h('input', { type: 'file', accept: 'image/*,.cgm,.svg,.tif,.tiff', class: 'input' }) as HTMLInputElement;
    const notation = select([['png', 'PNG'], ['jpeg', 'JPEG'], ['svg', 'SVG'], ['gif', 'GIF'], ['cgm', 'CGM'], ['tiff', 'TIFF'], ['pdf', 'PDF']], this.app.settings.defaultNotation);
    const previewBox = h('div', { class: 'img-preview' }, 'No image selected');
    let chosen: File | null = file ?? null;
    let previewUrl: string | null = null; // the preview of a picked file; released when another is picked or the dialog closes
    const releasePreview = () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    };
    const showFile = (f: File | null) => {
      clear(previewBox);
      releasePreview();
      if (!f) {
        const u = icn.value ? this.app.images.resolver(icn.value) : null;
        if (u) previewBox.appendChild(h('img', { src: u, alt: icn.value }));
        else previewBox.textContent = 'No image linked';
        return;
      }
      if (f.type.startsWith('image/')) previewBox.appendChild(h('img', { src: (previewUrl = URL.createObjectURL(f)), alt: f.name }));
      else previewBox.textContent = f.name + ' (preview not available)';
      if (!icn.value || icn.dataset.auto === '1') {
        icn.value = ImageStore.icnName(f.name);
        icn.dataset.auto = '1';
      }
      const ext = f.name.split('.').pop()!.toLowerCase();
      const map: Record<string, string> = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', svg: 'svg', gif: 'gif', cgm: 'cgm', tif: 'tiff', tiff: 'tiff', pdf: 'pdf' };
      if (map[ext]) notation.value = map[ext];
    };
    fileInput.addEventListener('change', () => {
      chosen = fileInput.files?.[0] ?? null;
      showFile(chosen);
    });
    icn.addEventListener('input', () => {
      icn.dataset.auto = '0';
      if (!chosen) showFile(null);
    });
    showFile(chosen);
    const icnRe = /^ICN-[A-Z0-9-]+$/i;
    const err = h('div', { class: 'form-errors', role: 'alert' });
    const body = h('div', { class: 'form-grid two' }, h('div', null,
      graphic ? null : field('Figure title', title),
      field('Image file', fileInput, 'Linked for preview in the editor; the ICN is declared as an entity in the DOCTYPE'),
      field('Information control number (ICN)', icn, 'e.g. ICN-EXAMPLE-A-000000-A-00001-00001-A-001-01'),
      field('Notation', notation),
      err,
    ), previewBox);
    modal(graphic ? 'Graphic' : 'Insert figure', body, [
      { label: 'Cancel' },
      {
        label: graphic ? 'Apply' : 'Insert', primary: true, action: async () => {
          const name = icn.value.trim();
          if (!name || !/^[A-Za-z_][\w.-]*$/.test(name)) {
            err.textContent = 'Enter a valid ICN (an XML name, e.g. ICN-…)';
            return false;
          }
          if (!icnRe.test(name)) this.app.toast('The ICN does not follow the "ICN-…" convention; BREX may report it.', 'warning');
          if (chosen) await this.app.images.add(chosen, name);
          const fname = chosen ? `${name}.${chosen.name.split('.').pop()}` : undefined;
          if (graphic) {
            ed.exec('Change graphic', (s) => {
              graphic.setAttribute('infoEntityIdent', name);
              ed.ensureEntity(name, fname, notation.value);
              return s;
            });
            ed.design.invalidate();
          } else {
            ed.insertFigure({ title: title.value, icn: name, fileName: fname, notation: notation.value });
          }
        },
      },
    ], { width: '720px', onClose: releasePreview });
  }

  // ---------------------------------------------------------------- references
  internalRef(ed: DocumentEditor, existing?: Element) {
    const labels = buildLabels(ed.doc.xml);
    const targets: PickItem[] = [];
    const kinds = new Set(['figure', 'table', 'levelledPara', 'proceduralStep', 'graphic', 'multimedia', 'supportEquipDescr', 'supplyDescr', 'spareDescr', 'warning', 'caution', 'note', 'hotspot', 'footnote', 'crewDrillStep', 'isolationStep']);
    for (const el of Array.from(ed.doc.xml.getElementsByTagName('*'))) {
      if (!kinds.has(el.nodeName) && !el.hasAttribute('id')) continue;
      if (!kinds.has(el.nodeName) && !ed.grammar?.attribute(el.nodeName, 'id')) continue;
      const id = el.getAttribute('id');
      const title = elementChildren(el).find((c) => c.nodeName === 'title');
      const text = title ? textOf(title) : truncate(textOf(el), 60);
      targets.push({ id: elKey(el), label: `${labels.label(el)}${title ? '  ' + textOf(title) : ''}`.trim(), detail: `<${el.nodeName}>${id ? ' #' + id : ' (an ID will be generated)'} ${title ? '' : text}`, icon: el.nodeName === 'figure' ? 'figure' : el.nodeName === 'table' ? 'table' : el.nodeName === 'proceduralStep' ? 'step' : 'section' });
    }
    const map = new Map<string, Element>();
    for (const el of Array.from(ed.doc.xml.getElementsByTagName('*'))) map.set(elKey(el), el);
    picker(existing ? 'Change cross-reference target' : 'Insert cross-reference', targets, (key) => {
      const target = map.get(key);
      if (!target) return;
      if (existing) {
        ed.retargetInternalRef(existing, target);
      } else ed.insertInternalRef(target);
      ed.focus();
    }, { emptyText: 'No referenceable elements (figures, tables, paragraphs, steps) in this data module' });
  }

  dmRef(ed: DocumentEditor, existing?: Element) {
    const code = existing ? readDmCode(find(existing, 'dmCode')) : null;
    const l = existing ? dmRefLabel(existing) : null;
    const dmc = input(code ? formatDmc(code) : '', { placeholder: 'DMC-MODEL-A-00-00-00-00A-040A-D' });
    const ii = existing ? find(existing, 'issueInfo') : null;
    const issueNo = input(ii?.getAttribute('issueNumber') ?? '', { placeholder: 'optional', maxlength: 3 });
    const inWork = input(ii?.getAttribute('inWork') ?? '', { placeholder: '00', maxlength: 2 });
    const tech = input(existing ? textOf(find(existing, 'techName')) : '');
    const infoN = input(existing ? textOf(find(existing, 'infoName')) : '');
    const err = h('div', { class: 'form-errors', role: 'alert' });
    const openDocs = this.app.editors.filter((e) => e !== ed && e.doc.ident?.parts);
    const fromOpen = select([['', '— choose an open data module —'], ...openDocs.map((e, i) => [String(i), `${e.doc.ident!.dmc} ${e.doc.ident!.techName}`] as [string, string])], '');
    fromOpen.addEventListener('change', () => {
      const e = openDocs[+fromOpen.value];
      if (!e) return;
      const id = e.doc.ident!;
      dmc.value = id.dmc;
      tech.value = id.techName;
      infoN.value = id.infoName;
      issueNo.value = id.issueNumber;
      inWork.value = id.inWork;
    });
    const parsedView = h('div', { class: 'field-hint' });
    const showParsed = () => {
      const p = parseDmc(dmc.value);
      parsedView.textContent = p ? `System ${p.systemCode}-${p.subSystemCode}${p.subSubSystemCode}-${p.assyCode}, info code ${p.infoCode}${p.infoCodeVariant}, location ${p.itemLocationCode}` : dmc.value ? 'Not a valid data module code' : '';
    };
    dmc.addEventListener('input', showParsed);
    showParsed();
    const body = h('div', null,
      openDocs.length ? field('From an open document', fromOpen) : null,
      field('Data module code', dmc), parsedView,
      h('div', { class: 'form-grid' }, field('Issue number', issueNo), field('In-work', inWork), field('Technical name', tech), field('Information name', infoN)),
      err,
    );
    modal(existing ? 'Data module reference' : 'Insert data module reference', body, [
      { label: 'Cancel' },
      {
        label: existing ? 'Apply' : 'Insert', primary: true, action: () => {
          const p = parseDmc(dmc.value);
          const errs = p ? validateDmcParts(p) : ['Enter a valid data module code, e.g. DMC-EXAMPLE-A-00-00-00-00A-040A-D'];
          if (errs.length) {
            err.textContent = errs.join('; ');
            return false;
          }
          if (issueNo.value && !/^\d{3}$/.test(issueNo.value)) {
            err.textContent = 'Issue number must be 3 digits';
            return false;
          }
          if (existing) {
            ed.exec('Edit data module reference', (s) => {
              const doc = ed.doc.xml;
              const ident = find(existing, 'dmRefIdent')!;
              writeDmCode(find(ident, 'dmCode')!, p!);
              let iiEl = find(ident, 'issueInfo');
              if (issueNo.value) {
                if (!iiEl) {
                  iiEl = createEl(doc, 'issueInfo');
                  find(ident, 'dmCode')!.after(iiEl);
                }
                iiEl.setAttribute('issueNumber', issueNo.value);
                iiEl.setAttribute('inWork', inWork.value || '00');
              } else iiEl?.remove();
              let items = elementChildren(existing).find((c) => c.nodeName === 'dmRefAddressItems');
              if (tech.value) {
                if (!items) {
                  items = createEl(doc, 'dmRefAddressItems');
                  ident.after(items);
                }
                let title = elementChildren(items).find((c) => c.nodeName === 'dmTitle');
                if (!title) {
                  title = createEl(doc, 'dmTitle');
                  items.insertBefore(title, items.firstChild);
                }
                title.textContent = '';
                const tn = createEl(doc, 'techName');
                tn.textContent = tech.value;
                title.appendChild(tn);
                if (infoN.value) {
                  const inn = createEl(doc, 'infoName');
                  inn.textContent = infoN.value;
                  title.appendChild(inn);
                }
              } else if (items) {
                const title = elementChildren(items).find((c) => c.nodeName === 'dmTitle');
                title?.remove();
                if (!items.children.length) items.remove();
              }
              return s;
            });
          } else ed.insertDmRef(p!, { techName: tech.value, infoName: infoN.value, issueNumber: issueNo.value, inWork: inWork.value });
          void l;
        },
      },
    ], { width: '640px' });
  }

  // ---------------------------------------------------------------- definition list
  definitionList(ed: DocumentEditor, existing?: Element) {
    const existingItems = existing ? elementChildren(existing).filter((c) => c.nodeName === 'definitionListItem') : [];
    const existingHeader = existing ? elementChildren(existing).find((c) => c.nodeName === 'definitionListHeader') : null;
    const rows = h('div', { class: 'deflist-list' });
    type Row = { term: HTMLInputElement; def: HTMLTextAreaElement; row: HTMLElement };
    const entries: Row[] = [];
    const addRow = (term = '', def = '') => {
      const termInput = h('input', { class: 'input', placeholder: 'Term', value: term }) as HTMLInputElement;
      const defInput = h('textarea', { class: 'input deflist-def', placeholder: 'Definition', rows: 2 }) as HTMLTextAreaElement;
      defInput.value = def;
      const removeBtn = h('button', { class: 'icon-btn', title: 'Remove this entry', on: { click: () => { entries.splice(entries.indexOf(row), 1); rowEl.remove(); } } }, icon('close', 14));
      const rowEl = h('div', { class: 'deflist-row' }, h('span', { class: 'deflist-num' }, String(entries.length + 1) + '.'), termInput, defInput, removeBtn);
      const row: Row = { term: termInput, def: defInput, row: rowEl };
      entries.push(row);
      rows.appendChild(rowEl);
      return row;
    };
    if (existingItems.length) {
      for (const it of existingItems) {
        const term = elementChildren(it).find((c) => c.nodeName === 'listItemTerm');
        const def = elementChildren(it).find((c) => c.nodeName === 'listItemDefinition');
        addRow(term ? textOf(term) : '', def ? textOf(def) : '');
      }
    } else {
      addRow();
      addRow();
    }
    const addBtn = h('button', { class: 'btn btn-sm', on: { click: () => { addRow(); entries[entries.length - 1].term.focus(); } } }, icon('plus', 14), ' Add term');
    const termHeader = input(existingHeader ? textOf(elementChildren(existingHeader).find((c) => c.nodeName === 'termTitle') ?? null) : '', { placeholder: 'e.g. Term (optional)' });
    const defHeader = input(existingHeader ? textOf(elementChildren(existingHeader).find((c) => c.nodeName === 'definitionTitle') ?? null) : '', { placeholder: 'e.g. Definition (optional)' });
    const err = h('div', { class: 'form-errors', role: 'alert' });
    const body = h('div', { class: 'deflist-dialog' },
      h('p', { class: 'confirm-text' }, 'Add each term with its definition, one row at a time. Rows with an empty term are left out.'),
      h('div', { class: 'form-grid' }, field('Column heading for terms', termHeader), field('Column heading for definitions', defHeader)),
      h('div', { class: 'deflist-head-row' }, h('span', { class: 'deflist-num' }, ''), h('span', null, 'Term'), h('span', null, 'Definition'), h('span', null)),
      rows, addBtn, err,
    );
    modal(existing ? 'Edit definition list' : 'Insert definition list', body, [
      { label: 'Cancel' },
      {
        label: existing ? 'Apply' : 'Insert', primary: true, action: () => {
          const data = entries.map((r) => ({ term: r.term.value, definition: r.def.value }));
          if (!data.some((d) => d.term.trim())) {
            err.textContent = 'Add at least one term';
            return false;
          }
          const missing = data.find((d) => d.term.trim() && !d.definition.trim());
          if (missing) {
            err.textContent = `"${missing.term.trim()}" needs a definition`;
            return false;
          }
          ed.insertDefinitionList(data, { term: termHeader.value, definition: defHeader.value }, existing);
          ed.focus();
        },
      },
    ], { width: '640px' });
  }

  // ---------------------------------------------------------------- acronym
  acronym(ed: DocumentEditor, existing?: Element) {
    const term = input(existing ? textOf(elementChildren(existing).find((c) => c.nodeName === 'acronymTerm') ?? null) : '', { placeholder: 'e.g. EDP', maxlength: 40 });
    const def = input(existing ? textOf(elementChildren(existing).find((c) => c.nodeName === 'acronymDefinition') ?? null) : '', { placeholder: 'e.g. Engine-driven pump' });
    const preview = h('div', { class: 'field-hint acronym-preview' });
    const err = h('div', { class: 'form-errors', role: 'alert' });
    const update = () => { preview.textContent = term.value ? `Renders as: ${term.value}${def.value ? ' (' + def.value + ')' : ''}` : ''; };
    term.addEventListener('input', update);
    def.addEventListener('input', update);
    update();
    const body = h('div', null,
      h('p', { class: 'confirm-text' }, 'Inserted inline at the cursor — it will not break the surrounding paragraph onto a new line.'),
      field('Acronym', term, 'The short form, e.g. "EDP"'),
      field('Expansion', def, 'The full text the acronym stands for (required by S1000D, shown in parentheses)'),
      preview, err,
    );
    modal(existing ? 'Edit acronym' : 'Insert acronym', body, [
      { label: 'Cancel' },
      {
        label: existing ? 'Apply' : 'Insert', primary: true, action: () => {
          if (!term.value.trim()) {
            err.textContent = 'Enter the acronym';
            return false;
          }
          if (!def.value.trim()) {
            err.textContent = 'Enter what the acronym stands for (S1000D requires an acronymDefinition)';
            return false;
          }
          ed.insertAcronym(term.value.trim(), def.value.trim(), existing);
          ed.focus();
        },
      },
    ], { width: '460px' });
  }

  externalPubRef(ed: DocumentEditor, existing?: Element) {
    const ident = existing ? find(existing, 'externalPubRefIdent') : null;
    const code = input(ident ? textOf(find(ident, 'externalPubCode')) : '', { placeholder: 'e.g. AC 43.13-1B' });
    const title = input(ident ? textOf(find(ident, 'externalPubTitle')) : '', { placeholder: 'e.g. Acceptable Methods, Techniques, and Practices' });
    const issue = input(ident ? textOf(find(ident, 'externalPubIssueInfo')) : '');
    const href = input(existing?.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '', { placeholder: 'https:// (optional)' });
    const err = h('div', { class: 'form-errors', role: 'alert' });
    const body = h('div', null,
      h('p', { class: 'confirm-text' }, 'A reference to a publication or document outside S1000D (a manual, a standard, a regulation…).'),
      field('Publication code', code, 'The document or standard identifier'),
      field('Publication title', title),
      field('Issue / edition', issue, 'e.g. "Revision 4" or "2024"'),
      field('Link (URL)', href, 'Optional; opens the publication if it is available online'),
      err,
    );
    modal(existing ? 'External publication reference' : 'Insert external publication reference', body, [
      { label: 'Cancel' },
      {
        label: existing ? 'Apply' : 'Insert', primary: true, action: () => {
          if (!code.value.trim() && !title.value.trim()) {
            err.textContent = 'Enter a publication code or title';
            return false;
          }
          ed.insertExternalPubRef({ code: code.value.trim(), title: title.value.trim(), issue: issue.value.trim(), href: href.value.trim() }, existing);
          ed.focus();
        },
      },
    ], { width: '560px' });
  }

  specialChar(ed: DocumentEditor) {
    const chars = '° ± × ÷ µ Ω ≤ ≥ ≠ ≈ ∞ √ ∑ ∆ π α β γ δ ε θ λ σ φ ω ² ³ ¹ ½ ¼ ¾ ‰ ′ ″ • · – — … ← → ↑ ↓ ↔ ⇒ ⇔ ✓ ✗ © ® ™ § ¶ € £ ¥ ¢ ∅ ∠ ⊥ ∥ ≡ ∝ ∫ ∂'.split(' ');
    const grid = h('div', { class: 'char-grid' });
    let m: ModalHandle;
    for (const c of chars) {
      grid.appendChild(h('button', { class: 'char-btn', title: `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`, on: { click: () => { m.close(); ed.focus(); ed.insertSpecialChar(c); } } }, c));
    }
    grid.appendChild(h('button', { class: 'char-btn wide', title: 'No-break space U+00A0', on: { click: () => { m.close(); ed.focus(); ed.insertSpecialChar(' '); } } }, 'NBSP'));
    m = modal('Special character', grid, [{ label: 'Close' }], { width: '520px' });
  }

  // ---------------------------------------------------------------- DM properties
  dmProperties(ed: DocumentEditor) {
    const xml = ed.doc.xml;
    const ident = find(xml, 'dmIdent');
    const status = find(xml, 'dmStatus');
    if (!ident || !status) return this.app.toast('This document has no data module identification (dmIdent/dmStatus)', 'warning');
    const code = readDmCode(find(ident, 'dmCode'))!;
    const issue = find(ident, 'issueInfo');
    const lang = find(ident, 'language');
    const date = find(xml, 'issueDate');
    const sec = find(status, 'security');
    const rpc = find(status, 'responsiblePartnerCompany');
    const orig = find(status, 'originator');
    const qa = find(status, 'qualityAssurance');
    const applic = elementChildren(status).find((c) => c.nodeName === 'applic');
    const brexRef = find(status, 'brexDmRef');
    const brexCode = brexRef ? readDmCode(find(brexRef, 'dmCode')) : null;
    const dmcIn = input(formatDmc(code));
    const issueNo = input(issue?.getAttribute('issueNumber') ?? '', { maxlength: 3 });
    const inWork = input(issue?.getAttribute('inWork') ?? '', { maxlength: 2 });
    const langIn = input(lang?.getAttribute('languageIsoCode') ?? '', { maxlength: 3 });
    const countryIn = input(lang?.getAttribute('countryIsoCode') ?? '', { maxlength: 2 });
    const dateIn = input(date ? `${date.getAttribute('year')}-${date.getAttribute('month')}-${date.getAttribute('day')}` : '', { type: 'date' });
    const tech = input(textOf(find(xml, 'techName')));
    const infoN = input(textOf(find(xml, 'infoName')));
    const issueType = select([['new', 'new'], ['changed', 'changed'], ['deleted', 'deleted'], ['revised', 'revised'], ['status', 'status'], ['rinstate-changed', 'rinstate-changed'], ['rinstate-revised', 'rinstate-revised'], ['rinstate-status', 'rinstate-status']], status.getAttribute('issueType') ?? 'new');
    const secIn = select(Object.entries(SECURITY_LABELS).map(([k, v]) => [k, `${k} – ${v}`]), sec?.getAttribute('securityClassification') ?? '01');
    const rpcCode = input(rpc?.getAttribute('enterpriseCode') ?? '', { maxlength: 5 });
    const rpcName = input(textOf(rpc?.getElementsByTagName('enterpriseName')[0] ?? null));
    const origCode = input(orig?.getAttribute('enterpriseCode') ?? '', { maxlength: 5 });
    const origName = input(textOf(orig?.getElementsByTagName('enterpriseName')[0] ?? null));
    const applicText = input(applic ? textOf(applic.getElementsByTagName('displayText')[0] ?? applic) : '');
    const qaState = qa ? (find(qa, 'secondVerification') ? 'second' : find(qa, 'firstVerification') ? 'first' : 'unverified') : 'unverified';
    const qaSel = select([['unverified', 'Unverified'], ['first', 'First verification'], ['second', 'First + second verification']], qaState);
    const qaType = select([['tabtop', 'Table top'], ['onobject', 'On object'], ['ttandoo', 'Table top and on object']], (find(qa, 'firstVerification')?.getAttribute('verificationType')) ?? 'tabtop');
    const issueKey = ed.doc.schemaRef?.issue ?? '5-0';
    const brexIn = input(brexCode ? formatDmc(brexCode) : formatDmc(defaultBrexCode(issueKey)));
    const schemaSel = select(ISSUES.map((i) => [i, 'S1000D ' + ISSUE_LABEL[i]]), issueKey);
    const err = h('div', { class: 'form-errors', role: 'alert' });
    const body = h('div', null,
      h('div', { class: 'form-section' }, 'Identification'),
      h('div', { class: 'form-grid' }, field('Data module code', dmcIn, undefined, 'span2'), field('Issue number', issueNo), field('In-work', inWork), field('Language', langIn), field('Country', countryIn), field('Issue date', dateIn), field('Issue type', issueType)),
      h('div', { class: 'form-grid' }, field('Technical name', tech), field('Information name', infoN)),
      h('div', { class: 'form-section' }, 'Status'),
      h('div', { class: 'form-grid' }, field('Security classification', secIn), field('Applicability (display text)', applicText), field('Quality assurance', qaSel), field('Verification type', qaType)),
      h('div', { class: 'form-grid' }, field('Responsible partner company code', rpcCode), field('Responsible partner company name', rpcName), field('Originator code', origCode), field('Originator name', origName)),
      h('div', { class: 'form-section' }, 'Business rules and schema'),
      h('div', { class: 'form-grid' }, field('BREX data module code', brexIn, `Default for this issue: ${formatDmc(defaultBrexCode(issueKey))}`, 'span2'), field('S1000D issue (schema)', schemaSel, 'Changes xsi:noNamespaceSchemaLocation')),
      err,
    );
    modal('Data module properties', body, [
      { label: 'Cancel' },
      {
        label: 'Apply', primary: true, action: () => {
          const p = parseDmc(dmcIn.value);
          const bp = parseDmc(brexIn.value);
          const errs = [...(p ? validateDmcParts(p) : ['Invalid data module code']), ...(bp ? [] : ['Invalid BREX data module code'])];
          if (!/^\d{3}$/.test(issueNo.value)) errs.push('Issue number: 3 digits');
          if (!/^\d{2}$/.test(inWork.value)) errs.push('In-work: 2 digits');
          if (!tech.value.trim()) errs.push('Technical name is required');
          // codes are checked when they were changed, so a document with a legacy value can still be edited
          const changed = (input: HTMLInputElement, el: Element | null | undefined, attr: string) => input.value !== (el?.getAttribute(attr) ?? '');
          if (lang && changed(langIn, lang, 'languageIsoCode') && !/^[a-z]{2,3}$/i.test(langIn.value)) errs.push('Language: 2 or 3 letters (ISO 639), e.g. en');
          if (lang && changed(countryIn, lang, 'countryIsoCode') && !/^[a-z]{2}$/i.test(countryIn.value)) errs.push('Country: 2 letters (ISO 3166), e.g. US');
          if (rpc && changed(rpcCode, rpc, 'enterpriseCode') && !/^[A-Z0-9]{5}$/i.test(rpcCode.value)) errs.push('Responsible partner company code: 5 letters or digits');
          if (orig && changed(origCode, orig, 'enterpriseCode') && !/^[A-Z0-9]{5}$/i.test(origCode.value)) errs.push('Originator code: 5 letters or digits');
          if (errs.length) {
            err.textContent = errs.join('; ');
            return false;
          }
          const ok = ed.exec('Data module properties', (s) => {
            const doc = ed.doc.xml;
            writeDmCode(find(ident, 'dmCode')!, p!);
            issue?.setAttribute('issueNumber', issueNo.value);
            issue?.setAttribute('inWork', inWork.value);
            lang?.setAttribute('languageIsoCode', langIn.value.toLowerCase());
            lang?.setAttribute('countryIsoCode', countryIn.value.toUpperCase());
            if (date && dateIn.value) {
              const [y, mo, d] = dateIn.value.split('-');
              date.setAttribute('year', y);
              date.setAttribute('month', mo);
              date.setAttribute('day', d);
            }
            const setText = (el: Element | null, v: string) => {
              if (el && textOf(el) !== v) el.textContent = v;
            };
            setText(find(doc, 'techName'), tech.value);
            const infoEl = find(doc, 'infoName');
            if (infoEl) setText(infoEl, infoN.value);
            else if (infoN.value) {
              const t = find(doc, 'techName')!;
              const n = createEl(doc, 'infoName');
              n.textContent = infoN.value;
              t.after(n);
            }
            status.setAttribute('issueType', issueType.value);
            sec?.setAttribute('securityClassification', secIn.value);
            if (rpc && changed(rpcCode, rpc, 'enterpriseCode')) rpc.setAttribute('enterpriseCode', rpcCode.value.toUpperCase());
            setText(rpc?.getElementsByTagName('enterpriseName')[0] ?? null, rpcName.value);
            if (orig && changed(origCode, orig, 'enterpriseCode')) orig.setAttribute('enterpriseCode', origCode.value.toUpperCase());
            setText(orig?.getElementsByTagName('enterpriseName')[0] ?? null, origName.value);
            if (applic) {
              const dt = applic.getElementsByTagName('displayText')[0];
              const sp = dt?.getElementsByTagName('simplePara')[0];
              if (sp) setText(sp, applicText.value);
            }
            // rebuilt only when the choice changed: a rebuild drops whatever else the verification elements carry
            if (qa && (qaSel.value !== qaState || (qaState !== 'unverified' && qaType.value !== (find(qa, 'firstVerification')?.getAttribute('verificationType') ?? 'tabtop')))) {
              const want = qaSel.value;
              while (qa.firstChild) qa.removeChild(qa.firstChild);
              if (want === 'unverified') qa.appendChild(createEl(doc, 'unverified'));
              else {
                const f1 = createEl(doc, 'firstVerification');
                f1.setAttribute('verificationType', qaType.value);
                qa.appendChild(f1);
                if (want === 'second') {
                  const f2 = createEl(doc, 'secondVerification');
                  f2.setAttribute('verificationType', qaType.value);
                  qa.appendChild(f2);
                }
              }
            }
            if (brexRef) writeDmCode(find(brexRef, 'dmCode')!, bp!);
            const root = doc.documentElement;
            const sch = ed.doc.schemaRef?.schema ?? 'descript';
            if (schemaSel.value !== issueKey) root.setAttributeNS(NS.xsi, 'xsi:noNamespaceSchemaLocation', schemaUrl(schemaSel.value, sch));
            return s;
          });
          if (ok && schemaSel.value !== issueKey) {
            void ed.doc.refreshSchema().then(() => {
              ed.xml.setGrammar(ed.doc.grammar);
              ed.design.invalidate();
              this.app.updateChrome();
            });
          }
        },
      },
    ], { width: '820px' });
    void todayParts;
    void DEFAULT_BREX;
  }

  // ---------------------------------------------------------------- settings
  settings() {
    const s = this.app.settings;
    const view = select([['design', 'Design'], ['tags', 'Tags'], ['split', 'Split'], ['xml', 'XML']], s.defaultView);
    const theme = select([['system', 'Follow system'], ['light', 'Light'], ['dark', 'Dark']], s.theme);
    const live = checkbox('Validate automatically while editing', s.liveValidation);
    const liveXsd = checkbox('Include XSD schema validation in live validation', s.liveXsd);
    const liveBrex = checkbox('Include BREX check in live validation', s.liveBrex);
    const spell = checkbox('Spell checking in the design view', s.spellcheck);
    const sync = checkbox('Synchronise selection between Design and XML in Split view', s.syncSelection);
    const splitTags = checkbox('Show tags in Split view', s.splitTags);
    const autosave = checkbox('Keep recovery drafts (restored after a crash or reload)', s.drafts);
    const ent = checkbox('Declare missing ICN entities automatically when saving', s.declareEntitiesOnSave);
    const notation = select([['png', 'PNG'], ['jpeg', 'JPEG'], ['svg', 'SVG'], ['cgm', 'CGM'], ['tiff', 'TIFF'], ['gif', 'GIF']], s.defaultNotation);
    const issue = select(ISSUES.filter((i) => i !== '4-1').map((i) => [i, 'S1000D ' + ISSUE_LABEL[i]]), s.defaultIssue);
    const delay = input(String(s.xmlCommitDelay), { type: 'number', min: 100, max: 5000, step: 100 });
    const body = h('div', { class: 'settings' },
      h('div', { class: 'form-section' }, 'General'),
      h('div', { class: 'form-grid' }, field('Default view', view), ...(this.app.host ? [] : [field('Theme', theme)]), field('Default S1000D issue for new data modules', issue), field('Default graphic notation', notation)),
      h('div', { class: 'form-section' }, 'Editing'),
      spell.el, sync.el, splitTags.el, field('XML view: apply edits after (ms)', delay),
      h('div', { class: 'form-section' }, 'Validation'),
      live.el, liveXsd.el, liveBrex.el, ent.el,
      h('div', { class: 'form-section' }, 'Recovery'),
      autosave.el,
    );
    modal('Settings', body, [
      { label: 'Cancel' },
      {
        label: 'Save', primary: true, action: () => {
          const wasLive = s.liveValidation;
          Object.assign(s, {
            defaultView: view.value, theme: theme.value, liveValidation: live.input.checked, liveXsd: liveXsd.input.checked, liveBrex: liveBrex.input.checked,
            spellcheck: spell.input.checked, syncSelection: sync.input.checked, splitTags: splitTags.input.checked, drafts: autosave.input.checked,
            declareEntitiesOnSave: ent.input.checked, defaultNotation: notation.value, defaultIssue: issue.value, xmlCommitDelay: Math.min(5000, Math.max(100, Math.round(+delay.value) || 500)),
          });
          this.app.saveSettings();
          this.app.applySettings();
          // turning live validation on should show the current state, not wait for the next edit
          if (!wasLive && s.liveValidation && this.app.active) void this.app.validate(this.app.active, { live: true });
        },
      },
    ], { width: '640px' });
  }

  shortcuts() {
    const groups = new Map<string, HTMLElement>();
    const body = h('div', { class: 'shortcuts' });
    const extra = this.app.host?.commands?.() ?? [];
    const replaced = new Set(extra.map((c) => c.replaces).filter(Boolean));
    for (const c of [...this.app.commands.filter((x) => !replaced.has(x.id)), ...extra.filter((x) => x.keys?.length).map((x) => ({ ...x, description: undefined as string | undefined }))]) {
      if (!c.keys?.length && !c.description) continue;
      let g = groups.get(c.group);
      if (!g) {
        g = h('div', { class: 'sc-group' }, h('h3', null, c.group));
        groups.set(c.group, g);
        body.appendChild(g);
      }
      g.appendChild(h('div', { class: 'sc-row' }, h('span', null, c.label), h('span', { class: 'sc-keys' }, ...(c.keys ?? [c.description!]).map((k) => h('kbd', null, shortcutLabel(k))))));
    }
    const ed = h('div', { class: 'sc-group' }, h('h3', null, 'Editing keys'),
      ...[['Enter', 'New paragraph / list item / step (splits the element)'], ['Enter on empty last list item', 'Leave the list'], ['Backspace at paragraph start', 'Join with previous paragraph'], ['Tab / Shift+Tab', 'Next/previous table cell, demote/promote item'], ['Tab in last table cell', 'Add a row'], ['Esc', 'Clear element selection'], ['Ctrl+A', 'Select paragraph, then all content'], ['Ctrl+Click on a reference', 'Follow the cross-reference'], ['Shift+Right-click', 'Native context menu (spelling suggestions)']].map(([k, d]) => h('div', { class: 'sc-row' }, h('span', null, d), h('span', { class: 'sc-keys' }, h('kbd', null, k)))));
    body.appendChild(ed);
    modal('Keyboard shortcuts', body, [{ label: 'Close', primary: true }], { width: '760px' });
  }

  // ---------------------------------------------------------------- BREX library
  async brexLibrary() {
    const list = h('div', { class: 'lib-list' });
    const refresh = async () => {
      const items: StoredBrex[] = await this.app.validator.listBrex();
      clear(list);
      list.appendChild(h('div', { class: 'lib-note' }, 'The S1000D default BREX data modules for issues 4.1, 4.2, 5.0, 6 and 7 are built in. Project BREX data modules added here are used automatically when a data module references them (layered on top of the default BREX).'));
      if (!items.length) list.appendChild(h('div', { class: 'panel-empty' }, 'No project BREX data modules loaded.'));
      for (const b of items) {
        list.appendChild(h('div', { class: 'lib-row' }, icon('brex', 15), h('span', { class: 'lib-name' }, b.dmc), h('span', { class: 'lib-detail' }, b.fileName), h('button', { class: 'btn btn-sm btn-danger', on: { click: async () => { await this.app.validator.removeBrex(b.dmc); await refresh(); } } }, 'Remove')));
      }
    };
    const file = h('input', { type: 'file', accept: '.xml,.XML', multiple: true, class: 'input' }) as HTMLInputElement;
    file.addEventListener('change', async () => {
      for (const f of Array.from(file.files ?? [])) {
        try {
          const b = await this.app.validator.addBrex(await readXmlFile(f), f.name);
          this.app.toast(`Added BREX ${b.dmc} (${b.rules.length} rules)`, 'info');
        } catch (e) {
          this.app.toast(`${f.name}: ${(e as Error).message}`, 'error');
        }
      }
      file.value = '';
      await refresh();
    });
    const useActive = h('button', { class: 'btn', on: { click: async () => {
      const ed = this.app.active;
      if (!ed) return;
      try {
        const b = await this.app.validator.addBrex(ed.doc.toString(), ed.doc.fileName);
        this.app.toast(`Added BREX ${b.dmc} (${b.rules.length} rules)`, 'info');
        await refresh();
      } catch (e) {
        this.app.toast((e as Error).message, 'error');
      }
    } } }, 'Add the active document');
    await refresh();
    modal('BREX library', h('div', null, h('div', { class: 'lib-actions' }, field('Add BREX data module files', file), useActive), list), [{ label: 'Close', primary: true }], { width: '720px' });
  }

  images() {
    const list = h('div', { class: 'lib-list' });
    const refresh = () => {
      clear(list);
      const names = this.app.images.names();
      if (!names.length) list.appendChild(h('div', { class: 'panel-empty' }, 'No linked images. Graphics are shown as placeholders until an image file is linked to their ICN.'));
      for (const n of names) {
        list.appendChild(h('div', { class: 'lib-row' }, h('img', { class: 'lib-thumb', src: this.app.images.resolver(n)!, alt: '' }), h('span', { class: 'lib-name' }, n), h('button', { class: 'btn btn-sm btn-danger', on: { click: async () => { await this.app.images.remove(n); refresh(); this.app.editors.forEach((e) => e.design.invalidate()); } } }, 'Unlink')));
      }
    };
    const file = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'input' }) as HTMLInputElement;
    file.addEventListener('change', async () => {
      for (const f of Array.from(file.files ?? [])) await this.app.images.add(f, ImageStore.icnName(f.name));
      file.value = '';
      refresh();
      this.app.editors.forEach((e) => e.design.invalidate());
    });
    refresh();
    modal('Linked images', h('div', null, field('Link image files (the file name without extension is the ICN)', file), list), [{ label: 'Close', primary: true }], { width: '640px' });
  }

  about() {
    const body = h('div', { class: 'about' },
      h('div', { class: 'about-logo' }, icon('design', 40)),
      h('h3', null, 'S1000D Studio'),
      h('p', null, 'Structured WYSIWYG authoring for S1000D data modules (Issues 4.1–7). Schema-driven editing with Design, Tags, Split and XML views, XSD validation (libxml2) and BREX checking.'),
      h('p', { class: 'muted' }, 'Bundles the official S1000D XML schemas and default BREX data modules published by the S1000D Steering Committee (ASD/AIA/ATA). XSD validation uses xmllint compiled to WebAssembly (MIT). Icons: Lucide (ISC).'),
    );
    modal('About', body, [{ label: 'Close', primary: true }], { width: '520px' });
  }

  restoreDrafts(drafts: { id: string; fileName: string; savedAt: number }[]): Promise<string[] | null> {
    return new Promise((resolve) => {
      const checks = drafts.map((d) => ({ d, c: checkbox(`${d.fileName} — ${new Date(d.savedAt).toLocaleString()}`, true) }));
      let result: string[] | null = null;
      modal('Recover unsaved work', h('div', null, h('p', null, 'S1000D Studio found unsaved documents from a previous session.'), ...checks.map((x) => x.c.el)), [
        { label: 'Discard', danger: true, action: () => { result = []; } },
        { label: 'Restore selected', primary: true, action: () => { result = checks.filter((x) => x.c.input.checked).map((x) => x.d.id); } },
      ], { width: '560px', onClose: () => resolve(result) });
    });
  }
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

const keyMap = new WeakMap<Element, string>();
let keySeq = 0;
function elKey(el: Element): string {
  let k = keyMap.get(el);
  if (!k) {
    k = 'k' + ++keySeq;
    keyMap.set(el, k);
  }
  return k;
}
