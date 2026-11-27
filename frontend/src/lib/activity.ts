// Human wording for audit-log actions, shared by the Overview feed, the Activity dashboard, the administrator's oversight and the audit log.
// WP-07 (UX-015): every action the server writes has a sentence here; one it does not know yet is worded from its code ("jss.ancillary.saved"
// reads "jss ancillary saved"), so a dotted code is never shown as the sentence.
export const ACTION_LABEL: Record<string, string> = {
  // projects
  'project.created': 'created the project', 'project.updated': 'updated the project', 'project.deleted': 'deleted a project',
  'project.imported': 'imported the project', 'project.exported': 'exported the project', 'project.converted': 'converted a document into',
  'project.adopted': 'took over the project', 'project.approved': 'approved the project', 'project.rejected': 'rejected the project request',
  'project.owner_reassigned': 'gave the project a new owner:', 'project.made_ownerless': 'left the project without an owner:',
  'project.folder_missing': 'found the folder missing for', 'project.import_discarded': 'removed an unfinished import:',
  'project.unsafe_paths': 'reported unsafe file locations in',
  // data modules and other CSDB objects
  'dm.saved': 'saved a data module in', 'dm.created': 'created a data module in', 'dm.deleted': 'deleted a data module in', 'dm.imported': 'imported data modules into',
  'dm.locked': 'locked a data module in', 'dm.unlocked': 'unlocked a data module in', 'dm.issued': 'issued a data module in',
  'dm.obsolete': 'made a data module obsolete in', 'dm.reinstated': 'reinstated a data module in', 'dm.superseded': 'superseded a data module in',
  'object.created': 'created a CSDB object in', 'object.saved': 'saved a CSDB object in', 'object.deleted': 'deleted a CSDB object from',
  'brex.created': 'created business rules for', 'dml.generated': 'generated a data module list for', 'identity.changed': 'changed the identity codes of',
  // publication and publishing
  'pm.saved': 'changed the publication of', 'pm.imported': 'imported a publication into', 'publish.built': 'built the PDF of', 'publish.downloaded': 'downloaded the PDF of',
  'publish.waiver.added': 'waived a publishing check for', 'publish.waiver.removed': 'withdrew a publishing waiver for',
  'validation.run': 'validated', 'validation.issue': 'recorded a validation finding in', 'watermark.updated': 'changed the watermark of',
  'jss.saved': 'saved the JSS document of', 'jss.exported': 'exported the JSS document of', 'jss.ancillary.saved': 'changed the front matter of',
  'jss.ancillary.reset': 'reset the front matter of', 'jss.ancillary.choices': 'changed the front-matter pages of',
  'jsg.saved': 'saved the JSG document of', 'jsg.built': 'built the JSG PDF of', 'jsg.imported': 'imported a JSG document into',
  'jssdm.generated': 'generated JSS data modules for', 'jssdm.imported': 'imported JSS data modules into',
  // releases and review
  'release.requested': 'requested a release of', 'release.approved': 'approved a release of', 'release.rejected': 'rejected a release of',
  'release.withdrawn': 'withdrew a release request of', 'release.issued': 'issued a release of',
  'review.comment': 'commented on', 'review.changes_requested': 'asked for changes in',
  // packages, imports, graphics
  'package.exported': 'exported a package of', 'package.imported': 'imported a package into',
  'import.scanned': 'checked an import for', 'import.applied': 'applied an import to', 'import.assigned': 'placed imported modules in',
  'media.uploaded': 'uploaded a graphic to', 'graphics.added': 'added a graphic to', 'graphics.removed': 'removed a graphic from',
  // configuration, codes, SNS, extensions
  'settings.saved': 'changed the settings of', 'config.created': 'set up the S1000D configuration of', 'config.updated': 'changed the S1000D configuration of',
  'config.deleted': 'removed the S1000D configuration of',
  'sns.created': 'added to the SNS of', 'sns.updated': 'changed the SNS of', 'sns.deleted': 'removed from the SNS of', 'sns.imported': 'imported an SNS into',
  'sns.derived': 'derived the SNS of', 'sns.learned': 'added codes to the SNS of', 'sns.ordering': 'reordered the SNS of',
  'sns.defaults.created': 'created an SNS preset', 'sns.defaults.updated': 'changed an SNS preset', 'sns.defaults.deleted': 'deleted an SNS preset',
  'extension.registered': 'registered an extension profile', 'extension.deleted': 'removed an extension profile',
  'extension.enabled': 'turned on an extension profile in', 'extension.disabled': 'turned off an extension profile in',
  // the shared repository
  'cir.added': 'added to the shared repository', 'cir.removed': 'removed from the shared repository', 'cir.copied': 'copied a shared module into',
  'cir.link.detached': 'detached a shared module in', 'cir.update.approved': 'approved a shared-module update for',
  // people, folders, invitations
  'invite.created': 'invited someone to', 'invite.accepted': 'joined', 'invite.declined': 'declined an invitation to', 'invite.revoked': 'withdrew an invitation to',
  'member.added': 'added someone to', 'member.assigned': 'assigned someone to', 'member.role_changed': 'changed a member role in', 'member.removed': 'removed a member from',
  'folder.created': 'created a folder', 'folder.renamed': 'renamed a folder', 'folder.deleted': 'deleted a folder', 'folder.access_changed': 'changed who may open a folder',
  'user.created': 'created an account', 'user.updated': 'changed an account', 'user.disabled': 'disabled an account', 'user.enabled': 'enabled an account',
  'user.reset': 'reset a password', 'user.import.committed': 'imported accounts', 'user.setup_admin_created': 'set up the platform',
  'user.bootstrap_admin_created': 'set up the platform',
  // sign-in and the platform
  'auth.login': 'signed in', 'auth.login.master': 'signed in with the master password', 'auth.logout': 'signed out', 'auth.login.failed': 'failed to sign in',
  'auth.onboarding.completed': 'finished setting up the account', 'auth.password.changed': 'changed the password',
  'auth.password.console_reset': 'had the password reset at the server', 'auth.session.displaced': 'signed in elsewhere, which ended an earlier session',
  'auth.session.revoked': 'had the sessions ended',
  'reset.requested': 'asked for a password reset', 'reset.approved': 'approved a password reset', 'reset.rejected': 'refused a password reset',
  'settings.platform': 'changed the platform settings', 'settings.security_policy': 'changed the security policy', 'maintenance.reindex': 're-indexed the documents',
  'backup.exported': 'exported the project files',
  // WP-12: the platform backup
  'backup.created': 'made a platform backup', 'backup.failed': 'could not make a platform backup', 'backup.downloaded': 'downloaded a platform backup',
  'backup.copied': 'copied a platform backup', 'backup.restored': 'restored a platform backup into a new folder', 'backup.deleted': 'deleted a platform backup',
  'backup.restore_tested': 'tested the restore of a platform backup', 'backup.pruned': 'removed old scheduled backups', 'retention.purged': 'removed records past their retention',
};

/** An action's sentence; an unknown one is worded from its code (never shown as a dotted code). */
export const actionLabel = (a: string): string => ACTION_LABEL[a] ?? String(a ?? '').replace(/[._]+/g, ' ').trim();

/** Sign-in bookkeeping: shown in the audit log, left out of the activity feeds where it drowns the work (UX-015). */
const NOISE = new Set(['auth.login', 'auth.logout', 'auth.session.displaced', 'auth.login.failed', 'auth.onboarding.completed']);
export const isFeedNoise = (a: string): boolean => NOISE.has(a);
