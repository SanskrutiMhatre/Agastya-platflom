// =============================================================================
// Agastya Platform - Mode B team server and client (audit WP-28; ENT-001/WP-26 TLS, WP-27 directory, WP-12 backup, PRD-007 warm standby).
//
//   agastya.ini [directory], [backup], [server] MaxConnections / LeaseMinutes   passed to the server as AGASTYA_* (the server checks the
//        values and names the setting when one is wrong, so a typo stops the start with a line in agastya-server.log, never silently)
//   agastya.ini [client] Server=https://docs.example.local:4040/   this installation is a CLIENT of a team server: the tray opens that
//        address (an Edge app window) and runs no server of its own; Thumbprint= optionally pins the server certificate (SHA-256) for the
//        handshake check below
//   AgastyaCtl.exe --configure-server  [--name <host> ...] [--bind lan|<address>|loopback] [--port <n>]
//                                      [--make-cert [--days <n>] | --pfx <file> [--passphrase-file <file>] | --cert <pem> --key <pem>]
//                                      [--firewall]
//        Makes this installation a team server: puts the certificate material in <state>\tls (a private CA and a server certificate with
//        --make-cert), writes [server] Bind / Mode / ServerNames and [tls] into agastya.ini, and limits tls\ to SYSTEM, the Administrators
//        and LOCAL SERVICE (read) - the CA's private key goes to tls\ca, which the service cannot read. --firewall (Administrator) opens the
//        port on private and domain networks. Then: --install-service, --start.
//   AgastyaCtl.exe --check-server [<url>]
//        The client/server handshake from this computer: the server answers /api/version over HTTPS with a certificate this computer trusts
//        (or the pinned thumbprint), and accepts this program's version (minClientVersion). --doctor runs it in client mode.
// =============================================================================

using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.RegularExpressions;

namespace Agastya
{
    internal static class TeamServer
    {
        // agastya.ini key (section.key, lower case) -> server environment variable; true = a path (relative to agastya.ini's folder)
        private static readonly Dictionary<string, KeyValuePair<string, bool>> Keys = new Dictionary<string, KeyValuePair<string, bool>>
        {
            { "directory.url", new KeyValuePair<string, bool>("AGASTYA_DIRECTORY_URL", false) },
            { "directory.basedn", new KeyValuePair<string, bool>("AGASTYA_DIRECTORY_BASE_DN", false) },
            { "directory.binddn", new KeyValuePair<string, bool>("AGASTYA_DIRECTORY_BIND_DN", false) },
            { "directory.bindpasswordfile", new KeyValuePair<string, bool>("AGASTYA_DIRECTORY_BIND_PASSWORD_FILE", true) },
            { "directory.cafile", new KeyValuePair<string, bool>("AGASTYA_DIRECTORY_CA_FILE", true) },
            { "directory.groupbasedn", new KeyValuePair<string, bool>("AGASTYA_DIRECTORY_GROUP_BASE_DN", false) },
            { "directory.loginattribute", new KeyValuePair<string, bool>("AGASTYA_DIRECTORY_LOGIN_ATTRIBUTE", false) },
            { "directory.userclass", new KeyValuePair<string, bool>("AGASTYA_DIRECTORY_USER_CLASS", false) },
            { "directory.nestedgroups", new KeyValuePair<string, bool>("AGASTYA_DIRECTORY_NESTED_GROUPS", false) },
            { "directory.timeoutms", new KeyValuePair<string, bool>("AGASTYA_DIRECTORY_TIMEOUT_MS", false) },
            { "directory.synchours", new KeyValuePair<string, bool>("AGASTYA_DIRECTORY_SYNC_HOURS", false) },
            { "backup.dir", new KeyValuePair<string, bool>("AGASTYA_BACKUP_DIR", true) },
            { "backup.intervalhours", new KeyValuePair<string, bool>("AGASTYA_BACKUP_INTERVAL_HOURS", false) },
            { "backup.keep", new KeyValuePair<string, bool>("AGASTYA_BACKUP_KEEP", false) },
            { "backup.copyto", new KeyValuePair<string, bool>("AGASTYA_BACKUP_COPY_DIR", true) },
            { "backup.restoretestdays", new KeyValuePair<string, bool>("AGASTYA_RESTORE_TEST_DAYS", false) },
            { "server.maxconnections", new KeyValuePair<string, bool>("AGASTYA_WS_MAX_CLIENTS", false) },
            { "server.leaseminutes", new KeyValuePair<string, bool>("AGASTYA_LEASE_MINUTES", false) },
            { "client.server", new KeyValuePair<string, bool>(null, false) },
            { "client.thumbprint", new KeyValuePair<string, bool>(null, false) },
        };

