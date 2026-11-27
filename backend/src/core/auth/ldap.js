'use strict';
// A small LDAPv3 client over TLS (LDAPS) - just what directory sign-on needs (audit WP-27: ENT-005, DEP-015, RES-003).
//
// Why not a library: no LDAP client is in node_modules or the offline npm cache of this build machine (checked 2026-11-27: ldapjs, ldapts,
// asn1 absent), and the product ships offline. The protocol subset is small and fixed: simple bind, search, unbind (RFC 4511), BER as
// RFC 4511 section 5.1 restricts it (definite lengths only). Everything is built from typed values, never by parsing a filter string,
// so a user name can never change the shape of a filter (no LDAP injection by construction).
//
// Transport: LDAPS only (TLS from the first byte, port 636 or the global catalogue 3269). Certificates are always verified against the
// customer's CA file (or the system store when none is given); there is no "accept any certificate" switch. Plain ldap:// and StartTLS
// are refused by the configuration (config.ts). Simple bind over TLS satisfies Active Directory's "LDAP signing required"; channel
// binding (EPA) applies to SASL binds, which this client does not use - recorded in docs/OPERATIONS.md.
//
//   const c = await LdapConnection.connect({ url: 'ldaps://dc1.corp.local', ca, timeoutMs });
//   await c.bind(dn, password);               // throws LdapError (code 49 = invalid credentials)
//   const entries = await c.search({ base, scope: 'sub', filter: { and: [{ eq: ['objectClass', 'user'] }, { eq: ['sAMAccountName', u] }] }, attributes: [...] });
//   c.close();
//
// Referrals (SearchResultReference) are not chased: they are counted and returned, so the caller can log them. A forest with several
// domains is searched through the global catalogue (ldaps://gc:3269) instead.

const tls = require('tls');

// ---- BER (the subset LDAP uses) ---------------------------------------------

const T = {
  BOOLEAN: 0x01, INTEGER: 0x02, OCTET: 0x04, NULL: 0x05, ENUM: 0x0a, SEQUENCE: 0x30, SET: 0x31,
  BIND_REQ: 0x60, BIND_RES: 0x61, UNBIND_REQ: 0x42, SEARCH_REQ: 0x63, SEARCH_ENTRY: 0x64, SEARCH_DONE: 0x65, SEARCH_REF: 0x73,
  SIMPLE_AUTH: 0x80,
};

function lengthBytes(n) {
  if (n < 0x80) return Buffer.from([n]);
  const out = [];
  while (n > 0) { out.unshift(n & 0xff); n = Math.floor(n / 256); }
  return Buffer.from([0x80 | out.length, ...out]);
}
/** One TLV: tag byte + definite length + content. */
function tlv(tag, content) {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return Buffer.concat([Buffer.from([tag]), lengthBytes(body.length), body]);
}
function integerBytes(n) {
  const out = [];
  let v = Math.trunc(n);
  do { out.unshift(v & 0xff); v = Math.floor(v / 256); } while (v > 0);
  if (out[0] & 0x80) out.unshift(0);
  return Buffer.from(out);
}
const ber = {
  tlv,
  int: (n, tag = T.INTEGER) => tlv(tag, integerBytes(n)),
  enumerated: (n) => tlv(T.ENUM, integerBytes(n)),
  str: (s, tag = T.OCTET) => tlv(tag, Buffer.isBuffer(s) ? s : Buffer.from(String(s), 'utf8')),
  bool: (b, tag = T.BOOLEAN) => tlv(tag, Buffer.from([b ? 0xff : 0x00])),
  seq: (parts, tag = T.SEQUENCE) => tlv(tag, Buffer.concat(parts)),
};

/** Read one TLV at `offset`. Returns null when the buffer does not hold all of it yet. Indefinite lengths are refused (RFC 4511 5.1). */
function readTlv(buf, offset = 0) {
  if (buf.length < offset + 2) return null;
  const tag = buf[offset];
  let len = buf[offset + 1]; let p = offset + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0) throw new LdapError(-1, 'BER: indefinite length is not allowed in LDAP');
    if (n > 4) throw new LdapError(-1, 'BER: length too large');
    if (buf.length < p + n) return null;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[p + i];
    p += n;
  }
  if (buf.length < p + len) return null;
  return { tag, value: buf.subarray(p, p + len), end: p + len };
}
/** The TLVs inside a constructed value. */
function children(value) {
  const out = []; let o = 0;
  while (o < value.length) {
    const t = readTlv(value, o);
    if (!t) throw new LdapError(-1, 'BER: truncated value');
    out.push(t); o = t.end;
  }
  return out;
}
function readInt(value) {
  let n = value.length && (value[0] & 0x80) ? -1 : 0;
  for (const b of value) n = n * 256 + b;
  return n;
}

// ---- filters (RFC 4511 4.5.1), from typed values ---------------------------

