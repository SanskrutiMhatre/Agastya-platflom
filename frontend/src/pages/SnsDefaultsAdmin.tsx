// Administrator > S1000D > SNS defaults: the organisation's default Standard Numbering System.
//
// Every signed-in user can read these rows (a project's SNS tab shows them read-only and can import them); only a software administrator changes
// them, here. Changing the defaults never changes a project that has already imported rows: a project keeps its own copy.
// The older two-column "SNS" table is retired (the SNS presets replaced it). An upgraded installation may still hold rows in it: the defaults were filled
// from them once, the first time they were read, and "Merge the older table" below brings in any others - preview first, and nothing is replaced: a code
// that is in both with different titles is listed and kept.

import { useState } from 'react';
import { defaultsRowsApi, snsDefaultsApi, type ImportResult } from '../api/sns';
import { SnsRowsEditor } from '../components/SnsRows';
import { CappedList, Section } from '../components/lists';
import { Alert, Badge, Loading, Spinner, errText, useAsync } from '../components/ui';
import { displayCode, groupMerge, mergeOutcome, plural } from '../lib/sns';
import { canEditSnsDefaults } from '../lib/roles';
import { useSession } from '../store/session';
import { useUi } from '../store/ui';

function MergeLegacy({ onApplied }: { onApplied: () => void }) {
  const toast = useUi((s) => s.toast);
  const [busy, setBusy] = useState<'' | 'preview' | 'apply'>('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<(ImportResult & { legacy: number }) | null>(null);
  const [done, setDone] = useState('');

  const run = async (apply: boolean) => {
    setBusy(apply ? 'apply' : 'preview'); setError(''); if (apply) setDone('');
    try {
      const r = await snsDefaultsApi.mergeLegacy({ apply, overwrite: false });
      if (apply) { const text = mergeOutcome(r); setDone(text); setResult(null); toast(text, 'success'); onApplied(); } else setResult(r);
    } catch (e) { setError(errText(e)); if (!apply) setResult(null); } finally { setBusy(''); }
  };

  const view = result ? groupMerge(result, false) : null;
  return (
    <section className="v2-card v2-card-pad v2-stack" data-testid="sns-defaults-legacy" aria-label="Merge the older SNS table">
      <h4 style={{ margin: 0 }}>Merge the older SNS table</h4>
      <p className="v2-sub" style={{ margin: 0 }}>Adds the codes of the older two-column table that are not in these defaults yet. A code that is in both with different titles is listed and kept as it is here.</p>
      <div className="v2-row wrap">
        <button type="button" className="btn" disabled={!!busy} onClick={() => void run(false)} data-testid="sns-defaults-legacy-preview">{busy === 'preview' ? <Spinner /> : null}Preview</button>
        <button type="button" className="btn btn-primary" disabled={!!busy || !view || !view.canApply} onClick={() => void run(true)} data-testid="sns-defaults-legacy-apply">{busy === 'apply' ? <Spinner /> : null}Add {view ? plural(view.add.length, 'row') : 'rows'}</button>
      </div>
      {error ? <Alert tone="bad"><span data-testid="sns-defaults-legacy-error">{error}</span></Alert> : null}
      {done ? <Alert tone="ok"><span data-testid="sns-defaults-legacy-done">{done}</span></Alert> : null}
      {result && view ? (
        <div className="v2-stack" data-testid="sns-defaults-legacy-result">
          <div className="v2-hint">The older table has {plural(result.legacy, 'row')}: <b data-testid="sns-defaults-legacy-n-add">{view.add.length}</b> to add, <b data-testid="sns-defaults-legacy-n-same">{view.same}</b> already here, <b data-testid="sns-defaults-legacy-n-differs">{view.differs.length}</b> with a different title (kept).</div>
          <Section title="Will add" count={view.add.length} tone={view.add.length ? 'ok' : undefined} defaultOpen={view.add.length > 0} testid="sns-defaults-legacy-add">
            <CappedList items={view.add} initial={25} noun="rows" empty={<span className="v2-hint">Nothing new: every code is already in the defaults.</span>}
              render={(r) => <><span className="v2-mono" style={{ minWidth: 90 }}>{displayCode(r)}</span><span>{r.title}</span></>} />
          </Section>
          <Section title="Differs (kept)" count={view.differs.length} tone={view.differs.length ? 'warn' : undefined} defaultOpen={view.differs.length > 0} testid="sns-defaults-legacy-differs">
            <CappedList items={view.differs} initial={25} noun="rows" empty={<span className="v2-hint">No title differs.</span>}
              render={(c) => (
                <div style={{ width: '100%' }}>
                  <span className="v2-mono">{c.code}</span>{c.caseOnly ? <> <Badge>capitals only</Badge></> : null}
                  <div className="v2-hint">In the defaults: &ldquo;{c.existing}&rdquo;</div>
                  <div className="v2-hint">In the older table, not applied: &ldquo;{c.incoming}&rdquo;</div>
                </div>
              )} />
          </Section>
        </div>
      ) : null}
    </section>
  );
}

export function SnsDefaultsAdmin() {
  const me = useSession((s) => s.user);
  const data = useAsync(() => snsDefaultsApi.get(), []);
  const may = canEditSnsDefaults(me);
  if (data.loading && !data.data) return <Loading />;
  if (data.error || !data.data) return <Alert tone="bad">{data.error || 'Could not read the SNS defaults.'}</Alert>;
  return (
    <div className="v2-stack" data-testid="sns-defaults-admin">
      <div>
        <h3 style={{ margin: 0 }}>SNS defaults</h3>
        <p className="v2-sub" style={{ margin: '2px 0 0' }}>
          The organisation&rsquo;s default Standard Numbering System: systems, sub-systems, sub-sub-systems and assemblies. A project can import these rows from its SNS settings.
          Changing them here does not change a project that has already imported them.
        </p>
      </div>
      <Alert><span className="v2-hint" style={{ color: 'inherit' }}>These defaults are separate from the <strong>Numbering (SNS)</strong> presets that a new S1000D project starts from. The older two-column SNS table was retired; use &ldquo;Merge the older SNS table&rdquo; below to bring in rows an upgraded installation still holds in it.</span></Alert>
      {!may ? <Alert tone="warn">Only a software administrator can change the defaults.</Alert> : null}
      <SnsRowsEditor data={data.data} api={defaultsRowsApi} canWrite={may} reload={data.reload} testid="sns-defaults" noun="organisation defaults" />
      {may ? <MergeLegacy onApplied={data.reload} /> : null}
    </div>
  );
}
