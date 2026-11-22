// The SNS rows as an editable hierarchy: system > sub-system > sub-sub-system > assembly. One component for a project's SNS and for the organisation
// defaults (the two differ only in the `api` that saves and in who may write), so they look and behave the same.
//
//   - the per-field code rules (from the server), the problems of the whole set with each one next to the row it names, a summary
//   - add / edit / delete in a dialog; a change of code or a delete that reaches rows below asks first and says how many
//   - a search box and "Show more": a 4,000-row SNS opens at its systems and renders a page of rows at a time
//
// The pure logic (tree, problems, form checks, what a cascade touches) is in lib/sns.ts.

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { SnsData, SnsRow, SnsRowData, SnsRowsApi, SnsRules } from '../api/sns';
import {
  LEVEL_LABEL, PROBLEM_LABEL, TITLE_MAX, ancestorIds, buildTree, changesNode, childForm, childrenRefused, descendantsOf, displayCode, emptyForm, errorLines, flattenTree, formFromRow,
  hasErrors, initialOpen, levelOf, orderProblems, parentIds, plural, problemsByRow, rowBody, sampleCodes, summariseProblems, validateForm, type FormErrors,
} from '../lib/sns';
import { cap } from '../lib/importPackage';
import { useUi } from '../store/ui';
import { Icon } from './Icon';
import { CappedList, Section, ShowMore } from './lists';
import { Alert, Badge, Empty, Field, Modal, Spinner } from './ui';

const PAGE = 100;

type FormState = { mode: 'add'; initial: SnsRowData; focus: keyof SnsRowData; parent: SnsRow | null } | { mode: 'edit'; row: SnsRow; initial: SnsRowData; focus: keyof SnsRowData; parent: null };
interface Pending { body: SnsRowData; row: SnsRow; count: number; sample: string }

const FIELDS: Array<{ key: keyof SnsRowData; label: string; max: number; optional?: boolean }> = [
  { key: 'systemDiffCode', label: 'System difference code (optional)', max: 4, optional: true },
  { key: 'systemCode', label: 'System code', max: 3 },
  { key: 'subSystemCode', label: 'Sub-system code', max: 1 },
  { key: 'subSubSystemCode', label: 'Sub-sub-system code', max: 1 },
  { key: 'assyCode', label: 'Assembly code', max: 4 },
];

