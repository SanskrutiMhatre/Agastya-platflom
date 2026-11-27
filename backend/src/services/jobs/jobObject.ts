// =============================================================================
// WP-14 / PRD-001 (addendum 17): the job workers and every tool they start (the FOP JVM, xsltproc, Ghostscript) run inside one Windows job
// object with a per-process memory limit, a memory limit for all of them together, a CPU rate cap, an active-process limit and
// kill-on-close.
//
// Node has no API for job objects and the product takes no new native module, so the job object is held by a small helper process:
// Windows PowerShell 5.1 (part of every supported Windows) compiles the few kernel32 calls below with Add-Type and keeps the only handle.
// The server writes "ASSIGN <pid>" for each worker it starts; processes a worker starts join the job by inheritance. The helper reads its
// standard input until it closes: when the server stops - cleanly, by a crash, or killed - the pipe closes, the helper exits, the handle
// closes, and Windows ends every process in the job (kill-on-close). So no worker and no java.exe outlives the server.
//
// If the helper cannot start (not Windows, PowerShell missing, Add-Type blocked by a language-mode policy), the job service still runs:
// each worker then has its V8 heap limit and the JVM its -Xmx, workers run at below-normal priority, a worker ends its JVM when the server's
// channel closes, and the status says why the job object is not in force (GET /api/admin/jobs).
// =============================================================================

import { spawn, type ChildProcess } from 'child_process';
import readline from 'readline';

export interface JobObjectLimits { processMb: number; jobMb: number; cpuPercent: number; activeProcesses: number }
export interface JobObjectStatus { state: 'off' | 'starting' | 'active' | 'unavailable'; reason?: string; limits?: JobObjectLimits; cpu?: string }
export interface JobObjectStats { active: number; terminated: number; peakProcessMb: number; peakJobMb: number }

