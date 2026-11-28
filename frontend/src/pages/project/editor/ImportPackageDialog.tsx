// "Import package": bring a foreign S1000D package (Xignal/Docuneering, Vektra, any other) into the project.
//
//   choose files, a folder or a .zip  ->  Scan (nothing is written)  ->  read the report  ->  Apply (writes, with the repairs)
//   ->  read the change log  ->  place the modules no publication claimed (the second tab)
//
// The selection lives here, so a failed scan or a refused import never loses it. Scan can be cancelled (nothing is written);
// Apply cannot (cancelling the upload would not stop a server that has begun writing), so it only waits and says so.
// The pure logic (selection, grouping, capping, options) is in lib/importPackage.ts.

import { useMemo, useRef, useState } from 'react';
import { ApiError } from '../../../api/client';
import { importerApi, type ApplyResult, type RepairRuleId, type ScanResult } from '../../../api/importer';
import type { ProjectRole } from '../../../api';
import { Alert, Field, Modal, Spinner, errText, fmtSize, useAsync } from '../../../components/ui';
import { CappedList, Section } from '../../../components/lists';
import { Icon } from '../../../components/Icon';
import {
  buildPackageForm, defaultRepairs, describeSelection, importOptions, makeSelection, plural, selectionProblem, type PickSource, type Selection,
} from '../../../lib/importPackage';
import { canAssignModules, canImportPackage, type Can } from '../../../lib/roles';
import { ImportAssignPanel } from './ImportAssignPanel';
import '../../../styles/pages/project-pages.css';   // UI consistency pass: the mockup tabs and cards of the dialog
import { ImportReportView } from './ImportReportView';
import { ImportResultView } from './ImportResultView';
import { tablistKeys } from '../../../components/a11y';

type Stage = 'choose' | 'scanning' | 'applying' | 'report' | 'applied';
type Tab = 'import' | 'place';
type PublicationMode = 'auto' | 'replace' | 'keep';
interface Failure { message: string; problems?: string[] }

// webkitdirectory is not in React's typings, but every current browser honours it.
const FOLDER_ATTRS = { webkitdirectory: '', directory: '' } as Record<string, string>;

