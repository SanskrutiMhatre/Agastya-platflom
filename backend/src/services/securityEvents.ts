// =============================================================================
// Security events with stable ids (audit WP-29: RES-004, ENT-007 part 4, AU-5).
//
// A small, documented set of events that a Windows administrator collects with Windows Event Forwarding, without an agent: the server
// raises them (mostly from the audit writer, so every audited security action is covered by one table), and the Windows host
// (packaging/host/AgastyaHost.cs) writes each one to the Application log under the "Agastya Platform" source with the id below. The ids are
// part of the product's interface: never renumber one; add new ids at the end of their block. The list is in docs/OPERATIONS.md section 13.
//
// Sinks: the structured log (always, kind "security"), standard output as `##agastya-event|<id>|<level>|<text>` when the host asked for
// it (config.log.eventSink = "host"), and a test sink (setSecurityEventSink).
// =============================================================================

import { logRecord } from './log';

export type EventLevel = 'information' | 'warning' | 'error';
export interface SecurityEventDef { id: number; name: string; level: EventLevel; description: string }
export interface SecurityEvent { id: number; name: string; level: EventLevel; message: string; at: string }

/** The catalogue. Ids are stable across versions. */
export const SECURITY_EVENTS = {
  AUDIT_WRITE_FAILED:     { id: 4100, name: 'audit.write_failed', level: 'error', description: 'An action could not be written to the audit log (a critical action was refused; any other went ahead and is flagged on the Security page).' },
  AUDIT_VERIFY_FAILED:    { id: 4101, name: 'audit.verify_failed', level: 'error', description: 'The audit chain verification found a changed, removed or inserted row, or a cut against a checkpoint.' },
  AUDIT_CHECKPOINT:       { id: 4102, name: 'audit.checkpoint', level: 'information', description: 'An audit checkpoint: the chain length and its last hash (keep these off the machine to detect a cut at the end).' },
  AUDIT_VERIFIED:         { id: 4103, name: 'audit.verified', level: 'information', description: 'The audit chain verification passed.' },
  SIGNIN_FAILURES:        { id: 4110, name: 'auth.failed_burst', level: 'warning', description: 'Several failed sign-ins for one account or from one address within 15 minutes.' },
  SIGNIN_THROTTLED:       { id: 4111, name: 'auth.throttled', level: 'warning', description: 'Sign-in attempts for an account were refused by the throttle (account temporarily locked).' },
  SIGNIN_MASTER:          { id: 4112, name: 'auth.login.master', level: 'warning', description: 'A sign-in used the vendor master credential.' },
  PASSWORD_RESET:         { id: 4113, name: 'auth.password_reset', level: 'warning', description: 'A password was reset by an administrator or from the server console.' },
  SESSION_REVOKED:        { id: 4114, name: 'auth.session_revoked', level: 'information', description: 'An administrator ended a session.' },
  ROLE_CHANGED:           { id: 4120, name: 'account.role_changed', level: 'warning', description: 'A platform role was changed, an account was created, disabled or enabled, or an administrator was created.' },
  MEMBERSHIP_CHANGED:     { id: 4121, name: 'project.membership_changed', level: 'information', description: 'A project membership was added, changed or removed, or folder access changed.' },
  RELEASE_REQUESTED:      { id: 4130, name: 'release.requested', level: 'information', description: 'A release was requested (with the publication fingerprint).' },
  RELEASE_DECIDED:        { id: 4131, name: 'release.decided', level: 'information', description: 'A release was approved or rejected.' },
  BACKUP_CREATED:         { id: 4140, name: 'backup.created', level: 'information', description: 'A platform backup was made.' },
  BACKUP_FAILED:          { id: 4141, name: 'backup.failed', level: 'error', description: 'A platform backup failed, or a backup failed its restore test.' },
  BACKUP_RESTORED:        { id: 4142, name: 'backup.restored', level: 'warning', description: 'A platform backup was restored into a new folder.' },
  LOCK_BROKEN:            { id: 4150, name: 'lock.broken', level: 'warning', description: 'A document lock or editing lease held by someone else was broken.' },
  SETTINGS_CHANGED:       { id: 4160, name: 'settings.changed', level: 'warning', description: 'Security settings, platform settings or the asset policy were changed.' },
  AUDIT_EXPORTED:         { id: 4161, name: 'audit.exported', level: 'information', description: 'The audit log was exported.' },
} as const satisfies Record<string, SecurityEventDef>;

