// Backup on the main dashboard: one ZIP of what the person is allowed to back up.

import { BackupButton } from '../components/Oversight';
import { PageHeader } from '../components/PageHeader';
import { useSession } from '../store/session';

export function BackupPage() {
  const role = useSession((s) => s.user?.role);
  const admin = role === 'admin';
  return (
    <div className="v2-page">
      <PageHeader icon="download" title="Backup" sub={admin ? 'Everything on the platform, as one ZIP file.' : 'Every project you can open, as one ZIP file.'} />
      <div className="v2-card v2-card-pad" style={{ maxWidth: 640 }}>
        <h3 style={{ marginTop: 0 }}>{admin ? 'Back up the platform' : 'Back up my projects'}</h3>
        <ul style={{ paddingLeft: 18 }}>
          <li>Each project: its data modules, publication, graphics and settings.</li>
          {admin ? <li>The people and their project memberships, and the activity log. Passwords are never included.</li> : null}
        </ul>
        <BackupButton label={admin ? 'Back up the platform' : 'Back up my projects'} />
        <p className="v2-hint" style={{ marginBottom: 0 }}>The file is built when you press the button, so it always holds the current state.</p>
        {admin ? <p className="v2-hint" style={{ marginBottom: 0 }} data-testid="backup-scope">This is an export of the project data, not a database backup: it holds no passwords, platform settings or release records and cannot be restored from here. For a complete backup, copy the data folder of the stopped server (administrator guide, section 7).</p> : null}
      </div>
    </div>
  );
}
