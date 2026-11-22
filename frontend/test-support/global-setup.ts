// vitest globalSetup: make an `xmllint` command available to the tests.
//
// Some tests (dmtypes, isoentities, the verification suites) shell out to a native `xmllint`. A real one is used when it is
// on the PATH. Otherwise a small launcher that runs the WebAssembly build of the same libxml2 (xmllint-shim.mjs) is put at
// the front of PATH for the duration of the run, so the tests run - and judge - the same on every machine.
//
// On Windows Node's spawnSync finds only real executables (not .cmd files), so the launcher is a tiny .exe compiled on the spot
// with the .NET Framework C# compiler that every Windows installation has (no SDK needed).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LAUNCHER_CS = `
using System; using System.Diagnostics; using System.Text;
static class P {
  static string Q(string a) {
    if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\\t', '"' }) < 0) return a;
    var sb = new StringBuilder("\\""); int bs = 0;
    foreach (char c in a) {
      if (c == '\\\\') { bs++; continue; }
      if (c == '"') { sb.Append('\\\\', bs * 2 + 1).Append('"'); bs = 0; continue; }
      sb.Append('\\\\', bs).Append(c); bs = 0;
    }
    return sb.Append('\\\\', bs * 2).Append('"').ToString();
  }
  static int Main(string[] args) {
    var parts = new System.Collections.Generic.List<string> { Q(Environment.GetEnvironmentVariable("XMLLINT_SHIM")) };
    foreach (var a in args) parts.Add(Q(a));
    var psi = new ProcessStartInfo(Environment.GetEnvironmentVariable("XMLLINT_NODE"), string.Join(" ", parts)) { UseShellExecute = false };
    using (var p = Process.Start(psi)) { p.WaitForExit(); return p.ExitCode; }
  }
}`;

function windowsLauncher(dir: string, shim: string): boolean {
  const csc = path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!fs.existsSync(csc)) return false;
  const src = path.join(dir, 'xmllint.cs');
  fs.writeFileSync(src, LAUNCHER_CS);
  const r = spawnSync(csc, ['/nologo', '/target:exe', `/out:${path.join(dir, 'xmllint.exe')}`, src], { encoding: 'utf8' });
  process.env.XMLLINT_SHIM = shim;
  process.env.XMLLINT_NODE = process.execPath;
  return r.status === 0 && fs.existsSync(path.join(dir, 'xmllint.exe'));
}

export default function setup(): () => void {
  const probe = spawnSync('xmllint', ['--version'], { encoding: 'utf8' });
  if (!probe.error) return () => {};
  const shim = path.resolve(__dirname, 'xmllint-shim.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xmllint-shim-'));
  let ok = true;
  if (process.platform === 'win32') ok = windowsLauncher(dir, shim);
  else {
    fs.writeFileSync(path.join(dir, 'xmllint'), `#!/bin/sh\nexec "${process.execPath}" "${shim}" "$@"\n`, { mode: 0o755 });
  }
  if (!ok) {
    console.warn('[tests] no native xmllint on PATH and the stand-in could not be built - tests that need it will fail');
    return () => { fs.rmSync(dir, { recursive: true, force: true }); };
  }
  const key = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  process.env[key] = dir + path.delimiter + (process.env[key] ?? '');
  console.log('[tests] no native xmllint on PATH - using the WebAssembly build of libxml2 (test-support/xmllint-shim.mjs)');
  return () => { fs.rmSync(dir, { recursive: true, force: true }); };
}
