'use strict';
// Who may give whom which role on a project. ONE rule, used by invitations, direct
// assignment, role changes and removals, so the routes cannot drift apart.
//
//   owner (and administrators, who are owner-equivalent)   any role, except 'manager' goes
//                                                          only to Project Manager accounts
//   manager (a Project Manager on this project)            viewer, reviewer or editor; cannot
//                                                          change or remove an owner or a manager
//   anyone else                                            nothing (the route guard already refuses)
//
// An Author never receives 'manager': approval and administrative power belong to the
// Project Manager role, whoever owns the project.

const { ROLE_RANK, PROJECT_ROLES } = require('./authz');

/*
  actor        the signed-in user
  actorRole    the actor's role ON THIS PROJECT ('owner' for an administrator)
  target       the user receiving or losing access
  role         the role being granted (omit for a removal)
  currentRole  the target's present role on the project, if any
  Returns { ok: true } or { ok: false, status, error }.
*/
function checkGrant({ actor, actorRole, target, role, currentRole }) {
  if (role !== undefined && !PROJECT_ROLES.includes(role)) {
    return { ok: false, status: 400, error: 'Unknown project role.' };
  }
  if (role === 'manager' && !(target.role === 'project_manager' || target.role === 'admin')) {
    return { ok: false, status: 400, error: 'Only a Project Manager account can be given the manager role. An Author can be given viewer, reviewer or editor access.' };
  }
  if (role === 'owner' && actorRole !== 'owner') {
    return { ok: false, status: 403, error: 'Only a project owner can make someone an owner.' };
  }
  if (actorRole === 'manager') {
    if (role !== undefined && ROLE_RANK[role] >= ROLE_RANK.manager) {
      return { ok: false, status: 403, error: 'A Project Manager can assign viewer, reviewer or editor access.' };
    }
    if (currentRole && ROLE_RANK[currentRole] >= ROLE_RANK.manager) {
      return { ok: false, status: 403, error: 'Only a project owner can change or remove an owner or a manager.' };
    }
  }
  return { ok: true };
}

module.exports = { checkGrant };
