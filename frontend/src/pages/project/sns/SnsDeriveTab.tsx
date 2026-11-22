// SNS > Derive structure: arrange the project's data modules into the publication structure (system > sub-system > sub-sub-system > assembly > modules)
// that the SNS describes.
//
//   choose the source and the options -> Preview (writes nothing: the structure, the hints, how many entries) -> Apply, after a confirmation
//
// Apply changes the publication module. With placement "replace" the whole structure is replaced (the previous file is kept as a backup); with "unplaced"
// only the modules no chapter places yet are appended. A preview is only good for the options it was made with: change one and it must be made again.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { snsApi, type DeriveResult } from '../../../api/sns';
import { Icon } from '../../../components/Icon';
import { CappedList, Section } from '../../../components/lists';
import { Alert, Field, Modal, Spinner, errText } from '../../../components/ui';
import { useProject } from '../../../layouts/ProjectShell';
import {
  DEFAULT_DERIVE, SOURCE_LABEL, deriveBody, deriveConfirmation, deriveSignature, plural, structureTiles, type DeriveOptions,
} from '../../../lib/sns';
import { useUi } from '../../../store/ui';
import { StructureView } from './StructureView';

export function SnsDeriveTab({ projectId, may }: { projectId: string; may: boolean }) {
  const toast = useUi((s) => s.toast);
  const { reload } = useProject();
  const [o, setO] = useState<DeriveOptions>(DEFAULT_DERIVE);
  const [preview, setPreview] = useState<{ result: DeriveResult; sig: string; opts: DeriveOptions } | null>(null);
  const [applied, setApplied] = useState<DeriveResult | null>(null);
  const [busy, setBusy] = useState<'' | 'preview' | 'apply'>('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);

  if (!may) return <Alert tone="warn"><span data-testid="sns-derive-readonly">Only an editor, manager or owner of the project can derive its publication structure.</span></Alert>;

  const set = <K extends keyof DeriveOptions>(k: K, v: DeriveOptions[K]) => setO((cur) => ({ ...cur, [k]: v }));
  const stale = !!preview && preview.sig !== deriveSignature(o);

  const doPreview = async () => {
    setBusy('preview'); setError(''); setApplied(null);
    try { const result = await snsApi.derive(projectId, deriveBody(o, false)); setPreview({ result, sig: deriveSignature(o), opts: o }); }
    catch (e) { setError(errText(e)); setPreview(null); } finally { setBusy(''); }
  };
  const doApply = async () => {
    if (!preview) return;
    setConfirm(false); setBusy('apply'); setError('');
    try {
      const result = await snsApi.derive(projectId, deriveBody(preview.opts, true));
      setApplied(result); setPreview(null);
      toast(`Publication structure written: ${plural(result.counts?.dms ?? 0, 'data module')}`, 'success');
      reload();
    } catch (e) { setError(errText(e)); } finally { setBusy(''); }
  };

  const r = preview?.result;
  const confirmation = preview ? deriveConfirmation(preview.opts, preview.result) : null;
  const t = 'sns-derive';
  return (
    <div className="v2-stack" data-testid="sns-derive">
      <section className="v2-card v2-card-pad v2-stack">
        <h3 style={{ margin: 0 }}>Derive the publication structure</h3>
        <p className="v2-sub" style={{ margin: 0 }}>
          Places every data module under the system, sub-system and assembly its code names, titled from the SNS. The order of the modules inside a node follows this project&rsquo;s
          ordering (the Ordering section). Preview shows the result without changing anything.
        </p>
        <div className="v2-grid cols-2">
          <Field label="Take the SNS from">
            <select className="v2-select" value={o.sns} onChange={(e) => set('sns', e.target.value as DeriveOptions['sns'])} disabled={!!busy} data-testid={`${t}-source`}>
              {(['project', 'defaults', 'merged'] as const).map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label="Placement" hint={o.placement === 'replace' ? 'The derived structure becomes the publication: what is arranged there now is replaced.' : 'The existing publication is kept; modules no chapter places yet are appended to it.'}>
            <select className="v2-select" value={o.placement} onChange={(e) => set('placement', e.target.value as DeriveOptions['placement'])} disabled={!!busy} data-testid={`${t}-placement`}>
              <option value="replace">Replace the publication structure</option>
              <option value="unplaced">Add only the modules not placed yet</option>
            </select>
          </Field>
          <Field label="A module that names a level the SNS does not define">
            <select className="v2-select" value={o.unmatched} onChange={(e) => set('unmatched', e.target.value as DeriveOptions['unmatched'])} disabled={!!busy} data-testid={`${t}-unmatched`}>
              <option value="deepest">Hang it under the deepest level that is defined</option>
              <option value="unclassified">Put it under the Unclassified chapter</option>
            </select>
          </Field>
          <Field label="Title of the Unclassified chapter">
            <input className="v2-input" value={o.unclassifiedTitle} maxLength={120} onChange={(e) => set('unclassifiedTitle', e.target.value)} disabled={!!busy} data-testid={`${t}-unclassified-title`} />
          </Field>
          <Field label="Chapter titles">
            <select className="v2-select" value={o.titleFormat} onChange={(e) => set('titleFormat', e.target.value as DeriveOptions['titleFormat'])} disabled={!!busy} data-testid={`${t}-title-format`}>
              <option value="title">The SNS title (Landing gear)</option>
              <option value="code-title">Code and title (32 - Landing gear)</option>
            </select>
          </Field>
          <Field label="Publication title" hint="Used only when the project has no publication module yet; an existing one keeps its title.">
            <input className="v2-input" value={o.pmTitle} maxLength={200} onChange={(e) => set('pmTitle', e.target.value)} disabled={!!busy} data-testid={`${t}-pm-title`} />
          </Field>
        </div>
        <label className="v2-row" style={{ gap: 6 }}><input type="checkbox" checked={o.collapseZero} onChange={(e) => set('collapseZero', e.target.checked)} disabled={!!busy} data-testid={`${t}-collapse-zero`} />A zero code (0, 00) means the level itself: modules sit directly in the level above</label>
        <label className="v2-row" style={{ gap: 6 }}><input type="checkbox" checked={o.excludeFrontMatter} onChange={(e) => set('excludeFrontMatter', e.target.checked)} disabled={!!busy} data-testid={`${t}-exclude-front`} />Leave out the front-matter modules the generator wrote or the importer consumed</label>
        <div className="v2-row wrap">
          <button type="button" className="btn" disabled={!!busy} onClick={() => void doPreview()} data-testid={`${t}-preview`}>{busy === 'preview' ? <Spinner /> : <Icon name="eye" size={14} />}Preview</button>
          <button type="button" className="btn btn-primary" disabled={!!busy || !preview || stale} onClick={() => setConfirm(true)} data-testid={`${t}-apply`}>{busy === 'apply' ? <Spinner /> : null}Apply to the publication…</button>
          {stale ? <span className="v2-hint" data-testid={`${t}-stale`}>An option changed after the preview: preview again before applying.</span> : <span className="v2-hint">Preview writes nothing.</span>}
        </div>
        {error ? <Alert tone="bad"><span data-testid={`${t}-error`}>{error}</span></Alert> : null}
      </section>

      {applied ? (
        <Alert tone="ok">
          <span data-testid={`${t}-done`}>
            The publication structure was written: {applied.counts ? `${plural(applied.counts.folders, 'chapter')} and ${plural(applied.counts.dms, 'data module')}` : 'done'}.
            {applied.backup ? ` The previous publication module was kept as ${applied.backup}.` : ' There was no publication module before, so nothing was backed up.'}{' '}
            <Link to={`/projects/${projectId}/publication`}>Open the Publication page</Link>
          </span>
        </Alert>
      ) : null}

      {r ? (
        <section className="v2-card v2-card-pad v2-stack" data-testid={`${t}-result`}>
          <h3 style={{ margin: 0 }}>Preview</h3>
          <div className="v2-tiles">{structureTiles(r.structure, r).map((x) => <div className="v2-tile" key={x.key}><b data-testid={`${t}-n-${x.key}`}>{x.value}</b><span>{x.label}</span></div>)}</div>
          <span className="v2-hint" data-testid={`${t}-header`}>{r.pm.headerFrom === 'existing' ? 'The publication keeps the title and codes it has.' : 'The project has no publication module: a header is generated.'}</span>
          {r.hints.map((h, i) => <Alert key={`h${i}`} tone="warn"><span data-testid={`${t}-hint`}>{h}</span></Alert>)}
          {r.structure.warnings.map((w, i) => <Alert key={`w${i}`}><span data-testid={`${t}-warning`}>{w}</span></Alert>)}
          <Section title="Structure" count={plural(r.structure.counts.dms, 'data module')} defaultOpen testid={`${t}-structure`}>
            {r.structure.roots.length ? <StructureView roots={r.structure.roots} /> : <span className="v2-hint">Nothing would be placed.</span>}
          </Section>
          {r.structure.superseded.length ? (
            <Section title="Older issues left out" count={r.structure.superseded.length} testid={`${t}-superseded`}>
              <p className="v2-hint" style={{ marginTop: 0 }}>Only the newest issue of a data module is placed.</p>
              <CappedList items={r.structure.superseded} initial={25} noun="files" render={(s) => <><span className="v2-mono">{s.file}</span><span className="v2-hint">replaced by {s.supersededBy}</span></>} />
            </Section>
          ) : null}
          {r.structure.skipped.length ? (
            <Section title="Skipped" count={r.structure.skipped.length} testid={`${t}-skipped`}>
              <CappedList items={r.structure.skipped} initial={25} noun="files" render={(s) => <><span className="v2-mono">{s.file}</span><span className="v2-hint">{s.reason}</span></>} />
            </Section>
          ) : null}
        </section>
      ) : null}

      {confirm && confirmation ? (
        <Modal title={confirmation.title} onClose={() => setConfirm(false)} width={520} buttons={<>
          <button className="btn" onClick={() => setConfirm(false)} data-testid={`${t}-confirm-cancel`}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void doApply()} data-testid={`${t}-confirm`}>{preview?.opts.placement === 'replace' ? 'Replace the publication structure' : 'Add to the publication structure'}</button>
        </>}>
          <div className="v2-stack" data-testid={`${t}-confirm-text`} data-placement={preview?.opts.placement}>
            {confirmation.lines.map((l, i) => <p key={i} style={{ margin: 0 }}>{l}</p>)}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