export function ImportPackageDialog({ projectId, can, onClose, onChanged }: {
  projectId: string; can: Can; onClose: () => void; onChanged: (what: { media: boolean }) => void;
}) {
  const mayImport = canImportPackage(can);
  const mayAssign = canAssignModules(can);
  const [tab, setTab] = useState<Tab>('import');
  const [stage, setStage] = useState<Stage>('choose');
  const [sel, setSel] = useState<Selection | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scannedWith, setScannedWith] = useState('');
  const [applied, setApplied] = useState<ApplyResult | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [repairs, setRepairs] = useState<RepairRuleId[] | null>(null);          // null until a scan has told us the rules and their defaults
  const [overwrite, setOverwrite] = useState(false);
  const [publication, setPublication] = useState<PublicationMode>('auto');
  const [neutralise, setNeutralise] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const pool = useAsync(() => importerApi.unassigned(projectId), [projectId]);

  const busy = stage === 'scanning' || stage === 'applying';
  const defaults = useMemo(() => (scan ? defaultRepairs(scan.rules) : []), [scan]);
  const optionsNow = (forApply: boolean) => importOptions({ repairs: repairs ?? defaults, defaults, overwrite, publication, neutraliseMissingBrex: neutralise }, forApply);
  const stale = stage === 'report' && scannedWith !== JSON.stringify(optionsNow(false));
  const unassignedCount = pool.loading ? null : pool.data?.count ?? null;

  const choose = (input: HTMLInputElement | null, source: PickSource) => {
    const files = [...(input?.files ?? [])];                        // copied first: clearing the input empties the live list
    if (input) input.value = '';
    if (!files.length) return;
    setSel(makeSelection(files, source));
    setScan(null); setApplied(null); setFailure(null); setRepairs(null); setStage('choose');
  };
  const clear = () => { setSel(null); setScan(null); setApplied(null); setFailure(null); setRepairs(null); setStage('choose'); };

  const run = async (kind: 'scan' | 'apply') => {
    const problem = selectionProblem(sel);
    if (problem || !sel) { setFailure({ message: problem ?? 'Choose the package first.' }); return; }
    const before: Stage = scan ? 'report' : 'choose';
    setFailure(null); setProgress(null); setStage(kind === 'scan' ? 'scanning' : 'applying');
    const ac = new AbortController();
    abort.current = ac;
    try {
      const form = buildPackageForm(sel, optionsNow(kind === 'apply'));
      const onProgress = (loaded: number, total: number) => setProgress({ loaded, total });
      if (kind === 'scan') {
        const r = await importerApi.scan(projectId, form, onProgress, ac.signal);
        setScan(r); setScannedWith(JSON.stringify(optionsNow(false)));
        if (repairs === null) setRepairs(defaultRepairs(r.rules));
        setStage('report');
      } else {
        const r = await importerApi.apply(projectId, form, onProgress);
        setApplied(r); setStage('applied');
        onChanged({ media: r.imported.media.length > 0 });
        pool.reload();
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') { setStage(before); return; }      // a cancelled scan: the selection and any earlier report stay
      const problems = e instanceof ApiError && Array.isArray(e.body?.problems) ? (e.body!.problems as unknown[]).map(String) : undefined;
      setFailure({ message: errText(e), problems });
      setStage(kind === 'apply' ? 'report' : before);
    } finally { abort.current = null; setProgress(null); }
  };

  const close = () => {
    if (stage === 'applying') return;                               // the server is writing: wait for it
    abort.current?.abort();
    onClose();
  };

  const toggleRule = (id: RepairRuleId, on: boolean) => setRepairs((cur) => {
    const base = cur ?? defaults;
    return on ? [...new Set([...base, id])] : base.filter((x) => x !== id);
  });

  const pct = progress && progress.total ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0;
  const uploaded = !!progress && progress.loaded >= progress.total;

  // ── body ───────────────────────────────────────────────────────────────
  const chooser = (
    <div className="v2-stack" data-testid="import-choose">
      <p style={{ margin: 0 }}>Choose the package: its files, the folder it is in, or a <strong>.zip</strong>. Nothing is written until you have read the scan and pressed <strong>Apply</strong>.</p>
      <div className="v2-pickbtns">
        <button className="btn" disabled={busy} onClick={() => filesInput.current?.click()} data-testid="pick-files"><Icon name="file" size={14} />Choose files…</button>
        <button className="btn" disabled={busy} onClick={() => folderInput.current?.click()} data-testid="pick-folder"><Icon name="folderOpen" size={14} />Choose a folder…</button>
        <button className="btn" disabled={busy} onClick={() => zipInput.current?.click()} data-testid="pick-zip"><Icon name="package" size={14} />Choose a .zip…</button>
      </div>
      <input ref={filesInput} type="file" multiple hidden data-testid="import-pkg-files" aria-label="Package files" onChange={(e) => choose(e.target, 'files')} />
      <input ref={folderInput} type="file" multiple hidden data-testid="import-pkg-folder" aria-label="Package folder" {...FOLDER_ATTRS} onChange={(e) => choose(e.target, 'folder')} />
      <input ref={zipInput} type="file" accept=".zip,application/zip" hidden data-testid="import-pkg-zip" aria-label="Package zip" onChange={(e) => choose(e.target, 'zip')} />
      {sel ? (
        <div className="card card-body pp-form" data-testid="selection">
          <div className="v2-row v2-spread"><strong data-testid="selection-summary">{describeSelection(sel, fmtSize)}</strong>{!busy ? <button className="btn sm" onClick={clear} data-testid="selection-clear">Clear</button> : null}</div>
          <CappedList items={sel.picks} initial={6} page={200} noun="files" testid="selection-list" render={(p) => <span className="v2-mono" style={{ overflowWrap: 'anywhere' }}>{p.path}</span>} />
          {selectionProblem(sel) ? <Alert tone="warn">{selectionProblem(sel)}</Alert> : null}
        </div>
      ) : <div className="v2-hint">Nothing chosen yet. A package can be hundreds of files; up to 5000 files or 1 GB go in one import.</div>}
    </div>
  );

  const options = scan ? (
    <Section title="Import options" defaultOpen={false} testid="sec-options">
      <div className="v2-stack" style={{ gap: 10 }}>
        <Field label="The project's publication">
          <select className="select" value={publication} disabled={busy} onChange={(e) => setPublication(e.target.value as PublicationMode)} data-testid="opt-publication">
            <option value="auto">Use the package's publication only if this project has none (recommended)</option>
            <option value="keep">Keep this project's publication; the imported modules wait in the unassigned list</option>
            <option value="replace">Replace this project's publication (the old one is kept as publication.xml.bak)</option>
          </select>
        </Field>
        <label className="v2-row" style={{ gap: 6, alignItems: 'flex-start' }}><input type="checkbox" checked={overwrite} disabled={busy} onChange={(e) => setOverwrite(e.target.checked)} data-testid="opt-overwrite" style={{ marginTop: 3 }} />
          <span>Replace data modules that already exist in this project<span className="v2-hint" style={{ display: 'block' }}>Without this, a module that is already here refuses the whole import and nothing is written. A replaced module keeps its earlier text in its history.</span></span></label>
        <label className="v2-row" style={{ gap: 6, alignItems: 'flex-start' }}><input type="checkbox" checked={neutralise} disabled={busy} onChange={(e) => setNeutralise(e.target.checked)} data-testid="opt-neutralise" style={{ marginTop: 3 }} />
          <span>Replace a BREX the package does not ship by the default BREX of its issue<span className="v2-hint" style={{ display: 'block' }}>Changes which business rules the modules are checked against. Leave it off if the organisation's own BREX is meant to apply: a build can instead be allowed without it as a recorded waiver (drafts only). Scan again after changing this.</span></span></label>
      </div>
    </Section>
  ) : null;

  const importBody = !mayImport ? <Alert tone="warn">Only an editor, manager or owner can import a package into this project.</Alert> : (
    <div className="v2-stack">
      {failure ? (
        <Alert tone="bad">
          <strong data-testid="import-error">{failure.message}</strong>
          {failure.problems?.length ? <div style={{ marginTop: 6 }}><CappedList items={failure.problems} initial={8} page={100} noun="problems" testid="import-refusals" render={(p: string) => <span style={{ overflowWrap: 'anywhere' }}>{p}</span>} /></div> : null}
          {sel ? <div className="v2-hint" style={{ marginTop: 6 }}>Your selection is still here: change what is needed and try again.</div> : null}
        </Alert>
      ) : null}

      {stage === 'applied' && applied ? <ImportResultView result={applied} rules={scan?.rules ?? []} unassigned={unassignedCount} /> : (
        <>
          {chooser}
          {busy ? (
            <div className="v2-stack" style={{ gap: 6 }} role="status" aria-live="polite" data-testid="import-progress">
              <div className={`v2-bar ${progress && !uploaded ? '' : 'busy'}`} aria-hidden="true"><i style={progress && !uploaded ? { width: `${pct}%` } : undefined} /></div>
              <div className="v2-row"><Spinner /><span>
                {stage === 'applying'
                  ? (progress && !uploaded ? `Uploading ${fmtSize(progress.loaded)} of ${fmtSize(progress.total)} (${pct}%)…` : 'Importing: the server is repairing and writing the package. Do not close this window.')
                  : (progress && !uploaded ? `Uploading ${fmtSize(progress.loaded)} of ${fmtSize(progress.total)} (${pct}%)…` : 'Scanning the package on the server. Nothing is written.')}
              </span></div>
            </div>
          ) : null}
          {scan && stage !== 'scanning' ? (
            <>
              {stale ? <Alert tone="warn" ><span data-testid="report-stale">The options changed since this report was made. Scan again to refresh it; the import itself always uses the options shown.</span></Alert> : null}
              <ImportReportView scan={scan} repairs={repairs ?? defaults} onToggle={toggleRule} locked={busy} />
              {options}
            </>
          ) : null}
        </>
      )}
    </div>
  );

  const placeBody = (
    <ImportAssignPanel projectId={projectId} data={pool.data} error={pool.error} loading={pool.loading} mayAssign={mayAssign} onReload={pool.reload} onAssigned={() => onChanged({ media: false })} />
  );

  // ── footer ─────────────────────────────────────────────────────────────
  const dms = scan?.report.counts.dms ?? 0;
  const footer = tab === 'place' ? <button className="btn" onClick={close} data-testid="import-close">Close</button> : (
    <>
      {stage === 'scanning' ? <button className="btn" onClick={() => abort.current?.abort()} data-testid="scan-cancel">Cancel the scan</button> : null}
      {stage === 'applying' ? <button className="btn primary" disabled><Spinner />Importing…</button> : null}
      {!busy ? <button className="btn" onClick={close} data-testid="import-close">Close</button> : null}
      {mayImport && !busy && stage !== 'applied' && sel && scan ? <button className="btn" onClick={clear} data-testid="import-another">Choose another package</button> : null}
      {mayImport && !busy && stage !== 'applied' ? <button className={`btn ${scan ? '' : 'primary'}`} disabled={!sel || !!selectionProblem(sel)} onClick={() => void run('scan')} data-testid="import-scan">{scan ? 'Scan again' : 'Scan package'}</button> : null}
      {mayImport && stage === 'report' && scan ? <button className="btn primary" disabled={dms === 0} onClick={() => void run('apply')} data-testid="import-apply" title={dms === 0 ? 'The package holds no data modules' : undefined}>Apply: import {plural(dms, 'data module')}</button> : null}
      {stage === 'applied' ? <button className="btn" onClick={clear} data-testid="import-another">Import another package</button> : null}
      {stage === 'applied' && (unassignedCount ?? 0) > 0 ? <button className="btn primary" onClick={() => setTab('place')} data-testid="goto-place">Place {plural(unassignedCount ?? 0, 'module')} in the publication…</button> : null}
    </>
  );

  return (
    <Modal title="Import package" width={900} sticky onClose={close} buttons={footer}>
      <div className="tabs pp-tabs" role="tablist" aria-label="Import package sections" onKeyDown={tablistKeys}>
        <button role="tab" aria-selected={tab === 'import'} className="tab" onClick={() => setTab('import')} data-testid="tab-import">Import a package</button>
        <button role="tab" aria-selected={tab === 'place'} className="tab" onClick={() => setTab('place')} data-testid="tab-place">Modules not in the publication{unassignedCount !== null ? ` (${unassignedCount})` : ''}</button>
      </div>
      {tab === 'import' ? importBody : placeBody}
    </Modal>
  );
}