        public static bool Known(string key) { return Keys.ContainsKey(key); }

        /// <summary>The team-server settings of agastya.ini as the server's environment.</summary>
        public static void AddEnvironment(Settings cfg, StringDictionary env)
        {
            foreach (KeyValuePair<string, string> kv in cfg.Extra)
            {
                KeyValuePair<string, bool> m;
                if (!Keys.TryGetValue(kv.Key, out m) || m.Key == null || kv.Value.Length == 0) continue;
                env[m.Key] = m.Value ? Settings.StatePath(kv.Value) : kv.Value;
            }
        }

        public static string ClientServer(Settings cfg) { string v; return cfg.Extra.TryGetValue("client.server", out v) ? v.Trim() : ""; }
        private static string ClientThumbprint(Settings cfg) { string v; return cfg.Extra.TryGetValue("client.thumbprint", out v) ? Norm(v) : ""; }
        private static string Norm(string t) { return Regex.Replace(t ?? "", "[^0-9A-Fa-f]", "").ToUpperInvariant(); }

        // ---------------------------------------------------------------------------------------------------------------------------
        // --configure-server
        // ---------------------------------------------------------------------------------------------------------------------------
        public sealed class Options
        {
            public List<string> Names = new List<string>();
            public string Bind = "lan", Port, Pfx, PassphraseFile, Cert, Key, Days;
            public bool MakeCert, Firewall;
        }

