// SNS > Import: bring rows in from the project's BREX data modules or from the organisation defaults.
//
//   Preview (nothing is written)  ->  read what is new, what is already there and what DIFFERS  ->  Apply
//
// A row that already exists with another title is never replaced on its own: it is listed under "Differs (kept)". The "Replace titles that differ"
// option is off by default and changes that line to "Differs (will be replaced)"; changing it after a preview makes the preview stale.
// The server answers an import with the rows to add, a COUNT of the rows already present, the conflicts and the rows it could not read.

import { useState, type ReactNode } from 'react';
import { defaultsRowsApi, snsApi, snsDefaultsApi, type ImportBody, type ImportResult } from '../../../api/sns';
import { Icon } from '../../../components/Icon';
import { CappedList, Section } from '../../../components/lists';
import { SnsRowsEditor } from '../../../components/SnsRows';
import { Alert, Badge, Loading, Modal, Spinner, errText, useAsync } from '../../../components/ui';
import { displayCode, groupMerge, importBody, mergeOutcome, plural } from '../../../lib/sns';
import { useUi } from '../../../store/ui';

function DefaultsView() {
  const data = useAsync(() => snsDefaultsApi.get(), []);
  if (data.loading && !data.data) return <Loading />;
  if (data.error || !data.data) return <Alert tone="bad">{data.error || 'Could not read the organisation defaults.'}</Alert>;
  return (
    <div className="v2-stack">
      <p className="v2-hint" style={{ margin: 0 }}>The organisation&rsquo;s default SNS, as every project can import it. A software administrator keeps it under Administrator &rsaquo; SNS defaults.</p>
      <SnsRowsEditor data={data.data} api={defaultsRowsApi} canWrite={false} reload={data.reload} testid="sns-defaults-ro" noun="organisation defaults" />
    </div>
  );
}

