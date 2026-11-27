// =============================================================================
// A small X.509 certificate writer (WP-26), for the administrator's tool scripts/make-tls-cert.js and for the TLS tests.
//
// Mode B serves TLS with a certificate the administrator supplies: one issued by the organisation's internal CA is the recommended path
// (docs/OPERATIONS.md). Where there is no CA, the tool makes a self-signed certificate (or a small private CA and a server certificate
// signed by it) with the names the clients use, and prints the SHA-256 thumbprint so the clients can pin or trust exactly that certificate.
// Node can sign but cannot write a certificate, so this encodes the DER itself: ECDSA P-256 keys, SHA-256 signatures, subjectAltName,
// basicConstraints, keyUsage and extendedKeyUsage. Nothing here is used at run time by the server, and nothing is installed anywhere.
// =============================================================================

import crypto from 'crypto';
import net from 'net';

const len = (n: number): Buffer => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = []; for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};
const tlv = (tag: number, body: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...parts: Buffer[]): Buffer => tlv(0x30, Buffer.concat(parts));
const set = (...parts: Buffer[]): Buffer => tlv(0x31, Buffer.concat(parts));
const int = (b: Buffer): Buffer => tlv(0x02, b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
const bool = (v: boolean): Buffer => tlv(0x01, Buffer.from([v ? 0xff : 0]));
const octets = (b: Buffer): Buffer => tlv(0x04, b);
const bits = (b: Buffer, unused = 0): Buffer => tlv(0x03, Buffer.concat([Buffer.from([unused]), b]));
const utf8 = (s: string): Buffer => tlv(0x0c, Buffer.from(s, 'utf8'));
function oid(dotted: string): Buffer {
  const a = dotted.split('.').map(Number); const out = [40 * a[0] + a[1]];
  for (const v of a.slice(2)) { const enc = [v & 0x7f]; for (let x = v >> 7; x > 0; x >>= 7) enc.unshift(0x80 | (x & 0x7f)); out.push(...enc); }
  return tlv(0x06, Buffer.from(out));
}
function time(d: Date): Buffer {
  const iso = d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';            // YYYYMMDDHHMMSSZ
  return d.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(iso.slice(2))) : tlv(0x18, Buffer.from(iso));
}

const ECDSA_SHA256 = seq(oid('1.2.840.10045.4.3.2'));
const name = (cn: string, org?: string): Buffer => seq(set(seq(oid('2.5.4.3'), utf8(cn))), ...(org ? [set(seq(oid('2.5.4.10'), utf8(org)))] : []));
const ext = (id: string, critical: boolean, value: Buffer): Buffer => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));

function san(names: string[]): Buffer {
  return seq(...names.map((n) => {
    const v = net.isIP(n);
    if (v === 4) return tlv(0x87, Buffer.from(n.split('.').map(Number)));
    if (v === 6) {
      const [head, tail = ''] = n.split('::'); const h = head ? head.split(':') : []; const t = tail ? tail.split(':') : [];
      const groups = n.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
      return tlv(0x87, Buffer.from(groups.flatMap((g) => { const x = parseInt(g || '0', 16); return [x >> 8, x & 0xff]; })));
    }
    return tlv(0x82, Buffer.from(n, 'ascii'));                                       // dNSName
  }));
}

export interface CertOptions {
  /** Subject common name (informational; clients match the subjectAltName entries). */
  commonName: string;
  organisation?: string;
  /** DNS names and IP addresses the clients use to reach the server. */
  altNames?: string[];
  notBefore?: Date;
  notAfter?: Date;
  /** A CA certificate (signs other certificates) instead of a server certificate. */
  ca?: boolean;
  /** Sign with this issuer (a CA made by this function) instead of self-signing. */
  issuer?: { certPem: string; keyPem: string };
}

export interface MadeCert { certPem: string; keyPem: string; fingerprint256: string }

/** Make a key pair and a certificate (self-signed, or signed by `issuer`). */
export function makeCertificate(o: CertOptions): MadeCert {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const serial = crypto.randomBytes(16); serial[0] &= 0x7f; if (serial[0] === 0) serial[0] = 1;
  const notBefore = o.notBefore ?? new Date(Date.now() - 5 * 60_000);
  const notAfter = o.notAfter ?? new Date(notBefore.getTime() + 397 * 86400_000);  // browsers accept at most 398 days for a server certificate
  const subject = name(o.commonName, o.organisation);
  let issuerName = subject; let signer = privateKey;
  if (o.issuer) {
    issuerName = subjectOf(Buffer.from(new crypto.X509Certificate(o.issuer.certPem).raw));      // the issuer's subject, byte for byte
    signer = crypto.createPrivateKey(o.issuer.keyPem);
  }
  const keyId = crypto.createHash('sha1').update(spki).digest();
  const extensions: Buffer[] = [
    ext('2.5.29.19', true, seq(...(o.ca ? [bool(true)] : []))),                     // basicConstraints
    ext('2.5.29.15', true, o.ca ? bits(Buffer.from([0x06]), 1) : bits(Buffer.from([0x80]), 7)),   // keyUsage: keyCertSign+cRLSign | digitalSignature
    ext('2.5.29.14', false, octets(keyId)),                                         // subjectKeyIdentifier
  ];
  if (!o.ca) extensions.push(ext('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'))));        // extendedKeyUsage: serverAuth
  if (o.altNames?.length) extensions.push(ext('2.5.29.17', false, san(o.altNames)));
  const tbs = seq(
    tlv(0xa0, int(Buffer.from([2]))), int(serial), ECDSA_SHA256, issuerName,
    seq(time(notBefore), time(notAfter)), subject, Buffer.from(spki), tlv(0xa3, seq(...extensions)),
  );
  const signature = crypto.sign('sha256', tbs, signer);                            // DER-encoded ECDSA signature
  const der = seq(tbs, ECDSA_SHA256, bits(signature));
  const certPem = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '')}\n-----END CERTIFICATE-----\n`;
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  return { certPem, keyPem, fingerprint256: new crypto.X509Certificate(certPem).fingerprint256 };
}

/** Read one DER element at `at`: its full extent and where its body starts. */
function element(b: Buffer, at: number): { start: number; body: number; end: number } {
  let p = at + 1; let n = b[p++];
  if (n & 0x80) { const k = n & 0x7f; n = 0; for (let i = 0; i < k; i++) n = (n << 8) | b[p++]; }
  return { start: at, body: p, end: p + n };
}

/** The subject Name of a DER certificate, as the exact bytes (an issuer field must match the CA's subject byte for byte). */
function subjectOf(der: Buffer): Buffer {
  const cert = element(der, 0); const tbs = element(der, cert.body);
  let p = tbs.body; const fields: Array<{ start: number; end: number }> = [];
  while (p < tbs.end) { const e = element(der, p); fields.push(e); p = e.end; }
  // version [0], serial, signature, issuer, validity, subject
  const subject = fields[der[fields[0].start] === 0xa0 ? 5 : 4];
  return der.subarray(subject.start, subject.end);
}
