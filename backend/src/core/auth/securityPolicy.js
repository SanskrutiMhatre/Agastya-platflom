'use strict';
// The platform's account and session policy (audit WP-03: SEC-016, ENT-010, PLT-022, PLT-015, ENT-009, RES-009).
// One record, `config_items` collection "security-policy", edited by an administrator (GET/PUT /api/admin/security-policy).
//
//   idleMinutes         a session ends after this long without activity (0 = no idle limit). Default 30 (gate G-SEC-3).
//                       Activity is any request the person makes, and the client's activity signal while they type or
//                       click in an editor that has not saved yet, so a working author is never signed out mid-edit.
//   absoluteHours       a session ends this long after sign-in whatever happens. Default 12 (one working day).
//   singleSession       a new sign-in ends the account's other sessions (the person is told why, UX-022). Default on.
//   separationOfDuties  the person who requests a release may not approve it (D7: enforced by default; an administrator may
//                       switch it off for a one-person installation, and the switch is in the audit log). Default on.
//   passwordMinLength   the shortest password a person may choose (NIST SP 800-63B-4 single-factor: 15). Default 15.
//                       Existing passwords keep working; the rule applies when a password is set.

const COLLECTION = 'security-policy';
const DEFAULTS = Object.freeze({ idleMinutes: 30, absoluteHours: 12, singleSession: true, separationOfDuties: true, passwordMinLength: 15 });
const RANGES = { idleMinutes: [5, 1440], absoluteHours: [1, 720], passwordMinLength: [8, 64] };

function createSecurityPolicy(store, nowIso = () => new Date().toISOString()) {
  let cache = null; let cachedAt = 0;

  function read() {
    if (cache && Date.now() - cachedAt < 5000) return cache;
    let row = null;
    try { row = store.configGet(COLLECTION, 'main'); } catch { row = null; }
    const p = { ...DEFAULTS };
    if (row) {
      if (Number.isInteger(row.idleMinutes) && (row.idleMinutes === 0 || (row.idleMinutes >= RANGES.idleMinutes[0] && row.idleMinutes <= RANGES.idleMinutes[1]))) p.idleMinutes = row.idleMinutes;
      if (Number.isInteger(row.absoluteHours) && row.absoluteHours >= RANGES.absoluteHours[0] && row.absoluteHours <= RANGES.absoluteHours[1]) p.absoluteHours = row.absoluteHours;
      if (typeof row.singleSession === 'boolean') p.singleSession = row.singleSession;
      if (typeof row.separationOfDuties === 'boolean') p.separationOfDuties = row.separationOfDuties;
      if (Number.isInteger(row.passwordMinLength) && row.passwordMinLength >= RANGES.passwordMinLength[0] && row.passwordMinLength <= RANGES.passwordMinLength[1]) p.passwordMinLength = row.passwordMinLength;
    }
    cache = Object.freeze(p); cachedAt = Date.now();
    return cache;
  }

  /* Validate and save; returns { policy } or { error }. */
  function write(body) {
    const cur = read(); const next = { ...cur }; const b = body || {};
    for (const k of ['idleMinutes', 'absoluteHours', 'passwordMinLength']) {
      if (b[k] === undefined) continue;
      const v = Number(b[k]);
      const [lo, hi] = RANGES[k];
      if (!Number.isInteger(v) || (k === 'idleMinutes' ? !(v === 0 || (v >= lo && v <= hi)) : (v < lo || v > hi))) {
        return { error: `${k} must be a whole number from ${lo} to ${hi}${k === 'idleMinutes' ? ' (or 0 for no idle limit)' : ''}.` };
      }
      next[k] = v;
    }
    for (const k of ['singleSession', 'separationOfDuties']) if (b[k] !== undefined) next[k] = !!b[k];
    if (next.idleMinutes && next.idleMinutes > next.absoluteHours * 60) return { error: 'The idle limit cannot be longer than the absolute limit.' };
    store.configPut(COLLECTION, 'main', next, nowIso());
    cache = null;
    return { policy: read() };
  }

  /*
    Separation of duties on release (D7, PLT-015, ENT-009): the message to refuse with when `approverId` requested the
    release themselves and the policy forbids it, otherwise null. Applies to approval only: a requester may still withdraw
    (reject) their own request.
  */
  function approverConflict(requestedBy, approverId) {
    if (!read().separationOfDuties) return null;
    if (requestedBy && approverId && requestedBy === approverId) {
      return 'You requested this release, so someone else must approve it (separation of duties). An administrator can allow self-approval for a one-person installation under Settings > Security.';
    }
    return null;
  }

  return { read, write, approverConflict, DEFAULTS };
}

module.exports = { createSecurityPolicy, DEFAULTS };
