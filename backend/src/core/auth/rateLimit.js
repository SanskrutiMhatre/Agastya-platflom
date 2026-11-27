'use strict';
// Sign-in throttle (audit WP-03: SEC-007, PLT-023, REL-006, ENT-011).
//
// Two sliding windows, both checked BEFORE any credential work so a limited caller learns nothing about the account:
//
//   * per account: at most MAX_ATTEMPTS attempts per WINDOW_MS for a username, from every address together. It is kept in
//     the database when a store is given, so a restart does not reset it. (The former key "username|ip" let anyone guess
//     without limit by rotating usernames or addresses, and was lost on every restart.)
//   * per address: at most IP_MAX_ATTEMPTS failed attempts per window from one client address over all usernames, in
//     memory: it catches one address cycling through many usernames. A successful sign-in does not count against it, so
//     an office behind one address is not locked out by its own people.
//
// The forgot-password queue and first-run setup share this throttle (same key space), so they cannot be used to probe
// accounts faster than sign-in can. The address is clientIp(), which honours the trust-proxy setting (SEC-008).

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const IP_MAX_ATTEMPTS = 100;

class RateLimiter {
  constructor({ windowMs = WINDOW_MS, max = MAX_ATTEMPTS, ipMax = IP_MAX_ATTEMPTS, now = () => Date.now(), store = null } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.ipMax = ipMax;
    this.now = now;
    this.store = store;
    this.accounts = new Map(); // key -> [timestamps], used when there is no store
    this.ips = new Map();      // ip -> [timestamps]
  }

  key(username) {
    return String(username || '').toLowerCase();
  }

  _window(arr, t) { return arr.filter((x) => t - x < this.windowMs); }

  _readAccount(k, t) {
    if (this.store) { try { return this._window(this.store.throttleGet(k), t); } catch { /* fall through to memory */ } }
    return this._window(this.accounts.get(k) || [], t);
  }

  _writeAccount(k, arr) {
    if (this.store) {
      try { this.store.throttlePut(k, arr, new Date(this.now()).toISOString()); return; } catch { /* fall through to memory */ }
    }
    if (arr.length) this.accounts.set(k, arr); else this.accounts.delete(k);
  }

  _deny(arr, t, max) {
    if (arr.length < max) return null;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((arr[0] + this.windowMs - t) / 1000)) };
  }

  /*
    Record an attempt. Returns { allowed: true } or { allowed: false, retryAfterSeconds } for a 429 with Retry-After.
  */
  attempt(username, ip) {
    const t = this.now();
    const k = this.key(username);
    const ipKey = String(ip || '');
    const ipArr = this._window(this.ips.get(ipKey) || [], t);
    const byIp = this._deny(ipArr, t, this.ipMax);
    if (byIp) return byIp;
    const acc = this._readAccount(k, t);
    const byAccount = this._deny(acc, t, this.max);
    if (byAccount) return byAccount;
    acc.push(t); this._writeAccount(k, acc);
    ipArr.push(t); this.ips.set(ipKey, ipArr);
    // Opportunistic cleanup so long-running servers don't accumulate keys.
    if (this.ips.size > 10000) for (const [key, list] of this.ips) if (!list.length || t - list[list.length - 1] > this.windowMs) this.ips.delete(key);
    if (this.accounts.size > 10000) for (const [key, list] of this.accounts) if (!list.length || t - list[list.length - 1] > this.windowMs) this.accounts.delete(key);
    if (this.store && Math.random() < 0.01) { try { this.store.throttlePrune(new Date(t - this.windowMs).toISOString()); } catch { /* best effort */ } }
    return { allowed: true };
  }

  // Successful authentication clears the account's counter and takes this attempt off the address's count.
  clear(username, ip) {
    this._writeAccount(this.key(username), []);
    const ipKey = String(ip || '');
    const arr = this.ips.get(ipKey);
    if (arr && arr.length) { arr.pop(); if (!arr.length) this.ips.delete(ipKey); }
  }
}

module.exports = { RateLimiter, WINDOW_MS, MAX_ATTEMPTS, IP_MAX_ATTEMPTS };