type Key = keyof typeof SECURITY_EVENTS;
const DEFS: SecurityEventDef[] = Object.values(SECURITY_EVENTS);

/** Which audited action raises which event (exact names first, then patterns). Unlisted actions raise none. */
const BY_ACTION: Record<string, Key> = {
  'auth.login.master': 'SIGNIN_MASTER',
  'auth.password.console_reset': 'PASSWORD_RESET', 'user.reset': 'PASSWORD_RESET', 'reset.approved': 'PASSWORD_RESET',
  'auth.session.revoked': 'SESSION_REVOKED',
  'user.updated': 'ROLE_CHANGED', 'user.disabled': 'ROLE_CHANGED', 'user.enabled': 'ROLE_CHANGED', 'user.created': 'ROLE_CHANGED',
  'user.import.committed': 'ROLE_CHANGED', 'user.bootstrap_admin_created': 'ROLE_CHANGED', 'user.setup_admin_created': 'ROLE_CHANGED',
  'member.added': 'MEMBERSHIP_CHANGED', 'member.assigned': 'MEMBERSHIP_CHANGED', 'member.role_changed': 'MEMBERSHIP_CHANGED',
  'member.removed': 'MEMBERSHIP_CHANGED', 'folder.access_changed': 'MEMBERSHIP_CHANGED', 'project.owner_reassigned': 'MEMBERSHIP_CHANGED',
  // WP-27: groups, project group grants and capability rules change who may do what; a directory mapping can give a global role
  'group.member.added': 'MEMBERSHIP_CHANGED', 'group.member.removed': 'MEMBERSHIP_CHANGED', 'group.deleted': 'MEMBERSHIP_CHANGED',
  'project.access.group-granted': 'MEMBERSHIP_CHANGED', 'project.access.group-removed': 'MEMBERSHIP_CHANGED',
  'project.access.rule-set': 'MEMBERSHIP_CHANGED', 'project.access.rule-removed': 'MEMBERSHIP_CHANGED',
  'directory.mapping.added': 'ROLE_CHANGED', 'directory.mapping.removed': 'ROLE_CHANGED',
  'release.requested': 'RELEASE_REQUESTED', 'review.resubmitted': 'RELEASE_REQUESTED',
  'release.approved': 'RELEASE_DECIDED', 'release.rejected': 'RELEASE_DECIDED',
  'backup.created': 'BACKUP_CREATED', 'backup.failed': 'BACKUP_FAILED', 'backup.restored': 'BACKUP_RESTORED',
  'settings.security_policy': 'SETTINGS_CHANGED', 'settings.platform': 'SETTINGS_CHANGED', 'settings.saved': 'SETTINGS_CHANGED',
  'asset-policy.changed': 'SETTINGS_CHANGED',
  'maintenance.audit-export': 'AUDIT_EXPORTED', 'audit.exported': 'AUDIT_EXPORTED',
  'audit.checkpoint': 'AUDIT_CHECKPOINT',
};
function keyForAction(action: string, meta: unknown): Key | null {
  if (BY_ACTION[action]) {
    // a user.updated that changed only the display name is not a role change (the role, WP-27's auditor flag or the sign-in source is)
    if (action === 'user.updated' && !(meta && typeof meta === 'object' && ['role', 'auditor', 'auth_source'].some((k) => k in (meta as Record<string, unknown>)))) return null;
    return BY_ACTION[action];
  }
  if (action === 'backup.restore_tested' && meta && typeof meta === 'object' && (meta as { ok?: unknown }).ok === false) return 'BACKUP_FAILED';
  if (/lease\.(broken|break)|lock\.broken|\.lock_broken$|\.lease_broken$|checkout-broken$/.test(action)) return 'LOCK_BROKEN';   // WP-11 check-out breaks too
  return null;
}

type Sink = (e: SecurityEvent) => void;
let testSink: Sink | null = null;
let hostSink = false;
/** Tests: receive every event (returns the previous sink). */
export function setSecurityEventSink(s: Sink | null): Sink | null { const prev = testSink; testSink = s; return prev; }
/** index.ts: write `##agastya-event|...` lines for the Windows host (config.log.eventSink = "host"). */
export function enableHostEventSink(on: boolean): void { hostSink = on; }