        public static int Configure(Settings cfg, Options o)
        {
            foreach (string n in o.Names)
                if (!Regex.IsMatch(n, @"^(\*\.)?[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$") && !Regex.IsMatch(n, @"^[0-9a-fA-F:.]+$")) { Console.Error.WriteLine("--name " + n + " is not a host name or address"); return 2; }
            int sources = (o.MakeCert ? 1 : 0) + (o.Pfx != null ? 1 : 0) + (o.Cert != null || o.Key != null ? 1 : 0);
            if (sources > 1) { Console.Error.WriteLine("Choose one of --make-cert, --pfx or --cert/--key."); return 2; }
            if ((o.Cert == null) != (o.Key == null)) { Console.Error.WriteLine("--cert and --key go together."); return 2; }
            if (o.MakeCert && o.Names.Count == 0) { Console.Error.WriteLine("--make-cert needs at least one --name (the host name people type)."); return 2; }
            if (o.Port != null) { int pn; if (!int.TryParse(o.Port, out pn) || pn < 1 || pn > 65535) { Console.Error.WriteLine("--port must be 1-65535"); return 2; } }
            string bind = (o.Bind ?? "lan").Trim();
            bool loopback = bind.Equals("loopback", StringComparison.OrdinalIgnoreCase) || bind.StartsWith("127.") || bind == "::1";
            if (sources == 0 && !cfg.TlsConfigured && !loopback) { Console.Error.WriteLine("A team server on the network needs a certificate: give --make-cert, --pfx or --cert/--key (OPERATIONS.md, \"Mode B: TLS\")."); return 2; }

            string tls = Path.Combine(Path.GetDirectoryName(Layout.ConfigFile), "tls");
            Directory.CreateDirectory(tls);
            string certRel = null, keyRel = null, pfxRel = null, passRel = null;
            if (o.MakeCert)
            {
                string script = Path.Combine(Path.Combine(Path.Combine(Layout.AppDir, "backend"), "scripts"), "make-tls-cert.js");
                if (!File.Exists(Layout.NodeExe) || !File.Exists(script)) { Console.Error.WriteLine("The installation is incomplete: " + script); return 1; }
                string stage = Path.Combine(tls, ".new-" + Guid.NewGuid().ToString("N").Substring(0, 8));
                StringBuilder a = new StringBuilder("\"" + script + "\" --out \"" + stage + "\" --with-ca");
                foreach (string n in o.Names) a.Append(" --name ").Append(n);
                if (o.Days != null) a.Append(" --days ").Append(o.Days);
                Directory.CreateDirectory(stage);
                ProcessStartInfo psi = new ProcessStartInfo(Layout.NodeExe, a.ToString());
                psi.UseShellExecute = false; psi.CreateNoWindow = true; psi.RedirectStandardOutput = true; psi.RedirectStandardError = true;
                psi.WorkingDirectory = Path.Combine(Layout.AppDir, "backend");
                string output;
                int rc;
                using (Process p = Process.Start(psi)) { output = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd(); p.WaitForExit(); rc = p.ExitCode; }
                if (rc != 0) { Console.Error.WriteLine(output); try { Directory.Delete(stage, true); } catch { } return 1; }
                // keep earlier material as *.old-<time> (a renewal), never overwrite it silently
                string stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
                string caDir = Path.Combine(tls, "ca");
                Directory.CreateDirectory(caDir);
                MoveIn(Path.Combine(stage, "server.pem"), Path.Combine(tls, "server.pem"), stamp);
                MoveIn(Path.Combine(stage, "server-key.pem"), Path.Combine(tls, "server-key.pem"), stamp);
                MoveIn(Path.Combine(stage, "ca.pem"), Path.Combine(tls, "ca.pem"), stamp);
                MoveIn(Path.Combine(stage, "ca-key.pem"), Path.Combine(caDir, "ca-key.pem"), stamp);
                try { Directory.Delete(stage, true); } catch { }
                Console.WriteLine(output.Replace(stage, tls).Split(new string[] { "\nServer settings" }, StringSplitOptions.None)[0].Trim());
                certRel = "tls\\server.pem"; keyRel = "tls\\server-key.pem";
            }
            else if (o.Pfx != null)
            {
                if (!File.Exists(o.Pfx)) { Console.Error.WriteLine("No such file: " + o.Pfx); return 2; }
                CopyIn(o.Pfx, Path.Combine(tls, "server.pfx")); pfxRel = "tls\\server.pfx";
                if (o.PassphraseFile != null)
                {
                    if (!File.Exists(o.PassphraseFile)) { Console.Error.WriteLine("No such file: " + o.PassphraseFile); return 2; }
                    CopyIn(o.PassphraseFile, Path.Combine(tls, "passphrase.txt")); passRel = "tls\\passphrase.txt";
                }
            }
            else if (o.Cert != null)
            {
                if (!File.Exists(o.Cert) || !File.Exists(o.Key)) { Console.Error.WriteLine("No such file: " + (File.Exists(o.Cert) ? o.Key : o.Cert)); return 2; }
                CopyIn(o.Cert, Path.Combine(tls, "server.pem")); CopyIn(o.Key, Path.Combine(tls, "server-key.pem"));
                certRel = "tls\\server.pem"; keyRel = "tls\\server-key.pem";
                if (o.PassphraseFile != null) { CopyIn(o.PassphraseFile, Path.Combine(tls, "passphrase.txt")); passRel = "tls\\passphrase.txt"; }
            }

            Settings.Set("server", "Bind", bind);
            Settings.Set("server", "Mode", "server");
            if (o.Port != null) Settings.Set("server", "Port", o.Port);
            if (o.Names.Count > 0) Settings.Set("server", "ServerNames", string.Join(",", o.Names.ToArray()));
            if (certRel != null) { Settings.Set("tls", "Certificate", certRel); Settings.Set("tls", "Key", keyRel); Settings.Set("tls", "Pfx", ""); }
            if (pfxRel != null) { Settings.Set("tls", "Pfx", pfxRel); Settings.Set("tls", "Certificate", ""); Settings.Set("tls", "Key", ""); }
            if (passRel != null) Settings.Set("tls", "PassphraseFile", passRel);
            else if (certRel != null || pfxRel != null) Settings.Set("tls", "PassphraseFile", "");

            // tls\: SYSTEM and Administrators full control, the service account (LOCAL SERVICE) read, nobody else; tls\ca: not the service.
            string me = Host.IsAdmin() ? null : WindowsIdentityName();
            LockDown(tls, true, me);
            if (Directory.Exists(Path.Combine(tls, "ca"))) LockDown(Path.Combine(tls, "ca"), false, me);

            if (o.Firewall)
            {
                if (!Host.IsAdmin()) { Console.Error.WriteLine("--firewall needs an elevated (Administrator) prompt; the rest was configured."); return 3; }
                Settings now = Settings.Load();
                string ro;
                Run("netsh.exe", "advfirewall firewall delete rule name=\"Agastya Platform (LAN access)\"", out ro);
                int frc = Run("netsh.exe", "advfirewall firewall add rule name=\"Agastya Platform (LAN access)\" dir=in action=allow protocol=TCP localport=" + now.Port + " profile=private,domain enable=yes", out ro);
                if (frc != 0) { Console.Error.WriteLine("The firewall rule could not be added: " + ro); return 1; }
                Console.WriteLine("Firewall: TCP " + now.Port + " allowed on private and domain networks.");
            }
            Settings after = Settings.Load();
            Console.WriteLine();
            Console.WriteLine("Team server configured in " + Layout.ConfigFile + ":");
            Console.WriteLine("  [server] Bind=" + after.Bind + "  Mode=server  Port=" + after.Port + (after.ServerNames.Length > 0 ? "  ServerNames=" + after.ServerNames : ""));
            Console.WriteLine("  [tls]    " + (after.TlsPfx.Length > 0 ? "Pfx=" + after.TlsPfx : "Certificate=" + after.TlsCert + "  Key=" + after.TlsKey) + (after.TlsPassphraseFile.Length > 0 ? "  PassphraseFile=" + after.TlsPassphraseFile : ""));
            if (o.MakeCert) Console.WriteLine("  Clients trust " + Path.Combine(tls, "ca.pem") + " once (Trusted Root Certification Authorities, or Group Policy). Move " + Path.Combine(Path.Combine(tls, "ca"), "ca-key.pem") + " to offline storage; it is needed only to renew the certificate.");
            Console.WriteLine("Next: AgastyaCtl.exe --doctor, then --install-service and --start (OPERATIONS.md, \"Team server\").");
            return 0;
        }

