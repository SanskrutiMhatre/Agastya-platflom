// Administrator > Maintenance > Platform backups (WP-12: PLT-001, ENT-006, DEP-008).
//
// A platform backup is the one archive that brings the whole platform back: accounts and passwords, history, releases, settings (the
// database) and every project file, with a manifest that is checked on restore. This panel backs up now, lists the archives with the
// schedule and the last automatic restore test, and per archive: download, verify, copy to another folder, restore into a NEW folder
// (the running data folder is never touched; the steps to switch over are shown), delete.

import { useState } from 'react';
import { backupApi, type BackupItem, type RestoreReport } from '../api';
import { Icon } from '../components/Icon';
import { Alert, Badge, ConfirmModal, Empty, Loading, Modal, PromptModal, errText, fmtDate, fmtSize, useAsync } from '../components/ui';
import { useUi } from '../store/ui';

const KIND: Record<BackupItem['kind'], string> = { manual: 'Made here', scheduled: 'Scheduled', 'pre-update': 'Before an update', cli: 'Command line' };

export function PlatformBackups() {
  const toast = useUi((s) => s.toast);
  const st = useAsync(() => backupApi.status(), []);
  const [busy, setBusy] = useState('');
  const [copying, setCopying] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [restored, setRestored] = useState<{ report: RestoreReport; next: string[] } | null>(null);

  const act = async (id: string, fn: () => Promise<string>) => {
    setBusy(id);
    try { toast(await fn(), 'success'); st.reload(); } catch (e) { toast(errText(e), 'error'); } finally { setBusy(''); }
  };
  const s = st.data;

  return (
    <div className="v2-card v2-card-pad" data-testid="platform-backups" style={{ gridColumn: '1 / -1' }}>
      {copying ? <PromptModal title="Copy the backup to another folder" label="Folder (full path)" hint="A second disk or a USB stick, for example E:\Backups. The copy is checked byte for byte; nothing there is overwritten." confirmLabel="Copy"
        onClose={() => setCopying(null)} onSubmit={async (folder) => { const r = await backupApi.copy(copying, folder); toast(`Copied to ${r.file}`, 'success'); }} /> : null}
      {restoring ? <PromptModal title="Restore into a new folder" label="New folder (full path)" hint="A folder that does not exist yet, or is empty, outside the current data folder. Everything is checked before it is put in place; the running platform is not changed." confirmLabel="Restore"
        onClose={() => setRestoring(null)} onSubmit={async (target) => { setRestored(await backupApi.restore(restoring, target)); }} /> : null}
      {deleting ? <ConfirmModal title="Delete this backup?" danger confirmLabel="Delete" body={<p>{deleting} is removed from the backups folder. Copies elsewhere are not affected.</p>}
        onClose={() => setDeleting(null)} onConfirm={() => { const n = deleting; setDeleting(null); void act(`del-${n}`, async () => { await backupApi.remove(n); return 'Backup deleted'; }); }} /> : null}
      {restored ? (
        <Modal title="Restored" onClose={() => setRestored(null)} width={560} buttons={<button className="btn btn-primary" onClick={() => setRestored(null)}>Done</button>}>
          <p style={{ marginTop: 0 }}>The backup of {fmtDate(restored.report.createdAt)} is in <strong className="v2-mono">{restored.report.target}</strong>: {restored.report.files} files and {restored.report.rows} database rows in {restored.report.tables} tables, each checked against the backup.</p>
          <p>To switch the platform over to it:</p>
          <ol style={{ paddingLeft: 18 }}>{restored.next.map((n) => <li key={n}>{n}</li>)}</ol>
        </Modal>
      ) : null}

      <div className="v2-row v2-spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <h4 style={{ margin: 0 }}>Platform backup</h4>
          <p className="v2-sub" style={{ margin: '2px 0 0' }}>Everything needed to bring the platform back: accounts and passwords, history, releases, settings and every project file.</p>
        </div>
        <button className="btn btn-primary" disabled={!!busy || !!s?.running} aria-busy={busy === 'create' || undefined} data-testid="backup-now"
          onClick={() => void act('create', async () => { const r = await backupApi.create(); return `Backup written: ${r.name} (${fmtSize(r.bytes)})`; })}>
          <Icon name="download" />{busy === 'create' || s?.running ? 'Backing up…' : 'Back up now'}
        </button>
      </div>

      {st.loading && !s ? <Loading /> : st.error ? <Alert tone="bad">{st.error}</Alert> : s ? (
        <div className="v2-stack" style={{ marginTop: 12 }}>
          {s.stale ? <Alert tone="warn" >{s.latest ? `The newest backup is ${s.latest.ageDays} days old.` : 'There is no platform backup yet.'} Back up now, and keep a copy on another disk.</Alert> : null}
          {s.state.lastBackup && !s.state.lastBackup.ok ? <Alert tone="bad">The last backup failed ({fmtDate(s.state.lastBackup.at)}): {s.state.lastBackup.message}</Alert> : null}
          {s.state.lastRestoreTest && !s.state.lastRestoreTest.ok ? <Alert tone="bad">The last restore test of {s.state.lastRestoreTest.name} failed ({fmtDate(s.state.lastRestoreTest.at)}): {s.state.lastRestoreTest.message}</Alert> : null}
          <p className="v2-hint" style={{ margin: 0 }} data-testid="backup-schedule">
            {s.intervalHours > 0 ? `Scheduled every ${s.intervalHours} hours, keeping ${s.keep.daily} daily, ${s.keep.weekly} weekly and ${s.keep.monthly} monthly backups.` : 'No scheduled backup (AGASTYA_BACKUP_INTERVAL_HOURS is 0).'}
            {' '}{s.state.lastRestoreTest?.ok ? `Last restore test: ${fmtDate(s.state.lastRestoreTest.at)}, passed.` : ''} Folder: <span className="v2-mono">{s.dir}</span>
          </p>
          {s.backups.length === 0 ? <Empty title="No backups yet" /> : (
            <table className="v2-table" data-testid="backup-list">
              <thead><tr><th>Made</th><th>Kind</th><th>Size</th><th /></tr></thead>
              <tbody>
                {s.backups.map((b) => (
                  <tr key={b.name}>
                    <td title={b.name}>{fmtDate(b.createdAt)}</td>
                    <td><Badge tone={b.kind === 'scheduled' ? undefined : 'accent'}>{KIND[b.kind]}</Badge></td>
                    <td>{fmtSize(b.bytes)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <a className="btn btn-sm" href={backupApi.downloadUrl(b.name)} download>Download</a>{' '}
                      <button className="btn btn-sm" disabled={!!busy} aria-busy={busy === `v-${b.name}` || undefined} onClick={() => void act(`v-${b.name}`, async () => { const r = await backupApi.verify(b.name); return `Verified: ${r.report.files} files and ${r.report.rows} rows restore exactly`; })}>{busy === `v-${b.name}` ? 'Checking…' : 'Verify'}</button>{' '}
                      <button className="btn btn-sm" disabled={!!busy} onClick={() => setCopying(b.name)}>Copy to…</button>{' '}
                      <button className="btn btn-sm" disabled={!!busy} onClick={() => setRestoring(b.name)}>Restore…</button>{' '}
                      <button className="btn btn-sm" disabled={!!busy} onClick={() => setDeleting(b.name)} aria-label={`Delete ${b.name}`}><Icon name="trash" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="v2-hint" style={{ margin: 0 }}>A backup holds every account's password hash: keep it where only administrators can read it.</p>
        </div>
      ) : null}
    </div>
  );
}
