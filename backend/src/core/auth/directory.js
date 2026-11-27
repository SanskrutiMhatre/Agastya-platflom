'use strict';
// Directory sign-on: the LDAPS directory, the directory AuthProvider, and the offboarding sync (audit WP-27: ENT-005, DEP-015, RES-003).
//
// Who decides what:
//   the directory      who a person is, whether their password is right, whether the account is enabled, which groups they are in
//   this platform      which directory groups mean which global role (directory_group_map, edited by administrators), project
//                      memberships, group grants, capability rules, sessions
//
// Sign-in (createDirectoryAuthProvider.authenticate):
//   1. A LOCAL account with that user name signs in locally, always (Mode A behaviour, and the break-glass administrator: it works with
//      the directory down). A directory user can therefore never take over a local account by choosing its name.
//   2. Otherwise the directory: the service account finds the entry (one exact match on the login attribute, built as a typed filter),
//      reads its groups (memberOf, or every nested group with AD's LDAP_MATCHING_RULE_IN_CHAIN), then binds as the person with their
//      password. An empty password is never sent (it would be an anonymous bind that "succeeds").
//   3. The groups are mapped to a role: admin > project_manager > author; 'auditor' only when no other role is mapped. No mapped role =
//      not authorised.
//   4. provisionUser creates the account on first sign-in (just in time) or updates role, name and DN; the directory-fed group
//      memberships are replaced with the mapped local groups. An account the directory had offboarded is enabled again; one an
//      administrator disabled is not.
//   Directory unreachable: directory users are refused with 'directory-unavailable' (the route answers 503), local accounts still work.
//
// Offboarding (syncDirectory, daily by default, and "Sync now" for administrators): every directory account is looked up with the service
// account; not found, disabled in the directory, or no longer in a mapped group -> disabled here (disabled_reason 'directory') and every
// session ended at once. A directory that cannot be reached changes nothing. A run that would offboard EVERY directory account (two or
// more) is treated as a configuration error (a wrong base DN) and changes nothing either.
//
// Audit actions (the existing audit() row format): directory.user.provisioned, directory.user.updated, directory.user.role-changed,
// directory.user.offboarded, directory.user.reinstated, directory.user.groups-changed, directory.sync, directory.sync.failed,
// auth.login.failed (reason directory-unavailable / not-authorised / disabled / bad-password / unknown-user).

const fs = require('fs');
const { LdapConnection, LdapError, RESULT, attrText, attrTexts } = require('./ldap');
const { newId, dummyVerify } = require('./crypto');
const policy = require('./policy');

const IN_CHAIN = '1.2.840.113556.1.4.1941';
const ROLE_ORDER = ['admin', 'project_manager', 'author'];
const ACCOUNTDISABLE = 0x2;

/** DNs compare case-insensitively and without the spaces around separators that tools add or drop. */
function normDn(dn) {
  return String(dn || '').trim().replace(/\s*([,=+])\s*/g, '$1').toLowerCase();
}

class DirectoryUnavailable extends Error {
  constructor(message) { super(message); this.name = 'DirectoryUnavailable'; }
}

/**
 * The directory itself. `cfg` is config.directory; `connect` and `readFile` are seams for tests.
 */
