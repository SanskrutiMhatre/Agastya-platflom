// SNS > Ordering: how the modules of one SNS node are ordered when the publication structure is derived.
//
// Edited here, because each part is simple and checked: the ORDER of the sort keys (all of them stay, none can repeat), the information codes that go
// FIRST or LAST, and a rank for single information codes (lower sorts earlier, ahead of the group the code is in).
// Shown read-only, not edited: the table of information-code groups. The server stores a group table as a whole and does not validate it, so a
// project that already has one keeps it exactly as it is, and a project without one uses the standard table below.

import { useState } from 'react';
import { snsApi, type OrderingInfo } from '../../../api/sns';
import { Icon } from '../../../components/Icon';
import { Alert, Badge, Field, Loading, Spinner, errText, useAsync } from '../../../components/ui';
import { ORDER_KEY_LABEL, buildOrder, moveKey, orderFormFrom, sameOrder, type OrderForm } from '../../../lib/sns';
import { useUi } from '../../../store/ui';

function Groups({ info }: { info: OrderingInfo }) {
  const own = info.override?.groups;
  const groups = own?.length ? own : info.groups;
  return (
    <div className="v2-stack" style={{ gap: 6 }} data-testid="sns-order-groups">
      <h4 style={{ margin: 0 }}>Information-code groups, in book order</h4>
      <p className="v2-hint" style={{ margin: 0 }}>{own?.length ? 'This project has its own group table (set through the API). It is shown as it is and kept when you save.' : 'The standard table. It is not edited here.'}</p>
      <div className="v2-card"><table className="v2-table"><thead><tr><th>#</th><th>Group</th><th>Codes</th><th>What it holds</th></tr></thead>
        <tbody>{groups.map((g, i) => <tr key={g.id}><td>{i + 1}</td><td className="v2-mono">{g.id}</td><td className="v2-mono">{g.from}&ndash;{g.to}</td><td>{g.label}</td></tr>)}</tbody></table></div>
    </div>
  );
}

function Editor({ projectId, info, may, onSaved }: { projectId: string; info: OrderingInfo; may: boolean; onSaved: (i: OrderingInfo) => void }) {
  const toast = useUi((s) => s.toast);
  const [form, setForm] = useState<OrderForm>(() => orderFormFrom(info));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const built = buildOrder(form, info.keys, info.override);
  const dirty = !sameOrder(built.order, info.override) || built.errors.length > 0;

  const save = async (order: typeof built.order, message: string) => {
    setBusy(true); setError('');
    try { const next = await snsApi.setOrdering(projectId, order); onSaved(next); setForm(orderFormFrom(next)); toast(message, 'success'); }
    catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  return (
    <div className="v2-stack" data-testid="sns-ordering">
      {!may ? <Alert tone="warn"><span data-testid="sns-order-readonly">Only an editor, manager or owner of the project can change the ordering. It is shown here as it is.</span></Alert> : null}
      <section className="v2-card v2-card-pad v2-stack">
        <h3 style={{ margin: 0 }}>Ordering of modules inside a node</h3>
        <p className="v2-sub" style={{ margin: 0 }}>{info.override ? 'This project has its own ordering.' : 'This project uses the standard ordering.'} The sort keys apply in the order listed: the first decides, the next breaks a tie.</p>
        <ol className="v2-list" style={{ listStyle: 'none' }} data-testid="sns-order-keys">
          {form.keys.map((k, i) => (
            <li key={k} data-testid="sns-order-key" data-key={k}>
              <span className="v2-badge">{i + 1}</span>
              <span style={{ flex: 1 }}>{ORDER_KEY_LABEL[k]}</span>
              {may ? (
                <span className="v2-row" style={{ gap: 2 }}>
                  <button type="button" className="icon-btn" aria-label={`Move ${ORDER_KEY_LABEL[k]} earlier`} disabled={busy || i === 0} onClick={() => setForm({ ...form, keys: moveKey(form.keys, i, -1) })} data-testid="sns-order-up"><Icon name="up" size={14} /></button>
                  <button type="button" className="icon-btn" aria-label={`Move ${ORDER_KEY_LABEL[k]} later`} disabled={busy || i === form.keys.length - 1} onClick={() => setForm({ ...form, keys: moveKey(form.keys, i, 1) })} data-testid="sns-order-down"><Icon name="down" size={14} /></button>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
        <div className="v2-grid cols-2">
          <Field label="Information codes that go first" hint="Three-character codes, in the order they should come, separated by commas or spaces. For example 018, 040.">
            <input className="v2-input v2-mono" value={form.pinFirst} onChange={(e) => setForm({ ...form, pinFirst: e.target.value })} disabled={!may || busy} data-testid="sns-order-pin-first" />
          </Field>
          <Field label="Information codes that go last" hint="The same, placed after everything else.">
            <input className="v2-input v2-mono" value={form.pinLast} onChange={(e) => setForm({ ...form, pinLast: e.target.value })} disabled={!may || busy} data-testid="sns-order-pin-last" />
          </Field>
        </div>
        <Field label="Rank of single information codes" hint="One per line: the code, =, a whole number. Lower sorts earlier and beats the code's group. For example 720 = -1 puts 720 ahead of its group.">
          <textarea className="v2-textarea" rows={3} style={{ height: 'auto', padding: '6px 10px', fontFamily: 'var(--font-mono)' }} value={form.rank} onChange={(e) => setForm({ ...form, rank: e.target.value })} disabled={!may || busy} data-testid="sns-order-rank" />
        </Field>
        {built.errors.length ? <Alert tone="bad"><div data-testid="sns-order-errors">{built.errors.map((m, i) => <div key={i}>{m}</div>)}</div></Alert> : null}
        {error ? <Alert tone="bad"><span data-testid="sns-order-error">{error}</span></Alert> : null}
        {may ? (
          <div className="v2-row wrap">
            <button type="button" className="btn btn-primary" disabled={busy || !dirty || built.errors.length > 0} onClick={() => void save(built.order, built.order ? 'Ordering saved' : 'Ordering set to the standard')} data-testid="sns-order-save">{busy ? <Spinner /> : null}Save ordering</button>
            {info.override ? <button type="button" className="btn" disabled={busy} onClick={() => void save(null, 'Ordering reset to the standard')} data-testid="sns-order-reset">Reset to the standard ordering</button> : null}
            {dirty && !built.errors.length ? <span className="v2-hint">Not saved yet.</span> : null}
          </div>
        ) : null}
        {info.override ? <div className="v2-row wrap"><Badge tone="accent">Project ordering in force</Badge></div> : null}
      </section>
      <Groups info={info} />
      <p className="v2-hint" style={{ margin: 0 }}>{info.note}</p>
    </div>
  );
}

export function SnsOrderingTab({ projectId, may }: { projectId: string; may: boolean }) {
  const info = useAsync(() => snsApi.ordering(projectId), [projectId]);
  if (info.loading && !info.data) return <Loading />;
  if (info.error || !info.data) return <Alert tone="bad">{info.error || 'Could not read the ordering.'}</Alert>;
  return <Editor key={JSON.stringify(info.data.override)} projectId={projectId} info={info.data} may={may} onSaved={(i) => info.set(i)} />;
}
