'use strict';
// Password hashing and token primitives.
//
// Argon2id via the prebuilt native binding when it loads; otherwise scrypt
// from node:crypto (always available, no native dependency) so an install
// where the binding cannot load still authenticates — both formats are
// self-describing PHC-style strings, so a database written under one
// algorithm verifies fine after switching to the other.
//
// Nothing in this module ever logs or returns plaintext material.

const crypto = require('crypto');

let argon2 = null;
try { argon2 = require('argon2'); } catch { argon2 = null; }

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 32, saltlen: 16 };

function scryptHash(password) {
  const salt = crypto.randomBytes(SCRYPT.saltlen);
  const key = crypto.scryptSync(Buffer.from(String(password), 'utf8'), salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 128 * SCRYPT.N * SCRYPT.r * 2,
  });
  return `$scrypt$N=${SCRYPT.N},r=${SCRYPT.r},p=${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function scryptVerify(stored, password) {
  const m = /^\$scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/.exec(stored);
  if (!m) return false;
  const [, N, r, p, saltB64, keyB64] = m;
  const salt = Buffer.from(saltB64, 'base64');
  const expect = Buffer.from(keyB64, 'base64');
  let key;
  try {
    key = crypto.scryptSync(Buffer.from(String(password), 'utf8'), salt, expect.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 128 * Number(N) * Number(r) * 2,
    });
  } catch { return false; }
  return key.length === expect.length && crypto.timingSafeEqual(key, expect);
}

async function hashPassword(password) {
  if (argon2) {
    return argon2.hash(String(password), { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 4 });
  }
  return scryptHash(password);
}

async function verifyPassword(stored, password) {
  if (!stored || typeof stored !== 'string') return false;
  if (stored.startsWith('$argon2')) {
    if (!argon2) return false; // argon2 hash but binding unavailable: cannot verify
    try { return await argon2.verify(stored, String(password)); } catch { return false; }
  }
  if (stored.startsWith('$scrypt$')) return scryptVerify(stored, password);
  return false;
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
  hashPassword, verifyPassword, dummyVerify, newToken, sha256hex, newId,
  usingArgon2: () => !!argon2,
};