function createDirectory(cfg, { connect = (o) => LdapConnection.connect(o), readFile = (f) => fs.readFileSync(f, 'utf8') } = {}) {
  const ca = () => (cfg.caFile ? readFile(cfg.caFile) : null);
  const bindPassword = () => readFile(cfg.bindPasswordFile).replace(/\r?\n$/, '');

  /** A connection bound as the service account, trying each URL in turn. */
  async function serviceConnection() {
    const errors = [];
    for (const url of cfg.urls) {
      let c = null;
      try {
        c = await connect({ url, ca: ca(), timeoutMs: cfg.timeoutMs });
        await c.bind(cfg.bindDn, bindPassword());
        return { conn: c, url };
      } catch (e) {
        if (c) c.close();
        // A refused service bind is a configuration fault, not "this person is unknown": report it as unavailable.
        errors.push(`${url}: ${e instanceof LdapError && !e.transport ? `service account refused (${e.code}): ${e.message}` : e.message}`);
      }
    }
    throw new DirectoryUnavailable(`the directory cannot be reached (${errors.join('; ')})`);
  }

  const ATTRS = () => [cfg.loginAttribute, 'displayName', 'cn', 'memberOf', 'userAccountControl', 'objectGUID', 'entryUUID'];

  async function findEntry(conn, username) {
    const r = await conn.search({
      base: cfg.baseDn, scope: 'sub', sizeLimit: 2,
      filter: { and: [{ eq: ['objectClass', cfg.userObjectClass] }, { eq: [cfg.loginAttribute, username] }] },
      attributes: ATTRS(),
    });
    if (r.entries.length !== 1) return { entry: null, ambiguous: r.entries.length > 1 };
    return { entry: r.entries[0], ambiguous: false };
  }

  async function groupsOf(conn, entry) {
    if (!cfg.nestedGroups) return attrTexts(entry, 'memberOf');
    const r = await conn.search({
      base: cfg.groupBaseDn, scope: 'sub', sizeLimit: 1000,
      filter: { ext: { rule: IN_CHAIN, attr: 'member', value: entry.dn } }, attributes: ['1.1'],
    });
    return r.entries.map((e) => e.dn);
  }

  function identityOf(entry, groups, fallbackName) {
    const guid = entry.attrs.objectguid && entry.attrs.objectguid[0];
    const uuid = attrText(entry, 'entryUUID');
    const uac = Number(attrText(entry, 'userAccountControl') || 0);
    return {
      username: (attrText(entry, cfg.loginAttribute) || fallbackName).toLowerCase(),
      dn: entry.dn,
      externalId: guid ? `guid:${guid.toString('hex')}` : uuid ? `uuid:${uuid.toLowerCase()}` : `dn:${normDn(entry.dn)}`,
      fullName: attrText(entry, 'displayName') || attrText(entry, 'cn') || fallbackName,
      disabled: (uac & ACCOUNTDISABLE) !== 0,
      groups,
    };
  }

  return {
    config: cfg,
    /**
     * Check a password. { ok: true, identity } | { ok: false, reason: 'unknown-user' | 'bad-password' | 'disabled', identity? }.
     * Throws DirectoryUnavailable when no directory server answers.
     */
    async authenticate(username, password) {
      const { conn } = await serviceConnection();
      try {
        const { entry } = await findEntry(conn, username);
        if (!entry) return { ok: false, reason: 'unknown-user' };
        const groups = await groupsOf(conn, entry);
        const identity = identityOf(entry, groups, username);
        if (!password) return { ok: false, reason: 'bad-password' };
        try { await conn.bind(entry.dn, password); } catch (e) {
          if (e instanceof LdapError && !e.transport && e.code === RESULT.invalidCredentials) {
            return identity.disabled ? { ok: false, reason: 'disabled', identity } : { ok: false, reason: 'bad-password' };
          }
          throw e instanceof LdapError && e.transport ? new DirectoryUnavailable(e.message) : e;
        }
        if (identity.disabled) return { ok: false, reason: 'disabled', identity };
        return { ok: true, identity };
      } catch (e) {
        if (e instanceof LdapError && e.transport) throw new DirectoryUnavailable(e.message);
        throw e;
      } finally { conn.close(); }
    },
    /** Look several people up with one service connection (the sync job). Map of user name -> identity, or null when not found. */
    async lookupMany(usernames) {
      const { conn } = await serviceConnection();
      try {
        const out = new Map();
        for (const u of usernames) {
          const { entry } = await findEntry(conn, u);
          out.set(u, entry ? identityOf(entry, await groupsOf(conn, entry), u) : null);
        }
        return out;
      } catch (e) {
        if (e instanceof LdapError && e.transport) throw new DirectoryUnavailable(e.message);
        throw e;
      } finally { conn.close(); }
    },
    /** Connection test for the administrator: reach a server, bind as the service account, optionally find one person (no password). */
    async test(username) {
      const started = Date.now();
      const { conn, url } = await serviceConnection();
      try {
        let found = null;
        if (username) {
          const { entry, ambiguous } = await findEntry(conn, username);
          found = entry ? { dn: entry.dn, groups: await groupsOf(conn, entry) } : { dn: null, ambiguous };
        }
        return { ok: true, url, ms: Date.now() - started, found };
      } finally { conn.close(); }
    },
  };
}

/**
 * The global role and local groups a set of directory groups maps to, from the administrator's table (access.listDirectoryMappings()).
 * Returns null when no mapped group gives a role (the person is not authorised to use the platform).
 */
function mapGroups(groupDns, mappings) {
  const mine = new Set(groupDns.map(normDn));
  const hits = mappings.filter((m) => mine.has(normDn(m.group_dn)));
  const roles = new Set(hits.map((m) => m.global_role).filter(Boolean));
  const role = ROLE_ORDER.find((r) => roles.has(r)) || (roles.has('auditor') ? 'author' : null);
  if (!role) return null;
  const auditor = !ROLE_ORDER.some((r) => roles.has(r)) && roles.has('auditor');
  return { role, auditor, groupIds: [...new Set(hits.map((m) => m.group_id).filter(Boolean))].sort() };
}

/**
 * The AuthProvider for Mode B with a directory. `local` is the local provider (used for every local account); `access` the access
 * repository (repositories/accessRepository.ts); `directory` from createDirectory.
 */
