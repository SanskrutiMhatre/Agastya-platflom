// WP-28 (PRD-003): the Project Home's "Working now": who is in the project and on what, and which documents are checked out by whom
// until when. A project owner, a manager or an administrator can break a check-out from here (audited on the server).

import { useState } from 'react';
import { del } from '../api/client';
import { errText } from './ui';
import { confirmDialog } from '../lib/dialogs';
import { useUi } from '../store/ui';
import { activityText, baseName, initials, untilText, useAnnouncePresence, useTeam, type ProjectLease } from '../lib/presence';

export function WorkingNow({ projectId, format, canBreak }: { projectId: string; format: string; canBreak: boolean }) {
  useAnnouncePresence(projectId, null);
  const team = useTeam(projectId);
  const toast = useUi((s) => s.toast);
  const [busy, setBusy] = useState('');
  const others = team.people.filter((p) => !p.mine);

  const docName = (l: ProjectLease): string => {
    const b = baseName(l.path);
    const doc = /^DMC-/i.test(b) ? b : format === 'jsg' ? 'the JSG document' : format === 'jss' ? 'the JSS document' : b || 'a document';
    return l.part ? `${doc} (${l.part})` : doc;
  };
  const breakIt = async (l: ProjectLease) => {
    const b = baseName(l.path);
    const url = /^DMC-/i.test(b)
      ? `/api/projects/${projectId}/dms/${encodeURIComponent(b)}/checkout?break=1`
      : `/api/projects/${projectId}/${format}/checkout?part=${encodeURIComponent(l.part)}&break=1`;
    // WP-35 (GAP-002): the app's own dialog, not the browser's
    if (!await confirmDialog({ title: 'Break the check-out?', message: `Break ${l.holder ?? 'the other author'}'s check-out of ${docName(l)}?`, confirmLabel: 'Break check-out', danger: true })) return;
    setBusy(l.documentId + l.part);
    try { await del(url); team.reload(); } catch (e) { toast(errText(e), 'error'); } finally { setBusy(''); }
  };

  // UI redesign screen 2 (mockup project.html): the foot of the Home's Team card, in the mockup's classes; when nothing is going on it is
  // one quiet line ("Working now: nobody else is here · no document is checked out")
  return (
    <section className="now" aria-labelledby="home-team-h" data-testid="home-team">
      <h4 id="home-team-h" className="now-h">Working now</h4>
      {others.length ? (
        <ul className="now-list v2-team-list" aria-label="People in this project now" data-testid="home-team-people">
          {others.map((p) => (
            <li key={`${p.userId}-${p.doc?.path ?? ''}`}><span className={`avatar sm${p.mode === 'editing' ? ' here' : ''}`} aria-hidden="true">{initials(p.name)}</span>
              <span className="trunc grow"><b>{p.name}</b> <span className="faint">{activityText(p)}</span></span></li>
          ))}
        </ul>
      ) : <span className="faint" data-testid="home-team-alone">Nobody else is in this project right now.</span>}
      {team.leases.length ? (
        <ul className="now-list v2-team-list" aria-label="Checked-out documents" data-testid="home-team-leases">
          {team.leases.map((l) => (
            <li key={l.documentId + l.part}>
              <span className="trunc grow" title={l.path ?? ''}>{docName(l)}</span>
              <span className="badge" title={untilText(l.expiresAt)}>{l.mine ? 'you' : l.holder ?? 'another author'}</span>
              {canBreak && !l.mine ? <button className="btn sm" disabled={busy === l.documentId + l.part} onClick={() => void breakIt(l)} data-testid="home-team-break">Break</button> : null}
            </li>
          ))}
        </ul>
      ) : <span className="faint" data-testid="home-team-noleases">No document is checked out.</span>}
    </section>
  );
}