/** One line of text, no control characters, no "|" (the host's line format), at most 2000 characters (the Application log's practical limit is far above). */
const clean = (s: string): string => s.replace(/[\r\n\t|]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 2000);

export function raiseSecurityEvent(key: Key, message: string): SecurityEvent {
  const d = SECURITY_EVENTS[key];
  const e: SecurityEvent = { id: d.id, name: d.name, level: d.level, message: clean(message), at: new Date().toISOString() };
  logRecord(d.level === 'error' ? 'error' : d.level === 'warning' ? 'warn' : 'info', `security event ${d.id} ${d.name}: ${e.message}`, { kind: 'security', eventId: d.id, event: d.name });
  if (hostSink) { try { process.stdout.write(`##agastya-event|${d.id}|${d.level}|${e.message}\n`); } catch { /* the host is gone */ } }
  if (testSink) { try { testSink(e); } catch { /* a test sink never breaks the caller */ } }
  return e;
}

// ---- sign-in failure bursts ----------------------------------------------------------------------------------------------------------
const WINDOW_MS = 15 * 60_000; const BURST = 5;
const failures = new Map<string, { times: number[]; reported: number }>();
function countFailure(key: string, now: number): boolean {
  const f = failures.get(key) ?? { times: [], reported: 0 };
  f.times = f.times.filter((t) => now - t < WINDOW_MS); f.times.push(now);
  failures.set(key, f);
  if (failures.size > 5000) { for (const k of failures.keys()) { failures.delete(k); if (failures.size <= 4000) break; } }
  // one event when the burst threshold is reached, then at most one per window for the same key
  if (f.times.length >= BURST && now - f.reported >= WINDOW_MS) { f.reported = now; return true; }
  return false;
}
/** Forget the counters (tests). */
export function resetSecurityEventCounters(): void { failures.clear(); }

/** Called by the audit writer after a row was written: raises the event the action maps to, if any. */
export function securityEventForAudit(fields: { action?: unknown; actorUsername?: unknown; ip?: unknown; meta?: unknown; targetId?: unknown; projectId?: unknown }, now = Date.now()): SecurityEvent | null {
  const action = String(fields.action ?? '');
  const who = fields.actorUsername ? String(fields.actorUsername) : (fields.meta && typeof fields.meta === 'object' && (fields.meta as { username?: unknown }).username ? String((fields.meta as { username?: unknown }).username) : 'unknown');
  const from = fields.ip ? ` from ${String(fields.ip)}` : '';
  if (action === 'auth.login.failed') {
    const byUser = countFailure(`u:${who.toLowerCase()}`, now);
    const byIp = fields.ip ? countFailure(`i:${String(fields.ip)}`, now) : false;
    if (byUser || byIp) return raiseSecurityEvent('SIGNIN_FAILURES', `${BURST} or more failed sign-ins within 15 minutes ${byUser ? `for the account "${who}"` : ''}${byUser && byIp ? ' and' : ''}${byIp ? ` from ${String(fields.ip)}` : ''}.`);
    return null;
  }
  const key = keyForAction(action, fields.meta);
  if (!key) return null;
  const meta = fields.meta && typeof fields.meta === 'object' ? ` ${JSON.stringify(fields.meta).slice(0, 600)}` : '';
  const target = fields.targetId ? ` target ${String(fields.targetId)}` : '';
  const project = fields.projectId ? ` project ${String(fields.projectId)}` : '';
  return raiseSecurityEvent(key, `${action} by ${who}${from}${project}${target}.${meta}`);
}

/** The throttle refused a sign-in (once per window per account). */
export function signInThrottled(username: string, ip: string, now = Date.now()): SecurityEvent | null {
  const f = failures.get(`t:${username.toLowerCase()}`) ?? { times: [], reported: 0 };
  failures.set(`t:${username.toLowerCase()}`, f);
  if (now - f.reported < WINDOW_MS) return null;
  f.reported = now;
  return raiseSecurityEvent('SIGNIN_THROTTLED', `Sign-in attempts for the account "${username}" are being refused by the throttle (last from ${ip}).`);
}

/** The documented list (docs/OPERATIONS.md and the test that keeps them equal). */
export const securityEventCatalogue = (): SecurityEventDef[] => DEFS.map((d) => ({ ...d }));
