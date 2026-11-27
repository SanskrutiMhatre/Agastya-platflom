'use strict';
// Make a TLS certificate for a Mode B server where the organisation has no internal CA (WP-26). Prefer a certificate from the
// organisation's own CA; see docs/OPERATIONS.md, "Mode B: TLS".
//
//   node scripts/make-tls-cert.js --out <folder> --name <host name or address> [--name ...] [--days 397] [--with-ca]
//
// Writes server.pem and server-key.pem (and, with --with-ca, ca.pem and ca-key.pem: a private CA that signed the server certificate; the
// clients then trust ca.pem once and the server certificate can be renewed without touching them again). Prints the SHA-256 thumbprints
// and the settings to use. Installs nothing: trusting the certificate (or the CA) on the clients is the administrator's step.
// Keep the *-key.pem files where only the service account and administrators can read them.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const names = []; let out = null; let days = 397; let withCa = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--name') names.push(String(args[++i] || '').trim());
  else if (a === '--out') out = args[++i];
  else if (a === '--days') days = Number(args[++i]);
  else if (a === '--with-ca') withCa = true;
  else { console.error(`unknown argument: ${a}`); process.exit(2); }
}
if (!out || names.length === 0 || names.some((n) => !n) || !Number.isInteger(days) || days < 1 || days > 3650) {
  console.error('usage: node scripts/make-tls-cert.js --out <folder> --name <host name or address> [--name ...] [--days 1-3650] [--with-ca]');
  process.exit(2);
}
let make;
try { ({ makeCertificate: make } = require(path.join(__dirname, '..', 'dist', 'services', 'tlsCert'))); } catch {
  console.error('backend/dist is missing: build first (npx tsc -p . in backend/)'); process.exit(1);
}

fs.mkdirSync(out, { recursive: true });
const write = (f, s) => { const p = path.join(out, f); if (fs.existsSync(p)) { console.error(`${p} exists; choose another --out folder`); process.exit(1); } fs.writeFileSync(p, s, { mode: 0o600 }); return p; };
const notAfter = new Date(Date.now() + days * 86400_000);
let issuer;
if (withCa) {
  const ca = make({ commonName: `Agastya Platform CA (${names[0]})`, organisation: 'Agastya Platform', ca: true, notAfter: new Date(Date.now() + 10 * 365 * 86400_000) });
  write('ca.pem', ca.certPem); write('ca-key.pem', ca.keyPem);
  console.log(`CA certificate      ${path.join(out, 'ca.pem')}  SHA-256 ${ca.fingerprint256}`);
  issuer = { certPem: ca.certPem, keyPem: ca.keyPem };
}
const srv = make({ commonName: names[0], organisation: 'Agastya Platform', altNames: names, notAfter, issuer });
const cert = write('server.pem', srv.certPem); const key = write('server-key.pem', srv.keyPem);
console.log(`server certificate  ${cert}  SHA-256 ${srv.fingerprint256}`);
console.log(`valid until         ${notAfter.toISOString()}  for ${names.join(', ')}`);
console.log('');
console.log('Server settings (agastya.ini [tls], or the environment):');
console.log(`  AGASTYA_MODE=server`);
console.log(`  AGASTYA_TLS_CERT=${cert}`);
console.log(`  AGASTYA_TLS_KEY=${key}`);
console.log(withCa ? 'Clients: trust ca.pem (Trusted Root Certification Authorities), then open https://' + names[0] + ':<port>/'
  : 'Clients: trust server.pem, or check the thumbprint above when the browser asks, then open https://' + names[0] + ':<port>/');