        private static string WindowsIdentityName() { try { return System.Security.Principal.WindowsIdentity.GetCurrent().Name; } catch { return null; } }

        private static void MoveIn(string from, string to, string stamp)
        {
            if (!File.Exists(from)) return;
            if (File.Exists(to)) File.Move(to, to + ".old-" + stamp);
            File.Move(from, to);
        }
        private static void CopyIn(string from, string to)
        {
            if (Path.GetFullPath(from).Equals(Path.GetFullPath(to), StringComparison.OrdinalIgnoreCase)) return;
            if (File.Exists(to)) File.Move(to, to + ".old-" + DateTime.Now.ToString("yyyyMMdd-HHmmss"));
            File.Copy(from, to);
        }

        /// <summary>S-1-5-18 SYSTEM, S-1-5-32-544 Administrators, S-1-5-19 LOCAL SERVICE. `operatorName`: a non-elevated operator (a console run) keeps access.</summary>
        private static void LockDown(string dir, bool serviceReads, string operatorName)
        {
            string grants = "*S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F" + (serviceReads ? " *S-1-5-19:(OI)(CI)RX" : "") + (operatorName != null ? " \"" + operatorName + "\":(OI)(CI)F" : "");
            string o;
            int rc = Run("icacls.exe", "\"" + dir + "\" /inheritance:r /grant:r " + grants + " /T /C /Q", out o);
            // a grant made on the parent with /T is an explicit entry here: take it away where the service must not read
            if (rc == 0 && !serviceReads) rc = Run("icacls.exe", "\"" + dir + "\" /remove:g *S-1-5-19 /T /C /Q", out o);
            if (rc != 0) Console.WriteLine("(the permissions of " + dir + " could not be limited: " + o.Trim() + ")");
        }

        private static int Run(string exe, string args, out string output)
        {
            ProcessStartInfo psi = new ProcessStartInfo(exe, args);
            psi.UseShellExecute = false; psi.CreateNoWindow = true; psi.RedirectStandardOutput = true; psi.RedirectStandardError = true;
            using (Process p = Process.Start(psi)) { output = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd(); p.WaitForExit(); return p.ExitCode; }
        }

        // ---------------------------------------------------------------------------------------------------------------------------
        // --check-server: the client/server handshake from this computer
        // ---------------------------------------------------------------------------------------------------------------------------
        public sealed class CheckResult { public bool Ok; public List<string> Lines = new List<string>(); public List<bool> Good = new List<bool>(); public void Add(bool ok, string l) { Good.Add(ok); Lines.Add(l); if (!ok) Ok = false; } }

