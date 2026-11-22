// Generate a configuration-specific publication: choose a product (from the project's PCT) and/or values for its product attributes and conditions,
// check what that configuration includes, and build a separate PDF. The unfiltered publication (Generate) is not affected.
import { useMemo, useState } from 'react';
import { ApiError } from '../../../api/client';
import { s1000dApi, type ConfigInput, type ConfigPlan } from '../../../api';
import { Alert, Badge, Empty, Field, Loading, Modal, Spinner, errText, ago, useAsync } from '../../../components/ui';

export function ConfigurationDialog({ id, onClose, onBuilt }: { id: string; onClose: () => void; onBuilt: (url: string, label: string, note: string) => void }) {
  const choices = useAsync(() => s1000dApi.configurations(id), [id]);
  const [product, setProduct] = useState('');
  const [vals, setVals] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<ConfigPlan | null>(null);
  const [busy, setBusy] = useState<'' | 'check' | 'build'>('');
  const [err, setErr] = useState('');
  const c = choices.data;
  const input = (): ConfigInput => ({ ...(product ? { productId: product } : {}), values: Object.entries(vals).filter(([, v]) => v.trim()).map(([ident, value]) => ({ ident, value: value.trim() })) });
  const props = useMemo(() => [...(c?.attributes ?? []).map((a) => ({ ...a, kind: 'Attribute' })), ...(c?.conditions ?? []).map((x) => ({ ...x, pattern: null, kind: 'Condition' }))], [c]);
  const fromProduct = (ident: string) => c?.products.find((p) => p.id === product)?.assigns.find((a) => a.ident === ident)?.value;
  const nothing = !product && !Object.values(vals).some((v) => v.trim());

  const check = async () => {
    setBusy('check'); setErr(''); setPlan(null);
    try { setPlan(await s1000dApi.planConfigured(id, input())); } catch (e) { setErr(errText(e)); } finally { setBusy(''); }
  };
  const build = async () => {
    setBusy('build'); setErr('');
    try {
      const out = await s1000dApi.buildConfigured(id, input());
      onBuilt(`${s1000dApi.configuredUrl(id, out.name)}?t=${Date.now()}`, `Configuration · ${out.plan.label}`, `${out.plan.included} data module(s) apply, ${out.plan.excluded.length} left out, ${out.plan.elementsRemoved} element(s) removed · ${out.name}`);
      onClose();
    } catch (e) {
      const b = e instanceof ApiError ? (e.body as { code?: string; unresolved?: ConfigPlan['unresolved']; properties?: string[] } | undefined) : undefined;
      if (b?.code === 'APPLICABILITY_UNRESOLVED') setPlan({ label: '', values: [], excluded: [], canBuild: false, properties: b.properties ?? [], summary: { included: 0, excluded: 0, elementsRemoved: 0, entriesRemoved: 0, entriesLeft: 0 }, unresolved: b.unresolved ?? [] });
      setErr(errText(e));
    } finally { setBusy(''); }
  };

  return (
    <Modal title="Publish for a configuration" onClose={onClose} width={720} buttons={<>
      <button className="btn" onClick={onClose}>Close</button>
      <button className="btn" onClick={check} disabled={!!busy || nothing} data-testid="cfg-check">{busy === 'check' ? <Spinner /> : null}Check</button>
      <button className="btn btn-primary" onClick={build} disabled={!!busy || nothing} data-testid="cfg-build">{busy === 'build' ? <Spinner /> : null}Generate PDF</button>
    </>}>
      {choices.loading && !c ? <Loading /> : !c ? <Alert tone="bad">{choices.error}</Alert> : !props.length ? (
        <Empty title="This project has no applicability definitions">Define product attributes and conditions under Project settings → S1000D → Applicability first.</Empty>
      ) : (
        <div className="v2-stack" data-testid="cfg-dialog">
          <p className="v2-hint" style={{ margin: 0 }}>{c.note} Content that is not marked with applicability is always included. A property you give no value for is <b>unresolved</b>: if it decides what is included, the PDF is not built.</p>
          <Field label="Product" hint="A product defined in the project's products table (PCT). Values below override the product's.">
            <select className="v2-select" value={product} onChange={(e) => { setProduct(e.target.value); setPlan(null); }} data-testid="cfg-product">
              <option value="">(none: choose values below)</option>{c.products.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
            </select>
          </Field>
          <div className="v2-card"><table className="v2-table"><thead><tr><th>Property</th><th style={{ width: '45%' }}>Value</th></tr></thead><tbody>
            {props.map((p) => (
              <tr key={p.id}><td><b>{p.name}</b> <span className="v2-hint v2-mono">{p.id}</span> <span className="v2-hint">({p.kind.toLowerCase()})</span></td><td>
                {p.values.length ? (
                  <select className="v2-select" value={vals[p.id] ?? ''} aria-label={`Value of ${p.name}`} onChange={(e) => { setVals({ ...vals, [p.id]: e.target.value }); setPlan(null); }}>
                    <option value="">{fromProduct(p.id) ? `${fromProduct(p.id)} (from the product)` : '(no value)'}</option>{p.values.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                ) : (
                  <input className="v2-input" value={vals[p.id] ?? ''} aria-label={`Value of ${p.name}`} placeholder={fromProduct(p.id) ? `${fromProduct(p.id)} (from the product)` : p.type === 'integer' ? 'a number' : 'a value'} onChange={(e) => { setVals({ ...vals, [p.id]: e.target.value }); setPlan(null); }} />
                )}</td></tr>))}</tbody></table></div>
          {err ? <Alert tone="bad"><span style={{ whiteSpace: 'pre-wrap' }}>{err}</span></Alert> : null}
          {plan ? (
            <div className="v2-card v2-card-pad v2-stack" data-testid="cfg-plan" style={{ gap: 6 }}>
              {plan.canBuild ? <Alert tone="ok">This configuration can be published.</Alert> : plan.unresolved.length ? <Alert tone="warn"><b>Unresolved:</b> no value for {plan.properties.map((p) => `“${p}”`).join(', ')}. It decides what is included, so the PDF is not built until you give one.</Alert> : <Alert tone="warn">Nothing applies to this configuration.</Alert>}
              <div>{plan.summary.included} data module(s) included · {plan.summary.excluded} left out · {plan.summary.elementsRemoved} element(s) removed · {plan.summary.entriesRemoved} publication entr{plan.summary.entriesRemoved === 1 ? 'y' : 'ies'} removed, {plan.summary.entriesLeft} left</div>
              {plan.excluded.length ? <details><summary>Left out ({plan.excluded.length})</summary><ul style={{ margin: 0, paddingLeft: 18 }}>{plan.excluded.map((f) => <li key={f} className="v2-mono">{f}</li>)}</ul></details> : null}
              {plan.unresolved.length ? <details open><summary>Where it matters ({plan.unresolved.length})</summary><table className="v2-table"><tbody>{plan.unresolved.slice(0, 20).map((u, i) => <tr key={i}><td className="v2-mono">{u.file}</td><td>line {u.line}</td><td>{u.what}</td><td>{u.properties.join(', ')}</td></tr>)}</tbody></table></details> : null}
            </div>
          ) : null}
          {c.builds.length ? (
            <div><h4 style={{ margin: '4px 0' }}>Built configuration PDFs</h4><ul style={{ margin: 0, paddingLeft: 18 }}>
              {c.builds.slice(0, 8).map((b) => <li key={b.file}><a href={s1000dApi.configuredUrl(id, b.name, true)} download>{b.name}</a> <Badge>{ago(b.builtAt)}</Badge></li>)}</ul></div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
