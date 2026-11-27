// =============================================================================
// Agastya Platform - Windows host.
//
// One small native program that runs the bundled Node.js server the way a Windows product is expected to run:
//   AgastyaPlatform.exe            tray application: starts the server, opens the browser, keeps it running
//   AgastyaPlatform.exe --service  entry point the Windows Service Control Manager uses
//   AgastyaCtl.exe <command>       the same code built as a console program, for administrators and scripts
//
// Commands (AgastyaCtl.exe):  --console  --doctor [--deep]  --verify  --support-bundle [file]  --status  --start  --stop  --install-service
//                             --uninstall-service  --version  --help   (--verify / --support-bundle / the start-up file check: Integrity.cs, SupportBundle.cs)
//                             --verify-update  --apply-update  --rollback  --versions  --prune-versions  --repair-launcher  --first-admin
//                             (WP-25 offline update, version folders, the window, first administrator: Update.cs)
// Options:                    --home <dir>   keep config, data and logs under <dir> (tests and portable use)
//                             --port <n>     --lan   (with --install-service: written to the configuration)
//
// Built with the .NET Framework 4 C# compiler that ships with Windows, so it needs nothing installed and the language level is C# 5.
// =============================================================================

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Threading;
#if GUI
using System.Drawing;
using System.Windows.Forms;
#endif

namespace Agastya
{
    // ---------------------------------------------------------------------------------------------------------------
    // Where everything lives.
    // ---------------------------------------------------------------------------------------------------------------
    internal static class Layout
    {
        // WP-25 (DEP-023): an installation keeps each version in its own folder and a pointer to the one that runs:
        //   <InstallDir>\AgastyaPlatform.exe, AgastyaCtl.exe   the launcher (a copy of the current version's; shortcuts and the service use it)
        //   <InstallDir>\current, previous                       one line each: the folder name under versions\ (Update.cs writes them atomically)
        //   <InstallDir>\versions\<version>\                     runtime\, app\, version.json, MANIFEST.sha256 ... of that version
        // Without a "current" file (the portable ZIP, a development tree, an installation made before WP-25) the program files sit beside the
        // launcher, as before ("flat" layout).
        public static string InstallDir;  // the folder of the launcher (the install folder, or the unpacked portable folder)
        public static string ExeDir;      // the program files of the running version: <InstallDir>\versions\<current>, or InstallDir (flat)
        public static string AppDir;      // <ExeDir>\app
        public static string NodeExe;     // <ExeDir>\runtime\node.exe
        public static string CurrentVersion;  // the "current" pointer, or null in a flat layout
        public static string StateDir;    // config, data and logs live under here unless the configuration says otherwise
        public static string ConfigFile;
        public static string LogDir;
        public static bool Portable;
        public static string StateOverride;   // --home / AGASTYA_HOME, when given
        public static string InstallOverride; // --install-dir, when given (Setup runs its own new AgastyaCtl.exe against the installed folder)

        public static string VersionsDir { get { return Path.Combine(InstallDir, "versions"); } }

        /// <summary>Re-read the "current" pointer (after Update.cs switched it).</summary>
        public static void ResolveProgram()
        {
            ExeDir = InstallDir;
            CurrentVersion = Versions.ReadPointer("current");
            if (CurrentVersion != null)
            {
                string d = Path.Combine(VersionsDir, CurrentVersion);
                if (Directory.Exists(d)) ExeDir = d; else CurrentVersion = null;
            }
            AppDir = Path.Combine(ExeDir, "app");
            NodeExe = Path.Combine(Path.Combine(ExeDir, "runtime"), "node.exe");
        }

        public static void Init(string homeOverride)
        {
            string self = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            InstallDir = self;
            if (!string.IsNullOrEmpty(InstallOverride)) InstallDir = Path.GetFullPath(InstallOverride);
            else
            {
                // started from inside versions\<v>\ (by hand, or a shortcut of an older layout): the installation is two folders up
                DirectoryInfo up = Directory.GetParent(self);
                if (up != null && up.Name.Equals("versions", StringComparison.OrdinalIgnoreCase) && up.Parent != null && File.Exists(Path.Combine(up.Parent.FullName, "current")))
                    InstallDir = up.Parent.FullName;
            }
            ResolveProgram();
            Portable = File.Exists(Path.Combine(InstallDir, "portable.flag"));
            if (!string.IsNullOrEmpty(homeOverride))
            {
                StateDir = Path.GetFullPath(homeOverride);
                ConfigFile = Path.Combine(StateDir, "agastya.ini");
                LogDir = Path.Combine(StateDir, "logs");
            }
            else if (Portable)
            {
                StateDir = Path.Combine(InstallDir, "data");
                ConfigFile = Path.Combine(Path.Combine(InstallDir, "config"), "agastya.ini");
                LogDir = Path.Combine(StateDir, "logs");
            }
            else
            {
                // The installer records where this installation keeps its configuration and logs (per-machine: C:\ProgramData\Agastya Platform;
                // per-user: under the user's profile; or a folder an administrator chose) in state.dir beside the program.
                string marker = Path.Combine(InstallDir, "state.dir");
                string chosen = null;
                try { if (File.Exists(marker)) { string[] l = File.ReadAllLines(marker); if (l.Length > 0 && l[0].Trim().Length > 0) chosen = l[0].Trim(); } } catch { }
                StateDir = chosen != null ? Environment.ExpandEnvironmentVariables(chosen)
                                          : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "Agastya Platform");
                ConfigFile = Path.Combine(StateDir, "agastya.ini");
                LogDir = Path.Combine(StateDir, "logs");
            }
        }

        public static string Version
        {
            get
            {
                System.Version v = Assembly.GetExecutingAssembly().GetName().Version;
                return v.Major + "." + v.Minor + "." + v.Build;
            }
        }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // agastya.ini - a plain key=value file with [sections]; every setting has a default, so a missing or empty file is valid.
    // ---------------------------------------------------------------------------------------------------------------
    internal sealed class Settings
    {
        public int Port = 4040;
        public string Bind = "loopback";       // loopback | lan | an IP address
        public string DataDir = "";
        public bool SecureCookies;
        public bool OpenBrowser = true;
        public int LogMaxMb = 10;
        public int LogKeep = 5;
        public string ServiceName = "AgastyaPlatform";
        // WP-26: Mode B (a server on the network) serves TLS only. Empty Mode = "server" when Bind is not loopback, else "local".
        public string Mode = "";
        public string ServerNames = "";
        public string TlsCert = "", TlsKey = "", TlsPfx = "", TlsPassphraseFile = "", HstsMaxAge = "";
        // WP-25: where the interface opens (auto = an app window of Microsoft Edge when it is there, else the default browser with a notice)
        public string Window = "auto";
        // WP-25 (DEP-023): offline updates. KeepVersions = earlier versions kept for a rollback; HealthSeconds = how long a new version has to
        // answer /api/version and /api/ready before it is rolled back; TrustedThumbprints = further signing certificates accepted for an update
        // package (a certificate renewal), comma-separated SHA-1 thumbprints - the signer of the installed AgastyaCtl.exe is always accepted.
        public int KeepVersions = 2;
        public int HealthSeconds = 60;
        public string TrustedThumbprints = "";
        public List<string> Problems = new List<string>();

