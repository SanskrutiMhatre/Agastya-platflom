'use strict';
// =============================================================================
// The audit chain (audit WP-29: ENT-003, G-SEC-4). Plain JavaScript because the AuthStore (store.js) and the offline tools
// (scripts/reset-admin.js, scripts/agastya-audit.js) load it from src/ as well as from dist/.
//
// Every audit row written by this build carries
//   seq        1, 2, 3 ... with no gap (a unique index refuses a second row with the same number)
//   prev_hash  the row_hash of the row before it (GENESIS for seq 1)
//   row_hash   HMAC-SHA-256 over the row's canonical content and prev_hash, with a key kept OUTSIDE the database
//   chain_key  the first 16 hex digits of SHA-256(key), so a verification with the wrong key says so instead of "every row changed"
//
// So an edited row, a deleted middle row and an inserted (forged) row are each detected by `verifyRows`, and deleting the newest rows
// is detected against a checkpoint (seq + row_hash, signed with the same key) kept outside the database: in the backup folder and
// in the Windows Application log. Two limits are inherent and documented (docs/OPERATIONS.md, section 13): someone who holds the key
// can rebuild the whole chain, and a cut at the tail is only visible against a checkpoint taken after it (Schneier-Kelsey).
//
// Rows written before the chain existed keep seq NULL; they are counted as "before the chain" and never rewritten (additive migration).
// Retention (services/dataProtection.ts) removes the oldest rows after archiving them; it records the last removed row as the
// chain's anchor, so the first remaining row is checked against it rather than against GENESIS.
// =============================================================================

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FORMAT = 'agastya-audit-chain/1';
/** prev_hash of the first row of a chain. */
const GENESIS = crypto.createHash('sha256').update(`${FORMAT} genesis`).digest('hex');

/** Where the key lives when AGASTYA_AUDIT_KEY_FILE does not say: beside the database, in its own folder (the packaged product points
 *  it at the state folder instead, outside the data folder). */
function defaultKeyFile(workspaceDir, env) {
  const v = env && env.AGASTYA_AUDIT_KEY_FILE;
  return v && String(v).trim() ? path.resolve(String(v).trim()) : path.join(workspaceDir, 'audit-key', 'audit-hmac.key');
}

const keyIdOf = (key) => crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);

/**
 * Read the key, or make one (32 random bytes, hex, owner-only where the file system knows modes) when the file does not exist.
 * A file that exists but does not hold a key is an error: a silent new key would make every earlier row unverifiable.
 */
function loadOrCreateKey(file, { create = true } = {}) {
  let text = null;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (text === null) {
    if (!create) return null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fresh = crypto.randomBytes(32).toString('hex');
    try {
      fs.writeFileSync(file, `${fresh}\n`, { flag: 'wx', mode: 0o600 });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;          // another process made it first: use theirs
    }
    text = fs.readFileSync(file, 'utf8');
  }
  const hex = text.trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error(`The audit key file ${file} does not hold a key (64 hex digits). Restore it from where it was kept; do not delete it.`);
  const key = Buffer.from(hex, 'hex');
  return { key, id: keyIdOf(key), file };
}

/** The fields a row hash covers, in a fixed order; meta is hashed as stored (the JSON text), so reading it back cannot change it. */
function canonical(row) {
  const v = (x) => (x === undefined || x === null ? null : String(x));
  return JSON.stringify([FORMAT, Number(row.seq), v(row.at), v(row.actor_id), v(row.actor_username), v(row.ip), v(row.action),
    v(row.target_type), v(row.target_id), v(row.project_id), v(row.meta), v(row.prev_hash)]);
}

const hmac = (key, text) => crypto.createHmac('sha256', key).update(text).digest('hex');
const rowHash = (key, row) => hmac(key, canonical(row));

/** A checkpoint is "the chain had seq rows and ended in hash" at a time, signed with the key. */
function signCheckpoint(key, cp) {
  return hmac(key, JSON.stringify([FORMAT, 'checkpoint', Number(cp.seq), String(cp.row_hash), String(cp.at), String(cp.chain_key)]));
}
function checkpointValid(key, cp) {
  try {
    const want = Buffer.from(signCheckpoint(key, cp), 'hex'); const got = Buffer.from(String(cp.signature || ''), 'hex');
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  } catch { return false; }
}

/**
 * Walk a chain. `rows` is an iterable of audit rows with seq NOT NULL, in seq order (the caller pages them out of the database);
 * `start` is { seq, hash } of the anchor (the row before the first one present) or null for a chain that starts at GENESIS.
 * Returns the problems found (at most `maxProblems` listed, all counted) and the head.
 */
function verifyRows(key, keyId, rows, start, maxProblems = 50) {
  const problems = []; let count = 0;
  const add = (p) => { count++; if (problems.length < maxProblems) problems.push(p); };
  let expectSeq = start ? Number(start.seq) + 1 : 1;
  let prev = start ? String(start.hash) : GENESIS;
  let n = 0; let head = start ? { seq: Number(start.seq), hash: String(start.hash) } : { seq: 0, hash: GENESIS };
  let wrongKey = 0;
  for (const r of rows) {
    n++;
    const seq = Number(r.seq);
    if (seq !== expectSeq) {
      add(seq > expectSeq
        ? { kind: 'missing', id: r.id, seq, message: `rows ${expectSeq}${seq - 1 > expectSeq ? `-${seq - 1}` : ''} of the chain are missing (deleted) before row id ${r.id}` }
        : { kind: 'out-of-order', id: r.id, seq, message: `row id ${r.id} repeats or goes back to sequence ${seq} (expected ${expectSeq})` });
    }
    if (r.chain_key && keyId && r.chain_key !== keyId) wrongKey++;
    if (String(r.prev_hash) !== prev) add({ kind: 'link', id: r.id, seq, message: `row id ${r.id} (sequence ${seq}) does not follow the row before it (its link was changed, or a row was removed or inserted before it)` });
    if (rowHash(key, r) !== String(r.row_hash)) add({ kind: 'content', id: r.id, seq, message: `row id ${r.id} (sequence ${seq}) was changed after it was written, or was not written by this platform` });
    prev = String(r.row_hash); expectSeq = seq + 1; head = { seq, hash: String(r.row_hash) };
  }
  return { rows: n, problems, problemCount: count, head, wrongKey };
}

module.exports = { FORMAT, GENESIS, defaultKeyFile, loadOrCreateKey, keyIdOf, canonical, rowHash, signCheckpoint, checkpointValid, verifyRows };
