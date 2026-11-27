// =============================================================================
// Network edge (WP-26: ENT-001, SEC-006, DEP-010) - what the server listens on, with which certificate, and which host names it answers to.
//
//   * Mode A (config.mode "local", the default): loopback only. With AGASTYA_HOST unset the server listens on 127.0.0.1 and, when the
//     machine has it, ::1 on the same port (so "localhost" works whichever address a browser tries first) - never on a network interface.
//     config.ts refuses a non-loopback AGASTYA_HOST in this mode.
//   * Mode B (config.mode "server"): every listener on a non-loopback address is HTTPS. A plain HTTP request to that port gets no HTTP
//     answer at all (the TLS layer drops it), so gate G-SEC-1 counts 0 plain-HTTP responses. Session cookies are Secure, HSTS is sent
//     (services/securityHeaders.ts) and the client reaches the WebSocket over wss. The certificate is the administrator's: PEM certificate
//     and key, or a PKCS#12 file; a passphrase only from a file. It is read and checked here at start: unreadable, wrong key, wrong
//     passphrase or expired stops the server with the variable's name; less than 30 days left is a warning in the log.
//   * Host names (DNS rebinding): every HTTP request and every WebSocket upgrade must name this server in its Host header - a loopback
//     name, an AGASTYA_SERVER_NAMES entry, a name or address in the certificate, or the address the server was told to listen on.
//     Anything else is 421. Without this a page on another site whose DNS name is re-pointed at 127.0.0.1 is "same origin" with itself
//     and could, for example, create the first administrator of a fresh install.
// =============================================================================

import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import https from 'https';
import net from 'net';
import tls from 'tls';
import { config as processConfig, ConfigError, isLoopbackHost, type Config, type TlsFiles } from '../config';

export interface CertInfo {
  subject: string;
  /** subjectAltName DNS names (lower case) and IP addresses. */
  altNames: string[];
  validFrom: string;
  validTo: string;
  daysLeft: number;
  fingerprint256: string;
  source: 'pem' | 'pfx';
}

export interface TlsMaterial { options: tls.SecureContextOptions; info: CertInfo }

function readOrFail(variable: string, file: string): Buffer {
  try { return fs.readFileSync(file); } catch (e) {
    throw new ConfigError(variable, `cannot read "${file}" (${(e as NodeJS.ErrnoException).code ?? (e as Error).message}).`);
  }
}

function altNamesOf(subjectAltName: string | undefined): string[] {
  return (subjectAltName ?? '').split(/,\s*/).map((s) => {
    const m = /^(DNS|IP Address):(.+)$/.exec(s.trim());
    return m ? m[2].trim().toLowerCase() : '';
  }).filter(Boolean);
}

function infoOf(c: { subject: string; subjectAltName?: string; validFrom: string; validTo: string; fingerprint256: string }, source: 'pem' | 'pfx', now: Date): CertInfo {
  const to = new Date(c.validTo);
  return {
    subject: c.subject.replace(/\n/g, ', '), altNames: altNamesOf(c.subjectAltName),
    validFrom: new Date(c.validFrom).toISOString(), validTo: to.toISOString(),
    daysLeft: Math.floor((to.getTime() - now.getTime()) / 86400_000), fingerprint256: c.fingerprint256, source,
  };
}