        public bool TlsConfigured { get { return TlsCert.Length > 0 || TlsPfx.Length > 0; } }
        public bool Loopback { get { string b = BindAddress; return b.StartsWith("127.") || b == "::1" || b.Equals("localhost", StringComparison.OrdinalIgnoreCase); } }
        public string EffectiveMode { get { return Mode.Length > 0 ? Mode.ToLowerInvariant() : (Loopback ? "local" : "server"); } }
        /// <summary>A path in agastya.ini may be relative to the folder of agastya.ini.</summary>
        public static string StatePath(string p)
        {
            if (string.IsNullOrEmpty(p)) return p;
            string x = Environment.ExpandEnvironmentVariables(p);
            return Path.IsPathRooted(x) ? x : Path.Combine(Path.GetDirectoryName(Layout.ConfigFile), x);
        }

        public string WorkspaceDir
        {
            get
            {
                if (!string.IsNullOrEmpty(DataDir)) return Environment.ExpandEnvironmentVariables(DataDir);
                return Path.Combine(Layout.StateDir, "workspace");
            }
        }

        public string BindAddress
        {
            get
            {
                string b = (Bind ?? "").Trim();
                if (b.Length == 0 || b.Equals("loopback", StringComparison.OrdinalIgnoreCase)) return "127.0.0.1";
                if (b.Equals("lan", StringComparison.OrdinalIgnoreCase) || b.Equals("any", StringComparison.OrdinalIgnoreCase)) return "0.0.0.0";
                return b;
            }
        }

        public string Url { get { return (TlsConfigured ? "https" : "http") + "://localhost:" + Port + "/"; } }

        public static Settings Load()
        {
            Settings s = new Settings();
            if (!File.Exists(Layout.ConfigFile)) return s;
            string section = "";
            int lineNo = 0;
            foreach (string raw in File.ReadAllLines(Layout.ConfigFile))
            {
                lineNo++;
                string line = raw.Trim();
                if (line.Length == 0 || line[0] == ';' || line[0] == '#') continue;
                if (line[0] == '[' && line[line.Length - 1] == ']') { section = line.Substring(1, line.Length - 2).Trim().ToLowerInvariant(); continue; }
                int eq = line.IndexOf('=');
                if (eq < 1) { s.Problems.Add("line " + lineNo + ": not a key=value line"); continue; }
                string key = section + "." + line.Substring(0, eq).Trim().ToLowerInvariant();
                string val = line.Substring(eq + 1).Trim();
                switch (key)
                {
                    case "server.port":
                        int p;
                        if (int.TryParse(val, out p) && p >= 1 && p <= 65535) s.Port = p; else s.Problems.Add("line " + lineNo + ": Port must be 1-65535");
                        break;
                    case "server.bind": s.Bind = val; break;
                    case "storage.datadir": s.DataDir = val; break;
                    case "security.securecookies": s.SecureCookies = val == "1" || val.Equals("true", StringComparison.OrdinalIgnoreCase); break;
                    case "app.openbrowser": s.OpenBrowser = !(val == "0" || val.Equals("false", StringComparison.OrdinalIgnoreCase)); break;
                    case "logging.maxfilemb": int mb; if (int.TryParse(val, out mb) && mb >= 1) s.LogMaxMb = mb; break;
                    case "logging.keepfiles": int kf; if (int.TryParse(val, out kf) && kf >= 1) s.LogKeep = kf; break;
                    case "service.name": if (val.Length > 0) s.ServiceName = val; break;
                    case "server.mode": s.Mode = val; break;
                    case "server.servernames": s.ServerNames = val; break;
                    case "tls.certificate": s.TlsCert = val; break;
                    case "tls.key": s.TlsKey = val; break;
                    case "tls.pfx": s.TlsPfx = val; break;
                    case "tls.passphrasefile": s.TlsPassphraseFile = val; break;
                    case "tls.hstsmaxage": s.HstsMaxAge = val; break;
                    case "app.window":
                        string w = val.ToLowerInvariant();
                        if (w == "auto" || w == "app" || w == "browser") s.Window = w; else s.Problems.Add("line " + lineNo + ": Window must be auto, app or browser");
                        break;
                    case "update.keepversions":
                        int kv; if (int.TryParse(val, out kv) && kv >= 1 && kv <= 10) s.KeepVersions = kv; else s.Problems.Add("line " + lineNo + ": KeepVersions must be 1-10");
                        break;
                    case "update.healthseconds":
                        int hs; if (int.TryParse(val, out hs) && hs >= 15 && hs <= 900) s.HealthSeconds = hs; else s.Problems.Add("line " + lineNo + ": HealthSeconds must be 15-900");
                        break;
                    case "update.trustedthumbprints": s.TrustedThumbprints = val; break;
                    default: s.Problems.Add("line " + lineNo + ": unknown setting '" + key + "'"); break;
                }
            }
            return s;
        }

