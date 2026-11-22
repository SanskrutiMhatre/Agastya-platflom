// Human wording for audit-log actions, shared by the Overview feed and the Activity dashboard.
export const ACTION_LABEL: Record<string, string> = {
  'project.created': 'created the project', 'project.updated': 'updated the project', 'project.deleted': 'deleted a project',
  'dm.saved': 'saved a data module in', 'dm.created': 'created a data module in', 'dm.deleted': 'deleted a data module in', 'dm.imported': 'imported data modules into',
  'dm.locked': 'locked a data module in', 'dm.unlocked': 'unlocked a data module in',
  'pm.saved': 'changed the publication of', 'pm.imported': 'imported a publication into', 'publish.built': 'built the PDF of', 'validation.run': 'validated',
  'release.requested': 'requested a release of', 'release.approved': 'approved a release of', 'release.rejected': 'rejected a release of', 'release.withdrawn': 'withdrew a release request of',
  'watermark.updated': 'changed the watermark of', 'settings.saved': 'changed the settings of', 'media.uploaded': 'uploaded a graphic to',
  'invite.created': 'invited someone to', 'invite.accepted': 'joined', 'member.assigned': 'assigned someone to', 'member.role_changed': 'changed a member role in',
  'member.removed': 'removed a member from', 'folder.created': 'created a folder', 'folder.renamed': 'renamed a folder', 'folder.deleted': 'deleted a folder',
  'user.created': 'created an account', 'auth.login': 'signed in',
};
export const actionLabel = (a: string): string => ACTION_LABEL[a] ?? a;
