// Structured applicability picker, shared by the New data module wizard (the data module's own <applic>) and the properties pane
// (a new <applic> definition that content is pointed at with applicRefId). It offers the project's ACT product attributes and CCT conditions
// (ProjectRefs.applic) and produces the S1000D markup: one <assert>, or an <evaluate andOr="and|or"> over several.
import { h, clear } from './dom';
import { escapeAttr, escapeText } from '../core/xml';
import type { ProjectRefs } from '../core/reference';

type Defs = NonNullable<ProjectRefs['applic']>;
export interface ApplicPick { inner: string; text: string }
export interface ApplicPicker {
  el: HTMLElement;
  /** 'all' = no restriction, 'select' = the rows below. */
  mode: HTMLSelectElement;
  /** The chosen applicability, or null when "all" is chosen or no row has a value yet. */
  read(): ApplicPick | null;
  /** True when "select" is chosen but nothing is picked yet (the form must not be submitted). */
  incomplete(): boolean;
}

const opt = (value: string, label: string) => h('option', { value }, label) as HTMLOptionElement;
function select(items: Array<[string, string]>, value: string): HTMLSelectElement {
  const s = h('select', { class: 'input' }) as HTMLSelectElement;
  for (const [v, l] of items) s.appendChild(opt(v, l));
  s.value = value;
  return s;
}

export function applicPicker(defs: Defs, onChange: () => void, opts: { allowAll?: boolean } = {}): ApplicPicker {
  const allowAll = opts.allowAll !== false;
  type Row = { prop: HTMLSelectElement; picked: () => string; kind: () => 'prodattr' | 'condition'; id: () => string };
  const rows: Row[] = [];
  const mode = select(allowAll ? [['all', 'All (no restriction)'], ['select', "Only where… (from this project's applicability definitions)"]] : [['select', 'Only where…']], allowAll ? 'all' : 'select');
  mode.setAttribute('aria-label', 'Applicability mode');
  const andOr = select([['and', 'all of these (and)'], ['or', 'any of these (or)']], 'and');
  const box = h('div', { class: 'applic-rows' });
  const add = h('button', { type: 'button', class: 'btn' }, 'Add a condition') as HTMLButtonElement;
  const tools = h('div', { class: 'applic-tools' }, add, andOr);
  const el = h('div', null, allowAll ? mode : null, box, tools);

  const addRow = () => {
    const items: Array<[string, string]> = [
      ...defs.attributes.map((a): [string, string] => [`prodattr:${a.id}`, `${a.name} (${a.id})`]),
      ...defs.conditions.map((c): [string, string] => [`condition:${c.id}`, `Condition: ${c.name} (${c.id})`]),
    ];
    const prop = select(items, items[0]?.[0] ?? '');
    const vals = h('span', { class: 'applic-vals' });
    const find = () => { const [k, id] = prop.value.split(':'); return k === 'prodattr' ? defs.attributes.find((a) => a.id === id) : defs.conditions.find((c) => c.id === id); };
    const boxes: HTMLInputElement[] = []; let free: HTMLInputElement | null = null;
    const draw = () => {
      clear(vals); boxes.length = 0; free = null;
      const def = find();
      if (def?.values.length) {
        for (const v of def.values) { const cb = h('input', { type: 'checkbox', value: v }) as HTMLInputElement; cb.addEventListener('change', onChange); boxes.push(cb); vals.appendChild(h('label', { class: 'check' }, cb, ' ' + v)); }
      } else {
        free = h('input', { class: 'input', spellcheck: 'false', placeholder: 'value, e.g. 1~5 or A|B' }) as HTMLInputElement;
        free.addEventListener('input', onChange); vals.appendChild(free);
      }
    };
    prop.addEventListener('change', () => { draw(); onChange(); });
    draw();
    const rm = h('button', { type: 'button', class: 'btn' }, 'Remove') as HTMLButtonElement;
    const row: Row = { prop, kind: () => prop.value.split(':')[0] as 'prodattr' | 'condition', id: () => prop.value.split(':')[1], picked: () => (free ? free.value.trim() : boxes.filter((b) => b.checked).map((b) => b.value).join('|')) };
    const line = h('div', { class: 'applic-row' }, prop, vals, rm);
    rm.addEventListener('click', () => { rows.splice(rows.indexOf(row), 1); line.remove(); onChange(); });
    rows.push(row); box.appendChild(line); onChange();
  };
  add.addEventListener('click', addRow);
  const sync = () => { const on = mode.value === 'select'; box.style.display = on ? '' : 'none'; tools.style.display = on ? '' : 'none'; if (on && !rows.length) addRow(); };
  mode.addEventListener('change', () => { sync(); onChange(); });
  box.style.display = 'none'; tools.style.display = 'none';
  if (!allowAll) sync();

  const name = (r: Row) => (r.kind() === 'prodattr' ? defs.attributes.find((a) => a.id === r.id())?.name : defs.conditions.find((c) => c.id === r.id())?.name) ?? r.id();
  return {
    el, mode,
    incomplete: () => mode.value === 'select' && !rows.some((r) => r.picked()),
    read: () => {
      if (mode.value !== 'select') return null;
      const picked = rows.filter((r) => r.picked());
      if (!picked.length) return null;
      const asserts = picked.map((r) => `<assert applicPropertyIdent="${escapeAttr(r.id())}" applicPropertyType="${r.kind()}" applicPropertyValues="${escapeAttr(r.picked())}"/>`);
      const text = picked.map((r) => `${name(r)}: ${r.picked().split('|').join(', ')}`).join(andOr.value === 'or' ? ' or ' : ' and ');
      return { inner: asserts.length === 1 ? asserts[0] : `<evaluate andOr="${andOr.value}">${asserts.join('')}</evaluate>`, text };
    },
  };
}

/** The complete <applic> element (as the wizard writes it into dmStatus), pretty-printed to match the template. */
export function applicElementXml(p: ApplicPick, indent = '      '): string {
  return `${indent}<applic>\n${indent}  <displayText>\n${indent}    <simplePara>${escapeText(p.text)}</simplePara>\n${indent}  </displayText>\n${indent}  ${p.inner}\n${indent}</applic>`;
}
