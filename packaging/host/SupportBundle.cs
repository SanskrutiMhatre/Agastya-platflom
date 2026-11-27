// =============================================================================
// Agastya Platform - support bundle (audit WP-24: DEP-024, RES-006, ENT-007).
//
//   AgastyaCtl.exe --support-bundle [<file.zip>]
//
// One ZIP an air-gapped site can hand to support. Built from an ALLOW-LIST of named items, never by copying folders:
//   README.txt            what is in it and what is deliberately not
//   version.txt           program version, version.json, build commit
//   doctor.txt            the --doctor report
//   integrity.txt         the quick program-file check (MANIFEST.sha256) and the Authenticode state of AgastyaCtl.exe
//   agastya.ini           the configuration with every value whose key names a secret masked
//   logs/*.log            the last 2 MB of the host and server logs (current and previous file), each line redacted
//   system.txt            Windows version, processors, memory, free disk of the data drive, service configuration and state, firewall rule
//   server.txt            when the server answers on loopback: GET /api/version and /api/ready (public, no secrets)
//   data-folder.txt       counts and sizes only: database size, number of project folders - no names, no content
// It NEVER contains publisher.db, workspace files, project names, password hashes, cookies or tokens. Redaction is tested with seeded canary
// secrets (scripts/release/host.test.mjs).
// =============================================================================

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;

namespace Agastya
{
    internal static class SupportBundle
    {
        private const long LogTailBytes = 2L * 1024 * 1024;
        private static readonly Regex SecretKey = new Regex(@"pass|secret|token|cookie|credential|apikey|api_key|private", RegexOptions.IgnoreCase);
        private static readonly Regex[] LineRedactions = new Regex[] {
            // an HTTP credential first ("Authorization: Bearer x" would otherwise mask only the word Bearer)
            new Regex(@"(?<k>\b(?:Bearer|Basic)\s+)(?<v>[A-Za-z0-9\-._~+/=]{8,})", RegexOptions.IgnoreCase),
            // key=value, key: value, "key":"value" for anything that names a secret
            new Regex(@"(?<k>""?[A-Za-z_\-]*(?:password|passwd|pwd|secret|token|cookie|session|authorization|credential|api[_-]?key)[A-Za-z_\-]*""?\s*[:=]\s*)(?<v>""[^""]*""|'[^']*'|[^\s,;&}]+)", RegexOptions.IgnoreCase),
            new Regex(@"(?<k>\b(?:agastya[_-]?sid|sid|connect\.sid)=)(?<v>[^\s;,]+)", RegexOptions.IgnoreCase),
            // Argon2 / scrypt password hashes wherever they appear
            new Regex(@"(?<k>)(?<v>\$(?:argon2(?:id|i|d)|scrypt)\$[^\s""';]+)", RegexOptions.IgnoreCase),   // the parameters contain commas
        };

        public static string RedactLine(string line)
        {
            foreach (Regex re in LineRedactions) line = re.Replace(line, delegate (Match m) { return m.Groups["k"].Value + "***"; });
            return line;
        }

        public static string MaskIni(string text)
        {
            StringBuilder sb = new StringBuilder();
            foreach (string raw in text.Replace("\r\n", "\n").Split('\n'))
            {
                string t = raw.Trim();
                int eq = t.IndexOf('=');
                if (eq > 0 && t[0] != ';' && t[0] != '#' && t[0] != '[' && SecretKey.IsMatch(t.Substring(0, eq))) sb.Append(t.Substring(0, eq).Trim()).Append("=***");
                else sb.Append(RedactLine(raw));
                sb.Append("\r\n");
            }
            return sb.ToString();
        }

        private static string Tail(string file, long bytes)
        {
            using (FileStream s = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                long start = Math.Max(0, s.Length - bytes);
                s.Seek(start, SeekOrigin.Begin);
                using (StreamReader r = new StreamReader(s, Encoding.UTF8))
                {
                    string all = r.ReadToEnd();
                    if (start > 0) { int nl = all.IndexOf('\n'); all = "[... earlier lines left out ...]\n" + (nl >= 0 ? all.Substring(nl + 1) : ""); }
                    StringBuilder sb = new StringBuilder();
                    foreach (string line in all.Replace("\r\n", "\n").Split('\n')) sb.Append(RedactLine(line)).Append("\r\n");
                    return sb.ToString();
                }
            }
        }