        /// <summary>Set one key in agastya.ini, creating the file and the section when needed. Every other line is kept as it is.</summary>
        public static void Set(string section, string key, string value)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Layout.ConfigFile));
            List<string> lines = File.Exists(Layout.ConfigFile) ? new List<string>(File.ReadAllLines(Layout.ConfigFile)) : new List<string>();
            int secStart = -1;
            for (int i = 0; i < lines.Count; i++)
            {
                string t = lines[i].Trim();
                if (t.Equals("[" + section + "]", StringComparison.OrdinalIgnoreCase)) { secStart = i; break; }
            }
            if (secStart < 0)
            {
                if (lines.Count > 0 && lines[lines.Count - 1].Trim().Length > 0) lines.Add("");
                lines.Add("[" + section + "]"); lines.Add(key + "=" + value);
            }
            else
            {
                int found = -1, lastContent = secStart;
                for (int i = secStart + 1; i < lines.Count; i++)
                {
                    string t = lines[i].Trim();
                    if (t.Length > 0 && t[0] == '[') break;
                    if (t.Length == 0) continue;
                    lastContent = i;
                    if (t[0] == ';' || t[0] == '#') continue;
                    int eq = t.IndexOf('=');
                    if (eq > 0 && t.Substring(0, eq).Trim().Equals(key, StringComparison.OrdinalIgnoreCase)) found = i;
                }
                if (found >= 0) lines[found] = key + "=" + value; else lines.Insert(lastContent + 1, key + "=" + value);
            }
            File.WriteAllLines(Layout.ConfigFile, lines.ToArray(), new UTF8Encoding(false));
        }
    }
    // ---------------------------------------------------------------------------------------------------------------
    // Log files: size-rotated, never throws.
    // ---------------------------------------------------------------------------------------------------------------
    internal sealed class RotatingLog
    {
        private readonly string path;
        private readonly long maxBytes;
        private readonly int keep;
        private readonly object gate = new object();

        public RotatingLog(string file, int maxMb, int keepFiles)
        {
            // Nothing is created here: --version, --help and --doctor must leave no trace. The folder is made at the first line written.
            path = file; maxBytes = (long)maxMb * 1024 * 1024; keep = keepFiles;
        }

        public void Write(string text)
        {
            lock (gate)
            {
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(path));
                    FileInfo fi = new FileInfo(path);
                    if (fi.Exists && fi.Length > maxBytes) Rotate();
                    File.AppendAllText(path, text + Environment.NewLine, Encoding.UTF8);
                }
                catch { /* a full disk or a locked file must never take the server down */ }
            }
        }

        private void Rotate()
        {
            for (int i = keep - 1; i >= 1; i--)
            {
                string from = path + "." + i, to = path + "." + (i + 1);
                if (File.Exists(to)) File.Delete(to);
                if (File.Exists(from)) File.Move(from, to);
            }
            string first = path + ".1";
            if (File.Exists(first)) File.Delete(first);
            File.Move(path, first);
            string oldest = path + "." + (keep + 1);
            if (File.Exists(oldest)) File.Delete(oldest);
        }
    }

    internal static class Host
    {
        public static RotatingLog HostLog;
        public const string EventSource = "Agastya Platform";

        public static void Info(string msg) { Line("INFO ", msg); }
        public static void Warn(string msg) { Line("WARN ", msg); }
        public static void Error(string msg) { Line("ERROR", msg); }

        private static void Line(string level, string msg)
        {
            string s = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " " + level + " " + msg;
            if (HostLog != null) HostLog.Write(s);
            if (Program.ConsoleMode) Console.WriteLine(s);
        }

        /// <summary>The Windows Event Log is written when the source exists (the installer or --install-service registers it); never required.</summary>
        public static void Event(EventLogEntryType type, string msg)
        {
            try { if (EventLog.SourceExists(EventSource)) EventLog.WriteEntry(EventSource, msg, type); } catch { }
        }

        public static bool IsAdmin()
        {
            try { return new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator); } catch { return false; }
        }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // A Windows job object that kills everything in it when this program ends, however it ends. Without it a crashed or killed host
    // would leave node.exe and the renderer's java.exe running and holding the port and the database.
    // ---------------------------------------------------------------------------------------------------------------
    internal static class KillOnCloseJob
    {
        [StructLayout(LayoutKind.Sequential)]
        private struct BasicLimits
        {
            public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit;
            public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass;
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct IoCounters { public ulong a, b, c, d, e, f; }
        [StructLayout(LayoutKind.Sequential)]
        private struct ExtendedLimits
        {
            public BasicLimits Basic; public IoCounters Io;
            public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed;
        }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr CreateJobObject(IntPtr attrs, string name);
        [DllImport("kernel32.dll")] private static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, int size);
        [DllImport("kernel32.dll")] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        private static IntPtr job = IntPtr.Zero;

        public static void Add(Process p)
        {
            try
            {
                if (job == IntPtr.Zero)
                {
                    job = CreateJobObject(IntPtr.Zero, null);
                    ExtendedLimits lim = new ExtendedLimits();
                    lim.Basic.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                    SetInformationJobObject(job, 9, ref lim, Marshal.SizeOf(typeof(ExtendedLimits)));
                }
                AssignProcessToJobObject(job, p.Handle);
            }
            catch (Exception e) { Host.Warn("could not attach the server to the job object: " + e.Message); }
        }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Runs the Node server and keeps it running.
    // ---------------------------------------------------------------------------------------------------------------
    internal sealed class Supervisor
    {
        private readonly Settings cfg;
        private readonly RotatingLog serverLog;
        private Process child;
        private Thread loop;
        private volatile bool stopping;
        private readonly object gate = new object();
        public volatile bool GaveUp;
        public event Action StateChanged;
        /// <summary>"app" or "browser" when this process opens the interface (the tray), null otherwise (service, console, update check).</summary>
        public string WindowKind { get; set; }

        public Supervisor(Settings s)
        {
            cfg = s;
            serverLog = new RotatingLog(Path.Combine(Layout.LogDir, "agastya-server.log"), s.LogMaxMb, s.LogKeep);
        }

        public bool Running { get { lock (gate) { return child != null && !child.HasExited; } } }

        public void Start()
        {
            stopping = false; GaveUp = false;
            Integrity.CheckAtStartInBackground();   // WP-24 (DEP-013): once per process, logged only, never blocks the start
            loop = new Thread(Run); loop.IsBackground = true; loop.Name = "server-supervisor"; loop.Start();
        }

        private void Run()
        {
            List<DateTime> starts = new List<DateTime>();
            int backoff = 1;
            while (!stopping)
            {
                starts.Add(DateTime.UtcNow);
                starts.RemoveAll(delegate (DateTime t) { return (DateTime.UtcNow - t).TotalSeconds > 120; });
                if (starts.Count > 6)
                {
                    Host.Error("The server stopped " + starts.Count + " times in two minutes; giving up. See " + Path.Combine(Layout.LogDir, "agastya-server.log"));
                    Host.Event(EventLogEntryType.Error, "The Agastya Platform server keeps stopping and was not restarted again. Logs: " + Layout.LogDir);
                    GaveUp = true; Notify(); return;
                }
                int code = RunOnce();
                if (stopping) break;
                Host.Warn("The server exited (code " + code + "); restarting in " + backoff + " s");
                Host.Event(EventLogEntryType.Warning, "The Agastya Platform server exited (code " + code + ") and is being restarted.");
                for (int i = 0; i < backoff * 10 && !stopping; i++) Thread.Sleep(100);
                backoff = Math.Min(backoff * 2, 30);
            }
        }

        private int RunOnce()
        {
            string entry = Path.Combine(Path.Combine(Path.Combine(Layout.AppDir, "backend"), "dist"), "index.js");
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = Layout.NodeExe;
            psi.Arguments = "\"" + entry + "\"";
            psi.WorkingDirectory = Path.Combine(Layout.AppDir, "backend");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardInput = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            psi.EnvironmentVariables["NODE_ENV"] = "production";
            psi.EnvironmentVariables["PORT"] = cfg.Port.ToString();
            psi.EnvironmentVariables["AGASTYA_HOST"] = cfg.BindAddress;
            psi.EnvironmentVariables["AGASTYA_WORKSPACE_DIR"] = cfg.WorkspaceDir;
            psi.EnvironmentVariables["AGASTYA_CLIENT_DIST"] = Path.Combine(Path.Combine(Layout.AppDir, "frontend"), "dist");
            psi.EnvironmentVariables["AGASTYA_SHUTDOWN_ON_STDIN_CLOSE"] = "1";
            if (cfg.SecureCookies) psi.EnvironmentVariables["AGASTYA_SECURE_COOKIES"] = "1";
            // WP-26: the server refuses a network address without TLS and names the setting in the server log.
            psi.EnvironmentVariables["AGASTYA_MODE"] = cfg.EffectiveMode;
            if (cfg.ServerNames.Length > 0) psi.EnvironmentVariables["AGASTYA_SERVER_NAMES"] = cfg.ServerNames;
            if (cfg.TlsCert.Length > 0) psi.EnvironmentVariables["AGASTYA_TLS_CERT"] = Settings.StatePath(cfg.TlsCert);
            if (cfg.TlsKey.Length > 0) psi.EnvironmentVariables["AGASTYA_TLS_KEY"] = Settings.StatePath(cfg.TlsKey);
            if (cfg.TlsPfx.Length > 0) psi.EnvironmentVariables["AGASTYA_TLS_PFX"] = Settings.StatePath(cfg.TlsPfx);
            if (cfg.TlsPassphraseFile.Length > 0) psi.EnvironmentVariables["AGASTYA_TLS_PASSPHRASE_FILE"] = Settings.StatePath(cfg.TlsPassphraseFile);
            if (cfg.HstsMaxAge.Length > 0) psi.EnvironmentVariables["AGASTYA_HSTS_MAX_AGE"] = cfg.HstsMaxAge;
            // WP-25 (PRD-005): GET /api/version reports the WebView2 runtime of this computer and where the interface opens
            string wv2 = Shell.WebView2Version();
            if (wv2 != null) psi.EnvironmentVariables["AGASTYA_WEBVIEW2_VERSION"] = wv2;
            if (WindowKind != null) psi.EnvironmentVariables["AGASTYA_SHELL_WINDOW"] = WindowKind;
            try { Directory.CreateDirectory(cfg.WorkspaceDir); } catch (Exception e) { Host.Error("cannot create the data folder " + cfg.WorkspaceDir + ": " + e.Message); return -2; }

            Process p = new Process(); p.StartInfo = psi; p.EnableRaisingEvents = true;
            p.OutputDataReceived += delegate (object s, DataReceivedEventArgs e) { if (e.Data != null) serverLog.Write(e.Data); };
            p.ErrorDataReceived += delegate (object s, DataReceivedEventArgs e) { if (e.Data != null) serverLog.Write("[stderr] " + e.Data); };
            try { p.Start(); }
            catch (Exception e) { Host.Error("could not start " + Layout.NodeExe + ": " + e.Message); return -1; }
            KillOnCloseJob.Add(p);
            p.BeginOutputReadLine(); p.BeginErrorReadLine();
            lock (gate) { child = p; }
            Host.Info("server started (pid " + p.Id + ") on " + cfg.BindAddress + ":" + cfg.Port + ", data in " + cfg.WorkspaceDir);
            Notify();
            p.WaitForExit();
            int code = p.ExitCode;
            lock (gate) { child = null; }
            Notify();
            return code;
        }

        private void Notify() { Action h = StateChanged; if (h != null) { try { h(); } catch { } } }

        /// <summary>Ask the server to stop by closing its standard input, give it time to finish writing, then end it.</summary>
        public void Stop()
        {
            stopping = true;
            Process p;
            lock (gate) { p = child; }
            if (p != null)
            {
                try { if (!p.HasExited) { try { p.StandardInput.Close(); } catch { } } } catch { }
                try
                {
                    if (!p.WaitForExit(25000)) { Host.Warn("the server did not stop in 25 s; ending it"); p.Kill(); p.WaitForExit(5000); }
                }
                catch { }
                Host.Info("server stopped");
            }
            if (loop != null) loop.Join(3000);
        }
    }

    internal static class Probe
    {
        static Probe() { try { ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12; } catch { } }

        /// <summary>True when something on this port answers the platform's liveness check (plain HTTP in Mode A, HTTPS in Mode B, WP-26).</summary>
        public static bool Alive(int port) { return Get("http", port) || Get("https", port); }

        private static bool Get(string scheme, int port)
        {
            try
            {
                HttpWebRequest r = (HttpWebRequest)WebRequest.Create(scheme + "://127.0.0.1:" + port + "/api/health");
                r.Timeout = 2500; r.Proxy = null;
                // A liveness probe of this computer's own server over loopback: the certificate is checked by the clients, not here
                // (it rarely names 127.0.0.1).
                if (scheme == "https") r.ServerCertificateValidationCallback = delegate { return true; };
                using (HttpWebResponse resp = (HttpWebResponse)r.GetResponse()) { return (int)resp.StatusCode == 200; }
            }
            catch { return false; }
        }

        public static bool PortFree(int port, string address)
        {
            System.Net.Sockets.TcpListener l = null;
            try { l = new System.Net.Sockets.TcpListener(IPAddress.Parse(address), port); l.Start(); return true; }
            catch { return false; }
            finally { if (l != null) { try { l.Stop(); } catch { } } }
        }

        public static bool WaitUntilAlive(int port, int seconds, Supervisor sup)
        {
            DateTime end = DateTime.UtcNow.AddSeconds(seconds);
            while (DateTime.UtcNow < end)
            {
                if (Alive(port)) return true;
                if (sup != null && sup.GaveUp) return false;
                Thread.Sleep(400);
            }
            return false;
        }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // The Windows service.
    // ---------------------------------------------------------------------------------------------------------------
    internal sealed class AgastyaService : ServiceBase
    {
        private Supervisor sup;
        private Settings cfg;
        private volatile bool failing;
        public AgastyaService(Settings s) { cfg = s; ServiceName = s.ServiceName; CanStop = true; CanShutdown = true; AutoLog = false; }

        protected override void OnStart(string[] args)
        {
            Host.Info("service starting (version " + Layout.Version + ")");
            sup = new Supervisor(cfg);
            // WP-04 (DEP-022): when the supervisor gives up, the service must not sit in RUNNING with no server behind it. It stops with
            // ERROR_PROCESS_ABORTED (1067), so the SCM records the failure and (failureflag 1, set at install) runs the recovery actions.
            sup.StateChanged += delegate
            {
                if (!sup.GaveUp || failing) return;
                failing = true;
                ThreadPool.QueueUserWorkItem(delegate
                {
                    Host.Event(EventLogEntryType.Error, "Agastya Platform is stopping with an error: the server kept stopping. Logs: " + Layout.LogDir);
                    ExitCode = 1067;
                    try { Stop(); } catch (Exception e) { Host.Error("could not report the failure to the service manager: " + e.Message); }
                });
            };
            sup.Start();
            Host.Event(EventLogEntryType.Information, "Agastya Platform " + Layout.Version + " started on port " + cfg.Port + ".");
        }

        protected override void OnStop() { Shut(); }
        protected override void OnShutdown() { Shut(); }

        private void Shut()
        {
            RequestAdditionalTime(30000);
            if (sup != null) sup.Stop();
            Host.Event(EventLogEntryType.Information, "Agastya Platform stopped.");
        }
    }

    internal static class ServiceTools
    {
        public static int Sc(string args, out string output)
        {
            ProcessStartInfo psi = new ProcessStartInfo("sc.exe", args);
            psi.UseShellExecute = false; psi.CreateNoWindow = true; psi.RedirectStandardOutput = true; psi.RedirectStandardError = true;
            using (Process p = Process.Start(psi))
            {
                output = (p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd()).Trim();
                p.WaitForExit();
                return p.ExitCode;
            }
        }

        public static string StateOf(string name)
        {
            string o; int rc = Sc("query \"" + name + "\"", out o);
            if (rc == 1060) return "not installed";
            foreach (string l in o.Split('\n')) { string t = l.Trim(); if (t.StartsWith("STATE")) return t.Substring(t.IndexOf(':') + 1).Trim(); }
            return rc == 0 ? "unknown" : "error " + rc;
        }

        public static int Icacls(string path, string grant)
        {
            string o; ProcessStartInfo psi = new ProcessStartInfo("icacls.exe", "\"" + path + "\" /grant " + grant);
            psi.UseShellExecute = false; psi.CreateNoWindow = true; psi.RedirectStandardOutput = true; psi.RedirectStandardError = true;
            using (Process p = Process.Start(psi)) { o = p.StandardOutput.ReadToEnd(); p.WaitForExit(); return p.ExitCode; }
        }

        public static int Install(Settings cfg)
        {
            if (!Host.IsAdmin()) { Console.Error.WriteLine("Installing the service needs an elevated (Administrator) prompt."); return 3; }
            if (ServiceTools.StateOf(cfg.ServiceName) != "not installed") { Console.Error.WriteLine("A service named '" + cfg.ServiceName + "' already exists. Run --uninstall-service first."); return 1; }
            Directory.CreateDirectory(cfg.WorkspaceDir); Directory.CreateDirectory(Layout.LogDir);
            // The service runs as LocalService, an account with no network identity; it needs to write the data and log folders and nothing else.
            string acct = "\"NT AUTHORITY\\LOCAL SERVICE\":(OI)(CI)M";
            Icacls(cfg.WorkspaceDir, acct); Icacls(Layout.LogDir, acct);
            string cfgDir = Path.GetDirectoryName(Layout.ConfigFile);
            Icacls(cfgDir, "\"NT AUTHORITY\\LOCAL SERVICE\":(OI)(CI)RX");
            string exe = Path.Combine(Layout.InstallDir, "AgastyaPlatform.exe");
            string bin = "\\\"" + exe + "\\\" --service" + (Layout.StateOverride != null ? " --home \\\"" + Layout.StateOverride + "\\\"" : "");
            string o;
            int rc = Sc("create \"" + cfg.ServiceName + "\" binPath= \"" + bin + "\" start= auto obj= \"NT AUTHORITY\\LocalService\" DisplayName= \"Agastya Platform\"", out o);
            Console.WriteLine(o); if (rc != 0) return rc;
            Sc("description \"" + cfg.ServiceName + "\" \"Offline S1000D authoring and publishing server.\"", out o);
            // Recover from a crash: restart after 5 s, then 30 s, then 60 s; reset the counter after a day.
            Sc("failure \"" + cfg.ServiceName + "\" reset= 86400 actions= restart/5000/restart/30000/restart/60000", out o);
            // Run the recovery actions also when the service stops itself with an error (the supervisor gave up), not only on a crash.
            Sc("failureflag \"" + cfg.ServiceName + "\" 1", out o);
            try { if (!EventLog.SourceExists(Host.EventSource)) EventLog.CreateEventSource(Host.EventSource, "Application"); } catch (Exception e) { Console.WriteLine("(event log source not registered: " + e.Message + ")"); }
            Console.WriteLine("Service '" + cfg.ServiceName + "' installed. Start it with:  AgastyaCtl.exe --start");
            return 0;
        }

        public static int Uninstall(Settings cfg)
        {
            if (!Host.IsAdmin()) { Console.Error.WriteLine("Removing the service needs an elevated (Administrator) prompt."); return 3; }
            string o;
            if (StateOf(cfg.ServiceName) == "not installed") { Console.WriteLine("Service '" + cfg.ServiceName + "' is not installed."); return 0; }
            Sc("stop \"" + cfg.ServiceName + "\"", out o);
            for (int i = 0; i < 60 && !StateOf(cfg.ServiceName).Contains("STOPPED"); i++) Thread.Sleep(500);
            int rc = Sc("delete \"" + cfg.ServiceName + "\"", out o);
            Console.WriteLine(o);
            return rc;
        }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // --doctor: checks the installation and the machine; changes nothing.
    // ---------------------------------------------------------------------------------------------------------------
    internal static class Doctor
    {
        private static int fails, warns;
        private static void Pass(string m) { Console.WriteLine("[ OK ] " + m); }
        private static void Warn(string m) { warns++; Console.WriteLine("[WARN] " + m); }
        private static void Fail(string m) { fails++; Console.WriteLine("[FAIL] " + m); }

        private static string RunCapture(string exe, string args, int ms)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(exe, args);
                psi.UseShellExecute = false; psi.CreateNoWindow = true; psi.RedirectStandardOutput = true; psi.RedirectStandardError = true;
                using (Process p = Process.Start(psi))
                {
                    string o = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
                    if (!p.WaitForExit(ms)) { try { p.Kill(); } catch { } return null; }
                    return o.Trim();
                }
            }
            catch { return null; }
        }

        public static int Run(Settings cfg, bool deep)
        {
            fails = 0; warns = 0;
            Console.WriteLine("Agastya Platform " + Layout.Version + " - self-check");
            Console.WriteLine("  mode      " + (Layout.Portable ? "portable" : "installed"));
            Console.WriteLine("  program   " + Layout.ExeDir + (Layout.CurrentVersion != null ? "  (version folder; launcher in " + Layout.InstallDir + ")" : ""));
            Console.WriteLine("  config    " + Layout.ConfigFile + (File.Exists(Layout.ConfigFile) ? "" : "  (not created yet - defaults apply)"));
            Console.WriteLine("  data      " + cfg.WorkspaceDir);
            Console.WriteLine("  logs      " + Layout.LogDir);
            Console.WriteLine();

            if (Environment.Is64BitOperatingSystem) Pass("64-bit Windows"); else Fail("this product needs 64-bit Windows");
            // WP-24 (G-DEP-4): a value the program cannot use (it falls back to the default) is a problem; a key it does not know stays a warning
            foreach (string p in cfg.Problems) { if (p.IndexOf("unknown setting", StringComparison.Ordinal) >= 0) Warn("agastya.ini " + p); else Fail("agastya.ini " + p + " (the default is used instead)"); }
            if (cfg.Problems.Count == 0) Pass("agastya.ini is valid");

            string[] must = new string[] {
                Layout.NodeExe,
                Path.Combine(Layout.AppDir, "backend\\dist\\index.js"),
                Path.Combine(Layout.AppDir, "frontend\\dist\\index.html"),
                Path.Combine(Layout.AppDir, "backend\\vendor\\tools\\jre\\bin\\java.exe"),
                Path.Combine(Layout.AppDir, "backend\\vendor\\tools\\fop.xconf"),
                Path.Combine(Layout.AppDir, "backend\\schemas"),
                Path.Combine(Layout.AppDir, "backend\\node_modules\\express\\package.json"),
            };
            bool all = true;
            foreach (string f in must) { if (!(File.Exists(f) || Directory.Exists(f))) { Fail("missing: " + f); all = false; } }
            if (all) Pass("program files are complete");

            // WP-24 (DEP-013): the program files against the signed manifest (quick: sizes + hashes of the executables and server code; --deep: all)
            IntegrityResult ir = Integrity.Check(Layout.ExeDir, deep);
            if (!ir.ManifestPresent) Warn(ir.FilesLine());
            else if (ir.FilesOk) Pass(ir.FilesLine()); else Fail(ir.FilesLine());
            if (ir.ManifestPresent)
            {
                if (!ir.SignaturePresent) Warn(ir.SignatureLine());
                else if (ir.SignatureValid && ir.SignerMatchesExe) Pass(ir.SignatureLine()); else Fail(ir.SignatureLine());
            }

            string nv = File.Exists(Layout.NodeExe) ? RunCapture(Layout.NodeExe, "--version", 10000) : null;
            if (nv != null && nv.StartsWith("v")) Pass("Node.js runtime " + nv); else Fail("the bundled Node.js does not run");
            string jv = File.Exists(must[3]) ? RunCapture(must[3], "-version", 15000) : null;
            if (jv != null && jv.IndexOf("version", StringComparison.OrdinalIgnoreCase) >= 0) Pass("Java runtime (for the PDF renderer): " + jv.Split('\n')[0].Trim()); else Fail("the bundled Java runtime does not run");

            string bind = cfg.BindAddress;
            // WP-26: a network address is Mode B and needs TLS; the server refuses to start without it.
            if (!cfg.Loopback && !cfg.TlsConfigured) Fail("Bind=" + cfg.Bind + " serves the network, which needs TLS: set Certificate and Key (or Pfx) under [tls] in agastya.ini; the server does not start without them (OPERATIONS.md, \"Mode B: TLS\")");
            else if (!cfg.Loopback) Pass("listens on " + bind + " (Mode B) with TLS: " + (cfg.TlsPfx.Length > 0 ? Settings.StatePath(cfg.TlsPfx) : Settings.StatePath(cfg.TlsCert)));
            else Pass("listens on " + bind + " only (Mode " + (cfg.EffectiveMode == "server" ? "B behind a TLS proxy on this computer" : "A") + ")");
            if (cfg.TlsCert.Length > 0)
            {
                try
                {
                    var c = new System.Security.Cryptography.X509Certificates.X509Certificate2(Settings.StatePath(cfg.TlsCert));
                    int days = (int)Math.Floor((c.NotAfter - DateTime.Now).TotalDays);
                    if (days < 0) Fail("the TLS certificate expired on " + c.NotAfter.ToString("yyyy-MM-dd"));
                    else if (days <= 30) Warn("the TLS certificate expires in " + days + " days (" + c.NotAfter.ToString("yyyy-MM-dd") + "); renew it");
                    else Pass("TLS certificate " + c.Subject + ", " + days + " days left, SHA-256 thumbprint in the server log");
                }
                catch (Exception e) { Fail("the TLS certificate " + Settings.StatePath(cfg.TlsCert) + " cannot be read: " + e.Message); }
            }

            if (Probe.Alive(cfg.Port)) Pass("an Agastya Platform server is answering on port " + cfg.Port);
            else if (Probe.PortFree(cfg.Port, bind == "0.0.0.0" ? "0.0.0.0" : "127.0.0.1")) Pass("port " + cfg.Port + " is free");
            else Fail("port " + cfg.Port + " is in use by another program; choose another Port in agastya.ini");

            try
            {
                // Nothing is created: if the data folder does not exist yet, the nearest folder that does must be writable (the server makes it).
                string dir = cfg.WorkspaceDir;
                string probe = dir;
                while (!Directory.Exists(probe) && Path.GetDirectoryName(probe) != null) probe = Path.GetDirectoryName(probe);
                string t = Path.Combine(probe, ".doctor-" + Guid.NewGuid().ToString("N")); File.WriteAllText(t, "x"); File.Delete(t);
                if (probe == dir) Pass("the data folder is writable"); else Pass("the data folder does not exist yet; it will be created in " + probe + ", which is writable");
                DriveInfo d = new DriveInfo(Path.GetPathRoot(Path.GetFullPath(dir)));
                double gb = d.AvailableFreeSpace / 1073741824.0;
                if (gb < 1) Fail("only " + gb.ToString("0.0") + " GB free on " + d.Name); else if (gb < 5) Warn(gb.ToString("0.0") + " GB free on " + d.Name + " (publishing a large book needs a few GB)"); else Pass(gb.ToString("0") + " GB free on " + d.Name);
            }
            catch (Exception e) { Fail("the data folder " + cfg.WorkspaceDir + " is not writable: " + e.Message); }

            string st = ServiceTools.StateOf(cfg.ServiceName);
            if (st == "not installed") Pass("Windows service '" + cfg.ServiceName + "' is not installed (optional)"); else Pass("Windows service '" + cfg.ServiceName + "': " + st);

            // WP-25: the versioned layout (launcher = a copy of the current version's programs) and the window the interface opens in
            if (Layout.CurrentVersion != null)
            {
                string drift = Versions.LauncherDrift();
                if (drift != null) Fail(drift + " - run AgastyaCtl.exe --repair-launcher");
                else Pass("version " + Layout.CurrentVersion + " is current; earlier versions kept for a rollback: " + Versions.ListLine());
            }
            string wv2 = Shell.WebView2Version();
            if (wv2 != null) Pass("WebView2 runtime " + wv2);
            else Warn("the WebView2 runtime is not installed: the interface opens in " + (Shell.EdgePath() != null ? "an Edge app window" : "the default browser") + " (install it from the redist folder of the release; DEPLOYMENT-KIT.md)");

            Console.WriteLine();
            Console.WriteLine(fails == 0 ? (warns == 0 ? "Everything is in order." : "No problems; " + warns + " warning(s).") : fails + " problem(s) found.");
            return fails == 0 ? 0 : 1;
        }
    }

#if GUI
    // ---------------------------------------------------------------------------------------------------------------
    // Tray application.
    // ---------------------------------------------------------------------------------------------------------------
    internal sealed class TrayApp : ApplicationContext
    {
        private readonly Settings cfg;
        private readonly Supervisor sup;
        private readonly NotifyIcon tray;
        private readonly ToolStripMenuItem status;
        private readonly Control invoker;

        public TrayApp(Settings s)
        {
            cfg = s;
            sup = new Supervisor(s);
            sup.WindowKind = Agastya.Shell.PlannedWindow(s);
            tray = new NotifyIcon();
            try { tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { tray.Icon = SystemIcons.Application; }
            tray.Text = "Agastya Platform";
            ContextMenuStrip m = new ContextMenuStrip();
            status = new ToolStripMenuItem("Starting..."); status.Enabled = false;
            m.Items.Add(status);
            m.Items.Add(new ToolStripSeparator());
            m.Items.Add("Open Agastya Platform", null, delegate { OpenBrowser(); });
            m.Items.Add("Open data folder", null, delegate { Shell(cfg.WorkspaceDir); });
            m.Items.Add("Open log folder", null, delegate { Shell(Layout.LogDir); });
            m.Items.Add(new ToolStripSeparator());
            m.Items.Add("Restart server", null, delegate { RestartServer(); });
            m.Items.Add("Exit", null, delegate { Quit(); });
            tray.ContextMenuStrip = m;
            tray.DoubleClick += delegate { OpenBrowser(); };
            tray.Visible = true;
            invoker = new Control(); invoker.CreateControl(); IntPtr forceHandle = invoker.Handle;   // a window handle on the UI thread to marshal Quit onto
            sup.StateChanged += delegate { UpdateStatus(); };
            ThreadPool.QueueUserWorkItem(delegate { Boot(); });
        }

        private void Boot()
        {
            sup.Start();
            if (Probe.WaitUntilAlive(cfg.Port, 90, sup))
            {
                UpdateStatus();
                Host.Info("ready at " + cfg.Url);
                if (cfg.OpenBrowser) OpenBrowser();
            }
            else
            {
                string why = sup.GaveUp ? "The server keeps stopping." : "The server did not answer within 90 seconds.";
                Host.Error(why);
                tray.ShowBalloonTip(8000, "Agastya Platform", why + " Open the log folder from the tray menu.", ToolTipIcon.Error);
            }
        }

        private void UpdateStatus()
        {
            try { status.Text = sup.Running ? "Running - " + cfg.Url : (sup.GaveUp ? "Stopped (see logs)" : "Starting..."); tray.Text = "Agastya Platform - " + (sup.Running ? "running" : "not running"); } catch { }
        }

        public void RequestQuit()
        {
            try { if (invoker != null && invoker.IsHandleCreated) invoker.BeginInvoke(new Action(Quit)); else Quit(); } catch { Quit(); }
        }

        private bool noticeShown;
        /// <summary>WP-25 (PRD-005): an app window when possible; the default browser otherwise, with a notice saying why (once per run).</summary>
        private void OpenBrowser()
        {
            string notice = Agastya.Shell.Open(cfg, cfg.Url);
            if (notice != null && !noticeShown)
            {
                noticeShown = true;
                Host.Info("window: " + notice);
                try { tray.ShowBalloonTip(8000, "Agastya Platform", notice, ToolTipIcon.Info); } catch { }
            }
        }
        private static void Shell(string target) { try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); } catch { } }

        private void RestartServer()
        {
            ThreadPool.QueueUserWorkItem(delegate { sup.Stop(); sup.Start(); });
        }

        private void Quit()
        {
            tray.Visible = false;
            tray.Dispose();
            ThreadPool.QueueUserWorkItem(delegate { sup.Stop(); Host.Info("tray application closed"); Application.Exit(); });
        }
    }
