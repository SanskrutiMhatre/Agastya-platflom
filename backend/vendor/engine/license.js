'use strict';
// Time-limited licensing.
//
// A key is a signed statement, not a secret: "<payload>.<signature>", where the
// payload is base64url JSON and the signature is Ed25519 over the payload bytes,
// made with the vendor's private key. The app ships only the PUBLIC key, so it
// can check a key but cannot mint one — a customer who reads every line of the
// source still cannot produce a valid key for a later date.
//
// What this does NOT do is make the app uncrackable. An Electron app is
// JavaScript on the customer's disk; anyone willing to edit it can remove the
// check entirely. Signing defeats casual key sharing and forged expiry dates,
// which is the realistic threat. Treat it as a licence-compliance mechanism,
// not as copy protection.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Ed25519 SPKI DER, base64. Replace with your own from `npm run license:keygen`;
// the matching private key must never ship with the app.
const DEFAULT_PUBLIC_KEY =
    'MCowBQYDK2VwAyEAyl/JTQx9vVyjPTBO4RehCwLOOAcb+kKmOyEiw9HI9R4=';

const b64urlToBuf = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const bufToB64url = (b) => Buffer.from(b).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function publicKeyObject(b64) {
    return crypto.createPublicKey({
        key: Buffer.from(b64, 'base64'),
        format: 'der',
        type: 'spki',
    });
}

/*
  A stable, non-identifying machine fingerprint.

  Only used when a key opts into binding (payload.machine). Hashed so the stored
  licence file never contains the raw hostname or MAC of the customer's machine.
*/
function machineId() {
    const os = require('os');
    const nics = Object.values(os.networkInterfaces()).flat()
        .filter((n) => n && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00')
        .map((n) => n.mac)
        .sort();
    return crypto.createHash('sha256')
        .update([os.hostname(), os.platform(), os.arch(), nics[0] || ''].join('|'))
        .digest('hex')
        .slice(0, 32);
}

/*
  Parse and cryptographically verify a key. Returns { ok, reason, payload }.

  `reason` is a stable code the UI can map to a message: 'malformed',
  'bad-signature', 'expired', 'not-yet-valid', 'wrong-machine'.
*/
function verifyKey(key, opts) {
    const o = opts || {};
    const now = o.now instanceof Date ? o.now : new Date();
    const pub = o.publicKey || DEFAULT_PUBLIC_KEY;

    const raw = String(key || '').trim().replace(/\s+/g, '');
    const dot = raw.lastIndexOf('.');
    if (dot < 1 || dot === raw.length - 1) return { ok: false, reason: 'malformed' };

    const payloadPart = raw.slice(0, dot);
    let payload;
    try {
        payload = JSON.parse(b64urlToBuf(payloadPart).toString('utf8'));
    } catch { return { ok: false, reason: 'malformed' }; }
    if (!payload || typeof payload !== 'object') return { ok: false, reason: 'malformed' };

    let good = false;
    try {
        good = crypto.verify(null, Buffer.from(payloadPart, 'utf8'),
            publicKeyObject(pub), b64urlToBuf(raw.slice(dot + 1)));
    } catch { return { ok: false, reason: 'bad-signature' }; }
    // Signature is checked before any field is trusted: until it passes, the
    // expiry date in the payload is just an attacker-supplied string.
    if (!good) return { ok: false, reason: 'bad-signature' };

    if (payload.notBefore && now < new Date(payload.notBefore)) {
        return { ok: false, reason: 'not-yet-valid', payload };
    }
    if (!payload.expires) return { ok: false, reason: 'malformed', payload };
    if (now > new Date(payload.expires)) return { ok: false, reason: 'expired', payload };

    if (payload.machine && payload.machine !== (o.machineId || machineId())) {
        return { ok: false, reason: 'wrong-machine', payload };
    }
    return { ok: true, payload };
}

function daysLeft(payload, now) {
    const end = new Date(payload.expires).getTime();
    const from = (now instanceof Date ? now : new Date()).getTime();
    return Math.max(0, Math.ceil((end - from) / 86400000));
}

// ---------------------------------------------------------------------------
// Stored licence state
// ---------------------------------------------------------------------------

function statePath(dir) { return path.join(dir, 'license.json'); }

function readState(dir) {
    try { return JSON.parse(fs.readFileSync(statePath(dir), 'utf8')); } catch { return null; }
}

function writeState(dir, state) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(statePath(dir), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/*
  Check the installed licence.

  Also guards against the obvious dodge of winding the system clock back past
  the expiry date: the highest time ever observed is recorded, and if `now` is
  meaningfully behind it the check fails with 'clock-tampered' rather than
  silently accepting. A day of slack absorbs timezone and DST noise.
*/
const CLOCK_SLACK_MS = 86400000;

function checkInstalled(dir, opts) {
    const o = opts || {};
    const now = o.now instanceof Date ? o.now : new Date();
    const state = readState(dir);
    if (!state || !state.key) return { ok: false, reason: 'no-license' };

    const seen = state.lastSeen ? new Date(state.lastSeen).getTime() : 0;
    if (seen && now.getTime() < seen - CLOCK_SLACK_MS) {
        return { ok: false, reason: 'clock-tampered', payload: state.payload };
    }

    const res = verifyKey(state.key, { ...o, now });
    if (res.ok) {
        writeState(dir, {
            ...state,
            payload: res.payload,
            lastSeen: new Date(Math.max(now.getTime(), seen)).toISOString(),
        });
        return { ...res, daysLeft: daysLeft(res.payload, now) };
    }
    return res;
}

// Validate before storing, so an unusable key is never written to disk.
function activate(dir, key, opts) {
    const res = verifyKey(key, opts);
    if (!res.ok) return res;
    const now = (opts && opts.now instanceof Date) ? opts.now : new Date();
    writeState(dir, {
        key: String(key).trim(),
        payload: res.payload,
        activatedAt: now.toISOString(),
        lastSeen: now.toISOString(),
    });
    return { ...res, daysLeft: daysLeft(res.payload, now) };
}

function deactivate(dir) {
    try { fs.unlinkSync(statePath(dir)); return true; } catch { return false; }
}

const MESSAGES = {
    'no-license': 'No licence installed. Enter a licence key to continue.',
    malformed: 'That licence key is not readable. Check it was copied in full.',
    'bad-signature': 'That licence key is not valid for this product.',
    expired: 'This licence has expired. Contact your supplier to renew it.',
    'not-yet-valid': 'This licence is not active yet.',
    'wrong-machine': 'This licence is registered to a different machine.',
    'clock-tampered': 'The system clock is behind the last recorded use. Set the correct date and try again.',
};

module.exports = {
    verifyKey, checkInstalled, activate, deactivate, machineId, daysLeft,
    readState, writeState, MESSAGES, DEFAULT_PUBLIC_KEY, bufToB64url,
};