export function SnsRowsEditor({ data, api, canWrite, reload, testid = 'sns', noun = 'SNS' }: {
  data: SnsData; api: SnsRowsApi; canWrite: boolean; reload: () => void; testid?: string; noun?: string;
}) {
  const toast = useUi((s) => s.toast);
  const tree = useMemo(() => buildTree(data.rows), [data.rows]);
  const [open, setOpen] = useState<Set<string>>(() => initialOpen(tree, data.rows.length));
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [del, setDel] = useState<{ row: SnsRow; kids: SnsRow[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState('');

  // After a row is added, open the rows above it so it can be seen.
  useEffect(() => {
    if (!reveal) return;
    const above = ancestorIds(tree, reveal);
    if (above.length || tree.some((n) => n.row.id === reveal)) { setOpen((o) => new Set([...o, ...above])); setReveal(''); }
  }, [reveal, tree]);

  const byRow = useMemo(() => problemsByRow(data.problems), [data.problems]);
  const summary = useMemo(() => summariseProblems(data.problems), [data.problems]);
  const flat = useMemo(() => flattenTree(tree, { open, query }), [tree, open, query]);
  const view = cap(flat, shown);

  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const openAdd = (parent: SnsRow | null) => {
    setFormError([]);
    if (!parent) { setForm({ mode: 'add', initial: emptyForm(), focus: 'systemCode', parent: null }); return; }
    const c = childForm(parent);
    if (c) setForm({ mode: 'add', initial: c.form, focus: c.field, parent });
  };
  const openEdit = (row: SnsRow) => { setFormError([]); setForm({ mode: 'edit', row, initial: formFromRow(row), focus: 'title', parent: null }); };
  const close = () => { if (!busy) { setForm(null); setPending(null); setFormError([]); } };

  const persist = async (f: FormState, body: SnsRowData, cascade: boolean) => {
    setBusy(true); setFormError([]);
    try {
      if (f.mode === 'add') {
        const r = await api.create(body);
        toast(`Added ${displayCode(r.row)}${r.warnings.length ? `. ${r.warnings.join(' ')}` : ''}`, r.warnings.length ? 'info' : 'success');
        setReveal(r.row.id); setQuery('');
      } else {
        const r = await api.update(f.row.id, body, cascade);
        toast(`Saved ${displayCode(r.row)}${r.changedChildren ? `; ${plural(r.changedChildren, 'row')} below it changed with it` : ''}${r.warnings.length ? `. ${r.warnings.join(' ')}` : ''}`, 'success');
      }
      setForm(null); setPending(null); reload();
    } catch (e) {
      const kids = f.mode === 'edit' ? childrenRefused(e) : null;
      if (kids !== null && f.mode === 'edit') setPending({ body, row: f.row, count: kids, sample: '' });      // the list on screen was stale: ask again with the server's count
      else { setPending(null); setFormError(errorLines(e)); }
    } finally { setBusy(false); }
  };

  const submit = (body: SnsRowData) => {
    if (!form) return;
    if (form.mode === 'edit' && changesNode(form.row, body)) {
      const kids = descendantsOf(data.rows, form.row);
      if (kids.length) { setPending({ body, row: form.row, count: kids.length, sample: sampleCodes(kids) }); return; }
    }
    void persist(form, body, false);
  };

  const askDelete = (row: SnsRow) => setDel({ row, kids: descendantsOf(data.rows, row) });
  const doDelete = async () => {
    if (!del) return;
    setBusy(true);
    try {
      const r = await api.remove(del.row.id, del.kids.length > 0);
      toast(`Deleted ${displayCode(del.row)}${r.removed > 1 ? ` and ${plural(r.removed - 1, 'row')} below it` : ''}`, 'success');
      setDel(null); reload();
    } catch (e) {
      toast(errorLines(e).join(' '), 'error');
      if (childrenRefused(e) !== null) { setDel(null); reload(); }
    } finally { setBusy(false); }
  };

  const tone = summary.errors ? 'bad' : summary.warnings ? 'warn' : 'ok';
  return (
    <div className="v2-stack" data-testid={`${testid}-editor`}>
      <Alert tone={tone}><span data-testid={`${testid}-problem-summary`}>{data.rows.length === 0 ? `No rows in the ${noun} yet.` : `${plural(data.rows.length, 'row')}. ${summary.text}.`}</span></Alert>

      <Section title="Rules for the codes" defaultOpen testid={`${testid}-rules`}>
        <ul className="v2-list">
          {FIELDS.map((f) => <li key={f.key}><strong style={{ minWidth: 190 }}>{f.label.replace(' (optional)', '')}</strong><span>{data.rules.codes[f.key as keyof SnsRules['codes']]}</span></li>)}
        </ul>
        <p className="v2-hint" style={{ margin: '8px 0 0' }}>{data.rules.note}</p>
      </Section>

      {data.problems.length ? (
        <Section title="Problems" count={data.problems.length} tone={summary.errors ? 'bad' : 'warn'} defaultOpen={data.problems.length <= 10} testid={`${testid}-problems`}>
          <CappedList items={orderProblems(data.problems)} initial={25} noun="problems" testid={`${testid}-problem-list`} render={(p) => (
            <><Badge tone={p.severity === 'error' ? 'bad' : 'warn'}>{PROBLEM_LABEL[p.code]}</Badge><span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{p.message}</span></>
          )} />
        </Section>
      ) : null}

      <div className="v2-row wrap">
        <input className="v2-input" style={{ maxWidth: 280 }} placeholder="Find a code or a title…" aria-label={`Find a row of the ${noun}`} value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }} data-testid={`${testid}-filter`} />
        <button type="button" className="btn btn-sm" onClick={() => setOpen(parentIds(tree))} data-testid={`${testid}-expand`}><Icon name="expand" size={13} />Expand all</button>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(new Set())} data-testid={`${testid}-collapse`}><Icon name="collapse" size={13} />Collapse all</button>
        <span style={{ flex: 1 }} />
        {canWrite ? <button type="button" className="btn btn-primary" onClick={() => openAdd(null)} data-testid={`${testid}-add`}><Icon name="plus" />Add a row</button> : null}
      </div>

      <div className="v2-card">
        {flat.length === 0 ? (
          <Empty title={query ? 'Nothing matches' : `No rows in the ${noun} yet`}>{canWrite && !query ? <span className="v2-hint">Add a system, then the sub-systems and assemblies below it. Or bring rows in from a BREX, the organisation defaults or the data modules.</span> : null}</Empty>
        ) : (
          <div className="v2-scroll-x">
            <table className="v2-table" data-testid={`${testid}-table`}>
              <thead><tr><th>Code</th><th>Diff.</th><th>Title</th><th>Level</th>{canWrite ? <th /> : null}</tr></thead>
              <tbody>{view.items.map((f) => {
                const r = f.node.row;
                const code = displayCode(r);
                const probs = byRow.get(r.id) ?? [];
                return (
                  <tr key={r.id} data-testid={`${testid}-row`} data-code={code} data-diff={r.systemDiffCode} data-level={f.node.level} data-problems={probs.length}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, paddingLeft: f.depth * 20 }}>
                        {f.hasChildren
                          ? <button type="button" className="icon-btn" aria-expanded={f.open} aria-label={`${f.open ? 'Collapse' : 'Expand'} ${code}`} onClick={() => toggle(r.id)} disabled={!!query} data-testid={`${testid}-toggle`}><Icon name={f.open ? 'down' : 'right'} size={14} /></button>
                          : <span style={{ display: 'inline-block', width: 28 }} />}
                        <span className="v2-mono">{code}</span>
                        {f.hasChildren && !f.open ? <span className="v2-hint">({f.below})</span> : null}
                      </span>
                    </td>
                    <td>{r.systemDiffCode ? <Badge title="This row applies only to modules with this system difference code">{r.systemDiffCode}</Badge> : <span className="v2-hint">all</span>}</td>
                    <td style={{ overflowWrap: 'anywhere' }}>
                      {r.title}
                      {probs.map((p, i) => (
                        <div key={i} className={p.severity === 'error' ? 'v2-error' : 'v2-hint'} style={p.severity === 'warn' ? { color: 'var(--warning)' } : undefined} data-testid={`${testid}-row-problem`} data-severity={p.severity} data-problem={p.code}>
                          <Icon name={p.severity === 'error' ? 'alert' : 'warn'} size={12} /> {p.message}
                        </div>
                      ))}
                    </td>
                    <td><span className="v2-hint">{LEVEL_LABEL[f.node.level]}</span></td>
                    {canWrite ? (
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {levelOf(r) !== 'assy' ? <button type="button" className="icon-btn" title="Add a row below this one" aria-label={`Add a row below ${code}`} onClick={() => openAdd(r)} disabled={busy} data-testid={`${testid}-add-child`}><Icon name="plus" size={14} /></button> : null}
                        <button type="button" className="icon-btn" title="Edit" aria-label={`Edit ${code}${r.systemDiffCode ? ` (${r.systemDiffCode})` : ''}`} onClick={() => openEdit(r)} disabled={busy} data-testid={`${testid}-edit`}><Icon name="edit" size={14} /></button>
                        <button type="button" className="icon-btn" title="Delete" aria-label={`Delete ${code}${r.systemDiffCode ? ` (${r.systemDiffCode})` : ''}`} onClick={() => askDelete(r)} disabled={busy} data-testid={`${testid}-delete`}><Icon name="trash" size={14} /></button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </div>
      <ShowMore shown={shown} total={flat.length} page={PAGE} noun="rows" testid={`${testid}-more`} onShown={setShown} />
      {!canWrite ? <span className="v2-hint">You can read the {noun} here. Changing it needs {noun === 'organisation defaults' ? 'a software administrator' : 'an editor, manager or owner of the project'}.</span> : null}

      {form ? (
        <RowForm key={form.mode === 'edit' ? form.row.id : 'new'} state={form} rules={data.rules} childCount={form.mode === 'edit' ? descendantsOf(data.rows, form.row).length : 0}
          error={formError} busy={busy} onSubmit={submit} onClose={close} />
      ) : null}

      {pending ? (
        <Modal title={`Change ${displayCode(pending.row)} and the rows below it?`} onClose={() => (busy ? undefined : setPending(null))} width={500} sticky buttons={<>
          <button className="btn" onClick={() => setPending(null)} disabled={busy} data-testid={`${testid}-cascade-cancel`}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => form && void persist(form, pending.body, true)} data-testid={`${testid}-cascade-confirm`}>{busy ? <Spinner /> : null}Change {plural(pending.count + 1, 'row')}</button>
        </>}>
          <div className="v2-stack" data-testid={`${testid}-cascade`}>
            <p style={{ margin: 0 }}>
              <strong data-testid={`${testid}-cascade-count`}>{plural(pending.count, 'row')}</strong> sit{pending.count === 1 ? 's' : ''} below {displayCode(pending.row)}{pending.row.systemDiffCode ? ` (difference code ${pending.row.systemDiffCode})` : ''}.
              Changing its code to <span className="v2-mono">{displayCode(pending.body)}</span> also changes the codes of {pending.count === 1 ? 'that row' : 'those rows'}, so that {pending.count === 1 ? 'it stays' : 'they stay'} under it. Their titles are not changed.
            </p>
            {pending.sample ? <p className="v2-hint" style={{ margin: 0 }}>{pending.sample}</p> : null}
            <p className="v2-hint" style={{ margin: 0 }}>Data modules keep the codes they carry; this changes the numbering system only.</p>
          </div>
        </Modal>
      ) : null}

      {del ? (
        <Modal title={`Delete ${displayCode(del.row)}?`} onClose={() => (busy ? undefined : setDel(null))} width={500} buttons={<>
          <button className="btn" onClick={() => setDel(null)} disabled={busy} data-testid={`${testid}-delete-cancel`}>Cancel</button>
          <button className="btn btn-primary" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }} disabled={busy} onClick={() => void doDelete()} data-testid={`${testid}-delete-confirm`}>{busy ? <Spinner /> : null}Delete {plural(del.kids.length + 1, 'row')}</button>
        </>}>
          <div className="v2-stack" data-testid={`${testid}-delete-dialog`}>
            <p style={{ margin: 0 }}><strong>{displayCode(del.row)}</strong> &ldquo;{del.row.title}&rdquo; is removed from the {noun}.</p>
            {del.kids.length ? (
              <Alert tone="warn"><span data-testid={`${testid}-delete-count`}>{plural(del.kids.length, 'row')}</span> below it {del.kids.length === 1 ? 'is' : 'are'} deleted with it ({sampleCodes(del.kids)}).</Alert>
            ) : <p className="v2-hint" style={{ margin: 0 }}>No rows sit below it.</p>}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function RowForm({ state, rules, childCount, error, busy, onSubmit, onClose }: {
  state: FormState; rules: SnsRules; childCount: number; error: string[]; busy: boolean; onSubmit: (body: SnsRowData) => void; onClose: () => void;
}) {
  const [f, setF] = useState<SnsRowData>(state.initial);
  const [touched, setTouched] = useState<Set<keyof SnsRowData>>(new Set());
  const errors: FormErrors = validateForm(f, rules.codes);
  const shownErrors: FormErrors = Object.fromEntries(Object.entries(errors).filter(([k]) => touched.has(k as keyof SnsRowData))) as FormErrors;
  const set = (key: keyof SnsRowData, v: string, max: number) => {
    setF((cur) => ({ ...cur, [key]: key === 'title' ? v : v.toUpperCase().slice(0, Math.max(max, 6)) }));
    setTouched((t) => new Set(t).add(key));
  };
  const body = rowBody(f);
  const renames = state.mode === 'edit' && childCount > 0 && changesNode(state.initial, body);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(new Set(['systemDiffCode', 'systemCode', 'subSystemCode', 'subSubSystemCode', 'assyCode', 'title']));
    if (!hasErrors(errors) && !busy) onSubmit(body);
  };
  const heading = state.mode === 'edit' ? `Edit ${displayCode(state.row)}` : state.parent ? `Add a row below ${displayCode(state.parent)}` : 'Add a row';
  return (
    <Modal title={heading} onClose={onClose} width={520} sticky buttons={<>
      <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="btn btn-primary" disabled={busy || hasErrors(errors)} onClick={submit} data-testid="sns-save">{busy ? <Spinner /> : null}{state.mode === 'edit' ? 'Save changes' : 'Add row'}</button>
    </>}>
      <form className="v2-stack" onSubmit={submit} noValidate data-testid="sns-form">
        {FIELDS.map((x) => (
          <Field key={x.key} label={x.label} error={shownErrors[x.key]} hint={rules.codes[x.key as keyof SnsRules['codes']]}>
            <input className="v2-input v2-mono" value={f[x.key]} onChange={(e) => set(x.key, e.target.value, x.max)} autoComplete="off" spellCheck={false}
              autoFocus={state.focus === x.key} aria-invalid={!!shownErrors[x.key]} data-testid={`sns-f-${x.key}`} />
          </Field>
        ))}
        <Field label="Title" error={shownErrors.title} hint={`At most ${TITLE_MAX} characters.`}>
          <input className="v2-input" value={f.title} onChange={(e) => set('title', e.target.value, TITLE_MAX)} maxLength={TITLE_MAX + 20} autoComplete="off"
            autoFocus={state.focus === 'title'} aria-invalid={!!shownErrors.title} data-testid="sns-f-title" />
        </Field>
        <div className="v2-hint" data-testid="sns-f-level">This row is a {LEVEL_LABEL[levelOf(body)].toLowerCase()}{body.systemCode ? ` (${displayCode(body)})` : ''}.</div>
        {renames ? <Alert tone="warn"><span data-testid="sns-f-renames">{plural(childCount, 'row')} sit{childCount === 1 ? 's' : ''} below this one. Changing its code changes theirs too; you are asked to confirm that next.</span></Alert> : null}
        {error.length ? <Alert tone="bad"><div data-testid="sns-form-error">{error.map((l, i) => <div key={i}>{l}</div>)}</div></Alert> : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