#endif

    // ---------------------------------------------------------------------------------------------------------------
    internal static class Program
    {
        public static bool ConsoleMode;

        public static string QuitEventName(int port) { return "Global\\AgastyaPlatform-quit-" + port; }

        private const string Usage =
            "Agastya Platform {0}\r\n\r\n" +
            "  AgastyaCtl.exe --console              run the server in this window (Ctrl+C stops it)\r\n" +
            "  AgastyaCtl.exe --doctor [--deep]      check the installation and this machine (--deep: hash every program file)\r\n" +
            "  AgastyaCtl.exe --verify [--require-signed]  check every program file against the signed manifest (exit 0 = intact)\r\n" +
            "  AgastyaCtl.exe --support-bundle [<file.zip>]  write a ZIP for support: reports and redacted logs, never the database\r\n" +
            "  AgastyaCtl.exe --status               show whether the service / server is running\r\n" +
            "  AgastyaCtl.exe --install-service      register the Windows service (Administrator)\r\n" +
            "  AgastyaCtl.exe --uninstall-service    remove it (your data is kept)\r\n" +
            "  AgastyaCtl.exe --start | --stop       start or stop the service\r\n" +
            "  AgastyaCtl.exe --quit                 ask a running tray application to close\r\n" +
            "  AgastyaCtl.exe --backup-db <label>    copy the stopped database to <data>\\backups\\pre-upgrade-<label>-<time> (Setup now makes a verified platform backup instead)\r\n" +
            "  AgastyaCtl.exe --reset-admin <user>   set a new password for <user> (Administrator; asks for it, never on the command line)\r\n" +
            "  AgastyaCtl.exe --verify-update <file.agupdate>  check an offline update package; changes nothing\r\n" +
            "  AgastyaCtl.exe --apply-update <file.agupdate>   install it: verified backup, switch, health check, automatic rollback\r\n" +
            "  AgastyaCtl.exe --rollback [--restore-db]        go back to the previous version (--restore-db: and to the database copy taken before the update)\r\n" +
            "  AgastyaCtl.exe --versions | --prune-versions | --repair-launcher\r\n" +
            "  AgastyaCtl.exe --first-admin <user> --password-file <file>  create the first administrator (temporary password, changed at first sign-in)\r\n" +
            "  AgastyaCtl.exe --version\r\n\r\n" +
            "Options: --home <folder>  keep configuration, data and logs under <folder>\r\n" +
            "         --port <n> --lan  (with --install-service) written to agastya.ini\r\n" +
            "         --allow-unsigned  (with the update commands) accept an unsigned package - development and test machines only\r\n";

        [STAThread]
        private static int Main(string[] args)
        {
            string home = null, mode = null, port = null, label = null, passwordFile = null, installDir = null;
            bool lan = false, deep = false, requireSigned = false, allowUnsigned = false, restoreDb = false, confirm = false;
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (a == "--home" && i + 1 < args.Length) home = args[++i];
                else if (a == "--install-dir" && i + 1 < args.Length) installDir = args[++i];
                else if (a == "--deep") deep = true;
                else if (a == "--require-signed") requireSigned = true;
                else if (a == "--allow-unsigned") allowUnsigned = true;
                else if (a == "--restore-db") restoreDb = true;
                else if (a == "--confirm") confirm = true;
                else if (a == "--password-file" && i + 1 < args.Length) passwordFile = args[++i];
                else if ((a == "--apply-update" || a == "--verify-update" || a == "--first-admin" || a == "--prepare-upgrade" || a == "--activate") && i + 1 < args.Length) { mode = a; label = args[++i]; }
                else if (a == "--support-bundle") { mode = a; if (i + 1 < args.Length && !args[i + 1].StartsWith("--")) label = args[++i]; }
                else if (a == "--port" && i + 1 < args.Length) port = args[++i];
                else if (a == "--lan") lan = true;
                else if (a == "--backup-db" && i + 1 < args.Length) { mode = a; label = args[++i]; }
                else if (a == "--reset-admin" && i + 1 < args.Length) { mode = a; label = args[++i]; }
                else if (a.StartsWith("--")) mode = a;
                else { Console.Error.WriteLine("Unknown argument: " + a); return 2; }
            }
            if (home == null) home = Environment.GetEnvironmentVariable("AGASTYA_HOME");
            Layout.StateOverride = home;
            Layout.InstallOverride = installDir;
            Layout.Init(home);
            Versions.CleanupOldLaunchers();   // a launcher replaced while it ran was renamed aside (WP-25)

            Settings cfg;
            try { cfg = Settings.Load(); }
            catch (Exception e) { Console.Error.WriteLine("Cannot read " + Layout.ConfigFile + ": " + e.Message); return 1; }
            Host.HostLog = new RotatingLog(Path.Combine(Layout.LogDir, "agastya-host.log"), cfg.LogMaxMb, cfg.LogKeep);

#if GUI
            ConsoleMode = false;
#else
            ConsoleMode = true;
#endif
            try
            {
                switch (mode)
                {
                    case "--version": Console.WriteLine("Agastya Platform " + Layout.Version + " (win-x64)"); return 0;
                    case "--help": Console.WriteLine(string.Format(Usage, Layout.Version)); return 0;
                    case "--doctor": return Doctor.Run(cfg, deep);
                    case "--verify": return Integrity.VerifyCommand(requireSigned);
                    case "--support-bundle": return SupportBundle.Create(cfg, label);
                    case "--status":
                        Console.WriteLine("service '" + cfg.ServiceName + "': " + ServiceTools.StateOf(cfg.ServiceName));
                        Console.WriteLine("server on port " + cfg.Port + ": " + (Probe.Alive(cfg.Port) ? "answering" : "not answering"));
                        return 0;
                    case "--backup-db": return BackupDatabase(cfg, label);
                    // WP-25: offline update, rollback, versions, Setup's steps, first administrator, data removal (Update.cs)
                    case "--verify-update": return Updater.VerifyOnly(cfg, label, allowUnsigned);
                    case "--apply-update": return Updater.Apply(cfg, label, allowUnsigned);
                    case "--rollback": return Updater.Rollback(cfg, restoreDb);
                    case "--versions": return Updater.ListVersions();
                    case "--prune-versions": { List<string> gone = Versions.Prune(cfg.KeepVersions, delegate (string m) { Console.WriteLine(m); }); Console.WriteLine(gone.Count + " version folder(s) removed"); return 0; }
                    case "--repair-launcher":
                        if (Layout.CurrentVersion == null) { Console.WriteLine("flat layout: nothing to repair"); return 0; }
                        Versions.RefreshLauncher(delegate (string m) { Console.WriteLine(m); }); Console.WriteLine("the launcher is version " + Layout.CurrentVersion + "'s"); return 0;
                    case "--prepare-upgrade": return Updater.PrepareUpgrade(cfg, label);
                    case "--activate": return Updater.Activate(cfg, label);
                    case "--first-admin": return Updater.FirstAdmin(cfg, label, passwordFile);
                    case "--remove-data": return Updater.RemoveData(cfg, confirm);
                    case "--reset-admin": return ResetAdmin(cfg, label);
                    case "--quit":
                        try { EventWaitHandle.OpenExisting(QuitEventName(cfg.Port)).Set(); Console.WriteLine("Asked the running application to close."); return 0; }
                        catch (WaitHandleCannotBeOpenedException) { Console.WriteLine("The tray application is not running."); return 0; }
                        catch (Exception e) { Console.Error.WriteLine("Could not reach the running application: " + e.Message); return 1; }
                    case "--install-service":
                        if (port != null) { int pn; if (!int.TryParse(port, out pn) || pn < 1 || pn > 65535) { Console.Error.WriteLine("--port must be 1-65535"); return 2; } Settings.Set("server", "Port", port); }
                        if (lan) Settings.Set("server", "Bind", "lan");
                        if (port != null || lan) cfg = Settings.Load();
                        return ServiceTools.Install(cfg);
                    case "--uninstall-service": return ServiceTools.Uninstall(cfg);
                    case "--start": { string o; int rc = ServiceTools.Sc("start \"" + cfg.ServiceName + "\"", out o); Console.WriteLine(o); return rc; }
                    case "--stop": { string o; int rc = ServiceTools.Sc("stop \"" + cfg.ServiceName + "\"", out o); Console.WriteLine(o); return rc; }
                    case "--service":
                        ConsoleMode = false;
                        ServiceBase.Run(new AgastyaService(cfg));
                        return 0;
                    case "--console": return RunConsole(cfg);
                    case null:
#if GUI
                        return RunTray(cfg);
#else
                        Console.WriteLine(string.Format(Usage, Layout.Version)); return 0;
#endif
                    default: Console.Error.WriteLine("Unknown option " + mode + ". Try --help."); return 2;
                }
            }
            catch (Exception e)
            {
                Host.Error("fatal: " + e);
                Console.Error.WriteLine("Error: " + e.Message);
                return 1;
            }
        }

        /// <summary>Copy publisher.db (and its write-ahead files) to a timestamped folder under the data folder's "backups". Changes nothing else.</summary>
        private static int BackupDatabase(Settings cfg, string label)
        {
            string data = cfg.WorkspaceDir;
            string db = Path.Combine(data, "publisher.db");
            if (!File.Exists(db)) { Console.WriteLine("No database in " + data + " yet; nothing to back up."); return 0; }
            if (Probe.Alive(cfg.Port)) { Console.Error.WriteLine("The server is running; stop it before backing up the database."); return 1; }
            StringBuilder safe = new StringBuilder();
            foreach (char c in (label ?? "unknown")) safe.Append(char.IsLetterOrDigit(c) || c == '.' || c == '-' ? c : '_');
            string dest = Path.Combine(Path.Combine(data, "backups"), "pre-upgrade-" + safe + "-" + DateTime.Now.ToString("yyyyMMdd-HHmmss"));
            Directory.CreateDirectory(dest);
            foreach (string name in new string[] { "publisher.db", "publisher.db-wal", "publisher.db-shm" })
            {
                string src = Path.Combine(data, name);
                if (File.Exists(src)) File.Copy(src, Path.Combine(dest, name), false);
            }
            Host.Info("database backed up to " + dest);
            Console.WriteLine("Database backed up to " + dest);
            return 0;
        }

        /// <summary>WP-04 (DEP-022): the break-glass reset against the configured data folder. The script asks for the password itself on this
        /// console (no echo), so it never appears in a command line, the shell history or the process list.</summary>
        private static int ResetAdmin(Settings cfg, string user)
        {
            if (!Host.IsAdmin()) { Console.Error.WriteLine("Resetting a password needs an elevated (Administrator) prompt."); return 3; }
            if (string.IsNullOrEmpty(user) || user.StartsWith("-")) { Console.Error.WriteLine("Usage: AgastyaCtl.exe --reset-admin <username>"); return 2; }
            string script = Path.Combine(Path.Combine(Path.Combine(Layout.AppDir, "backend"), "scripts"), "reset-admin.js");
            if (!File.Exists(Layout.NodeExe) || !File.Exists(script)) { Console.Error.WriteLine("The installation is incomplete: " + script); return 1; }
            ProcessStartInfo psi = new ProcessStartInfo(Layout.NodeExe, "\"" + script + "\" \"" + user.Replace("\"", "") + "\"");
            psi.UseShellExecute = false;
            psi.WorkingDirectory = Path.Combine(Layout.AppDir, "backend");
            psi.EnvironmentVariables["AGASTYA_WORKSPACE_DIR"] = cfg.WorkspaceDir;
            using (Process p = Process.Start(psi)) { p.WaitForExit(); Host.Info("reset-admin for " + user + " finished with code " + p.ExitCode); return p.ExitCode; }
        }

        private static int RunConsole(Settings cfg)
        {
            if (!File.Exists(Layout.NodeExe)) { Console.Error.WriteLine("The Node.js runtime is missing: " + Layout.NodeExe); return 1; }
            if (Probe.Alive(cfg.Port)) { Console.Error.WriteLine("An Agastya Platform server is already answering on port " + cfg.Port + "."); return 1; }
            Supervisor sup = new Supervisor(cfg);
            ManualResetEvent done = new ManualResetEvent(false);
            Console.CancelKeyPress += delegate (object s, ConsoleCancelEventArgs e) { e.Cancel = true; done.Set(); };
            sup.Start();
            if (Probe.WaitUntilAlive(cfg.Port, 90, sup)) Console.WriteLine("Ready at " + cfg.Url + "  (Ctrl+C to stop)");
            else { Console.Error.WriteLine("The server did not start; see " + Path.Combine(Layout.LogDir, "agastya-server.log")); sup.Stop(); return 1; }
            while (!done.WaitOne(500)) { if (sup.GaveUp) { sup.Stop(); return 1; } }
            Console.WriteLine("Stopping...");
            sup.Stop();
            return 0;
        }

