'use strict';
// Air-gap instrumentation for test/wp30-airgap.test.js (WP-30, G-OFF-1 / G-OFF-4). Loaded with `node --require` into the server; it adds itself to
// every Node process the server forks (the job workers), so the whole Node side of the product runs with outbound network access REFUSED:
//   - a TCP/TLS connection (net, tls, http, https, fetch/undici, ws) to anything but a loopback address or a local pipe fails with EACCES
//   - a DNS lookup or query for anything but localhost fails with EACCES
//   - a UDP datagram to anything but loopback is dropped
// Every refusal is written to AIRGAP_LOG (one JSON line: pid, kind, destination, a short stack); so is every process that loaded the hook, so the
// test can prove the workers were covered. The JVMs the workers start are watched from the outside (the test polls the TCP table).
const fs = require('fs');
const net = require('net');
const dns = require('dns');
const dgram = require('dgram');
const cp = require('child_process');

const LOG = process.env.AIRGAP_LOG;
const SELF = __filename;
const note = (o) => { if (!LOG) return; try { fs.appendFileSync(LOG, `${JSON.stringify({ pid: process.pid, at: Date.now(), ...o })}\n`); } catch { /* the log is best effort */ } };
note({ event: 'loaded', main: process.argv[1] || '' });

const loopback = (h) => {
  const s = String(h ?? 'localhost').replace(/^\[|\]$/g, '').toLowerCase();
  return s === '' || s === 'localhost' || s.endsWith('.localhost') || /^127\./.test(s) || s === '::1' || s === '0.0.0.0' || s === '::' || /^::ffff:127\./.test(s) || s === '0:0:0:0:0:0:0:1';
};
const refuse = (kind, dest) => {
  note({ event: 'blocked', kind, dest: String(dest), stack: (new Error().stack || '').split('\n').slice(3, 8).map((l) => l.trim()) });
  return Object.assign(new Error(`air-gap test: outbound ${kind} to ${dest} refused`), { code: 'EACCES' });
};

// TCP (and TLS, which connects through it)
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function airgapConnect(...args) {
  let o = args[0]; if (Array.isArray(o)) o = o[0];
  let host; let port; let pipe;
  if (o && typeof o === 'object') { host = o.host; port = o.port; pipe = o.path; }
  else if (typeof o === 'number' || (typeof o === 'string' && /^\d+$/.test(o))) { port = o; host = typeof args[1] === 'string' ? args[1] : 'localhost'; }
  else if (typeof o === 'string') pipe = o;
  if (!pipe && !loopback(host)) { const err = refuse('tcp', `${host}:${port}`); process.nextTick(() => this.destroy(err)); return this; }
  return connect.apply(this, args);
};

// DNS
for (const fn of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveNs', 'resolveTxt', 'resolveSrv', 'reverse']) {
  const orig = dns[fn]; if (typeof orig !== 'function') continue;
  dns[fn] = function airgapDns(name, ...rest) {
    if (fn !== 'reverse' && loopback(name)) return orig.call(this, name, ...rest);
    const cb = rest.reverse().find((x) => typeof x === 'function'); const err = refuse(`dns.${fn}`, name);
    if (cb) process.nextTick(() => cb(err)); return undefined;
  };
  const p = dns.promises[fn];
  if (typeof p === 'function') dns.promises[fn] = async (name, ...rest) => { if (fn !== 'reverse' && loopback(name)) return p.call(dns.promises, name, ...rest); throw refuse(`dns.${fn}`, name); };
}

// UDP
const send = dgram.Socket.prototype.send;
dgram.Socket.prototype.send = function airgapSend(...args) {
  const host = args.find((x, i) => i > 0 && typeof x === 'string');
  if (host && !loopback(host)) { refuse('udp', host); const cb = args.find((x) => typeof x === 'function'); if (cb) process.nextTick(() => cb(Object.assign(new Error('refused'), { code: 'EACCES' }))); return; }
  return send.apply(this, args);
};

// the job workers: every Node process the server forks loads this hook too (the pool replaces execArgv and drops NODE_OPTIONS)
const fork = cp.fork;
cp.fork = function airgapFork(modulePath, a, b) {
  let args = a; let opts = b;
  if (!Array.isArray(a)) { opts = a; args = []; }
  opts = { ...(opts || {}) }; const base = opts.execArgv || process.execArgv;
  opts.execArgv = base.includes(SELF) ? base : ['--require', SELF, ...base];
  opts.env = { ...(opts.env || process.env), AIRGAP_LOG: LOG || '' };
  return fork.call(this, modulePath, args, opts);
};