        private static string Run(string exe, string args)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(exe, args);
                psi.UseShellExecute = false; psi.CreateNoWindow = true; psi.RedirectStandardOutput = true; psi.RedirectStandardError = true;
                using (Process p = Process.Start(psi))
                {
                    string o = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
                    p.WaitForExit(15000);
                    return o.Trim();
                }
            }
            catch (Exception e) { return "(could not run " + exe + ": " + e.Message + ")"; }
        }

        private static string Get(string url)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Timeout = 5000; req.Proxy = null;
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                using (StreamReader r = new StreamReader(res.GetResponseStream())) return (int)res.StatusCode + " " + r.ReadToEnd();
            }
            catch (WebException e)
            {
                HttpWebResponse res = e.Response as HttpWebResponse;
                if (res != null) using (StreamReader r = new StreamReader(res.GetResponseStream())) return (int)res.StatusCode + " " + r.ReadToEnd();
                return "(no answer: " + e.Message + ")";
            }
            catch (Exception e) { return "(no answer: " + e.Message + ")"; }
        }

        private static void Add(ZipArchive zip, string name, string text)
        {
            ZipArchiveEntry e = zip.CreateEntry(name, CompressionLevel.Optimal);
            using (StreamWriter w = new StreamWriter(e.Open(), new UTF8Encoding(false))) w.Write(text);
        }

        public static int Create(Settings cfg, string outFile)
        {
            if (string.IsNullOrEmpty(outFile))
                outFile = Path.Combine(Path.Combine(Layout.StateDir, "support"), "agastya-support-" + Environment.MachineName + "-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".zip");
            outFile = Path.GetFullPath(outFile);
            Directory.CreateDirectory(Path.GetDirectoryName(outFile));
            List<string> items = new List<string>();
            using (FileStream fs = new FileStream(outFile, FileMode.Create, FileAccess.Write))
            using (ZipArchive zip = new ZipArchive(fs, ZipArchiveMode.Create))
            {
                Add(zip, "README.txt", string.Join("\r\n", new string[] {
                    "Agastya Platform support bundle, made " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss zzz") + " on " + Environment.MachineName + ".",
                    "",
                    "Contains: version, the self-check report, the program-file check, the configuration with secrets masked, the last 2 MB of the",
                    "host and server logs with passwords, tokens, cookies and password hashes masked line by line, Windows/service/firewall/disk",
                    "facts, and the server's public /api/version and /api/ready answers.",
                    "",
                    "Never contains: the database (publisher.db), any project or workspace file, project names, user names from the database,",
                    "password hashes, session cookies or tokens. Read it before you send it: it is plain text in a ZIP.",
                    "" }));

                StringBuilder ver = new StringBuilder();
                ver.AppendLine("program version " + Layout.Version + " (" + (Layout.Portable ? "portable" : "installed") + ")");
                string vj = Path.Combine(Layout.ExeDir, "version.json");
                ver.AppendLine(File.Exists(vj) ? File.ReadAllText(vj) : "(version.json not found)");
                Add(zip, "version.txt", ver.ToString()); items.Add("version.txt");

                TextWriter old = Console.Out;
                StringWriter doc = new StringWriter();
                try { Console.SetOut(doc); Doctor.Run(cfg, false); } catch (Exception e) { doc.WriteLine("doctor failed: " + e.Message); } finally { Console.SetOut(old); }
                Add(zip, "doctor.txt", RedactLines(doc.ToString())); items.Add("doctor.txt");

                IntegrityResult ir = Integrity.Check(Layout.ExeDir, false);
                Add(zip, "integrity.txt", ir.FilesLine() + "\r\n" + ir.SignatureLine() + "\r\nAuthenticode of AgastyaCtl.exe: " + ir.ExeSignature + "\r\n"); items.Add("integrity.txt");

                if (File.Exists(Layout.ConfigFile)) { Add(zip, "agastya.ini", MaskIni(File.ReadAllText(Layout.ConfigFile))); items.Add("agastya.ini"); }

                foreach (string name in new string[] { "agastya-host.log", "agastya-host.log.1", "agastya-server.log", "agastya-server.log.1", "agastya-server.jsonl" })
                {
                    string f = Path.Combine(Layout.LogDir, name);
                    if (!File.Exists(f)) continue;
                    try { Add(zip, "logs/" + name, Tail(f, LogTailBytes)); items.Add("logs/" + name); } catch (Exception e) { Add(zip, "logs/" + name + ".error.txt", e.Message); }
                }

                StringBuilder sys = new StringBuilder();
                sys.AppendLine("Windows " + Environment.OSVersion.VersionString + (Environment.Is64BitOperatingSystem ? " 64-bit" : " 32-bit"));
                sys.AppendLine("processors " + Environment.ProcessorCount);
                try
                {
                    DriveInfo d = new DriveInfo(Path.GetPathRoot(Path.GetFullPath(cfg.WorkspaceDir)));
                    sys.AppendLine("data drive " + d.Name + ": " + (d.AvailableFreeSpace / 1073741824.0).ToString("0.0") + " GB free of " + (d.TotalSize / 1073741824.0).ToString("0.0") + " GB");
                }
                catch (Exception e) { sys.AppendLine("data drive: " + e.Message); }
                sys.AppendLine("port " + cfg.Port + ", bind " + cfg.Bind + ", server " + (Probe.Alive(cfg.Port) ? "answering" : "not answering"));
                sys.AppendLine();
                sys.AppendLine("== service '" + cfg.ServiceName + "': " + ServiceTools.StateOf(cfg.ServiceName));
                sys.AppendLine(Run("sc.exe", "qc \"" + cfg.ServiceName + "\""));
                sys.AppendLine(Run("sc.exe", "qfailure \"" + cfg.ServiceName + "\""));
                sys.AppendLine();
                sys.AppendLine("== firewall rule");
                sys.AppendLine(Run("netsh.exe", "advfirewall firewall show rule name=\"Agastya Platform (LAN access)\""));
                Add(zip, "system.txt", RedactLines(sys.ToString())); items.Add("system.txt");

                if (Probe.Alive(cfg.Port))
                {
                    string baseUrl = "http://127.0.0.1:" + cfg.Port;
                    Add(zip, "server.txt", "GET /api/version\r\n" + Get(baseUrl + "/api/version") + "\r\n\r\nGET /api/ready\r\n" + Get(baseUrl + "/api/ready") + "\r\n");
                    items.Add("server.txt");
                }

                StringBuilder data = new StringBuilder();
                string ws = cfg.WorkspaceDir;
                data.AppendLine("data folder exists: " + Directory.Exists(ws));
                try
                {
                    string db = Path.Combine(ws, "publisher.db");
                    if (File.Exists(db)) data.AppendLine("publisher.db: " + (new FileInfo(db).Length / 1048576.0).ToString("0.0") + " MB (not included)");
                    string projects = Path.Combine(ws, "projects");
                    if (Directory.Exists(projects)) data.AppendLine("project folders: " + Directory.GetDirectories(projects).Length + " (names not included)");
                    string backups = Path.Combine(ws, "backups");
                    if (Directory.Exists(backups)) data.AppendLine("backup folders: " + Directory.GetDirectories(backups).Length);
                }
                catch (Exception e) { data.AppendLine(e.Message); }
                Add(zip, "data-folder.txt", data.ToString()); items.Add("data-folder.txt");
            }
            Host.Info("support bundle written to " + outFile + " (" + string.Join(", ", items.ToArray()) + ")");
            Console.WriteLine("Support bundle written to " + outFile);
            Console.WriteLine("It contains: " + string.Join(", ", items.ToArray()) + ". Secrets are masked; the database and the project files are not included.");
            return 0;
        }

        private static string RedactLines(string text)
        {
            StringBuilder sb = new StringBuilder();
            foreach (string line in text.Replace("\r\n", "\n").Split('\n')) sb.Append(RedactLine(line)).Append("\r\n");
            return sb.ToString();
        }
    }
}