function createDirectoryAuthProvider({ store, access, sessions = null, local, directory, audit = (_row) => {}, now = () => new Date().toISOString() }) {
  /** Disable an account the directory no longer allows, end its sessions at once. Idempotent. */
  function offboard(user, reason, by = null) {
    if (!user || user.auth_source !== 'directory') return false;
    if (user.disabled_at) return false;
    const t = now();
    store.updateUser(user.id, { disabled_at: t, disabled_reason: 'directory' }, t);
    const ended = store.revokeAllSessionsForUser(user.id, 'account-disabled', t);
    audit({ actorId: by ? by.id : null, actorUsername: by ? by.username : 'directory', action: 'directory.user.offboarded', targetType: 'user', targetId: user.id, meta: { username: user.username, reason, sessionsEnded: ended } });
    return true;
  }

  function lastActiveAdmin(user) {
    return user.role === 'admin' && store.listUsers().filter((u) => u.role === 'admin' && !u.disabled_at).length <= 1;
  }

  /** Create (first sign-in) or update the account of a directory identity that the mapping allows. Returns the account row. */
  function provisionUser(identity) {
    const decision = identity.decision || mapGroups(identity.groups || [], access.listDirectoryMappings());
    if (!decision) throw Object.assign(new Error('no mapped directory group gives this person a role'), { code: 'NOT_AUTHORISED' });
    const t = now();
    let user = store.findUserByExternalId(identity.externalId);
    if (!user) {
      const byName = store.findUserByUsername(identity.username);
      if (byName && byName.auth_source === 'directory') user = byName;                 // the directory changed the entry's id (restored object)
      else if (byName) throw Object.assign(new Error(`a local account named ${identity.username} exists`), { code: 'LOCAL_ACCOUNT_EXISTS' });
    }
    if (!user) {
      const u = policy.validateUsername(identity.username);
      if (!u.ok) throw Object.assign(new Error(`the directory user name "${identity.username}" cannot be used here: ${u.error}`), { code: 'INVALID_USERNAME' });
      const fullName = policy.validateFullName(identity.fullName).ok ? policy.validateFullName(identity.fullName).fullName : u.username;
      user = store.createUser({
        id: newId(), username: u.username, fullName, role: decision.role,
        passwordHash: '!directory', mustChangePassword: 0, onboardingPending: 0, usernameLocked: 1, createdBy: null, now: t,
      });
      user = store.updateUser(user.id, { auth_source: 'directory', external_id: identity.externalId, directory_dn: identity.dn, directory_checked_at: t, auditor: decision.auditor ? 1 : 0 }, t);
      audit({ actorId: null, actorUsername: 'directory', action: 'directory.user.provisioned', targetType: 'user', targetId: user.id, meta: { username: user.username, role: decision.role, auditor: decision.auditor, dn: identity.dn } });
    } else {
      const fields = { external_id: identity.externalId, directory_dn: identity.dn, directory_checked_at: t, auditor: decision.auditor ? 1 : 0 };
      const name = policy.validateFullName(identity.fullName);
      if (name.ok && name.fullName !== user.full_name) fields.full_name = name.fullName;
      if (decision.role !== user.role) {
        if (lastActiveAdmin(user)) {
          audit({ actorId: null, actorUsername: 'directory', action: 'directory.user.role-kept', targetType: 'user', targetId: user.id, meta: { username: user.username, kept: user.role, mapped: decision.role, why: 'last active administrator' } });
        } else {
          fields.role = decision.role;
          audit({ actorId: null, actorUsername: 'directory', action: 'directory.user.role-changed', targetType: 'user', targetId: user.id, meta: { username: user.username, from: user.role, to: decision.role } });
        }
      }
      if (user.disabled_at && user.disabled_reason === 'directory') {
        fields.disabled_at = null; fields.disabled_reason = null;
        audit({ actorId: null, actorUsername: 'directory', action: 'directory.user.reinstated', targetType: 'user', targetId: user.id, meta: { username: user.username } });
      }
      if (Boolean(user.auditor) !== decision.auditor) audit({ actorId: null, actorUsername: 'directory', action: 'directory.user.updated', targetType: 'user', targetId: user.id, meta: { username: user.username, auditor: decision.auditor } });
      user = store.updateUser(user.id, fields, t);
    }
    const g = access.replaceDirectoryMemberships(user.id, decision.groupIds, t);
    if (g.added.length || g.removed.length) {
      store.emitAccessChanged(user.id);
      audit({ actorId: null, actorUsername: 'directory', action: 'directory.user.groups-changed', targetType: 'user', targetId: user.id, meta: { username: user.username, added: g.added, removed: g.removed } });
    }
    return user;
  }

  return {
    kind: 'directory',
    directory,
    offboard,
    async authenticate({ username, password }) {
      const existing = store.findUserByUsername(username);
      // 1. Local accounts (and the break-glass administrator) never depend on the directory.
      if (existing && existing.auth_source !== 'directory') return local.authenticate({ username, password });
      if (!password) { await dummyVerify(''); return { ok: false, user: existing || undefined, reason: existing ? 'bad-password' : 'unknown-user' }; }
      let r;
      try { r = await directory.authenticate(String(username).trim(), password); } catch (e) {
        if (e instanceof DirectoryUnavailable) return { ok: false, user: existing || undefined, reason: 'directory-unavailable', detail: e.message };
        throw e;
      }
      if (!r.ok) {
        if ((r.reason === 'unknown-user' || r.reason === 'disabled') && existing) offboard(existing, r.reason === 'disabled' ? 'disabled in the directory' : 'not found in the directory');
        return { ok: false, user: existing || undefined, reason: r.reason };
      }
      const decision = mapGroups(r.identity.groups, access.listDirectoryMappings());
      if (!decision) {
        const linked = store.findUserByExternalId(r.identity.externalId) || existing;
        offboard(linked, 'no longer in a mapped directory group');
        return { ok: false, user: linked || undefined, reason: 'not-authorised' };
      }
      let user;
      try { user = provisionUser({ ...r.identity, decision }); } catch (e) {
        if (e.code === 'LOCAL_ACCOUNT_EXISTS' || e.code === 'INVALID_USERNAME') return { ok: false, user: existing || undefined, reason: 'not-authorised', detail: e.message };
        throw e;
      }
      if (user.disabled_at) return { ok: false, user, reason: 'disabled' };          // an administrator disabled it here: the directory does not override that
      return { ok: true, user, viaMaster: false, source: 'directory' };
    },
    resolveSession(cookieHeader) {
      return sessions ? sessions.resolveFromCookieHeader(cookieHeader || '') : null;
    },
    provisionUser,
  };
}

