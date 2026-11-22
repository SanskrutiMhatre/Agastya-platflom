'use strict';
// Sliding-window rate limiter for authentication attempts, keyed by
// username+IP. In-memory on purpose: the server is a single offline process,
// and losing counters on restart only ever errs towards letting a legitimate
// user try again. The forgot-password queue shares this limiter (same key
// space), so it cannot be used to probe accounts faster than login can.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

class RateLimiter {
  constructor({ windowMs = WINDOW_MS, max = MAX_ATTEMPTS, now = () => Date.now() } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.now = now;
    this.buckets = new Map(); // key -> [timestamps]
  }

  key(username, ip) {
    return `${String(username || '').toLowerCase()}|${ip || ''}`;
  }

  /*
    Record an attempt. Returns { allowed: true } or
    { allowed: false, retryAfterSeconds } for a 429 with Retry-After.
    The check happens BEFORE any credential work, so a limited caller learns
    nothing about the account.
  */
  attempt(username, ip) {
    const k = this.key(username, ip);
    const t = this.now();
    let arr = this.buckets.get(k);
    if (!arr) { arr = []; this.buckets.set(k, arr); }
    while (arr.length && t - arr[0] > this.windowMs) arr.shift();
    if (arr.length >= this.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((arr[0] + this.windowMs - t) / 1000));
      return { allowed: false, retryAfterSeconds };
    }
    arr.push(t);
    // Opportunistic cleanup so long-running servers don't accumulate keys.
    if (this.buckets.size > 10000) {
      for (const [key, list] of this.buckets) {
        if (!list.length || t - list[list.length - 1] > this.windowMs) this.buckets.delete(key);
      }
    }
    return { allowed: true };
  }

  // Successful authentication clears the caller's counter.
  clear(username, ip) {
    this.buckets.delete(this.key(username, ip));
  }
}

module.exports = { RateLimiter, WINDOW_MS, MAX_ATTEMPTS };
