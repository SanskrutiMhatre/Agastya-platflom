// =============================================================================
// Code signing as one configured step (audit WP-24: DEP-003, ENT-014, RES-005).
//
// The packager reads the signing set-up from the environment, so the same command builds an unsigned development package and a signed release:
//
//   AGASTYA_SIGN_THUMBPRINT   SHA-1 thumbprint of the code-signing certificate in a certificate store (CurrentUser\My, or LocalMachine\My with
//                             AGASTYA_SIGN_STORE=LocalMachine). Recommended: no password anywhere, and it works with a key in a hardware token / HSM.
//   AGASTYA_SIGN_PFX          or a .pfx file; its password in AGASTYA_SIGN_PASSWORD.
//   AGASTYA_SIGN_TIMESTAMP_URL  RFC 3161 time-stamp server (your CA's, or one reachable from the build machine). Every signature should carry a
//                             time stamp, or it stops verifying when the certificate expires; a --release build refuses to sign without one
//                             unless AGASTYA_SIGN_ALLOW_NO_TIMESTAMP=1 (recorded in BUILD-INFO.json).
//   AGASTYA_SIGNTOOL          signtool.exe to use (default: the newest x64 signtool of an installed Windows SDK). Without signtool the files are
//                             signed with Set-AuthenticodeSignature (scripts/signing/Sign-File.ps1), which needs no SDK.
//   AGASTYA_SIGN_CMD          (older, still honoured) a whole command with $f for the file; it replaces the above for the executables. The
//                             manifest and the checksum list can then only be signed when a thumbprint or .pfx is also given.
//
// What gets signed: every .exe/.dll/.node in the product that carries no signature yet (the host executables, xsltproc.exe and its DLLs, the
// argon2 native module); files already signed by their vendor (node.exe, the JRE) keep their own signature. Then the file manifest and, after
// the installer is built, SHA256SUMS.txt get a detached signature with the same certificate (scripts/signing/Sign-Manifest.ps1), and Inno Setup
// signs Setup.exe and its uninstaller through `node scripts/release/signing.mjs --sign <file>` (so no password reaches the ISCC command line).
// =============================================================================

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIGN_FILE_PS1 = path.join(ROOT, 'scripts', 'signing', 'Sign-File.ps1');
const SIGN_MANIFEST_PS1 = path.join(ROOT, 'scripts', 'signing', 'Sign-Manifest.ps1');

/** The newest x64 signtool.exe of an installed Windows 10/11 SDK, or null. */
export function findSigntool(env = process.env) {
  if (env.AGASTYA_SIGNTOOL) return fs.existsSync(env.AGASTYA_SIGNTOOL) ? env.AGASTYA_SIGNTOOL : null;
  const kits = path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
  if (!fs.existsSync(kits)) return null;
  const vers = fs.readdirSync(kits).filter((d) => /^10\.\d+\.\d+\.\d+$/.test(d))
    .sort((a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; });
  for (const v of vers) { const p = path.join(kits, v, 'x64', 'signtool.exe'); if (fs.existsSync(p)) return p; }
  return null;
}

/**
 * The signing set-up from the environment. { mode: 'none'|'store'|'pfx'|'command', ... , problems: [] }.
 * problems lists what makes the set-up unusable; a release build refuses to continue when there is any.
 */