        public static CheckResult Check(Settings cfg, string url)
        {
            CheckResult r = new CheckResult(); r.Ok = true;
            url = (url ?? ClientServer(cfg)).Trim().TrimEnd('/');
            if (url.Length == 0) { r.Add(false, "no server address: give one, or set [client] Server= in agastya.ini"); return r; }
            Uri u;
            if (!Uri.TryCreate(url, UriKind.Absolute, out u) || (u.Scheme != "https" && !(u.Scheme == "http" && u.IsLoopback))) { r.Add(false, url + " is not an https:// address (a team server serves HTTPS only)"); return r; }
            string pin = ClientThumbprint(cfg);
            string seen = null; SslPolicyErrors errors = SslPolicyErrors.None;
            try
            {
                try { ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12; } catch { }
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url + "/api/version");
                req.Timeout = 10000; req.Proxy = null;
                req.Headers["X-Agastya-Client"] = Layout.Version;
                req.ServerCertificateValidationCallback = delegate (object s, X509Certificate cert, X509Chain chain, SslPolicyErrors e)
                {
                    errors = e;
                    if (cert != null) { using (SHA256 h = SHA256.Create()) seen = BitConverter.ToString(h.ComputeHash(cert.GetRawCertData())).Replace("-", ""); }
                    if (pin.Length > 0) return seen == pin;            // pinned: exactly this certificate, whatever the trust store says
                    return e == SslPolicyErrors.None;
                };
                string body;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                using (StreamReader sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8)) body = sr.ReadToEnd();
                if (u.Scheme == "https") r.Add(true, "the server certificate is " + (pin.Length > 0 ? "the pinned one (SHA-256 " + pin.Substring(0, 16) + "...)" : "trusted by this computer") + (seen != null ? "" : ""));
                string version = Field(body, "version"), min = Field(body, "minClientVersion"), api = Field(body, "apiVersion");
                bool compatible = body.IndexOf("\"compatible\":true", StringComparison.Ordinal) >= 0;
                r.Add(true, url + " answers: Agastya Platform " + version + " (API level " + api + ")");
                if (min != null && Compare(Layout.Version, min) < 0) r.Add(false, "this client (" + Layout.Version + ") is older than the server accepts (" + min + "): update this computer after the server (server first, then clients)");
                else r.Add(true, "this client (" + Layout.Version + ") is accepted (the server needs " + (min ?? "any") + " or later)");
                if (version != null && Compare(version, Layout.Version) < 0) r.Add(false, "the server (" + version + ") is older than this client (" + Layout.Version + "): update the server first");
                r.Add(compatible, compatible ? "the server's database schema is compatible with its program" : "the server reports an incompatible database schema (see its --doctor)");
            }
            catch (WebException e)
            {
                if (errors != SslPolicyErrors.None || (pin.Length > 0 && seen != null && seen != pin))
                    r.Add(false, "the server certificate is not trusted (" + errors + (seen != null ? ", SHA-256 " + seen : "") + "): install the organisation's CA (or tls\\ca.pem of the server), or pin it with [client] Thumbprint=");
                else r.Add(false, url + " does not answer: " + e.Message);
            }
            return r;
        }

        public static int CheckCommand(Settings cfg, string url)
        {
            CheckResult r = Check(cfg, url);
            for (int i = 0; i < r.Lines.Count; i++) Console.WriteLine((r.Good[i] ? "[ OK ] " : "[FAIL] ") + r.Lines[i]);
            return r.Ok ? 0 : 1;
        }

        private static string Field(string json, string name)
        {
            Match m = Regex.Match(json, "\"" + Regex.Escape(name) + "\"\\s*:\\s*(\"([^\"]*)\"|([0-9.]+))");
            return m.Success ? (m.Groups[2].Success && m.Groups[2].Value.Length > 0 ? m.Groups[2].Value : m.Groups[3].Value) : null;
        }

        /// <summary>Compare two x.y.z versions (a pre-release suffix ranks below its release).</summary>
        public static int Compare(string a, string b)
        {
            string[] pa = (a ?? "0").Split('-'), pb = (b ?? "0").Split('-');
            string[] xa = pa[0].Split('.'), xb = pb[0].Split('.');
            for (int i = 0; i < 3; i++)
            {
                int va = i < xa.Length ? ToInt(xa[i]) : 0, vb = i < xb.Length ? ToInt(xb[i]) : 0;
                if (va != vb) return va < vb ? -1 : 1;
            }
            if (pa.Length != pb.Length) return pa.Length > pb.Length ? -1 : 1;
            return 0;
        }
        private static int ToInt(string s) { int v; return int.TryParse(s, out v) ? v : 0; }
    }
}