const CSHARP = `
using System;
using System.Runtime.InteropServices;
public static class AgastyaJob {
  [StructLayout(LayoutKind.Sequential)] public struct BASIC { public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] public struct IOC { public ulong R; public ulong W; public ulong O; public ulong RB; public ulong WB; public ulong OB; }
  [StructLayout(LayoutKind.Sequential)] public struct EXT { public BASIC Basic; public IOC Io; public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed; }
  [StructLayout(LayoutKind.Sequential)] public struct CPU { public uint ControlFlags; public uint CpuRate; }
  [StructLayout(LayoutKind.Sequential)] public struct ACCT { public long TotalUserTime; public long TotalKernelTime; public long ThisPeriodTotalUserTime; public long ThisPeriodTotalKernelTime; public uint TotalPageFaultCount; public uint TotalProcesses; public uint ActiveProcesses; public uint TotalTerminatedProcesses; }
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObjectW(IntPtr a, string n);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr j, int c, IntPtr i, uint l);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr j, int c, IntPtr i, uint l, IntPtr r);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint a, bool i, uint pid);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
  static IntPtr job = IntPtr.Zero;
  static void Set(int cls, object v) {
    int n = Marshal.SizeOf(v); IntPtr p = Marshal.AllocHGlobal(n);
    try { Marshal.StructureToPtr(v, p, false); if (!SetInformationJobObject(job, cls, p, (uint)n)) throw new Exception("SetInformationJobObject(" + cls + ") error " + Marshal.GetLastWin32Error()); }
    finally { Marshal.FreeHGlobal(p); }
  }
  static object Query(int cls, Type t) {
    int n = Marshal.SizeOf(t); IntPtr p = Marshal.AllocHGlobal(n);
    try { if (!QueryInformationJobObject(job, cls, p, (uint)n, IntPtr.Zero)) throw new Exception("QueryInformationJobObject(" + cls + ") error " + Marshal.GetLastWin32Error()); return Marshal.PtrToStructure(p, t); }
    finally { Marshal.FreeHGlobal(p); }
  }
  public static string Create(long processMb, long jobMb, uint active, uint cpuPercent) {
    job = CreateJobObjectW(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new Exception("CreateJobObject error " + Marshal.GetLastWin32Error());
    EXT e = new EXT();
    uint f = 0x2000 | 0x400;                                   // KILL_ON_JOB_CLOSE | DIE_ON_UNHANDLED_EXCEPTION (no error dialog holding a job)
    if (processMb > 0) { f |= 0x100; e.ProcessMemoryLimit = new UIntPtr((ulong)processMb * 1048576UL); }
    if (jobMb > 0) { f |= 0x200; e.JobMemoryLimit = new UIntPtr((ulong)jobMb * 1048576UL); }
    if (active > 0) { f |= 0x8; e.Basic.ActiveProcessLimit = active; }
    e.Basic.LimitFlags = f;
    Set(9, e);                                                 // JobObjectExtendedLimitInformation
    string cpu = "off";
    if (cpuPercent > 0 && cpuPercent < 100) {
      CPU c = new CPU(); c.ControlFlags = 0x1 | 0x4; c.CpuRate = cpuPercent * 100;   // ENABLE | HARD_CAP, in 1/100 of a percent
      try { Set(15, c); cpu = cpuPercent + "%"; } catch (Exception x) { cpu = "not applied: " + x.Message; }
    }
    return cpu;
  }
  public static void Assign(uint pid) {
    IntPtr h = OpenProcess(0x0101, false, pid);               // PROCESS_SET_QUOTA | PROCESS_TERMINATE
    if (h == IntPtr.Zero) throw new Exception("OpenProcess error " + Marshal.GetLastWin32Error());
    try { if (!AssignProcessToJobObject(job, h)) throw new Exception("AssignProcessToJobObject error " + Marshal.GetLastWin32Error()); }
    finally { CloseHandle(h); }
  }
  public static string Stats() {
    EXT e = (EXT)Query(9, typeof(EXT)); ACCT a = (ACCT)Query(1, typeof(ACCT));
    return "{\\"active\\":" + a.ActiveProcesses + ",\\"terminated\\":" + a.TotalTerminatedProcesses + ",\\"peakProcessMb\\":" + (e.PeakProcessMemoryUsed.ToUInt64() / 1048576UL) + ",\\"peakJobMb\\":" + (e.PeakJobMemoryUsed.ToUInt64() / 1048576UL) + "}";
  }
}
`;

function script(l: JobObjectLimits): string {
  return `$ErrorActionPreference = 'Stop'
function W([string]$s) { [Console]::Out.WriteLine($s); [Console]::Out.Flush() }
try {
  Add-Type -TypeDefinition @'
${CSHARP}
'@
  $cpu = [AgastyaJob]::Create(${Math.floor(l.processMb)}, ${Math.floor(l.jobMb)}, ${Math.floor(l.activeProcesses)}, ${Math.floor(l.cpuPercent)})
  W ("READY " + $cpu)
} catch { W ("FAIL " + $_.Exception.Message); exit 1 }
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  if ($line.StartsWith('ASSIGN ')) {
    $id = $line.Substring(7)
    try { [AgastyaJob]::Assign([uint32]$id); W ("OK " + $id) } catch { W ("ERR " + $id + " " + $_.Exception.Message) }
  } elseif ($line -eq 'STATS') {
    try { W ("STATS " + [AgastyaJob]::Stats()) } catch { W ("STATS {}") }
  }
}
`;
}

/** The helper that holds the job object. One per job service; `close()` (or the server's end) ends every process in the job. */
export class JobObjectHolder {
  private proc: ChildProcess | null = null;
  private waiting: Array<(line: string) => void> = [];
  private ready: Promise<JobObjectStatus> | null = null;
  status: JobObjectStatus;

  constructor(private readonly limits: JobObjectLimits | null) {
    this.status = limits ? { state: 'starting', limits } : { state: 'off', reason: 'turned off (AGASTYA_JOB_OBJECT=0, or not Windows)' };
  }