function ImportPanel({ kind, title, intro, run, onApplied }: {
  kind: 'brex' | 'defaults'; title: string; intro: ReactNode; run: (b: ImportBody) => Promise<ImportResult>; onApplied: () => void;
}) {
  const toast = useUi((s) => s.toast);
  const t = `sns-import-${kind}`;
  const [overwrite, setOverwrite] = useState(false);
  const [preview, setPreview] = useState<{ result: ImportResult; overwrite: boolean; no: number } | null>(null);
  const [busy, setBusy] = useState<'' | 'preview' | 'apply'>('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [count, setCount] = useState(0);

  const view = preview ? groupMerge(preview.result, preview.overwrite) : null;
  const stale = !!preview && preview.overwrite !== overwrite;

  const doPreview = async () => {
    setBusy('preview'); setError(''); setDone('');
    try { const result = await run(importBody(false, overwrite)); setCount((c) => c + 1); setPreview({ result, overwrite, no: count + 1 }); }
    catch (e) { setError(errText(e)); setPreview(null); } finally { setBusy(''); }
  };
  const doApply = async () => {
    if (!preview) return;
    setConfirm(false); setBusy('apply'); setError('');
    try {
      const result = await run(importBody(true, preview.overwrite));
      const text = mergeOutcome(result);
      setDone(text); setPreview(null); toast(text, 'success'); onApplied();
    } catch (e) { setError(errText(e)); } finally { setBusy(''); }
  };
  const apply = () => { if (view && view.replace > 0) setConfirm(true); else void doApply(); };

  return (
    <section className="v2-card v2-card-pad v2-stack" data-testid={t} aria-label={title}>
      <h3 style={{ margin: 0 }}>{title}</h3>
      <p className="v2-sub" style={{ margin: 0 }}>{intro}</p>
      <div className="v2-row" style={{ alignItems: 'flex-start', gap: 8 }}>
        <input type="checkbox" id={`${t}-ow`} checked={overwrite} disabled={!!busy} onChange={(e) => setOverwrite(e.target.checked)} aria-describedby={`${t}-ow-note`} data-testid={`${t}-overwrite`} style={{ marginTop: 3 }} />
        <div>
          <label htmlFor={`${t}-ow`}><strong>Replace titles that differ</strong></label>
          <div className="v2-hint" id={`${t}-ow-note`}>Off by default. A row that already exists with another title is left exactly as it is and listed under &ldquo;Differs (kept)&rdquo;. Tick this to replace those titles with the incoming ones.</div>
        </div>
      </div>
      <div className="v2-row wrap">
        <button type="button" className="btn" disabled={!!busy} onClick={() => void doPreview()} data-testid={`${t}-preview`}>{busy === 'preview' ? <Spinner /> : <Icon name="eye" size={14} />}Preview</button>
        <button type="button" className="btn btn-primary" disabled={!!busy || !view || stale || !view.canApply} onClick={apply} data-testid={`${t}-apply`}>{busy === 'apply' ? <Spinner /> : null}Apply</button>
        {stale ? <span className="v2-hint" data-testid={`${t}-stale`}>The option changed after the preview: preview again before applying.</span> : null}
        {!preview && !done ? <span className="v2-hint">Preview writes nothing.</span> : null}
      </div>
      {error ? <Alert tone="bad"><span data-testid={`${t}-error`}>{error}</span></Alert> : null}
      {done ? <Alert tone="ok"><span data-testid={`${t}-done`}>{done}</span></Alert> : null}

      {preview && view ? (
        <div className="v2-stack" key={preview.no} data-testid={`${t}-result`} data-applied={preview.result.applied ? '1' : '0'}>
          <div className="v2-tiles">
            <div className="v2-tile"><b data-testid={`${t}-n-add`}>{view.add.length}</b><span>Will add</span></div>
            <div className="v2-tile"><b data-testid={`${t}-n-same`}>{view.same}</b><span>Already present</span></div>
            <div className="v2-tile"><b data-testid={`${t}-n-differs`}>{view.differs.length}</b><span>{preview.overwrite ? 'Differ (replaced)' : 'Differ (kept)'}</span></div>
            {view.rejected.length ? <div className="v2-tile"><b data-testid={`${t}-n-rejected`}>{view.rejected.length}</b><span>Not valid</span></div> : null}
          </div>

          {kind === 'brex' ? (
            <div className="v2-stack" style={{ gap: 6 }} data-testid={`${t}-sources`}>
              {preview.result.sources?.length
                ? <div className="v2-hint">Read from {plural(preview.result.sources.length, 'BREX data module')}: <span className="v2-mono">{preview.result.sources.join(', ')}</span></div>
                : <Alert tone="warn">No BREX data module with SNS rules was found in this project.</Alert>}
              {preview.result.notes?.length ? <ul className="v2-list" data-testid={`${t}-notes`}>{preview.result.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}
              {preview.result.unreadable?.length ? (
                <Section title="Entries of the BREX that are not valid SNS codes" count={preview.result.unreadable.length} tone="warn" testid={`${t}-unreadable`}>
                  <CappedList items={preview.result.unreadable} initial={25} noun="entries" render={(u) => <><span className="v2-mono">{u.path}</span><span className="v2-error">{u.errors.join(' ')}</span></>} />
                </Section>
              ) : null}
            </div>
          ) : null}

          <Section title="Will add" count={view.add.length} tone={view.add.length ? 'ok' : undefined} defaultOpen={view.add.length > 0} testid={`${t}-add`}>
            <CappedList items={view.add} initial={25} noun="rows" testid={`${t}-add-list`} empty={<span className="v2-hint">Nothing new: every row is already in this project.</span>}
              render={(r) => <><span className="v2-mono" style={{ minWidth: 90 }}>{displayCode(r)}</span>{r.systemDiffCode ? <Badge>{r.systemDiffCode}</Badge> : null}<span>{r.title}</span></>} />
          </Section>
          <Section title="Already present" count={view.same} testid={`${t}-same`}>
            <span className="v2-hint">{plural(view.same, 'row')} {view.same === 1 ? 'is' : 'are'} already in this project with the same title. Nothing is done for {view.same === 1 ? 'it' : 'them'}.</span>
            {view.present.length ? (
              <CappedList items={view.present} initial={25} noun="rows" testid={`${t}-same-list`}
                render={(p) => <span data-testid={`${t}-same-row`} data-code={p.code}><span className="v2-mono" style={{ display: 'inline-block', minWidth: 90 }}>{p.code}</span>{p.title}</span>} />
            ) : null}
          </Section>
          <Section title={preview.overwrite ? 'Differs (will be replaced)' : 'Differs (kept)'} count={view.differs.length} tone={view.differs.length ? 'warn' : undefined} defaultOpen={view.differs.length > 0} testid={`${t}-differs`}>
            <CappedList items={view.differs} initial={25} noun="rows" testid={`${t}-differs-list`} empty={<span className="v2-hint">No row differs.</span>}
              render={(c) => (
                <div style={{ width: '100%' }} data-testid={`${t}-differs-row`} data-code={c.code}>
                  <span className="v2-mono">{c.code}</span>{c.caseOnly ? <> <Badge>capitals only</Badge></> : null}
                  <div className="v2-hint">In this project: &ldquo;{c.existing}&rdquo;</div>
                  <div className="v2-hint">{preview.overwrite ? 'Will become' : 'Incoming, not applied'}: &ldquo;{c.incoming}&rdquo;</div>
                </div>
              )} />
          </Section>
          {view.rejected.length ? (
            <Section title="Not valid, will not be added" count={view.rejected.length} tone="bad" testid={`${t}-rejected`}>
              <CappedList items={view.rejected} initial={25} noun="entries" render={(r) => <><span className="v2-mono">{r.code || `#${r.index + 1}`}</span><span className="v2-error">{r.errors.join(' ')}</span></>} />
            </Section>
          ) : null}
          {!view.canApply ? <Alert><span data-testid={`${t}-nothing`}>Nothing to apply{view.differs.length && !preview.overwrite ? ': the rows that differ are kept as they are' : ''}.</span></Alert> : null}
        </div>
      ) : null}

      {confirm && view ? (
        <Modal title={`Replace ${plural(view.replace, 'title')}?`} onClose={() => setConfirm(false)} width={480} buttons={<>
          <button className="btn" onClick={() => setConfirm(false)} data-testid={`${t}-confirm-cancel`}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void doApply()} data-testid={`${t}-confirm`}>Add {plural(view.add.length, 'row')} and replace {plural(view.replace, 'title')}</button>
        </>}>
          <p style={{ marginTop: 0 }}>{plural(view.replace, 'row')} already {view.replace === 1 ? 'has' : 'have'} another title in this project. Applying replaces {view.replace === 1 ? 'it' : 'them'} with the incoming {view.replace === 1 ? 'title' : 'titles'}. What was written there is lost.</p>
        </Modal>
      ) : null}
    </section>
  );
}

export function SnsImportTab({ projectId, may, onApplied }: { projectId: string; may: boolean; onApplied: () => void }) {
  return (
    <div className="v2-stack" data-testid="sns-import">
      {may ? (
        <>
          <ImportPanel kind="brex" title="Import from the BREX" run={(b) => snsApi.importBrex(projectId, b)} onApplied={onApplied}
            intro="Reads the SNS rules of the BREX data modules in this project: the numbering the project's own rules define. Preview shows what it holds before anything is added." />
          <ImportPanel kind="defaults" title="Import from the organisation defaults" run={(b) => snsApi.importDefaults(projectId, b)} onApplied={onApplied}
            intro="Copies the organisation's default SNS into this project. Rows the project already has are left as they are." />
        </>
      ) : <Alert tone="warn"><span data-testid="sns-import-readonly">Only an editor, manager or owner of the project can import rows.</span></Alert>}
      <Section title="Organisation defaults" testid="sns-defaults-view"><DefaultsView /></Section>
    </div>
  );
}
