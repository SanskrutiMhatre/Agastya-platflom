'use strict';
// WP-27: an in-process LDAPS directory for the directory sign-on tests (the test double the audit asks for; a real Active Directory test
// is external). It speaks the same BER as the product's client (dist/core/auth/ldap.js), over TLS with a certificate from a throwaway CA
// made by the product's own writer (dist/services/tlsCert.js), and it implements what the client uses: simple bind, search (and / or /
// not / equality / presence / AD's LDAP_MATCHING_RULE_IN_CHAIN on member), unbind. memberOf is computed from the groups' member lists.
// Every request is logged in `ops` so a test can prove what the product sent (no empty-password bind, a literal filter value).
//
// Requiring this file does NOT load dist/config, so it may be required before boot().

const tls = require('node:tls');
const { ber, readTlv, children, readInt, decodeFilter, T } = require('../dist/core/auth/ldap');
const { makeCertificate } = require('../dist/services/tlsCert');

const norm = (dn) => String(dn).trim().replace(/\s*([,=+])\s*/g, '$1').toLowerCase();

function makeCa(name = 'Test Directory CA') {
  const ca = makeCertificate({ commonName: name, ca: true });
  const server = makeCertificate({ commonName: 'localhost', altNames: ['localhost', '127.0.0.1'], issuer: ca });
  return { ca, server };
}

class FakeDirectory {
  constructor({ certs = makeCa() } = {}) {
    this.certs = certs; this.entries = new Map(); this.ops = []; this.sockets = new Set(); this.server = null; this.port = 0;
  }
  get caPem() { return this.certs.ca.certPem; }
  get url() { return `ldaps://localhost:${this.port}`; }

  /** Add or replace an entry. attrs: { name: value | [values] }; password for bindable entries. */
  put(dn, attrs, password = null) {
    const a = {};
    for (const [k, v] of Object.entries(attrs)) a[k] = (Array.isArray(v) ? v : [v]).map((x) => (Buffer.isBuffer(x) ? x : Buffer.from(String(x))));
    this.entries.set(norm(dn), { dn, attrs: a, password });
  }
  remove(dn) { this.entries.delete(norm(dn)); }
  get(dn) { return this.entries.get(norm(dn)) || null; }
  /** Set a group's member list (DNs). */
  setMembers(groupDn, members) { const g = this.get(groupDn); g.attrs.member = members.map((m) => Buffer.from(m)); }
  addMember(groupDn, dn) { const g = this.get(groupDn); g.attrs.member = [...(g.attrs.member || []), Buffer.from(dn)]; }
  removeMember(groupDn, dn) { const g = this.get(groupDn); g.attrs.member = (g.attrs.member || []).filter((b) => norm(b.toString()) !== norm(dn)); }

  attr(e, name) {
    const key = Object.keys(e.attrs).find((k) => k.toLowerCase() === String(name).toLowerCase());
    if (key) return e.attrs[key];
    if (String(name).toLowerCase() === 'memberof') {
      return [...this.entries.values()].filter((g) => (g.attrs.member || []).some((m) => norm(m.toString()) === norm(e.dn))).map((g) => Buffer.from(g.dn));
    }
    return null;
  }
  /** Every group that has `dn` as a member, directly or through other groups. */
  groupsInChain(dn) {
    const out = new Set(); const todo = [norm(dn)];
    while (todo.length) {
      const cur = todo.pop();
      for (const g of this.entries.values()) {
        if (out.has(norm(g.dn))) continue;
        if ((g.attrs.member || []).some((m) => norm(m.toString()) === cur)) { out.add(norm(g.dn)); todo.push(norm(g.dn)); }
      }
    }
    return out;
  }
  matches(e, f) {
    if (f.and) return f.and.every((x) => this.matches(e, x));
    if (f.or) return f.or.some((x) => this.matches(e, x));
    if (f.not) return !this.matches(e, f.not);
    if (f.present) return f.present.toLowerCase() === 'objectclass' || !!this.attr(e, f.present);
    if (f.eq) return (this.attr(e, f.eq[0]) || []).some((v) => v.toString().toLowerCase() === f.eq[1].toLowerCase());
    if (f.ext && f.ext.rule === '1.2.840.113556.1.4.1941' && String(f.ext.attr).toLowerCase() === 'member') return this.groupsInChain(f.ext.value).has(norm(e.dn));
    return false;
  }

  start() {
    this.server = tls.createServer({ key: this.certs.server.keyPem, cert: this.certs.server.certPem, minVersion: 'TLSv1.2' }, (sock) => {
      this.sockets.add(sock); sock.on('close', () => this.sockets.delete(sock)); sock.on('error', () => {});
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        for (;;) {
          const t = readTlv(buf, 0); if (!t) break; buf = buf.subarray(t.end);
          const [idT, op] = children(t.value); const id = readInt(idT.value);
          const send = (bytes) => sock.write(ber.seq([ber.int(id), bytes]));
          const result = (tag, code, msg = '') => send(ber.seq([ber.enumerated(code), ber.str(''), ber.str(msg)], tag));
          if (op.tag === T.BIND_REQ) {
            const [, nameT, authT] = children(op.value);
            const dn = nameT.value.toString(); const pw = authT.value.toString();
            this.ops.push({ op: 'bind', dn, emptyPassword: pw === '' });
            const e = this.get(dn);
            const uac = e ? Number((this.attr(e, 'userAccountControl') || [Buffer.from('0')])[0].toString()) : 0;
            if (e && e.password !== null && pw !== '' && pw === e.password && !(uac & 2)) result(T.BIND_RES, 0);
            else result(T.BIND_RES, 49, e && (uac & 2) ? '80090308: LdapErr: DSID-0C09042A, data 533' : 'invalid credentials');
          } else if (op.tag === T.SEARCH_REQ) {
            const parts = children(op.value);
            const base = parts[0].value.toString(); const filter = decodeFilter(parts[6]);
            const attrs = children(parts[7].value).map((a) => a.value.toString());
            this.ops.push({ op: 'search', base, filter });
            const hits = [...this.entries.values()].filter((e) => (norm(e.dn) === norm(base) || norm(e.dn).endsWith(`,${norm(base)}`)) && this.matches(e, filter));
            for (const e of hits) {
              const names = attrs.includes('1.1') ? [] : (attrs.length ? attrs : Object.keys(e.attrs));
              const out = [];
              for (const n of names) { const v = this.attr(e, n); if (v && v.length) out.push(ber.seq([ber.str(n), ber.seq(v.map((x) => ber.str(x)), T.SET)])); }
              send(ber.seq([ber.str(e.dn), ber.seq(out)], T.SEARCH_ENTRY));
            }
            result(T.SEARCH_DONE, 0);
          } else if (op.tag === T.UNBIND_REQ) { this.ops.push({ op: 'unbind' }); sock.end(); }
        }
      });
    });
    return new Promise((r) => this.server.listen(this.port || 0, '127.0.0.1', () => { this.port = this.server.address().port; r(this); }));
  }
  /** Simulate a domain controller outage (the port stops answering). */
  stop() {
    for (const s of this.sockets) s.destroy();
    return new Promise((r) => (this.server ? this.server.close(() => r()) : r()));
  }
}

module.exports = { FakeDirectory, makeCa };
