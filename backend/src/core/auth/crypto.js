'use strict';
// Password hashing and token primitives.
//
// Argon2id through the prebuilt native binding is REQUIRED (WP-13, ARC-019): `argon2` is a regular dependency of the package, and the server
// refuses to start when it does not load (assertPasswordHashing, called from index.ts), naming the cause. It used to be optional with a scrypt
// fallback, and a database moved to a build without the module locked out every user whose hash was Argon2.
//
// scrypt remains only to VERIFY hashes written by older builds that ran the fallback ($scrypt$...), and it runs off the event loop
// (crypto.scrypt on the thread pool; PERF-017: scryptSync blocked the server about 144 ms per login). New hashes are always Argon2id;
// needsRehash() tells the login route to upgrade an old scrypt hash after a successful sign-in.
//
// Nothing in this module ever logs or returns plaintext material.

const crypto = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(crypto.scrypt);

let argon2 = null;
let argon2Error = null;
try { argon2 = require('argon2'); } catch (e) { argon2 = null; argon2Error = e; }

/** Throws a clear error when Argon2 is unavailable. The server calls it before it listens; scripts call it before they write a hash. */
function assertPasswordHashing() {
  if (argon2) return;
  const why = argon2Error ? `: ${String(argon2Error.message || argon2Error).split(/\r?\n/)[0]}` : '';
  throw new Error(`The password-hashing module (argon2, a native module of the server package) does not load${why}. `
    + 'Reinstall the program (for a source checkout run "npm install" in backend/). The server does not start without it: no stored password could be checked.');
}

async function scryptVerify(stored, password) {
  const m = /^\$scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/.exec(stored);
  if (!m) return false;
  const [, N, r, p, saltB64, keyB64] = m;
  const salt = Buffer.from(saltB64, 'base64');
  const expect = Buffer.from(keyB64, 'base64');
  let key;
  try {
    key = await scryptAsync(Buffer.from(String(password), 'utf8'), salt, expect.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 128 * Number(N) * Number(r) * 2,
    });
  } catch { return false; }
  return key.length === expect.length && crypto.timingSafeEqual(key, expect);
}

async function hashPassword(password) {
  assertPasswordHashing();
  return argon2.hash(String(password), { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 });
}

async function verifyPassword(stored, password) {
  if (!stored || typeof stored !== 'string') return false;
  if (stored.startsWith('$argon2')) {
    assertPasswordHashing(); // a missing module is an installation fault, never a silent "wrong password"
    try { return await argon2.verify(stored, String(password)); } catch { return false; }
  }
  if (stored.startsWith('$scrypt$')) return scryptVerify(stored, password);
  return false;
}

/** True for a stored hash that is not Argon2id (an old scrypt hash): the login route re-hashes it with the password it has just verified. */
function needsRehash(stored) {
  return typeof stored === 'string' && stored.startsWith('$scrypt$');
}

// A constant-cost verification against a throwaway hash, run when the
// username does not exist, so "no such user" and "wrong password" take the
// same time — no enumeration via response latency.
let dummyHashPromise = null;
async function dummyVerify(password) {
  if (!dummyHashPromise) dummyHashPromise = hashPassword(crypto.randomBytes(16).toString('hex'));
  const dummy = await dummyHashPromise;
  await verifyPassword(dummy, String(password || ''));
  return false;
}

// Opaque session token: 256 bits, URL-safe. Only its SHA-256 is stored.
function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function sha256hex(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

function newId() {
  return crypto.randomUUID();
}

module.exports = {
  hashPassword, verifyPassword, needsRehash, dummyVerify, newToken, sha256hex, newId, assertPasswordHashing,
  usingArgon2: () => !!argon2,
};