export function signingConfig(env = process.env) {
  const c = {
    mode: 'none', problems: [],
    thumbprint: (env.AGASTYA_SIGN_THUMBPRINT || '').replace(/\s/g, '').toUpperCase() || null,
    store: /^localmachine$/i.test(env.AGASTYA_SIGN_STORE || '') ? 'LocalMachine' : 'CurrentUser',
    pfx: env.AGASTYA_SIGN_PFX || null,
    password: env.AGASTYA_SIGN_PASSWORD || null,
    timestampUrl: env.AGASTYA_SIGN_TIMESTAMP_URL || null,
    allowNoTimestamp: env.AGASTYA_SIGN_ALLOW_NO_TIMESTAMP === '1',
    command: env.AGASTYA_SIGN_CMD || null,
    signtool: null,
  };
  if (c.thumbprint && c.pfx) c.problems.push('set either AGASTYA_SIGN_THUMBPRINT or AGASTYA_SIGN_PFX, not both');
  if (c.thumbprint && !/^[0-9A-F]{40}$/.test(c.thumbprint)) c.problems.push('AGASTYA_SIGN_THUMBPRINT must be the 40-hex-digit SHA-1 thumbprint');
  if (c.pfx && !fs.existsSync(c.pfx)) c.problems.push(`AGASTYA_SIGN_PFX ${c.pfx} does not exist`);
  if (c.pfx && !c.password) c.problems.push('AGASTYA_SIGN_PFX needs its password in AGASTYA_SIGN_PASSWORD');
  if (c.timestampUrl && !/^https?:\/\/\S+$/i.test(c.timestampUrl)) c.problems.push('AGASTYA_SIGN_TIMESTAMP_URL must be an http(s) URL of an RFC 3161 server');
  if (c.command && !c.command.includes('$f')) c.problems.push('AGASTYA_SIGN_CMD must contain $f where the file name goes');
  c.mode = c.command ? 'command' : c.thumbprint ? 'store' : c.pfx ? 'pfx' : 'none';
  c.canSignManifest = !!(c.thumbprint || c.pfx);
  if (c.mode === 'store' || c.mode === 'pfx') c.signtool = findSigntool(env);
  return c;
}

/** Refusals of a --release build with this set-up (empty = may proceed). */
export function releaseSigningRefusals(c) {
  const r = [...c.problems];
  if (c.mode === 'none') r.push('a release must be signed: set AGASTYA_SIGN_THUMBPRINT (or AGASTYA_SIGN_PFX + AGASTYA_SIGN_PASSWORD) - docs/SIGNING.md');
  if (c.mode !== 'none' && !c.canSignManifest) r.push('the file manifest and SHA256SUMS.txt are signed with the certificate itself: with AGASTYA_SIGN_CMD also set AGASTYA_SIGN_THUMBPRINT or AGASTYA_SIGN_PFX');
  if (c.mode !== 'none' && !c.timestampUrl && !c.allowNoTimestamp) r.push('a release signature must be time-stamped: set AGASTYA_SIGN_TIMESTAMP_URL (or AGASTYA_SIGN_ALLOW_NO_TIMESTAMP=1 to accept signatures that stop verifying when the certificate expires)');
  return r;
}

/** The signtool argument list for a batch of files (never includes the password: see signFiles). */
export function signtoolArgs(c, files, { description } = {}) {
  const a = ['sign', '/fd', 'SHA256'];
  if (c.mode === 'store') { a.push('/sha1', c.thumbprint, '/s', 'My'); if (c.store === 'LocalMachine') a.push('/sm'); }
  else if (c.mode === 'pfx') a.push('/f', c.pfx, '/p', '<password>');
  if (c.timestampUrl) a.push('/tr', c.timestampUrl, '/td', 'SHA256');
  if (description) a.push('/d', description);
  return [...a, ...files];
}

