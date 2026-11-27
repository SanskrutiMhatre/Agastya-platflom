// WP-28 (PRD-003): the editor header's team chip, the same in the three editors.
//
//   [AL][BK] +2   Checked out by Ada until 14:05 [Break]      or   [Check out]   or   Checked out by you [Check in]
//
// The faces are the other people in the project now (hover or focus: who, on what). The check-out part is the open document's lease
// (WP-11): taking it stops other people's saves of it until it is given back or runs out; a project owner, a manager or an administrator
// can break someone else's. When a document someone else held is given back, a notice says so.

import { useCallback, useEffect, useRef, useState } from 'react';
import { del, get, post } from '../../api/client';
import { errText } from '../../components/ui';
import { confirmDialog } from '../../lib/dialogs';
import { useUi } from '../../store/ui';
import { activityText, baseName, initials, noticeIsFor, untilText, useAnnouncePresence, useTeam, type PresenceDoc } from '../../lib/presence';
import type { ProgressMsg } from '../../lib/progress';

interface Lease { part: string; holderId: string; holder: string | null; expiresAt: string; mine: boolean }

export interface TeamChipProps {
  projectId: string;
  /** the open document (null: none open) */
  doc: (PresenceDoc & { leases: string; checkout: string }) | null;
  /** the person may save here (shows Check out / Check in) */
  writable: boolean;
  /** a project owner, manager or administrator (shows Break) */
  canBreak: boolean;
  /** the document has unsaved changes: announced as "editing" */
  editing: boolean;
}

export function TeamChip({ projectId, doc, writable, canBreak, editing }: TeamChipProps) {
  const toast = useUi((s) => s.toast);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const heldByOther = useRef<string | null>(null);
  const presenceDoc: PresenceDoc | null = doc ? { kind: doc.kind, path: doc.path, ...(doc.title ? { title: doc.title } : {}) } : null;
  useAnnouncePresence(projectId, presenceDoc, editing ? 'editing' : 'viewing');

  const loadLeases = useCallback(() => {
    if (!doc) { setLeases([]); return; }
    get<{ leases: Lease[] }>(doc.leases, { background: true, fresh: true }).then((r) => setLeases(r.leases ?? []), () => setLeases([]));
  }, [doc?.leases]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadLeases(); }, [loadLeases]);

  const onLease = useCallback((m: ProgressMsg) => {
    if (!doc || !noticeIsFor(doc, m.path)) return;
    loadLeases();
    if (m.released && heldByOther.current) toast(`${m.holder ?? 'The other author'} ${m.broken ? 'no longer holds' : 'checked in'} ${doc.title || baseName(doc.path)}: you can check it out now.`, 'info');
  }, [doc, loadLeases, toast]);
  const team = useTeam(projectId, onLease);

  const whole = leases.find((l) => l.part === '') ?? null;
  const parts = leases.filter((l) => l.part !== '');
  heldByOther.current = whole && !whole.mine ? whole.holder : null;
  const others = team.people.filter((p) => !p.mine);
  const here = doc ? others.filter((p) => p.doc && p.doc.kind === doc.kind && baseName(p.doc.path) === baseName(doc.path)) : [];

  const act = async (what: 'take' | 'give' | 'break') => {
    if (!doc) return;
    // WP-35 (GAP-002): the app's own dialog, not the browser's
    if (what === 'break' && !await confirmDialog({ title: 'Break the check-out?', message: `Break ${whole?.holder ?? 'the other author'}'s check-out of ${doc.title || baseName(doc.path)}? Their unsaved work stays with them, but their next save may be refused.`, confirmLabel: 'Break check-out', danger: true })) return;
    setBusy(true);
    try {
      if (what === 'take') await post(doc.checkout, {});
      else await del(`${doc.checkout}${what === 'break' ? '?break=1' : ''}`);
      loadLeases(); team.reload();
    } catch (e) { toast(errText(e), 'error'); loadLeases(); } finally { setBusy(false); }
  };

  const faces = others.slice(0, 3);
  return (
    <span className="v2-team" data-testid="team-chip">
      {others.length ? (
        <span className="v2-team-faces" tabIndex={0} role="button" aria-expanded={open} aria-label={`${others.length} other ${others.length === 1 ? 'person' : 'people'} in this project`}
          onClick={() => setOpen((o) => !o)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o); } if (e.key === 'Escape') setOpen(false); }}
          title={others.map((p) => `${p.name}: ${activityText(p)}`).join('\n')} data-testid="team-faces">
          {faces.map((p) => <span key={`${p.userId}-${p.doc?.path ?? ''}`} className={`v2-face${here.includes(p) ? ' is-here' : ''}`}>{initials(p.name)}</span>)}
          {others.length > faces.length ? <span className="v2-face is-more">+{others.length - faces.length}</span> : null}
          {open ? (
            <span className="v2-team-pop" role="dialog" aria-label="People in this project">
              {others.map((p) => <span key={`${p.userId}-${p.doc?.path ?? ''}-row`} className="v2-team-row"><b>{p.name}</b> {activityText(p)}</span>)}
            </span>
          ) : null}
        </span>
      ) : null}
      {doc && whole ? (
        whole.mine
          ? <span className="v2-badge accent" data-testid="lease-mine" title={`You hold this document ${untilText(whole.expiresAt)}: other people cannot save it.`}>Checked out by you
              {writable ? <button className="btn btn-xs" onClick={() => void act('give')} disabled={busy} data-testid="lease-checkin">Check in</button> : null}</span>
          : <span className="v2-badge warn" data-testid="lease-other" title={`Your saves of this document are refused while ${whole.holder ?? 'another author'} holds it.`}>Checked out by {whole.holder ?? 'another author'} {untilText(whole.expiresAt)}
              {canBreak ? <button className="btn btn-xs" onClick={() => void act('break')} disabled={busy} data-testid="lease-break">Break</button> : null}</span>
      ) : doc && writable ? (
        <button className="btn btn-sm" onClick={() => void act('take')} disabled={busy} data-testid="lease-checkout"
          title="Check the document out: other people cannot save it until you check it in (or it runs out after an hour).">Check out</button>
      ) : null}
      {doc && parts.length ? <span className="v2-badge" data-testid="lease-parts" title={parts.map((l) => `${l.part}: ${l.mine ? 'you' : l.holder ?? 'another author'} ${untilText(l.expiresAt)}`).join('\n')}>{parts.length} part{parts.length === 1 ? '' : 's'} checked out</span> : null}
    </span>
  );
}
