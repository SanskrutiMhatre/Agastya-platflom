// Tells people when their access to a project changes. Called by the member routes
// (core/auth/routes.js) and the assign route (routes/team.ts).

import { store } from '../context';
import { notify, managersOf } from './notifications';
import { readProjectJson } from './projects';

type Kind = 'granted' | 'changed' | 'removed';
interface Ctx { actor: { id: string; full_name?: string; fullName?: string }; projectId: string; userId: string; role: string }

const LABEL: Record<string, string> = { owner: 'Owner', manager: 'Project Manager', editor: 'Editor', reviewer: 'Reviewer', viewer: 'Viewer' };

export function notifyAccess(kind: Kind, c: Ctx): void {
  const project = `“${readProjectJson(c.projectId).name || 'a project'}”`;
  const who = c.actor.fullName ?? c.actor.full_name ?? 'Someone';
  const person = store.getUser(c.userId)?.full_name ?? 'a member';
  const role = LABEL[c.role] ?? c.role;

  if (kind === 'removed') notify([c.userId], { kind: 'access.removed', title: 'Access removed', body: `${who} removed your access to ${project}.`, projectId: c.projectId, actorId: c.actor.id });
  else if (kind === 'changed') notify([c.userId], { kind: 'access.changed', title: 'Your access changed', body: `${who} made you ${role} on ${project}.`, projectId: c.projectId, actorId: c.actor.id });
  else notify([c.userId], { kind: 'access.granted', title: 'You were added to a project', body: `${who} gave you ${role} access to ${project}.`, projectId: c.projectId, actorId: c.actor.id });

  // The project's Project Manager keeps track of who else gets in.
  notify(managersOf(c.projectId).filter((id) => id !== c.userId), {
    kind: 'access.shared', title: 'Project access updated',
    body: kind === 'removed' ? `${who} removed ${person} from ${project}.` : `${who} gave ${person} ${role} access to ${project}.`,
    projectId: c.projectId, actorId: c.actor.id,
  });
}
