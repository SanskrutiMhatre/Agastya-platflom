// Notifications: this person's own inbox - approvals to decide, decisions on their requests,
// and changes to their project access. Unread items are marked; reading is per person.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { Empty, Loading, ago, fmtDate } from '../components/ui';
import { useInbox } from '../store/inbox';
import { useSession } from '../store/session';

const KIND_ICON: Record<string, IconName> = {
  'approval.requested': 'clock', 'approval.approved': 'ok', 'approval.rejected': 'alert', 'approval.withdrawn': 'back',
  'access.granted': 'invite', 'access.changed': 'users', 'access.removed': 'lock', 'access.shared': 'users',
  'account.created': 'invite', 'project.created': 'projects',
  'review.submitted': 'send', 'review.resubmitted': 'send', 'review.changes_requested': 'undo', 'review.comment': 'comment',
};
const KIND_TONE: Record<string, string> = { 'approval.approved': 'ok', 'approval.rejected': 'bad', 'approval.requested': 'warn', 'access.removed': 'bad', 'review.changes_requested': 'bad', 'review.resubmitted': 'warn' };

export function Notifications() {
  const nav = useNavigate();
  const { items, unread, loaded, refresh, markRead } = useInbox();
  const role = useSession((s) => s.user?.role);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  useEffect(() => { void refresh(); }, [refresh]);

  const shown = filter === 'unread' ? items.filter((n) => !n.read) : items;
  const open = async (id: number, read: boolean, projectId: string | null, kind: string) => {
    if (!read) await markRead([id]);
    if (projectId && kind.startsWith('review.')) nav(`/projects/${projectId}/release`);
    else if (projectId && kind !== 'access.removed' && role !== 'admin') nav(kind.startsWith('approval') && role === 'project_manager' ? '/activity' : `/projects/${projectId}`);
  };

  return (
    <div className="v2-page">
      <PageHeader icon="bell" title="Notifications" sub={unread ? `${unread} unread` : 'You are all caught up.'}
        actions={<>
          <div className="v2-seg" role="group" aria-label="Show"><button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</button><button className={filter === 'unread' ? 'on' : ''} onClick={() => setFilter('unread')}>Unread</button></div>
          <button className="btn" disabled={!unread} onClick={() => void markRead()} data-testid="mark-all-read"><Icon name="check" />Mark all as read</button>
        </>} />
      <div className="v2-card" data-testid="notifications">
        {!loaded ? <Loading /> : shown.length === 0 ? <Empty title={filter === 'unread' ? 'Nothing unread' : 'No notifications yet'} /> : shown.map((n) => (
          <div key={n.id} className={`v2-note ${n.read ? '' : 'unread'}`} data-testid="notification" data-read={n.read}>
            <span className={`v2-note-icon ${KIND_TONE[n.kind] ?? ''}`}><Icon name={KIND_ICON[n.kind] ?? 'info'} size={16} /></span>
            <button className="v2-note-main" onClick={() => void open(n.id, n.read, n.projectId, n.kind)}>
              <span className="v2-note-title">{n.title}{n.read ? null : <span className="v2-unread" aria-label="Unread" />}</span>
              {n.body ? <span className="v2-note-body">{n.body}</span> : null}
            </button>
            <span className="v2-hint" title={fmtDate(n.at)}>{ago(n.at)}</span>
            {n.read ? null : <button className="icon-btn" title="Mark as read" aria-label="Mark as read" onClick={() => void markRead([n.id])}><Icon name="check" /></button>}
          </div>
        ))}
      </div>
    </div>
  );
}
