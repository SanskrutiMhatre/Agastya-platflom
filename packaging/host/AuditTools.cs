// WP-29 (ENT-003, RES-004): the Windows side of the audit trail.
//
//   SecurityEventLine  the server writes each security event to standard output as  ##agastya-event|<id>|<level>|<text>  (it does so
//                      because the host sets AGASTYA_EVENT_SINK=host); the supervisor parses those lines and writes each one to the
//                      Application log under the "Agastya Platform" source with its stable id (docs/OPERATIONS.md section 13).
//                      Only ids 4100-4199 are accepted, so a line printed by anything else cannot write arbitrary event ids.
//   AuditTools.Verify  AgastyaCtl --verify-audit: runs  node backend\scripts\agastya-audit.js verify  against the data folder with the key
//                      in the state folder; exit 0 intact, 1 problems (also written as event 4101), 2 cannot check.
//   AuditTools.DoctorRow  the "Audit chain intact" row of --doctor.
//
// Registering the event source needs administrator rights; it is done by the installer and --install-service, never here. Without the
// source the events are still in the server log.

using System;
using System.Diagnostics;
using System.IO;
using System.Text;

namespace Agastya
{
    internal sealed class SecurityEventLine
    {
        public const string Prefix = "##agastya-event|";
        public int Id;
        public EventLogEntryType Type;
        public string Text;

        /// <summary>The event in a line of server output, or null when the line is not a well-formed event line.</summary>
        public static SecurityEventLine Parse(string line)
        {
            if (line == null || !line.StartsWith(Prefix, StringComparison.Ordinal)) return null;
            string[] parts = line.Substring(Prefix.Length).Split(new char[] { '|' }, 3);
            if (parts.Length != 3) return null;
            int id;
            if (!int.TryParse(parts[0], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out id)) return null;
            if (id < 4100 || id > 4199) return null;
            EventLogEntryType type;
            switch (parts[1])
            {
                case "information": type = EventLogEntryType.Information; break;
                case "warning": type = EventLogEntryType.Warning; break;
                case "error": type = EventLogEntryType.Error; break;
                default: return null;
            }
            string text = parts[2].Trim();
            if (text.Length == 0) return null;
            if (text.Length > 4000) text = text.Substring(0, 4000);
            SecurityEventLine e = new SecurityEventLine();
            e.Id = id; e.Type = type; e.Text = text;
            return e;
        }
    }

    internal static class AuditTools
    {
        private static string Script { get { return Path.Combine(Path.Combine(Path.Combine(Layout.AppDir, "backend"), "scripts"), "agastya-audit.js"); } }

        /// <summary>Runs the offline verifier; returns its exit code (or -1 when it could not be run) and its output.</summary>
        private static int Run(Settings cfg, int timeoutMs, out string output)
        {
            output = "";
            if (!File.Exists(Layout.NodeExe) || !File.Exists(Script)) { output = "the audit verifier is not installed (" + Script + ")"; return -1; }
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(Layout.NodeExe, "\"" + Script + "\" verify --workspace \"" + cfg.WorkspaceDir + "\"");
                psi.UseShellExecute = false; psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true; psi.RedirectStandardError = true;
                psi.StandardOutputEncoding = Encoding.UTF8; psi.StandardErrorEncoding = Encoding.UTF8;
                psi.WorkingDirectory = Path.Combine(Layout.AppDir, "backend");
                psi.EnvironmentVariables["AGASTYA_AUDIT_KEY_FILE"] = Host.AuditKeyFile;
                using (Process p = Process.Start(psi))
                {
                    var err = p.StandardError.ReadToEndAsync();
                    string o = p.StandardOutput.ReadToEnd();
                    if (!p.WaitForExit(timeoutMs)) { try { p.Kill(); } catch { } output = "the audit verification did not finish in " + (timeoutMs / 1000) + " s"; return -1; }
                    output = (o + err.Result).Trim();
                    return p.ExitCode;
                }
            }
            catch (Exception e) { output = e.Message; return -1; }
        }

        /// <summary>AgastyaCtl --verify-audit.</summary>
        public static int Verify(Settings cfg)
        {
            string o;
            int rc = Run(cfg, 30 * 60 * 1000, out o);
            Console.WriteLine(o);
            if (rc == 1) Host.Event(EventLogEntryType.Error, "The audit chain verification found a problem (AgastyaCtl --verify-audit): " + FirstLine(o), 4101);
            Host.Info("verify-audit finished with code " + rc);
            return rc < 0 ? 2 : rc;
        }

        /// <summary>The doctor row: 0 = pass, 1 = fail, 2 = warn, -1 = skip (no verifier in this tree); `line` is the text.</summary>
        public static int DoctorRow(Settings cfg, out string line)
        {
            line = null;
            if (!File.Exists(Script)) return -1;
            if (!File.Exists(Path.Combine(cfg.WorkspaceDir, "publisher.db"))) { line = "Audit chain: no database yet (made at the first start)"; return 0; }
            string o;
            int rc = Run(cfg, 10 * 60 * 1000, out o);
            // the verifier's summary already reads "audit chain intact: ..." / "audit chain BROKEN: ..."
            if (rc == 0) { line = Capital(StripStatus(FirstLine(o))); return 0; }
            if (rc == 1) { line = Capital(StripStatus(FirstLine(o))) + " (AgastyaCtl --verify-audit lists every problem)"; return 1; }
            line = "Audit chain not checked: " + StripStatus(FirstLine(o));
            return 2;
        }

        private static string FirstLine(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            int i = s.IndexOf('\n');
            return (i < 0 ? s : s.Substring(0, i)).Trim();
        }
        private static string Capital(string s) { return s.Length == 0 ? s : char.ToUpperInvariant(s[0]) + s.Substring(1); }
        private static string StripStatus(string s)
        {
            foreach (string p in new string[] { "OK: ", "BROKEN: ", "CANNOT VERIFY: " }) if (s.StartsWith(p, StringComparison.Ordinal)) return s.Substring(p.Length);
            return s;
        }

        /// <summary>Hidden test hook: AgastyaCtl --parse-event-line "<line>" prints "id|Type|text" or "not an event line" (exit 0 / 1).</summary>
        public static int ParseCommand(string line)
        {
            SecurityEventLine e = SecurityEventLine.Parse(line);
            if (e == null) { Console.WriteLine("not an event line"); return 1; }
            Console.WriteLine(e.Id + "|" + e.Type + "|" + e.Text);
            return 0;
        }
    }
}