  /** Starts the helper once; resolves when the job object exists (or why it does not). Never rejects. */
  start(): Promise<JobObjectStatus> {
    if (!this.limits) return Promise.resolve(this.status);
    if (this.ready) return this.ready;
    const limits = this.limits;
    this.ready = new Promise<JobObjectStatus>((resolve) => {
      const give = (s: JobObjectStatus): void => { this.status = s; resolve(s); };
      let p: ChildProcess;
      try {
        const encoded = Buffer.from(script(limits), 'utf16le').toString('base64');
        p = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      } catch (e) { give({ state: 'unavailable', reason: `PowerShell could not start: ${(e as Error).message}`, limits }); return; }
      this.proc = p;
      let first = true; let err = '';
      p.stderr?.on('data', (d) => { err = (err + String(d)).slice(-2000); });
      const rl = readline.createInterface({ input: p.stdout! });
      rl.on('line', (line) => {
        if (first) {
          first = false;
          if (line.startsWith('READY ')) give({ state: 'active', limits, cpu: line.slice(6).trim() });
          else give({ state: 'unavailable', reason: line.replace(/^FAIL\s*/, '').slice(0, 300) || 'the helper did not start', limits });
          return;
        }
        const w = this.waiting.shift(); if (w) w(line);
      });
      const timer = setTimeout(() => { if (first) { first = false; give({ state: 'unavailable', reason: 'the helper did not answer within 60 s', limits }); try { p.kill(); } catch { /* gone */ } } }, 60_000);
      timer.unref();
      p.on('error', (e) => { if (first) { first = false; give({ state: 'unavailable', reason: `PowerShell could not start: ${e.message}`, limits }); } });
      p.on('exit', (code) => {
        this.proc = null;
        for (const w of this.waiting.splice(0)) w('ERR helper exited');
        if (first) { first = false; give({ state: 'unavailable', reason: `the helper stopped (exit code ${code}) ${err.trim().slice(0, 300)}`.trim(), limits }); }
        else if (this.status.state === 'active') this.status = { state: 'unavailable', reason: `the helper stopped (exit code ${code})`, limits };
      });
      // the helper must not keep a test process (or a stopping server) alive by itself
      p.unref(); (p.stdin as unknown as { unref?: () => void })?.unref?.(); (p.stdout as unknown as { unref?: () => void })?.unref?.(); (p.stderr as unknown as { unref?: () => void })?.unref?.();
    });
    return this.ready;
  }

  private ask(line: string): Promise<string> {
    if (!this.proc || this.status.state !== 'active') return Promise.resolve('ERR not active');
    return new Promise((resolve) => { this.waiting.push(resolve); try { this.proc!.stdin!.write(`${line}\n`); } catch { resolve('ERR write failed'); } });
  }

  /** Puts a process into the job. False (with the reason in the log) when the job object is not in force. */
  async assign(pid: number): Promise<{ ok: boolean; reason?: string }> {
    const s = await this.start();
    if (s.state !== 'active') return { ok: false, reason: s.reason };
    const r = await this.ask(`ASSIGN ${pid}`);
    return r.startsWith('OK ') ? { ok: true } : { ok: false, reason: r.replace(/^ERR\s*\d*\s*/, '') };
  }

  async stats(): Promise<JobObjectStats | null> {
    if (this.status.state !== 'active') return null;
    const r = await this.ask('STATS');
    try { return JSON.parse(r.replace(/^STATS\s*/, '')) as JobObjectStats; } catch { return null; }
  }

  /** Closes the job: every process in it ends. */
  close(): void {
    const p = this.proc; this.proc = null; this.ready = null;
    if (this.limits) this.status = { state: 'starting', limits: this.limits };
    if (p) { try { p.stdin?.end(); } catch { /* gone */ } setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, 3000).unref(); }
  }
}