/**
 * The offboarding sync. Returns { checked, offboarded, updated, failed? }. Never changes anything when the directory cannot be reached,
 * or when it would offboard every directory account (a misconfiguration, not a mass departure).
 */
/**
 * @param {{ store: any, access: any, provider: any, audit?: (row: any) => void, by?: { id: string, username: string } | null }} opts
 */
async function syncDirectory({ store, access, provider, audit = (_row) => {}, by = null }) {
  const users = store.listDirectoryUsers();
  const actor = by ? { actorId: by.id, actorUsername: by.username } : { actorId: null, actorUsername: 'directory' };
  if (!users.length) { audit({ ...actor, action: 'directory.sync', meta: { checked: 0, offboarded: 0, updated: 0 } }); return { checked: 0, offboarded: 0, updated: 0 }; }
  let found;
  try { found = await provider.directory.lookupMany(users.map((u) => u.username)); } catch (e) {
    audit({ ...actor, action: 'directory.sync.failed', meta: { error: e.message } });
    return { checked: 0, offboarded: 0, updated: 0, failed: e.message };
  }
  const mappings = access.listDirectoryMappings();
  const verdicts = users.map((u) => {
    const id = found.get(u.username);
    if (!id) return { u, out: 'not found in the directory' };
    if (id.disabled) return { u, out: 'disabled in the directory' };
    const decision = mapGroups(id.groups, mappings);
    if (!decision) return { u, out: 'no longer in a mapped directory group' };
    return { u, id, decision };
  });
  const leaving = verdicts.filter((v) => v.out && !v.u.disabled_at);
  const active = users.filter((u) => !u.disabled_at);
  if (active.length >= 2 && leaving.length === active.length) {
    const msg = `the sync would disable all ${active.length} directory accounts; nothing was changed (check AGASTYA_DIRECTORY_BASE_DN and the group mapping)`;
    audit({ ...actor, action: 'directory.sync.failed', meta: { error: msg } });
    return { checked: users.length, offboarded: 0, updated: 0, failed: msg };
  }
  let offboarded = 0; let updated = 0;
  for (const v of verdicts) {
    if (v.out) { if (provider.offboard(v.u, v.out, by)) offboarded++; continue; }
    if (v.u.disabled_at) continue;                                  // re-enabling waits for the person's own next sign-in
    const before = JSON.stringify([v.u.role, v.u.auditor, access.groupIdsForUser(v.u.id)]);
    try { provider.provisionUser({ ...v.id, decision: v.decision }); } catch { continue; }
    const after = store.getUser(v.u.id);
    if (JSON.stringify([after.role, after.auditor, access.groupIdsForUser(v.u.id)]) !== before) updated++;
  }
  audit({ ...actor, action: 'directory.sync', meta: { checked: users.length, offboarded, updated } });
  return { checked: users.length, offboarded, updated };
}

module.exports = { createDirectory, createDirectoryAuthProvider, syncDirectory, mapGroups, normDn, DirectoryUnavailable };