#if GUI
        private static int RunTray(Settings cfg)
        {
            bool created;
            string mutexName = "Global\\AgastyaPlatform-tray-" + cfg.Port;
            using (Mutex single = new Mutex(true, mutexName, out created))
            {
                if (!created) { if (cfg.OpenBrowser) Shell.Open(cfg, cfg.Url); return 0; }
                if (!File.Exists(Layout.NodeExe)) { MessageBox.Show("The Node.js runtime is missing:\n" + Layout.NodeExe + "\n\nRepair the installation.", "Agastya Platform", MessageBoxButtons.OK, MessageBoxIcon.Error); return 1; }
                // Another copy (the Windows service, or a console run) may already own the port: then just open it.
                if (Probe.Alive(cfg.Port)) { if (cfg.OpenBrowser) Shell.Open(cfg, cfg.Url); return 0; }
                if (!Probe.PortFree(cfg.Port, cfg.BindAddress))
                {
                    MessageBox.Show("Port " + cfg.Port + " is used by another program.\n\nChoose a different Port in:\n" + Layout.ConfigFile, "Agastya Platform", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 1;
                }
                Application.EnableVisualStyles();
                Host.Info("tray application starting (version " + Layout.Version + ")");
                TrayApp app = new TrayApp(cfg);
                EventWaitHandle quit = new EventWaitHandle(false, EventResetMode.AutoReset, QuitEventName(cfg.Port));
                Thread watcher = new Thread(delegate () { quit.WaitOne(); app.RequestQuit(); });
                watcher.IsBackground = true; watcher.Start();
                Application.Run(app);
                return 0;
            }
        }
#endif
    }
}
