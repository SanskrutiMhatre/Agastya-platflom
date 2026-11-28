// =============================================================================
// Secrets at rest (Phase 3, P3-5: GitLab tokens and the OAuth application secret).
//
// The platform had no encrypted-secret store before this (the audit key, WP-29, is an HMAC key, not an encryption key), so this is the one:
// AES-256-GCM with a 256-bit key held in a file OUTSIDE the database (config.gitlab.secretsKeyFile: AGASTYA_SECRETS_KEY_FILE, default
// <workspace>/keys/secrets.key). The key is made on first use (32 random bytes, hex, owner-only where the file system knows modes); a file
// that does not hold a key stops the operation instead of silently making a new key (every stored secret would become unreadable).
//
// A sealed value is `v1:<key id>:<iv>:<tag>:<ciphertext>` (base64url). The key id (first 16 hex digits of SHA-256 of the key) says which key
// sealed it, so a database restored next to a different key file is reported as "sealed under another key", not as corrupt.
// A secret is never logged, never returned to the browser, and never written to the audit log (redactAuditMeta drops token/secret fields).
//
// Backups: the key file is not in the database. Keep it with the backups (docs/OPERATIONS.md, GitLab); without it the administrator re-enters
// the GitLab secrets and every user reconnects - nothing else is lost.
// =============================================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config';

let cached: { key: Buffer; id: string; file: string } | null = null;

const keyIdOf = (key: Buffer): string => crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);

/** The secrets key: read, or made on first use. */
export function secretsKey(file = config.gitlab.secretsKeyFile): { key: Buffer; id: string; file: string } {
  if (cached && cached.file === file) return cached;
  let text: string | null = null;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  if (text === null) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { fs.writeFileSync(file, `${crypto.randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    text = fs.readFileSync(file, 'utf8');
  }
  const hex = text.trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error(`The secrets key file ${file} does not hold a key (64 hex digits). Restore it from the backup it was kept with; do not delete it.`);
  const key = Buffer.from(hex, 'hex');
  cached = { key, id: keyIdOf(key), file };
  return cached;
}

const b64 = (b: Buffer): string => b.toString('base64url');

/** Seal a secret (a token, a client secret). */
export function seal(plain: string): string {
  const k = secretsKey();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k.key, iv);
  const ct = Buffer.concat([c.update(Buffer.from(plain, 'utf8')), c.final()]);
  return `v1:${k.id}:${b64(iv)}:${b64(c.getAuthTag())}:${b64(ct)}`;
}

export class SecretUnreadable extends Error {
  constructor(message: string, public readonly reason: 'other-key' | 'damaged') { super(message); this.name = 'SecretUnreadable'; }
}

/** Open a sealed secret; throws SecretUnreadable when it was sealed under another key or was altered. */
export function open(sealed: string): string {
  const parts = String(sealed ?? '').split(':');
  if (parts.length !== 5 || parts[0] !== 'v1') throw new SecretUnreadable('A stored secret is not in a format this version reads.', 'damaged');
  const k = secretsKey();
  if (parts[1] !== k.id) throw new SecretUnreadable('A stored secret was sealed under another secrets key (the key file was replaced or the database restored elsewhere). Enter it again.', 'other-key');
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', k.key, Buffer.from(parts[2], 'base64url'));
    d.setAuthTag(Buffer.from(parts[3], 'base64url'));
    return Buffer.concat([d.update(Buffer.from(parts[4], 'base64url')), d.final()]).toString('utf8');
  } catch { throw new SecretUnreadable('A stored secret could not be opened (it was altered).', 'damaged'); }
}

/** Test seam: forget the cached key (a test that swaps the key file). */
export function forgetSecretsKey(): void { cached = null; }