/** Read and check the configured certificate. Throws a ConfigError naming the variable for anything an administrator has to fix. */
export function loadTls(files: TlsFiles, now: Date = new Date()): TlsMaterial {
  const passphrase = files.passphraseFile ? readOrFail('AGASTYA_TLS_PASSPHRASE_FILE', files.passphraseFile).toString('utf8').replace(/\r?\n$/, '') : undefined;
  let material: TlsMaterial;
  if (files.pfxFile) {
    const pfx = readOrFail('AGASTYA_TLS_PFX', files.pfxFile);
    let ctx: tls.SecureContext;
    try { ctx = tls.createSecureContext({ pfx, passphrase }); } catch (e) {
      throw new ConfigError('AGASTYA_TLS_PFX', `"${files.pfxFile}" cannot be opened (${(e as Error).message}); check the file and AGASTYA_TLS_PASSPHRASE_FILE.`);
    }
    // Node reads PKCS#12 only into a TLS context; a server-side socket on that context reports the certificate it would present.
    const sock = new tls.TLSSocket(new net.Socket(), { secureContext: ctx, isServer: true });
    const pc = sock.getCertificate() as tls.PeerCertificate | null;
    sock.destroy();
    if (!pc || !pc.valid_to) throw new ConfigError('AGASTYA_TLS_PFX', `"${files.pfxFile}" holds no certificate.`);
    material = {
      options: { pfx, passphrase },
      info: infoOf({ subject: Object.entries(pc.subject ?? {}).map(([k, v]) => `${k}=${String(v)}`).join(', '), subjectAltName: pc.subjectaltname, validFrom: pc.valid_from, validTo: pc.valid_to, fingerprint256: pc.fingerprint256 }, 'pfx', now),
    };
  } else {
    const certPem = readOrFail('AGASTYA_TLS_CERT', files.certFile as string);
    const keyPem = readOrFail('AGASTYA_TLS_KEY', files.keyFile as string);
    let x509: crypto.X509Certificate;
    try { x509 = new crypto.X509Certificate(certPem); } catch (e) {
      throw new ConfigError('AGASTYA_TLS_CERT', `"${files.certFile}" is not a PEM certificate (${(e as Error).message}).`);
    }
    let key: crypto.KeyObject;
    try { key = crypto.createPrivateKey({ key: keyPem, passphrase }); } catch (e) {
      throw new ConfigError('AGASTYA_TLS_KEY', `"${files.keyFile}" cannot be read as a private key (${(e as Error).message}); an encrypted key needs AGASTYA_TLS_PASSPHRASE_FILE.`);
    }
    if (!x509.checkPrivateKey(key)) throw new ConfigError('AGASTYA_TLS_KEY', `"${files.keyFile}" is not the private key of the certificate "${files.certFile}".`);
    material = { options: { cert: certPem, key: keyPem, passphrase }, info: infoOf(x509, 'pem', now) };
  }
  const variable = files.pfxFile ? 'AGASTYA_TLS_PFX' : 'AGASTYA_TLS_CERT';
  if (new Date(material.info.validTo).getTime() <= now.getTime()) {
    throw new ConfigError(variable, `the certificate expired on ${material.info.validTo}; install a renewed one (docs/OPERATIONS.md, "Certificate renewal").`);
  }
  return material;
}

/** The host part of a Host header ("name:port", "[::1]:port", "name"), lower case, without a trailing dot. */
export function hostOnly(header: string): string {
  const h = header.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']') > 0 ? h.indexOf(']') : undefined);
  const colons = (h.match(/:/g) ?? []).length;
  const name = colons === 1 ? h.slice(0, h.indexOf(':')) : h;                      // more than one colon: a bare IPv6 address
  return name.replace(/\.$/, '');
}

/** One spelling per IPv6 address (the certificate says 0:0:0:0:0:0:0:1, a browser [::1]). */
function canon(h: string): string {
  return net.isIPv6(h) ? new URL(`http://[${h}]/`).hostname.slice(1, -1) : h;
}

function nameMatches(pattern: string, host: string): boolean {
  if (pattern === host) return true;
  if (pattern.startsWith('*.')) {                                                 // one label, as a certificate wildcard
    const rest = pattern.slice(1);
    return host.endsWith(rest) && host.length > rest.length && !host.slice(0, host.length - rest.length).includes('.');
  }
  return false;
}

export type HostCheck = (hostHeader: string | undefined) => boolean;