/*
  { and: [f...] } | { or: [f...] } | { not: f } | { eq: [attr, value] } | { present: attr }
  | { ext: { rule?: oid, attr?: string, value: string, dnAttributes?: boolean } }
*/
function encodeFilter(f) {
  if (!f || typeof f !== 'object') throw new LdapError(-1, 'filter: not an object');
  if (Array.isArray(f.and)) return ber.seq(f.and.map(encodeFilter), 0xa0);
  if (Array.isArray(f.or)) return ber.seq(f.or.map(encodeFilter), 0xa1);
  if (f.not) return ber.seq([encodeFilter(f.not)], 0xa2);
  if (Array.isArray(f.eq)) return ber.seq([ber.str(f.eq[0]), ber.str(f.eq[1])], 0xa3);
  if (typeof f.present === 'string') return ber.str(f.present, 0x87);
  if (f.ext) {
    const parts = [];
    if (f.ext.rule) parts.push(ber.str(f.ext.rule, 0x81));
    if (f.ext.attr) parts.push(ber.str(f.ext.attr, 0x82));
    parts.push(ber.str(f.ext.value, 0x83));
    if (f.ext.dnAttributes) parts.push(ber.bool(true, 0x84));
    return ber.seq(parts, 0xa9);
  }
  throw new LdapError(-1, 'filter: unknown form');
}
/** The inverse, for the test double and for logging what was asked. */
function decodeFilter(t) {
  const kids = () => children(t.value).map(decodeFilter);
  switch (t.tag) {
    case 0xa0: return { and: kids() };
    case 0xa1: return { or: kids() };
    case 0xa2: return { not: kids()[0] };
    case 0xa3: { const [a, v] = children(t.value); return { eq: [a.value.toString('utf8'), v.value.toString('utf8')] }; }
    case 0x87: return { present: t.value.toString('utf8') };
    case 0xa9: {
      const ext = {};
      for (const c of children(t.value)) {
        if (c.tag === 0x81) ext.rule = c.value.toString('utf8');
        else if (c.tag === 0x82) ext.attr = c.value.toString('utf8');
        else if (c.tag === 0x83) ext.value = c.value.toString('utf8');
        else if (c.tag === 0x84) ext.dnAttributes = c.value[0] !== 0;
      }
      return { ext };
    }
    default: return { unsupported: t.tag };
  }
}

const SCOPES = { base: 0, one: 1, sub: 2 };

// ---- result codes ----------------------------------------------------------

const RESULT = { success: 0, sizeLimitExceeded: 4, invalidCredentials: 49, insufficientAccessRights: 50, busy: 51, unavailable: 52, noSuchObject: 32 };

class LdapError extends Error {
  /** code: the LDAP resultCode, or -1 for a protocol/transport problem. */
  constructor(code, message, { transport = false } = {}) { super(message); this.name = 'LdapError'; this.code = code; this.transport = transport; }
}

/** LDAPResult (bind response, search done): { code, matchedDN, message }. */
function readResult(value) {
  const [c, m, d] = children(value);
  return { code: readInt(c.value), matchedDN: m ? m.value.toString('utf8') : '', message: d ? d.value.toString('utf8') : '' };
}

// ---- the connection ---------------------------------------------------------

class LdapConnection {
  constructor(socket, timeoutMs) {
    this.socket = socket; this.timeoutMs = timeoutMs; this.nextId = 1; this.pending = new Map(); this.buf = Buffer.alloc(0); this.closed = false;
    socket.on('data', (d) => this.onData(d));
    const fail = (err) => {
      this.closed = true;
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
    socket.on('error', (e) => fail(new LdapError(-1, `directory connection failed: ${e.message}`, { transport: true })));
    socket.on('close', () => fail(new LdapError(-1, 'the directory closed the connection', { transport: true })));
  }

  /**
   * Open an LDAPS connection. `url` is ldaps://host[:port]; `ca` the PEM text of the CA(s) the directory's certificate must chain to
   * (null = the system store). The host name is checked against the certificate (servername).
   */
  static connect({ url, ca = null, timeoutMs = 10000 }) {
    const u = new URL(url);
    if (u.protocol !== 'ldaps:') return Promise.reject(new LdapError(-1, `only ldaps:// is supported, not ${u.protocol}`, { transport: true }));
    const host = u.hostname.replace(/^\[(.*)\]$/, '$1'); const port = Number(u.port || 636);
    return new Promise((resolve, reject) => {
      let done = false;
      const opts = { host, port, minVersion: 'TLSv1.2', rejectUnauthorized: true };
      if (!/^[\d.]+$/.test(host) && !host.includes(':')) opts.servername = host;
      if (ca) opts.ca = ca;
      const socket = tls.connect(opts, () => { if (done) return; done = true; clearTimeout(timer); resolve(new LdapConnection(socket, timeoutMs)); });
      const timer = setTimeout(() => { if (done) return; done = true; socket.destroy(); reject(new LdapError(-1, `no answer from ${host}:${port} within ${timeoutMs} ms`, { transport: true })); }, timeoutMs);
      socket.once('error', (e) => { if (done) return; done = true; clearTimeout(timer); reject(new LdapError(-1, `cannot reach the directory at ${host}:${port}: ${e.message}`, { transport: true })); });
    });
  }

  onData(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      let t;
      try { t = readTlv(this.buf, 0); } catch (e) { this.socket.destroy(e); return; }
      if (!t) return;
      this.buf = this.buf.subarray(t.end);
      try { this.dispatch(t); } catch (e) { this.socket.destroy(e); return; }
    }
  }

