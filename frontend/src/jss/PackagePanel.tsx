// Import a finished project and export the document as a project, from the JSS editor.
//
// Everything the package format involves is handled by the server; this only picks a file, shows what the server found in plain words, and starts the download.

import { useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { packageApi, type ExportSummary, type ImportSummary, type PackageFinding } from '../api/jss';
import { Icon } from '../components/Icon';
import { Alert, Modal, Spinner, errText } from '../components/ui';
import { useUi } from '../store/ui';

type Summary = { kind: 'import'; data: ImportSummary } | { kind: 'export'; data: ExportSummary; blocked: boolean };

function Findings({ list }: { list: PackageFinding[] }) {
  const groups: Array<[PackageFinding['severity'], string]> = [['error', 'Must be fixed'], ['warning', 'Please review'], ['info', 'For your information']];
  if (!list.length) return <p className="v2-hint">Nothing to report.</p>;
  return <>{groups.map(([sev, title]) => { const items = list.filter((f) => f.severity === sev); return items.length ? (
    <section key={sev} style={{ marginBottom: 12 }}>
      <h3 style={{ fontSize: 13, margin: '0 0 4px' }}>{title} ({items.length})</h3>
      <ul style={{ margin: 0, paddingLeft: 18 }}>{items.map((f, i) => <li key={i} style={{ marginBottom: 2 }}>{f.message}{f.where ? <span className="v2-hint"> — {f.where}</span> : null}</li>)}</ul>
    </section>) : null; })}</>;
}

export function PackagePanel({ id, writable, dirty, saveFirst, onImported }: { id: string; writable: boolean; dirty: boolean; saveFirst: () => Promise<boolean>; onImported: () => void }) {
  const toast = useUi((s) => s.toast);
  const pick = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'' | 'import' | 'export'>('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [confirm, setConfirm] = useState<File | null>(null);

  const doImport = async (file: File) => {
    setConfirm(null); setBusy('import');
    try { const r = await packageApi.import(id, file); setSummary({ kind: 'import', data: r }); onImported(); toast(`Imported ${r.counts.documents} sections.`, 'success'); }
    catch (e) { toast(errText(e), 'error'); }
    finally { setBusy(''); }
  };

  const doExport = async () => {
    setBusy('export');
    try {
      if (dirty && !(await saveFirst())) return;
      const chk = await packageApi.exportCheck(id);
      if (!chk.ok) { setSummary({ kind: 'export', data: chk.report, blocked: true }); return; }
      const a = document.createElement('a'); a.href = packageApi.exportUrl(id); a.download = chk.report.fileName; document.body.appendChild(a); a.click(); a.remove();
      if (chk.report.findings.some((f) => f.severity !== 'info')) setSummary({ kind: 'export', data: chk.report, blocked: false }); else toast('Exported.', 'success');
    } catch (e) { toast(e instanceof ApiError ? e.message : errText(e), 'error'); }
    finally { setBusy(''); }
  };

  const d = summary?.data;
  return (
    <>
      <input ref={pick} type="file" accept=".zip,application/zip" hidden data-testid="jss-import-file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setConfirm(f); }} />
      <button className="btn btn-sm" onClick={() => pick.current?.click()} disabled={!writable || busy !== ''} data-testid="jss-import" title={writable ? 'Replace this document with a finished project (a .zip)' : 'You have read-only access'}>{busy === 'import' ? <Spinner /> : <Icon name="upload" size={12} />}Import project</button>
      <button className="btn btn-sm" onClick={() => void doExport()} disabled={busy !== ''} data-testid="jss-export" title="Download this document as a project package">{busy === 'export' ? <Spinner /> : <Icon name="download" size={12} />}Export</button>
      {confirm ? (
        <Modal title="Import project" onClose={() => setConfirm(null)} width={460} buttons={<><button className="btn" onClick={() => setConfirm(null)}>Cancel</button><button className="btn btn-primary" data-testid="jss-import-confirm" onClick={() => void doImport(confirm)}>Import</button></>}>
          <p>This replaces the content of this document with <strong>{confirm.name}</strong>. Your document's title page details are kept, and the previous content is saved beside it as a backup.</p>
          {dirty ? <Alert tone="warn">You have unsaved changes; they will be lost.</Alert> : null}
        </Modal>
      ) : null}
      {summary && d ? (
        <Modal title={summary.kind === 'import' ? 'Import finished' : summary.blocked ? 'This document cannot be exported yet' : 'Export finished'} onClose={() => setSummary(null)} width={640} buttons={<button className="btn btn-primary" onClick={() => setSummary(null)}>Close</button>}>
          {summary.kind === 'import'
            ? <p>{summary.data.counts.documents} sections were imported into {summary.data.counts.chapters} chapters: {summary.data.counts.tables} tables, {summary.data.counts.figures} figures{summary.data.counts.picturesMissing ? `, ${summary.data.counts.picturesMissing} pictures missing from the package (marked placeholders were added)` : ''}.</p>
            : <p>{summary.blocked ? 'Fix the items marked "Must be fixed", then export again.' : `${summary.data.counts.documents} sections exported (${summary.data.counts.documentsKept} exactly as imported).`}</p>}
          <div data-testid="jss-package-findings"><Findings list={d.findings} /></div>
        </Modal>
      ) : null}
    </>
  );
}