/** The Host rule for this configuration and certificate. A request without a Host header (HTTP/1.0, not a browser) is not refused. */
export function hostCheckFor(cfg: Pick<Config, 'mode' | 'host' | 'serverNames'>, certNames: string[] = []): HostCheck {
  if (cfg.serverNames.includes('*')) return () => true;
  const names = [...cfg.serverNames, ...certNames];
  if (cfg.host && !isLoopbackHost(cfg.host) && cfg.host !== '0.0.0.0' && cfg.host !== '::') names.push(cfg.host.toLowerCase());
  for (let i = 0; i < names.length; i++) names[i] = canon(names[i]);
  return (header) => {
    if (!header) return true;
    const host = canon(hostOnly(header));
    if (isLoopbackHost(host)) return true;
    return names.some((n) => nameMatches(n, host));
  };
}

// The rule in force. Before start() loads the certificate it is the configuration's own (a test server built with createApp() gets the
// loopback rule of Mode A); start() replaces it with one that knows the certificate's names.
let current: HostCheck = hostCheckFor(processConfig);
export const hostAllowed: HostCheck = (h) => current(h);
export function setHostCheck(check: HostCheck): void { current = check; }

/** The message of a refused Host, for HTTP (421) and the WebSocket upgrade alike. */
export const MISDIRECTED = 'This server does not answer to that name. Use the address the administrator gave you.';

/** Where to listen: Mode A without AGASTYA_HOST = both loopback addresses; otherwise the configured address (undefined = every interface). */
export function listenAddresses(cfg: Pick<Config, 'mode' | 'host'>): Array<string | undefined> {
  if (cfg.host) return [cfg.host];
  return cfg.mode === 'local' ? ['127.0.0.1', '::1'] : [undefined];
}

export interface Listening { servers: http.Server[]; port: number; addresses: string[]; scheme: 'http' | 'https' }

/**
 * Create and start the listeners for `handler`. The first address must bind; an extra loopback address (::1 next to 127.0.0.1) that the
 * machine does not have, or that another program holds, is skipped with a warning. `prepare` is called for each server before it listens.
 */
export async function listen(handler: http.RequestListener, port: number, cfg: Pick<Config, 'mode' | 'host'>, material: TlsMaterial | null,
  prepare: (s: http.Server) => void = () => undefined): Promise<Listening> {
  const servers: http.Server[] = []; const addresses: string[] = [];
  let bound = port;
  const make = (): http.Server => (material
    ? https.createServer({ ...material.options, minVersion: 'TLSv1.2' }, handler)
    : http.createServer(handler));
  const targets = listenAddresses(cfg);
  for (let i = 0; i < targets.length; i++) {
    const s = make(); prepare(s);
    try {
      await new Promise<void>((resolve, reject) => {
        s.once('error', reject);
        const done = (): void => { s.off('error', reject); resolve(); };
        if (targets[i] === undefined) s.listen(bound, done); else s.listen(bound, targets[i], done);
      });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i > 0 && cfg.host === undefined) { console.warn(`[network] not listening on ${targets[i]} as well (${code ?? (e as Error).message})`); continue; }
      for (const t of servers) t.close();
      throw e;
    }
    const a = s.address() as net.AddressInfo;
    bound = a.port; servers.push(s); addresses.push(a.family === 'IPv6' ? `[${a.address}]` : a.address);
  }
  return { servers, port: bound, addresses, scheme: material ? 'https' : 'http' };
}

/** A one-line description of the network setting for the start-up log and `npm run doctor`. */
export function describeNetwork(cfg: Pick<Config, 'mode' | 'host' | 'tls'>, info: CertInfo | null): string {
  const where = cfg.host ?? (cfg.mode === 'local' ? 'loopback (127.0.0.1, ::1)' : 'every network interface');
  const transport = info ? `TLS, certificate ${info.subject || '(no subject)'} for ${info.altNames.join(', ') || '(no subjectAltName)'}, ${info.daysLeft} days left, SHA-256 ${info.fingerprint256}` : 'plain HTTP (loopback only)';
  return `Mode ${cfg.mode === 'local' ? 'A (this computer only)' : 'B (server)'}; listens on ${where}; ${transport}`;
}