  dispatch(msg) {
    const [idT, op] = children(msg.value);
    const p = this.pending.get(readInt(idT.value));
    if (!p) return;                                       // an answer to something abandoned (timed out): ignore
    p.onOp(op);
  }

  send(opBytes, onOp) {
    if (this.closed) return Promise.reject(new LdapError(-1, 'the directory connection is closed', { transport: true }));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new LdapError(-1, `the directory did not answer within ${this.timeoutMs} ms`, { transport: true })); }, this.timeoutMs);
      this.pending.set(id, {
        reject: (e) => { clearTimeout(timer); reject(e); },
        onOp: (op) => {
          try {
            const r = onOp(op);
            if (r !== undefined) { clearTimeout(timer); this.pending.delete(id); r instanceof Error ? reject(r) : resolve(r.value); }
          } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
        },
      });
      this.socket.write(ber.seq([ber.int(id), opBytes]));
    });
  }

  /** Simple bind. An empty password is refused HERE: many servers treat it as an anonymous bind that "succeeds" (RFC 4513 5.1.2). */
  bind(dn, password) {
    if (!password) return Promise.reject(new LdapError(RESULT.invalidCredentials, 'an empty password is never sent (unauthenticated bind)'));
    return this.send(ber.seq([ber.int(3), ber.str(dn), ber.str(password, T.SIMPLE_AUTH)], T.BIND_REQ), (op) => {
      if (op.tag !== T.BIND_RES) return new LdapError(-1, `unexpected answer to a bind (tag ${op.tag})`);
      const r = readResult(op.value);
      return r.code === RESULT.success ? { value: true } : new LdapError(r.code, r.message || `bind refused (result ${r.code})`);
    });
  }

  /** Search. Resolves to { entries: [{ dn, attrs: { name: [Buffer...] } }], referrals }. */
  search({ base, scope = 'sub', filter, attributes = [], sizeLimit = 100, timeLimitSeconds = 0 }) {
    const req = ber.seq([
      ber.str(base), ber.enumerated(SCOPES[scope] ?? 2), ber.enumerated(0 /* neverDerefAliases */), ber.int(sizeLimit), ber.int(timeLimitSeconds),
      ber.bool(false), encodeFilter(filter), ber.seq(attributes.map((a) => ber.str(a))),
    ], T.SEARCH_REQ);
    const entries = []; let referrals = 0;
    return this.send(req, (op) => {
      if (op.tag === T.SEARCH_ENTRY) {
        const [dnT, attrsT] = children(op.value);
        const attrs = {};
        for (const a of children(attrsT.value)) {
          const [typeT, valsT] = children(a.value);
          attrs[typeT.value.toString('utf8').toLowerCase()] = children(valsT.value).map((v) => Buffer.from(v.value));
        }
        entries.push({ dn: dnT.value.toString('utf8'), attrs });
        return undefined;
      }
      if (op.tag === T.SEARCH_REF) { referrals++; return undefined; }
      if (op.tag === T.SEARCH_DONE) {
        const r = readResult(op.value);
        if (r.code === RESULT.success || (r.code === RESULT.sizeLimitExceeded && entries.length)) return { value: { entries, referrals } };
        return new LdapError(r.code, r.message || `search failed (result ${r.code})`);
      }
      return new LdapError(-1, `unexpected answer to a search (tag ${op.tag})`);
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.socket.write(ber.seq([ber.int(this.nextId++), tlv(T.UNBIND_REQ, Buffer.alloc(0))])); } catch { /* closing anyway */ }
    this.socket.end();
  }
}

/** First value of an attribute as text ('' when absent). */
const attrText = (entry, name) => { const v = entry.attrs[String(name).toLowerCase()]; return v && v.length ? v[0].toString('utf8') : ''; };
const attrTexts = (entry, name) => (entry.attrs[String(name).toLowerCase()] || []).map((b) => b.toString('utf8'));

module.exports = { LdapConnection, LdapError, RESULT, ber, readTlv, children, readInt, encodeFilter, decodeFilter, readResult, T, SCOPES, attrText, attrTexts };