/** Authenticode-sign files. Throws with the tool's output on failure. */
export function signFiles(c, files, { description = 'Agastya Platform', log = () => {} } = {}) {
  if (!files.length) return;
  if (c.mode === 'command') {
    for (const f of files) {
      const r = spawnSync(c.command.replace(/\$f/g, `"${f}"`), { shell: true, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`signing ${path.basename(f)} failed (AGASTYA_SIGN_CMD):\n${r.stdout}${r.stderr}`);
    }
    return;
  }
  if (c.mode !== 'store' && c.mode !== 'pfx') throw new Error('signing is not configured');
  if (c.signtool) {
    for (let i = 0; i < files.length; i += 40) {          // keep each command line well under the 32k limit
      const batch = files.slice(i, i + 40);
      const args = signtoolArgs(c, batch, { description }).map((x) => (x === '<password>' ? c.password : x));
      const r = spawnSync(c.signtool, args, { encoding: 'utf8', windowsHide: true });
      if (r.status !== 0) throw new Error(`signtool failed (exit ${r.status}):\n${r.stdout}${r.stderr}`.replaceAll(c.password || '\u0000', '***'));
      log(`  signtool signed ${batch.length} file(s)`);
    }
    return;
  }
  // no Windows SDK: Set-AuthenticodeSignature through Sign-File.ps1 (pfx) or the store certificate
  for (const f of files) {
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
    if (c.mode === 'pfx') args.push('-File', SIGN_FILE_PS1, '-File', f, '-Pfx', c.pfx, ...(c.timestampUrl ? ['-TimestampServer', c.timestampUrl] : []));
    else args.push('-Command', `$c = Get-Item -LiteralPath 'Cert:\\${c.store}\\My\\${c.thumbprint}'; $a = @{ FilePath = '${f.replace(/'/g, "''")}'; Certificate = $c; HashAlgorithm = 'SHA256' }; ` +
      `${c.timestampUrl ? `$a.TimestampServer = '${c.timestampUrl}'; ` : ''}$s = Set-AuthenticodeSignature @a; if ($s.Status -eq 'NotSigned' -or $s.Status -eq 'HashMismatch') { exit 1 }`);
    const r = spawnSync('powershell.exe', args, { encoding: 'utf8', env: { ...process.env, AGASTYA_SIGN_PASSWORD: c.password || '' }, windowsHide: true });
    if (r.status !== 0) throw new Error(`signing ${path.basename(f)} failed:\n${r.stdout}${r.stderr}`);
  }
  log(`  Set-AuthenticodeSignature signed ${files.length} file(s) (no signtool found)`);
}

/** Write <file>.sig for each file with the configured certificate (Sign-Manifest.ps1). */
export function signDetached(c, files) {
  if (!c.canSignManifest) throw new Error('detached signatures need AGASTYA_SIGN_THUMBPRINT or AGASTYA_SIGN_PFX');
  const out = [];
  for (const f of files) {   // one call per file: "powershell -File" passes a comma list as one string, not an array
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SIGN_MANIFEST_PS1, '-File', f];
    if (c.thumbprint) args.push('-Thumbprint', c.thumbprint, '-StoreLocation', c.store); else args.push('-Pfx', c.pfx);
    const r = spawnSync('powershell.exe', args, { encoding: 'utf8', env: { ...process.env, AGASTYA_SIGN_PASSWORD: c.password || '' }, windowsHide: true });
    if (r.status !== 0) throw new Error(`Sign-Manifest.ps1 failed for ${path.basename(f)} (exit ${r.status}):\n${r.stdout}${r.stderr}`);
    out.push(r.stdout.trim());
  }
  return out.join('\n');
}

/** A description of the set-up for logs and BUILD-INFO.json: never the password or the .pfx path. */
export const describeSigning = (c) => ({
  mode: c.mode, tool: c.mode === 'command' ? 'AGASTYA_SIGN_CMD' : c.signtool ? 'signtool' : c.mode === 'none' ? null : 'Set-AuthenticodeSignature',
  thumbprint: c.thumbprint, store: c.mode === 'store' ? c.store : undefined, timestamped: !!c.timestampUrl, timestampUrl: c.timestampUrl,
  detachedSignatures: c.canSignManifest,
});

// `node scripts/release/signing.mjs --sign <file>`: what Inno Setup calls to sign Setup.exe and the uninstaller (packaging/installer/agastya.iss,
// SignTool=agastyasign). `--show` prints the set-up the packager would use.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const c = signingConfig();
  if (argv[0] === '--show') { console.log(JSON.stringify({ ...describeSigning(c), signtool: c.signtool, problems: c.problems }, null, 2)); process.exit(c.problems.length ? 1 : 0); }
  if (argv[0] === '--sign' && argv[1]) {
    if (c.problems.length || c.mode === 'none') { console.error(`signing is not usable: ${c.problems.join('; ') || 'not configured'}`); process.exit(2); }
    try { signFiles(c, [path.resolve(argv[1])]); console.log(`signed ${path.basename(argv[1])}`); process.exit(0); } catch (e) { console.error(e.message); process.exit(1); }
  }
  console.error('usage: node scripts/release/signing.mjs --show | --sign <file>'); process.exit(2);
}
