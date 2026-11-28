// Backup on the main dashboard: one ZIP of what the person is allowed to back up.

import { BackupButton } from '../components/Oversight';
import { Icon } from '../components/Icon';
import '../styles/pages/admin.css';   // UI redesign screen 6: the administration look of the global pages
import { AdmHead } from './adminParts';
import { useSession } from '../store/session';

export function BackupPage() {
  const role = useSession((s) => s.user?.role);
  const admin = role === 'admin';
  return (
    <div className="v2-page adm">
      <AdmHead title="Backup" sub={admin ? 'Everything on the platform, as one ZIP file.' : 'Every project you can open, as one ZIP file.'} />
      <section className="card narrow" aria-labelledby="bk-h">
        <div className="card-head"><h3 id="bk-h"><Icon name="package" />{admin ? 'Back up the platform' : 'Back up my projects'}</h3></div>
        <div className="card-body v2-stack">
        <ul className="list-indent v2-m0">
          <li>Each project: its data modules, publication, graphics and settings.</li>
          {admin ? <li>The people and their project memberships, and the activity log. Passwords are never included.</li> : null}
        </ul>
        <div><BackupButton label={admin ? 'Back up the platform' : 'Back up my projects'} /></div>
        <p className="v2-hint v2-m0">The file is built when you press the button, so it always holds the current state.</p>
        {admin ? <p className="v2-hint v2-m0" data-testid="backup-scope">This is an export of the project files, not a backup: it holds no passwords, platform settings, history or release records and cannot be restored. The restorable platform backup (with restore into a new folder) is under Administrator, Maintenance, Platform backup.</p> : null}
        </div>
      </section>
    </div>
  );
}
