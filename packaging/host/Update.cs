// =============================================================================
// Agastya Platform - versioned program folders, offline update and rollback, the window, first administrator (audit WP-25: DEP-023, QA-009,
// PRD-005; DEP-001 installer side; G-DEP-1/2/5, G-REL-3).
//
//   AgastyaCtl.exe --verify-update <file.agupdate> [--allow-unsigned]   check a package and say whether it would be applied; changes nothing
//   AgastyaCtl.exe --apply-update  <file.agupdate> [--allow-unsigned]   verify, stop, verified pre-update backup, switch, health check,
//                                                                       automatic rollback when the new version does not become healthy
//   AgastyaCtl.exe --rollback [--restore-db]                            go back to the previous version (one command)
//   AgastyaCtl.exe --versions | --prune-versions | --repair-launcher
//   AgastyaCtl.exe --first-admin <user> --password-file <file>          the unattended first administrator (Setup /ADMINUSER /ADMINPASSWORDFILE)
//   Setup only:  --prepare-upgrade <label>   --activate <version>   --remove-data --confirm      (each with --install-dir <folder>)
//
// The update package (scripts/release/update-package.mjs writes it) is a ZIP:
//   update-info.txt       "key: value" lines: format agastya-update/1, product, app-id, version, min-from-version, manifest-sha256, files, bytes
//   update-info.txt.sig   detached signature (agastya-detached-signature/1, scripts/release/lib.mjs) with the release certificate
//   payload/...           the whole program tree of the new version, with its own MANIFEST.sha256 (+ .sig)
// Trust: the package must be signed by the certificate that signed the INSTALLED program (its AgastyaCtl.exe or its manifest), or by one listed
// in agastya.ini [update] TrustedThumbprints (a certificate renewal). Every payload file is hashed against the manifest named by the signed
// update-info.txt before anything is written. An unsigned package is refused unless --allow-unsigned is given (development and test machines).
//
// Exit codes of --apply-update / --verify-update (docs/DEPLOYMENT-KIT.md):
//   0 updated and healthy (or: would be applied)     10 package refused (signature, signer, integrity, format)
//   1 failed before anything changed                  11 version refused (same, older, product, from-version range)
//   2 wrong arguments                                 12 not enough disk space
//   13 the running server could not be stopped        14 the pre-update backup failed (nothing changed)
//   20 the new version failed its health check and the previous one runs again (database restored to its pre-update copy)
//   21 the rollback itself failed: the update log names what to do                22 (--rollback) the previous version cannot use this database
// =============================================================================

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using Microsoft.Win32;

namespace Agastya
{
    // ---------------------------------------------------------------------------------------------------------------
    // Version folders and the current / previous pointers.
    // ---------------------------------------------------------------------------------------------------------------
    internal static class Versions
    {
        private static readonly Regex VersionName = new Regex(@"^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$");
        public static readonly string[] LauncherFiles = new string[] { "AgastyaPlatform.exe", "AgastyaCtl.exe" };

        public static bool ValidName(string v) { return v != null && VersionName.IsMatch(v); }

        public static string ReadPointer(string name)
        {
            try
            {
                string f = Path.Combine(Layout.InstallDir, name);
                if (!File.Exists(f)) return null;
                string v = File.ReadAllText(f, Encoding.UTF8).Trim();
                return ValidName(v) ? v : null;
            }
            catch { return null; }
        }

        /// <summary>Write a pointer file atomically: a temporary file beside it, then a replace, so a power cut leaves the old or the new value.</summary>
        public static void WritePointer(string name, string value)
        {
            string f = Path.Combine(Layout.InstallDir, name);
            if (value == null) { if (File.Exists(f)) File.Delete(f); return; }
            if (!ValidName(value)) throw new ArgumentException("not a version: " + value);
            string tmp = f + ".tmp";
            using (FileStream s = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                byte[] b = new UTF8Encoding(false).GetBytes(value + "\r\n");
                s.Write(b, 0, b.Length); s.Flush(true);
            }
            if (File.Exists(f)) File.Replace(tmp, f, null); else File.Move(tmp, f);
        }

        /// <summary>"2.10.1" against "2.9.0": less than 0, 0, greater than 0. A pre-release ranks below its release; a malformed version below all.</summary>
        public static int Compare(string a, string b)
        {
            int[] x = Parse(a), y = Parse(b);
            if (x == null || y == null) return (x != null ? 1 : 0) - (y != null ? 1 : 0);
            for (int i = 0; i < 4; i++) if (x[i] != y[i]) return x[i].CompareTo(y[i]);
            return 0;
        }
        private static int[] Parse(string v)
        {
            if (v == null) return null;
            Match m = Regex.Match(v.Trim(), @"^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$");
            if (!m.Success) return null;
            return new int[] { int.Parse(m.Groups[1].Value), int.Parse(m.Groups[2].Value), int.Parse(m.Groups[3].Value), m.Groups[4].Success ? 0 : 1 };
        }

        /// <summary>The product version of a program folder: its version.json, or (a development tree) this program's own version.</summary>
        public static string VersionOf(string programDir)
        {
            string v = JsonField(Path.Combine(programDir, "version.json"), "version");
            return v ?? Layout.Version;
        }
        public static string JsonField(string file, string key)
        {
            try
            {
                if (!File.Exists(file)) return null;
                Match m = Regex.Match(File.ReadAllText(file, Encoding.UTF8), "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"([^\"]*)\"");
                return m.Success ? m.Groups[1].Value : null;
            }
            catch { return null; }
        }

        /// <summary>Version folders that hold a program (current and previous included), newest first.</summary>
        public static List<string> Installed()
        {
            List<string> l = new List<string>();
            if (Directory.Exists(Layout.VersionsDir))
                foreach (string d in Directory.GetDirectories(Layout.VersionsDir))
                {
                    string n = Path.GetFileName(d);
                    if (ValidName(n) && File.Exists(Path.Combine(d, "AgastyaCtl.exe"))) l.Add(n);
                }
            l.Sort(delegate (string a, string b) { int c = Compare(b, a); return c != 0 ? c : string.CompareOrdinal(b, a); });
            return l;
        }

        public static string ListLine()
        {
            List<string> others = Installed(); others.Remove(Layout.CurrentVersion ?? "");
            string prev = ReadPointer("previous");
            if (others.Count == 0) return "none";
            List<string> parts = new List<string>();
            foreach (string v in others) parts.Add(v + (v == prev ? " (previous)" : ""));
            return string.Join(", ", parts.ToArray());
        }

        /// <summary>Keep the current version, the previous one and the newest others up to `keep` earlier versions; remove the rest and any
        /// half-written folder. Never the folder this program runs from.</summary>
        public static List<string> Prune(int keep, Action<string> log)
        {
            List<string> removed = new List<string>();
            if (!Directory.Exists(Layout.VersionsDir)) return removed;
            string cur = ReadPointer("current"), prev = ReadPointer("previous");
            string self = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location).TrimEnd('\\');
            List<string> earlier = Installed(); earlier.Remove(cur ?? "");
            List<string> keepSet = new List<string>();
            if (cur != null) keepSet.Add(cur);
            if (prev != null) keepSet.Add(prev);
            foreach (string v in earlier) { if (keepSet.Count - (cur != null ? 1 : 0) >= keep) break; if (!keepSet.Contains(v)) keepSet.Add(v); }
            foreach (string d in Directory.GetDirectories(Layout.VersionsDir))
            {
                string n = Path.GetFileName(d);
                if (keepSet.Contains(n)) continue;
                if (string.Equals(d.TrimEnd('\\'), self, StringComparison.OrdinalIgnoreCase)) continue;
                try { DeleteTree(d); removed.Add(n); if (log != null) log("removed the program folder of version " + n); }
                catch (Exception e) { if (log != null) log("could not remove " + d + ": " + e.Message + " (it is tried again next time)"); }
            }
            return removed;
        }

        public static void DeleteTree(string dir)
        {
            if (!Directory.Exists(dir)) return;
            foreach (string f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories)) { try { File.SetAttributes(f, FileAttributes.Normal); } catch { } }
            Directory.Delete(dir, true);
        }

        /// <summary>null when the launcher programs beside the versions folder are the current version's; otherwise what differs.</summary>
        public static string LauncherDrift()
        {
            if (Layout.CurrentVersion == null) return null;
            foreach (string n in LauncherFiles)
            {
                string src = Path.Combine(Layout.ExeDir, n), dst = Path.Combine(Layout.InstallDir, n);
                if (!File.Exists(src)) return "version " + Layout.CurrentVersion + " has no " + n;
                if (!File.Exists(dst) || !SameBytes(src, dst)) return Path.Combine(Layout.InstallDir, n) + " is not the program of version " + Layout.CurrentVersion;
            }
            return null;
        }

        /// <summary>Copy the current version's programs to the launcher place. A running launcher cannot be overwritten but can be renamed: it is
        /// moved aside (*.old-*) and removed at a later start.</summary>
        public static void RefreshLauncher(Action<string> log)
        {
            foreach (string n in LauncherFiles)
            {
                string src = Path.Combine(Layout.ExeDir, n), dst = Path.Combine(Layout.InstallDir, n);
                if (!File.Exists(src)) throw new IOException("the program folder " + Layout.ExeDir + " has no " + n);
                if (File.Exists(dst) && SameBytes(src, dst)) continue;
                if (File.Exists(dst))
                {
                    try { File.Delete(dst); }
                    catch { File.Move(dst, dst + ".old-" + DateTime.UtcNow.Ticks); }
                }
                File.Copy(src, dst);
                if (log != null) log("launcher " + n + " is now version " + Layout.CurrentVersion + "'s");
            }
        }

        /// <summary>Setup's Add/Remove Programs entry ({AppId}_is1, HKLM or HKCU) shows the version Setup installed; after an offline update or
        /// a rollback it is set to the current one, so Settings > Apps and the deployment detection rule (Detect-AgastyaPlatform.ps1) agree with
        /// the program. Only an entry whose InstallLocation is this installation is touched.</summary>
        public static void SyncUninstallEntry(Action<string> log)
        {
            string appId = JsonField(Path.Combine(Layout.ExeDir, "version.json"), "appId");
            if (string.IsNullOrEmpty(appId) || Layout.CurrentVersion == null) return;
            string ver = VersionOf(Layout.ExeDir);
            foreach (RegistryHive hive in new RegistryHive[] { RegistryHive.LocalMachine, RegistryHive.CurrentUser })
            {
                try
                {
                    using (RegistryKey root = RegistryKey.OpenBaseKey(hive, RegistryView.Registry64))
                    using (RegistryKey k = root.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{" + appId + "}_is1", true))
                    {
                        if (k == null) continue;
                        string loc = (k.GetValue("InstallLocation") as string ?? "").TrimEnd('\\');
                        if (!string.Equals(loc, Layout.InstallDir.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase)) continue;
                        k.SetValue("DisplayVersion", ver);
                        if (log != null) log("Add/Remove Programs now shows version " + ver);
                    }
                }
                catch (Exception e) { if (log != null) log("the Add/Remove Programs entry could not be updated (" + e.Message + ")"); }
            }
        }

        public static void CleanupOldLaunchers()
        {
            try { foreach (string f in Directory.GetFiles(Layout.InstallDir, "*.exe.old-*")) { try { File.Delete(f); } catch { } } } catch { }
        }

        public static bool SameBytes(string a, string b)
        {
            FileInfo x = new FileInfo(a), y = new FileInfo(b);
            if (!x.Exists || !y.Exists || x.Length != y.Length) return false;
            return Hash.File(a) == Hash.File(b);
        }
    }

    internal static class Hash
    {
        public static string File(string p)
        {
            using (SHA256 sha = SHA256.Create())
            using (FileStream s = new FileStream(p, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1 << 20))
                return Hex(sha.ComputeHash(s));
        }
        public static string Bytes(byte[] b) { using (SHA256 sha = SHA256.Create()) return Hex(sha.ComputeHash(b)); }
        public static string Hex(byte[] b) { StringBuilder sb = new StringBuilder(b.Length * 2); foreach (byte x in b) sb.Append(x.ToString("x2")); return sb.ToString(); }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Detached signatures (format: scripts/release/lib.mjs). Shared by the manifest check (Integrity.cs) and the update package.
    // ---------------------------------------------------------------------------------------------------------------
    internal static class DetachedSig
    {
        /// <summary>null when `sigText` is a valid signature of `data` under the name `fileName`; otherwise the reason. signer/thumbprint are
        /// filled as soon as the embedded certificate can be read.</summary>
        public static string Verify(byte[] data, string sigText, string fileName, out string signer, out string thumbprint)
        {
            signer = null; thumbprint = null;
            try
            {
                Dictionary<string, string> f = new Dictionary<string, string>();
                foreach (string line in sigText.Split('\n'))
                {
                    Match m = Regex.Match(line.TrimEnd('\r'), @"^([a-z0-9-]+):\s?(.*)$");
                    if (m.Success) f[m.Groups[1].Value] = m.Groups[2].Value.Trim();
                }
                string v;
                if (!f.TryGetValue("format", out v) || v != "agastya-detached-signature/1") return "not an agastya-detached-signature/1 file";
                foreach (string k in new string[] { "algorithm", "signed-file", "signed-sha256", "thumbprint", "certificate", "signature" })
                    if (!f.ContainsKey(k)) return "the signature file has no " + k;
                X509Certificate2 cert = new X509Certificate2(Convert.FromBase64String(f["certificate"]));
                signer = cert.Subject; thumbprint = cert.Thumbprint.ToUpperInvariant();
                if (f["signed-file"] != fileName) return "the signature is for " + f["signed-file"];
                if (thumbprint != f["thumbprint"].ToUpperInvariant()) return "the thumbprint line does not match the certificate";
                if (Hash.Bytes(data) != f["signed-sha256"].ToLowerInvariant()) return fileName + " was changed after it was signed";
                byte[] sig = Convert.FromBase64String(f["signature"]);
                bool ok;
                if (f["algorithm"] == "RSA-PKCS1-SHA256") ok = cert.GetRSAPublicKey().VerifyData(data, sig, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
                else if (f["algorithm"] == "ECDSA-P1363-SHA256") ok = cert.GetECDsaPublicKey().VerifyData(data, sig, HashAlgorithmName.SHA256);
                else return "unknown algorithm " + f["algorithm"];
                return ok ? null : "the signature does not match (" + fileName + " or the signature was altered)";
            }
            catch (Exception e) { return e.Message; }
        }

        /// <summary>The Authenticode signer thumbprint of a file, or null (not signed / unreadable).</summary>
        public static string AuthenticodeThumbprint(string file)
        {
            try { return new X509Certificate2(X509Certificate.CreateFromSignedFile(file)).Thumbprint.ToUpperInvariant(); } catch { return null; }
        }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // The window: WebView2 runtime detection and where the interface opens (PRD-005).
    // ---------------------------------------------------------------------------------------------------------------
    internal static class Shell
    {
        // The Evergreen WebView2 runtime's client id (Microsoft's documented detection key; "pv" is the installed version).
        private const string WebView2Client = @"Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

        public static string WebView2Version()
        {
            string[][] places = new string[][] {
                new string[] { "HKLM", @"SOFTWARE\WOW6432Node\" + WebView2Client }, new string[] { "HKLM", @"SOFTWARE\" + WebView2Client },
                new string[] { "HKCU", @"Software\" + WebView2Client } };
            foreach (string[] p in places)
            {
                string v = RegString(p[0], p[1], "pv");
                if (!string.IsNullOrEmpty(v) && v != "0.0.0.0" && Regex.IsMatch(v, @"^\d+(\.\d+){1,3}$")) return v;
            }
            return null;
        }

        public static string EdgePath()
        {
            foreach (string hive in new string[] { "HKLM", "HKCU" })
            {
                string p = RegString(hive, @"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe", "");
                if (!string.IsNullOrEmpty(p) && File.Exists(p.Trim('"'))) return p.Trim('"');
            }
            foreach (string pf in new string[] { Environment.GetEnvironmentVariable("ProgramFiles(x86)"), Environment.GetEnvironmentVariable("ProgramFiles") })
            {
                if (string.IsNullOrEmpty(pf)) continue;
                string p = Path.Combine(pf, @"Microsoft\Edge\Application\msedge.exe");
                if (File.Exists(p)) return p;
            }
            return null;
        }

        private static string RegString(string hive, string key, string name)
        {
            try
            {
                using (RegistryKey root = RegistryKey.OpenBaseKey(hive == "HKLM" ? RegistryHive.LocalMachine : RegistryHive.CurrentUser, RegistryView.Registry64))
                using (RegistryKey k = root.OpenSubKey(key))
                    return k == null ? null : k.GetValue(name) as string;
            }
            catch { return null; }
        }

        /// <summary>"app" when the interface will open in an app window, "browser" otherwise.</summary>
        public static string PlannedWindow(Settings s) { return s.Window != "browser" && EdgePath() != null ? "app" : "browser"; }

        /// <summary>Open the interface. Returns a notice for the person when it had to fall back to the default browser, else null.</summary>
        public static string Open(Settings s, string url)
        {
            string notice = null;
            if (s.Window != "browser")
            {
                string edge = EdgePath();
                if (edge != null)
                {
                    try { Process.Start(new ProcessStartInfo(edge, "--app=\"" + url + "\"") { UseShellExecute = false }); return null; }
                    catch (Exception e) { notice = "Microsoft Edge could not open the Agastya Platform window (" + e.Message + "), so it opened in your default browser."; }
                }
                else notice = "Microsoft Edge and its WebView2 runtime were not found on this computer, so Agastya Platform opened in your default browser. "
                            + "Your administrator can install the runtime from the release's redist folder.";
            }
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
            return notice;
        }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // The update package.
    // ---------------------------------------------------------------------------------------------------------------
    internal sealed class UpdatePackage
    {
        public const string InfoName = "update-info.txt";
        public const string Format = "agastya-update/1";
        public string File;
        public Dictionary<string, string> Info = new Dictionary<string, string>();
        public string Version { get { return Get("version"); } }
        public bool Signed;
        public string Signer, Thumbprint;
        public long PayloadBytes;
        public int PayloadFiles;

        public string Get(string k) { string v; return Info.TryGetValue(k, out v) ? v : null; }

        private static bool SafeEntry(string name)
        {
            if (name.Length == 0 || name.IndexOf('\\') >= 0 || name.StartsWith("/") || name.IndexOf(':') >= 0) return false;
            foreach (string part in name.Split('/')) if (part == ".." || part == ".") return false;
            return name == InfoName || name == InfoName + ".sig" || (name.StartsWith("payload/") && name.Length > 8);
        }

        private static byte[] ReadEntry(ZipArchiveEntry e)
        {
            using (Stream s = e.Open()) using (MemoryStream m = new MemoryStream()) { s.CopyTo(m); return m.ToArray(); }
        }

        /// <summary>Everything that can be checked without writing a byte: format, signature and its signer, product, versions, every payload
        /// file's SHA-256 against the signed manifest. Returns 0 or an exit code (10 / 11), with the reason in `why`.</summary>
        public int Verify(Settings cfg, string installedVersion, string installedDir, bool allowUnsigned, out string why)
        {
            why = null;
            try
            {
                using (FileStream fs = new FileStream(File, FileMode.Open, FileAccess.Read, FileShare.Read))
                using (ZipArchive zip = new ZipArchive(fs, ZipArchiveMode.Read))
                {
                    Dictionary<string, ZipArchiveEntry> byName = new Dictionary<string, ZipArchiveEntry>(StringComparer.Ordinal);
                    foreach (ZipArchiveEntry e in zip.Entries)
                    {
                        if (e.FullName.EndsWith("/")) continue;   // a folder entry
                        if (!SafeEntry(e.FullName)) { why = "the package holds an entry that is not allowed: " + e.FullName; return 10; }
                        if (byName.ContainsKey(e.FullName)) { why = "the package holds " + e.FullName + " twice"; return 10; }
                        byName[e.FullName] = e;
                    }
                    ZipArchiveEntry infoEntry;
                    if (!byName.TryGetValue(InfoName, out infoEntry)) { why = "not an update package (" + InfoName + " is missing)"; return 10; }
                    byte[] info = ReadEntry(infoEntry);
                    foreach (string line in new UTF8Encoding(false).GetString(info).Split('\n'))
                    {
                        Match m = Regex.Match(line.TrimEnd('\r'), @"^([a-z0-9-]+):\s?(.*)$");
                        if (m.Success) Info[m.Groups[1].Value] = m.Groups[2].Value.Trim();
                    }
                    if (Get("format") != Format) { why = "not an " + Format + " package"; return 10; }
                    foreach (string k in new string[] { "product", "version", "min-from-version", "manifest-sha256" })
                        if (string.IsNullOrEmpty(Get(k))) { why = InfoName + " has no " + k; return 10; }

                    // --- who signed it, and may they update this installation?
                    ZipArchiveEntry sigEntry;
                    if (byName.TryGetValue(InfoName + ".sig", out sigEntry))
                    {
                        string problem = DetachedSig.Verify(info, new UTF8Encoding(false).GetString(ReadEntry(sigEntry)), InfoName, out Signer, out Thumbprint);
                        if (problem != null) { why = "the package signature does not hold: " + problem; return 10; }
                        Signed = true;
                        List<string> trusted = TrustedSigners(cfg, installedDir);
                        if (trusted.Count == 0 && !allowUnsigned)
                        { why = "the installed program is not signed, so nothing says who may update it; on a development or test machine pass --allow-unsigned"; return 10; }
                        if (trusted.Count > 0 && !trusted.Contains(Thumbprint))
                        { why = "the package is signed by " + Signer + " (" + Thumbprint + "), which is not the signer of the installed program (" + string.Join(", ", trusted.ToArray()) + ") nor in [update] TrustedThumbprints"; return 10; }
                    }
                    else if (!allowUnsigned) { why = "the package is not signed (" + InfoName + ".sig is missing); an unsigned package is accepted only with --allow-unsigned on a test machine"; return 10; }

                    // --- is it for this product, and newer?
                    if (Get("product") != "Agastya Platform") { why = "the package is for " + Get("product") + ", not Agastya Platform"; return 11; }
                    string appId = Versions.JsonField(Path.Combine(installedDir, "version.json"), "appId");
                    if (!string.IsNullOrEmpty(appId) && !string.IsNullOrEmpty(Get("app-id")) && !string.Equals(appId, Get("app-id"), StringComparison.OrdinalIgnoreCase))
                    { why = "the package is for another product id (" + Get("app-id") + "; installed " + appId + ")"; return 11; }
                    if (!Versions.ValidName(Version)) { why = "the package version '" + Version + "' is not x.y.z"; return 10; }
                    int c = Versions.Compare(Version, installedVersion);
                    if (c == 0) { why = "version " + Version + " is already installed"; return 11; }
                    if (c < 0) { why = "the package holds version " + Version + ", older than the installed " + installedVersion + "; an update never goes back - use AgastyaCtl.exe --rollback"; return 11; }
                    if (Versions.Compare(installedVersion, Get("min-from-version")) < 0)
                    { why = "this package updates " + Get("min-from-version") + " or later; the installed version is " + installedVersion + " (install the intermediate release first)"; return 11; }

                    // --- every payload file against the manifest that the signed update-info.txt names
                    ZipArchiveEntry mfEntry;
                    if (!byName.TryGetValue("payload/" + Integrity.ManifestName, out mfEntry)) { why = "the payload has no " + Integrity.ManifestName; return 10; }
                    byte[] mf = ReadEntry(mfEntry);
                    if (Hash.Bytes(mf) != Get("manifest-sha256").ToLowerInvariant()) { why = "the payload's " + Integrity.ManifestName + " is not the one the package was signed with"; return 10; }
                    ZipArchiveEntry mfSig;
                    if (byName.TryGetValue("payload/" + Integrity.ManifestName + ".sig", out mfSig))
                    {
                        string s2, t2;
                        string p2 = DetachedSig.Verify(mf, new UTF8Encoding(false).GetString(ReadEntry(mfSig)), Integrity.ManifestName, out s2, out t2);
                        if (p2 != null) { why = "the payload's manifest signature does not hold: " + p2; return 10; }
                        if (Signed && t2 != Thumbprint) { why = "the payload's manifest is signed by " + t2 + ", the package by " + Thumbprint; return 10; }
                    }
                    Dictionary<string, string[]> listed = new Dictionary<string, string[]>(StringComparer.Ordinal);
                    string[] lines = new UTF8Encoding(false).GetString(mf).Split('\n');
                    if (lines.Length == 0 || lines[0] != "# agastya-manifest/1") { why = "the payload manifest is not agastya-manifest/1"; return 10; }
                    foreach (string line in lines)
                    {
                        if (line.Length == 0 || line[0] == '#') continue;
                        int a = line.IndexOf(' '), b = a < 0 ? -1 : line.IndexOf(' ', a + 1);
                        if (a != 64 || b < 0) { why = "malformed manifest line"; return 10; }
                        listed[line.Substring(b + 1)] = new string[] { line.Substring(0, 64), line.Substring(a + 1, b - a - 1) };
                    }
                    int seen = 0;
                    using (SHA256 sha = SHA256.Create())
                        foreach (KeyValuePair<string, ZipArchiveEntry> kv in byName)
                        {
                            if (!kv.Key.StartsWith("payload/")) continue;
                            string rel = kv.Key.Substring(8);
                            if (rel == Integrity.ManifestName || rel == Integrity.ManifestName + ".sig") continue;
                            string[] want;
                            if (!listed.TryGetValue(rel, out want)) { why = "the payload holds a file its manifest does not list: " + rel; return 10; }
                            string got;
                            using (Stream s = kv.Value.Open()) got = Hash.Hex(sha.ComputeHash(s));
                            if (got != want[0] || kv.Value.Length.ToString() != want[1]) { why = "payload file " + rel + " does not match the manifest (changed after signing, or damaged)"; return 10; }
                            seen++; PayloadBytes += kv.Value.Length;
                        }
                    if (seen != listed.Count)
                    {
                        foreach (string rel in listed.Keys) if (!byName.ContainsKey("payload/" + rel)) { why = "the payload is missing " + rel; return 10; }
                    }
                    PayloadFiles = seen;
                    if (!listed.ContainsKey("AgastyaCtl.exe") || !listed.ContainsKey("runtime/node.exe") || !listed.ContainsKey("version.json"))
                    { why = "the payload is not a complete program (AgastyaCtl.exe, runtime/node.exe or version.json missing)"; return 10; }
                }
                return 0;
            }
            catch (InvalidDataException e) { why = "the package is not a readable ZIP: " + e.Message; return 10; }
            catch (Exception e) { why = "the package cannot be read: " + e.Message; return 10; }
        }

        /// <summary>The certificates that may sign an update of this installation: the signer of its AgastyaCtl.exe, of its manifest, and the
        /// administrator's list.</summary>
        public static List<string> TrustedSigners(Settings cfg, string installedDir)
        {
            List<string> l = new List<string>();
            string t = DetachedSig.AuthenticodeThumbprint(Path.Combine(installedDir, "AgastyaCtl.exe"));
            if (t != null) l.Add(t);
            string mf = Path.Combine(installedDir, Integrity.ManifestName);
            if (System.IO.File.Exists(mf + ".sig"))
            {
                string s, tp;
                if (DetachedSig.Verify(System.IO.File.ReadAllBytes(mf), System.IO.File.ReadAllText(mf + ".sig"), Integrity.ManifestName, out s, out tp) == null && !l.Contains(tp)) l.Add(tp);
            }
            foreach (string x in (cfg.TrustedThumbprints ?? "").Split(new char[] { ',', ';', ' ' }, StringSplitOptions.RemoveEmptyEntries))
            {
                string u = x.Trim().ToUpperInvariant();
                if (Regex.IsMatch(u, "^[0-9A-F]{40}$") && !l.Contains(u)) l.Add(u);
            }
            return l;
        }

        /// <summary>Write the payload into `target` (which must not exist), then check it again on disk.</summary>
        public void Extract(string target)
        {
            Directory.CreateDirectory(target);
            string root = Path.GetFullPath(target).TrimEnd('\\') + "\\";
            using (FileStream fs = new FileStream(File, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (ZipArchive zip = new ZipArchive(fs, ZipArchiveMode.Read))
                foreach (ZipArchiveEntry e in zip.Entries)
                {
                    if (!e.FullName.StartsWith("payload/") || e.FullName.EndsWith("/")) continue;
                    if (!SafeEntry(e.FullName)) throw new InvalidDataException("unsafe entry " + e.FullName);
                    string dest = Path.GetFullPath(Path.Combine(target, e.FullName.Substring(8).Replace('/', '\\')));
                    if (!dest.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("entry outside the target: " + e.FullName);
                    Directory.CreateDirectory(Path.GetDirectoryName(dest));
                    using (Stream s = e.Open()) using (FileStream o = new FileStream(dest, FileMode.CreateNew, FileAccess.Write)) { s.CopyTo(o); o.Flush(true); }
                }
        }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Stopping, backing up, switching, checking, rolling back.
    // ---------------------------------------------------------------------------------------------------------------
    internal static class Updater
    {
        private static RotatingLog updateLog;
        public static void Log(string m)
        {
            string s = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " " + m;
            if (updateLog != null) updateLog.Write(s);
            Console.WriteLine(m);
            Host.Info("update: " + m);
        }
        private static string OpenLog(string kind)
        {
            string f = Path.Combine(Layout.LogDir, kind + "-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".log");
            updateLog = new RotatingLog(f, 50, 1);
            return f;
        }

        private static string HistoryFile { get { return Path.Combine(Layout.InstallDir, "update-history.txt"); } }
        private static void History(string from, string to, string result, string backup, string dbCopy)
        {
            try { System.IO.File.AppendAllText(HistoryFile, string.Join("|", new string[] { DateTime.Now.ToString("s"), from, to, result, backup ?? "", dbCopy ?? "" }) + "\r\n", new UTF8Encoding(false)); } catch { }
        }
        /// <summary>The database copy taken when `to` was installed over another version (newest successful record), or null.</summary>
        private static string DbCopyFor(string to)
        {
            try
            {
                if (!System.IO.File.Exists(HistoryFile)) return null;
                string[] lines = System.IO.File.ReadAllLines(HistoryFile);
                for (int i = lines.Length - 1; i >= 0; i--)
                {
                    string[] p = lines[i].Split('|');
                    if (p.Length >= 6 && p[2] == to && p[3] == "updated" && p[5].Length > 0) return p[5];
                }
            }
            catch { }
            return null;
        }

        // ---- the server ------------------------------------------------------------------------------------------------
        private static bool LockHeld(string ws)
        {
            try
            {
                string f = Path.Combine(ws, ".agastya-server.lock");
                if (!System.IO.File.Exists(f)) return false;
                Match m = Regex.Match(System.IO.File.ReadAllText(f), "\"pid\"\\s*:\\s*(\\d+)");
                if (!m.Success) return false;
                Match h = Regex.Match(System.IO.File.ReadAllText(f), "\"host\"\\s*:\\s*\"([^\"]*)\"");
                if (h.Success && !string.Equals(h.Groups[1].Value, Environment.MachineName, StringComparison.OrdinalIgnoreCase)) return true;
                try { Process p = Process.GetProcessById(int.Parse(m.Groups[1].Value)); return !p.HasExited; } catch (ArgumentException) { return false; }
            }
            catch { return false; }
        }

        public sealed class Running { public bool Service, Tray; }

        /// <summary>Stop the service and the tray application and wait until the server no longer answers and no longer holds the data folder.
        /// No fixed wait: it ends as soon as both are true, and fails after `seconds`.</summary>
        public static bool StopEverything(Settings cfg, int seconds, out Running was)
        {
            was = new Running();
            string st = ServiceTools.StateOf(cfg.ServiceName);
            if (st.Contains("RUNNING") || st.Contains("START_PENDING"))
            {
                was.Service = true;
                string o; ServiceTools.Sc("stop \"" + cfg.ServiceName + "\"", out o);
                Log("stopping the Windows service '" + cfg.ServiceName + "'");
            }
            try { EventWaitHandle.OpenExisting(Program.QuitEventName(cfg.Port)).Set(); was.Tray = true; Log("asked the tray application to close"); }
            catch { }
            DateTime end = DateTime.UtcNow.AddSeconds(seconds);
            while (DateTime.UtcNow < end)
            {
                bool svcStopped = !was.Service || ServiceTools.StateOf(cfg.ServiceName).Contains("STOPPED");
                if (svcStopped && !Probe.Alive(cfg.Port) && !LockHeld(cfg.WorkspaceDir)) { Log("the server is stopped"); return true; }
                Thread.Sleep(250);
            }
            Log("the server still runs after " + seconds + " s (port " + cfg.Port + (LockHeld(cfg.WorkspaceDir) ? ", data folder locked" : "") + "); close it and try again");
            return false;
        }

        /// <summary>Start what ran before (or nothing). Used after a refusal, a success and a rollback.</summary>
        public static void Restore(Settings cfg, Running was)
        {
            if (was == null) return;
            if (was.Service) { string o; ServiceTools.Sc("start \"" + cfg.ServiceName + "\"", out o); Log("started the Windows service again"); }
            if (was.Tray)
            {
                try { Process.Start(new ProcessStartInfo(Path.Combine(Layout.InstallDir, "AgastyaPlatform.exe")) { UseShellExecute = false, WorkingDirectory = Layout.InstallDir }); Log("started the tray application again"); }
                catch (Exception e) { Log("could not start the tray application: " + e.Message); }
            }
        }

        private static string Fetch(Settings cfg, string path, out int status)
        {
            status = 0;
            try
            {
                HttpWebRequest r = (HttpWebRequest)WebRequest.Create((cfg.TlsConfigured ? "https" : "http") + "://127.0.0.1:" + cfg.Port + path);
                r.Timeout = 5000; r.Proxy = null;
                if (cfg.TlsConfigured) r.ServerCertificateValidationCallback = delegate { return true; };   // loopback probe of our own server
                using (HttpWebResponse resp = (HttpWebResponse)r.GetResponse())
                using (StreamReader sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8)) { status = (int)resp.StatusCode; return sr.ReadToEnd(); }
            }
            catch (WebException e)
            {
                HttpWebResponse resp = e.Response as HttpWebResponse;
                if (resp != null) { status = (int)resp.StatusCode; try { using (StreamReader sr = new StreamReader(resp.GetResponseStream())) return sr.ReadToEnd(); } catch { return ""; } }
                return null;
            }
            catch { return null; }
        }

        /// <summary>Start the program the pointer names (as the service when it ran as one, otherwise a supervisor in this process) and wait for
        /// /api/version to report `expected` with a compatible schema and /api/ready to answer 200. `sup` is the supervisor to stop later.</summary>
        public static bool StartAndCheck(Settings cfg, string expected, bool asService, int seconds, out Supervisor sup, out string detail)
        {
            sup = null; detail = "not started";
            if (asService) { string o; ServiceTools.Sc("start \"" + cfg.ServiceName + "\"", out o); Log("started the Windows service for the check"); }
            else { sup = new Supervisor(cfg); sup.Start(); Log("started version " + expected + " for the check"); }
            DateTime end = DateTime.UtcNow.AddSeconds(seconds);
            while (DateTime.UtcNow < end)
            {
                if (sup != null && sup.GaveUp) { detail = "the server keeps stopping (see agastya-server.log)"; break; }
                int st; string body = Fetch(cfg, "/api/version", out st);
                if (body == null) detail = "no answer on port " + cfg.Port;
                else if (st != 200) detail = "/api/version answered " + st;
                else
                {
                    Match v = Regex.Match(body, "\"version\"\\s*:\\s*\"([^\"]*)\"");
                    if (!v.Success || v.Groups[1].Value != expected) detail = "/api/version reports " + (v.Success ? v.Groups[1].Value : "no version") + ", expected " + expected;
                    else if (!Regex.IsMatch(body, "\"compatible\"\\s*:\\s*true")) detail = "/api/version: the database schema is not compatible with " + expected;
                    else
                    {
                        int rs; string ready = Fetch(cfg, "/api/ready", out rs);
                        if (rs == 200) { detail = "version " + expected + " answers /api/version and /api/ready"; Log(detail); return true; }
                        detail = "/api/ready answered " + rs + (ready != null ? ": " + (ready.Length > 300 ? ready.Substring(0, 300) : ready) : "");
                    }
                }
                Thread.Sleep(750);
            }
            Log("health check failed after " + seconds + " s: " + detail);
            return false;
        }

        public static void StopChecked(Settings cfg, Supervisor sup, bool asService)
        {
            if (sup != null) sup.Stop();
            if (asService)
            {
                string o; ServiceTools.Sc("stop \"" + cfg.ServiceName + "\"", out o);
                for (int i = 0; i < 240 && !ServiceTools.StateOf(cfg.ServiceName).Contains("STOPPED"); i++) Thread.Sleep(250);
            }
            for (int i = 0; i < 240 && (Probe.Alive(cfg.Port) || LockHeld(cfg.WorkspaceDir)); i++) Thread.Sleep(250);
        }

        // ---- data protection --------------------------------------------------------------------------------------------------
        private static int RunNode(string programDir, string args, string stdin, int timeoutMs, out string output)
        {
            string node = Path.Combine(Path.Combine(programDir, "runtime"), "node.exe");
            ProcessStartInfo psi = new ProcessStartInfo(node, args);
            psi.UseShellExecute = false; psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true; psi.RedirectStandardError = true; psi.RedirectStandardInput = true;
            psi.StandardOutputEncoding = Encoding.UTF8; psi.StandardErrorEncoding = Encoding.UTF8;
            psi.WorkingDirectory = Path.Combine(Path.Combine(programDir, "app"), "backend");
            psi.EnvironmentVariables["NODE_ENV"] = "production";
            // WP-29: a script that opens the database (first-admin, the backup tool) writes audit rows with the server's key, kept in the
            // state folder - never a second key beside the database
            psi.EnvironmentVariables["AGASTYA_AUDIT_KEY_FILE"] = Host.AuditKeyFile;
            StringBuilder sb = new StringBuilder();
            using (Process p = new Process())
            {
                p.StartInfo = psi;
                p.OutputDataReceived += delegate (object s, DataReceivedEventArgs e) { if (e.Data != null) lock (sb) sb.AppendLine(e.Data); };
                p.ErrorDataReceived += delegate (object s, DataReceivedEventArgs e) { if (e.Data != null && e.Data.IndexOf("ExperimentalWarning", StringComparison.Ordinal) < 0 && e.Data.IndexOf("--trace-warnings", StringComparison.Ordinal) < 0) lock (sb) sb.AppendLine(e.Data); };
                p.Start(); p.BeginOutputReadLine(); p.BeginErrorReadLine();
                try { if (stdin != null) { p.StandardInput.Write(stdin); } p.StandardInput.Close(); } catch { }
                if (!p.WaitForExit(timeoutMs)) { try { p.Kill(); } catch { } output = sb.ToString() + "(timed out)"; return -1; }
                p.WaitForExit();
                output = sb.ToString().Trim();
                return p.ExitCode;
            }
        }

        private static string BackupScript(string programDir)
        {
            string s = Path.Combine(Path.Combine(Path.Combine(Path.Combine(programDir, "app"), "backend"), "scripts"), "agastya-backup.js");
            return System.IO.File.Exists(s) && System.IO.File.Exists(Path.Combine(Path.Combine(programDir, "runtime"), "node.exe")) ? s : null;
        }

        /// <summary>WP-12 + DEP-001: a platform backup of the data folder (database image, every file, SHA-256 manifest), kind pre-update, made and
        /// then verified by restoring it into a scratch folder - by the installed version's own tool, or the new one's when the installed version
        /// predates it. Returns the archive, or null (the reason is logged). `skipped` is true when there is no database yet.</summary>
        public static string PreUpdateBackup(Settings cfg, string installedDir, string newDir, out bool skipped)
        {
            skipped = false;
            string ws = cfg.WorkspaceDir;
            if (!System.IO.File.Exists(Path.Combine(ws, "publisher.db"))) { Log("no database in " + ws + " yet: nothing to back up"); skipped = true; return null; }
            string dir = BackupScript(installedDir) != null ? installedDir : (newDir != null && BackupScript(newDir) != null ? newDir : null);
            if (dir == null) { Log("neither the installed version nor the new one has the backup tool (app\\backend\\scripts\\agastya-backup.js)"); return null; }
            Log("pre-update backup of " + ws + " with the backup tool of " + (dir == installedDir ? "the installed version" : "the new version"));
            string o;
            int rc = RunNode(dir, "\"" + BackupScript(dir) + "\" backup --workspace \"" + ws + "\" --kind pre-update", null, 4 * 3600 * 1000, out o);
            Log(o);
            Match m = Regex.Match(o ?? "", @"Backup written: (.+)");
            if (rc != 0 || !m.Success) { Log("the pre-update backup failed (exit " + rc + ")"); return null; }
            string archive = m.Groups[1].Value.Trim();
            rc = RunNode(dir, "\"" + BackupScript(dir) + "\" verify \"" + archive + "\"", null, 4 * 3600 * 1000, out o);
            Log(o);
            if (rc != 0) { Log("the pre-update backup does not verify (exit " + rc + "); it is kept for inspection: " + archive); return null; }
            Log("pre-update backup written and verified: " + archive);
            return archive;
        }

        private static readonly string[] DbFiles = new string[] { "publisher.db", "publisher.db-wal", "publisher.db-shm" };

        /// <summary>With the server stopped: the database files as they are, for an automatic rollback (the full backup is the safety net).</summary>
        public static string CopyDatabase(Settings cfg, string label)
        {
            string ws = cfg.WorkspaceDir;
            if (!System.IO.File.Exists(Path.Combine(ws, "publisher.db"))) return null;
            string dest = Path.Combine(Path.Combine(ws, "backups"), "update-" + label + "-" + DateTime.Now.ToString("yyyyMMdd-HHmmss"));
            Directory.CreateDirectory(dest);
            StringBuilder sums = new StringBuilder();
            foreach (string n in DbFiles)
            {
                string src = Path.Combine(ws, n);
                if (!System.IO.File.Exists(src)) continue;
                System.IO.File.Copy(src, Path.Combine(dest, n), false);
                string a = Hash.File(src), b = Hash.File(Path.Combine(dest, n));
                if (a != b) throw new IOException("the copy of " + n + " differs from the original");
                sums.AppendLine(a + " " + n);
            }
            System.IO.File.WriteAllText(Path.Combine(dest, "SHA256SUMS.txt"), sums.ToString());
            Log("database copy for a rollback: " + dest);
            return dest;
        }

        /// <summary>Put a database copy back. What is there now is moved aside (never deleted) when `keepAside` names a folder.</summary>
        public static void RestoreDatabase(Settings cfg, string copy, string keepAside)
        {
            string ws = cfg.WorkspaceDir;
            if (keepAside != null)
            {
                Directory.CreateDirectory(keepAside);
                foreach (string n in DbFiles) { string f = Path.Combine(ws, n); if (System.IO.File.Exists(f)) System.IO.File.Copy(f, Path.Combine(keepAside, n), true); }
                Log("the database as it was is kept in " + keepAside);
            }
            foreach (string n in DbFiles) { string f = Path.Combine(ws, n); if (System.IO.File.Exists(f)) System.IO.File.Delete(f); }
            foreach (string n in DbFiles) { string f = Path.Combine(copy, n); if (System.IO.File.Exists(f)) System.IO.File.Copy(f, Path.Combine(ws, n), false); }
            Log("database restored from " + copy);
        }

        private static bool DatabaseUnchanged(Settings cfg, string copy)
        {
            foreach (string n in DbFiles)
            {
                string a = Path.Combine(cfg.WorkspaceDir, n), b = Path.Combine(copy, n);
                if (System.IO.File.Exists(a) != System.IO.File.Exists(b)) return false;
                if (System.IO.File.Exists(a) && Hash.File(a) != Hash.File(b)) return false;
            }
            return true;
        }

        // ---- layouts ----------------------------------------------------------------------------------------------------------
        private static readonly Regex NotProgram = new Regex(@"^(state\.dir|portable\.flag|current|previous|update-history\.txt|unins\d{3}\.(exe|dat|msg)|config|data|logs|versions|.*\.old-\d+|.*\.tmp)$", RegexOptions.IgnoreCase);

        /// <summary>An installation made before WP-25 keeps its program beside the launcher. Move it into versions\&lt;its version&gt;\ and point
        /// "current" at it, so it becomes the version a rollback returns to. The launcher programs stay where they are (copied, not moved).</summary>
        public static int AdoptFlat()
        {
            if (Layout.CurrentVersion != null) return 0;
            if (Layout.Portable) { Log("a portable copy is updated by unpacking the new portable ZIP, not by an update package"); return 1; }
            if (!Directory.Exists(Path.Combine(Layout.InstallDir, "app")) || !System.IO.File.Exists(Path.Combine(Path.Combine(Layout.InstallDir, "runtime"), "node.exe")))
            { Log("no installed program in " + Layout.InstallDir); return 1; }
            string v = Versions.VersionOf(Layout.InstallDir);
            string target = Path.Combine(Layout.VersionsDir, v);
            if (Directory.Exists(target)) target = Path.Combine(Layout.VersionsDir, v + "-adopted");
            if (!Versions.ValidName(Path.GetFileName(target)) || Directory.Exists(target)) { Log("cannot adopt the installed program: " + target + " exists"); return 1; }
            Directory.CreateDirectory(target);
            foreach (string d in Directory.GetDirectories(Layout.InstallDir))
            {
                string n = Path.GetFileName(d);
                if (NotProgram.IsMatch(n)) continue;
                Directory.Move(d, Path.Combine(target, n));
            }
            foreach (string f in Directory.GetFiles(Layout.InstallDir))
            {
                string n = Path.GetFileName(f);
                if (NotProgram.IsMatch(n)) continue;
                if (Array.IndexOf(Versions.LauncherFiles, n) >= 0) System.IO.File.Copy(f, Path.Combine(target, n));
                else System.IO.File.Move(f, Path.Combine(target, n));
            }
            Versions.WritePointer("current", Path.GetFileName(target));
            Layout.ResolveProgram();
            Log("the installed program (version " + v + ") was moved to " + target + "; it is the version a rollback returns to");
            return 0;
        }

        // ---- commands -----------------------------------------------------------------------------------------------------------
        public static int VerifyOnly(Settings cfg, string file, bool allowUnsigned)
        {
            if (string.IsNullOrEmpty(file) || !System.IO.File.Exists(file)) { Console.Error.WriteLine("No such package: " + file); return 2; }
            UpdatePackage pkg = new UpdatePackage(); pkg.File = Path.GetFullPath(file);
            string installed = Versions.VersionOf(Layout.ExeDir);
            string why; int rc = pkg.Verify(cfg, installed, Layout.ExeDir, allowUnsigned, out why);
            if (rc != 0) { Console.WriteLine("REFUSED: " + why); return rc; }
            long need = pkg.PayloadBytes + (256L << 20);
            long free = FreeBytes(Layout.InstallDir);
            Console.WriteLine("OK: version " + pkg.Version + " (from " + installed + "), " + pkg.PayloadFiles + " files, " + (pkg.PayloadBytes / 1048576.0).ToString("0") + " MB, "
                + (pkg.Signed ? "signed by " + pkg.Signer + " (" + pkg.Thumbprint + ")" : "UNSIGNED (accepted with --allow-unsigned)"));
            if (free >= 0 && free < need) { Console.WriteLine("REFUSED: " + (free / 1048576) + " MB free beside the program, " + (need / 1048576) + " MB needed"); return 12; }
            return 0;
        }

        private static long FreeBytes(string dir) { try { return new DriveInfo(Path.GetPathRoot(Path.GetFullPath(dir))).AvailableFreeSpace; } catch { return -1; } }
        private static long FolderBytes(string dir)
        {
            long n = 0;
            try { foreach (string f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories)) { try { n += new FileInfo(f).Length; } catch { } } } catch { }
            return n;
        }

        public static int Apply(Settings cfg, string file, bool allowUnsigned)
        {
            if (string.IsNullOrEmpty(file) || !System.IO.File.Exists(file)) { Console.Error.WriteLine("No such package: " + file); return 2; }
            string logFile = OpenLog("update");
            Log("Agastya Platform update: " + Path.GetFullPath(file) + " (log " + logFile + ")");
            if (Layout.Portable) { Log("REFUSED: a portable copy is updated by unpacking the new portable ZIP"); return 1; }
            try { string t = Path.Combine(Layout.InstallDir, ".write-test-" + Guid.NewGuid().ToString("N")); System.IO.File.WriteAllText(t, "x"); System.IO.File.Delete(t); }
            catch (Exception e) { Log("REFUSED: the program folder " + Layout.InstallDir + " is not writable (" + e.Message + "); run from an elevated (Administrator) prompt"); return 1; }

            // 1. verify everything that can be verified without writing
            UpdatePackage pkg = new UpdatePackage(); pkg.File = Path.GetFullPath(file);
            string from = Versions.VersionOf(Layout.ExeDir);
            string why; int rc = pkg.Verify(cfg, from, Layout.ExeDir, allowUnsigned, out why);
            if (rc != 0) { Log("REFUSED: " + why); History(from, pkg.Get("version") ?? "?", "refused", null, null); return rc; }
            string to = pkg.Version;
            Log("package verified: version " + to + " (installed " + from + "), " + pkg.PayloadFiles + " files, " + (pkg.Signed ? "signed by " + pkg.Signer + " (" + pkg.Thumbprint + ")" : "UNSIGNED, accepted with --allow-unsigned"));
            long needProgram = pkg.PayloadBytes + (256L << 20), freeProgram = FreeBytes(Layout.InstallDir);
            long needData = FolderBytes(cfg.WorkspaceDir) + (256L << 20), freeData = FreeBytes(cfg.WorkspaceDir);
            if (freeProgram >= 0 && freeProgram < needProgram) { Log("REFUSED: " + (freeProgram >> 20) + " MB free beside the program, " + (needProgram >> 20) + " MB needed"); return 12; }
            if (freeData >= 0 && freeData < needData) { Log("REFUSED: " + (freeData >> 20) + " MB free on the data drive, " + (needData >> 20) + " MB needed for the pre-update backup"); return 12; }

            // 2. the new program folder, written and checked again on disk (the running version is untouched)
            if (AdoptFlat() != 0 && Layout.CurrentVersion == null) return 1;
            from = Layout.CurrentVersion;
            string fromDir = Layout.ExeDir;
            string target = Path.Combine(Layout.VersionsDir, to), staging = target + ".partial";
            try
            {
                Versions.DeleteTree(staging);
                if (Directory.Exists(target)) { Log("an earlier copy of " + to + " (not current) is replaced"); Versions.DeleteTree(target); }
                pkg.Extract(staging);
                IntegrityResult ir = Integrity.Check(staging, true);
                if (!ir.FilesOk) throw new InvalidDataException("the extracted files do not match the manifest: " + ir.FilesLine());
                if (pkg.Signed)
                {
                    string exe = Path.Combine(staging, "AgastyaCtl.exe");
                    string ac = WinTrust.Describe(exe);
                    if (ac.StartsWith("TAMPERED") || ac == "not signed" || DetachedSig.AuthenticodeThumbprint(exe) != pkg.Thumbprint)
                        throw new InvalidDataException("the new AgastyaCtl.exe is not Authenticode-signed by the package's signer (" + ac + ")");
                }
                Directory.Move(staging, target);
                Log("version " + to + " written to " + target);
            }
            catch (Exception e)
            {
                try { Versions.DeleteTree(staging); } catch { }
                Log("FAILED before anything changed: " + e.Message);
                return e is InvalidDataException ? 10 : 1;
            }

            // 3. stop, back up (abort on failure), keep a database copy for the rollback
            Running was;
            if (!StopEverything(cfg, 90, out was)) { Versions.DeleteTree(target); Restore(cfg, was); History(from, to, "server-not-stopped", null, null); return 13; }
            bool noDb;
            string backup = PreUpdateBackup(cfg, fromDir, target, out noDb);
            string dbCopy = null;
            if (backup == null && !noDb) { Versions.DeleteTree(target); Restore(cfg, was); History(from, to, "backup-failed", null, null); Log("nothing was changed"); return 14; }
            try { dbCopy = CopyDatabase(cfg, from + "-to-" + to); }
            catch (Exception e) { Versions.DeleteTree(target); Restore(cfg, was); Log("FAILED: the database copy for a rollback could not be made: " + e.Message + "; nothing was changed"); return 14; }

            // 4. switch
            string oldPrevious = Versions.ReadPointer("previous");
            try
            {
                Versions.WritePointer("previous", from);
                Versions.WritePointer("current", to);
                Layout.ResolveProgram();
                Versions.RefreshLauncher(Log);
                Log("switched: current = " + to + ", previous = " + from);
            }
            catch (Exception e)
            {
                Log("FAILED to switch: " + e.Message + "; going back");
                return RollBack(cfg, from, to, oldPrevious, dbCopy, was, null, false);
            }

            // 5. health check of the new version, then the state the computer was in
            Supervisor sup; string detail;
            if (StartAndCheck(cfg, to, was.Service, cfg.HealthSeconds, out sup, out detail))
            {
                if (!was.Service) StopChecked(cfg, sup, false);
                Restore(cfg, new Running { Tray = was.Tray });
                History(from, to, "updated", backup, dbCopy); Versions.SyncUninstallEntry(Log);
                RunWebView2Redist(target);
                Versions.Prune(cfg.KeepVersions, Log);
                Log("UPDATED to " + to + ". The previous version " + from + " is kept: AgastyaCtl.exe --rollback goes back to it.");
                return 0;
            }
            return RollBack(cfg, from, to, oldPrevious, dbCopy, was, sup, true);
        }

        private static int RollBack(Settings cfg, string from, string to, string oldPrevious, string dbCopy, Running was, Supervisor sup, bool started)
        {
            Log("ROLLING BACK to " + from);
            bool ok = true;
            try { if (started) StopChecked(cfg, sup, was.Service); } catch (Exception e) { ok = false; Log("could not stop version " + to + ": " + e.Message); }
            try
            {
                Versions.WritePointer("current", from);
                Versions.WritePointer("previous", oldPrevious);
                Layout.ResolveProgram();
                Versions.RefreshLauncher(Log);
            }
            catch (Exception e) { ok = false; Log("could not switch back: " + e.Message); }
            if (dbCopy != null)
            {
                try
                {
                    if (DatabaseUnchanged(cfg, dbCopy)) Log("the database was not changed by " + to);
                    else RestoreDatabase(cfg, dbCopy, Path.Combine(Path.Combine(cfg.WorkspaceDir, "backups"), "failed-update-" + to + "-" + DateTime.Now.ToString("yyyyMMdd-HHmmss")));
                }
                catch (Exception e) { ok = false; Log("could not restore the database copy " + dbCopy + ": " + e.Message); }
            }
            try { Versions.DeleteTree(Path.Combine(Layout.VersionsDir, to)); Log("removed the program folder of " + to); } catch (Exception e) { Log("could not remove " + to + ": " + e.Message + " (removed at the next update)"); }
            Supervisor s2 = null; string d2;
            bool healthy = ok && StartAndCheck(cfg, from, was.Service, cfg.HealthSeconds, out s2, out d2);
            if (healthy && !was.Service) StopChecked(cfg, s2, false);
            if (healthy) Restore(cfg, new Running { Tray = was.Tray });
            History(from, to, healthy ? "rolled-back" : "rollback-failed", null, dbCopy); Versions.SyncUninstallEntry(Log);
            if (healthy) { Log("ROLLED BACK: version " + from + " runs again with the database as it was before the update. The update was not applied."); return 20; }
            Log("ROLLBACK FAILED: the computer needs attention. The pre-update backup is in " + Path.Combine(Path.Combine(cfg.WorkspaceDir, "backups"), "platform")
                + "; the database copy in " + (dbCopy ?? "(none)") + ". Run AgastyaCtl.exe --doctor and see OPERATIONS.md, \"Updates\".");
            return 21;
        }

        private static void RunWebView2Redist(string programDir)
        {
            string redist = Path.Combine(Path.Combine(programDir, "redist"), "MicrosoftEdgeWebView2RuntimeInstallerX64.exe");
            if (!System.IO.File.Exists(redist)) return;
            try
            {
                Log("refreshing the WebView2 runtime from " + redist + " (installed: " + (Shell.WebView2Version() ?? "none") + ")");
                using (Process p = Process.Start(new ProcessStartInfo(redist, "/silent /install") { UseShellExecute = false, CreateNoWindow = true }))
                {
                    if (!p.WaitForExit(15 * 60 * 1000)) { Log("the WebView2 installer did not finish in 15 minutes; left running"); return; }
                    Log("WebView2 installer exit code " + p.ExitCode + "; runtime now " + (Shell.WebView2Version() ?? "none"));
                }
            }
            catch (Exception e) { Log("the WebView2 installer could not run: " + e.Message + " (the product keeps its browser fallback)"); }
        }

        /// <summary>AgastyaCtl --rollback [--restore-db]: back to the previous version in one command.</summary>
        public static int Rollback(Settings cfg, bool restoreDb)
        {
            string logFile = OpenLog("rollback");
            string cur = Layout.CurrentVersion, prev = Versions.ReadPointer("previous");
            Log("Agastya Platform rollback (log " + logFile + ")");
            if (cur == null) { Log("this installation has no version folders (installed before WP-25, or portable): reinstall the earlier Setup instead"); return 1; }
            if (prev == null || !Directory.Exists(Path.Combine(Layout.VersionsDir, prev))) { Log("no earlier version is kept (AgastyaCtl.exe --versions)"); return 1; }
            string dbCopy = restoreDb ? DbCopyFor(cur) : null;
            if (restoreDb && dbCopy == null) { Log("no database copy is recorded for the update to " + cur + "; restore a platform backup instead (OPERATIONS.md)"); return 1; }
            Running was;
            if (!StopEverything(cfg, 90, out was)) return 13;
            string safety = null;
            if (restoreDb)
            {
                safety = Path.Combine(Path.Combine(cfg.WorkspaceDir, "backups"), "rolled-back-from-" + cur + "-" + DateTime.Now.ToString("yyyyMMdd-HHmmss"));
                RestoreDatabase(cfg, dbCopy, safety);
            }
            Versions.WritePointer("current", prev);
            Versions.WritePointer("previous", cur);
            Layout.ResolveProgram();
            Versions.RefreshLauncher(Log);
            Supervisor sup; string detail;
            if (StartAndCheck(cfg, prev, was.Service, cfg.HealthSeconds, out sup, out detail))
            {
                if (!was.Service) StopChecked(cfg, sup, false);
                Restore(cfg, new Running { Tray = was.Tray });
                History(cur, prev, "manual-rollback", null, dbCopy); Versions.SyncUninstallEntry(Log);
                Log("ROLLED BACK to " + prev + (restoreDb ? "; the database is the copy taken before the update to " + cur + " (the newer one is kept in " + safety + ")" : "") + ". --rollback again returns to " + cur + ".");
                return 0;
            }
            // the previous version does not run on this database (a newer schema): back to where we were
            Log("version " + prev + " does not run here (" + detail + "); returning to " + cur);
            StopChecked(cfg, sup, was.Service);
            if (restoreDb && safety != null) RestoreDatabase(cfg, safety, null);
            Versions.WritePointer("current", cur); Versions.WritePointer("previous", prev);
            Layout.ResolveProgram(); Versions.RefreshLauncher(Log);
            Supervisor s2 = null; string d2;
            if (StartAndCheck(cfg, cur, was.Service, cfg.HealthSeconds, out s2, out d2)) { if (!was.Service) StopChecked(cfg, s2, false); Restore(cfg, new Running { Tray = was.Tray }); }
            Log(restoreDb ? "the rollback did not work; nothing was changed" :
                "the database was changed by version " + cur + ". AgastyaCtl.exe --rollback --restore-db goes back to the database copy taken before that update (later changes are kept aside, not deleted).");
            return 22;
        }

        public static int ListVersions()
        {
            Console.WriteLine("installation  " + Layout.InstallDir);
            if (Layout.CurrentVersion == null) { Console.WriteLine("layout        flat (one program folder; installed before WP-25, portable, or a development tree): version " + Versions.VersionOf(Layout.ExeDir)); return 0; }
            string prev = Versions.ReadPointer("previous");
            foreach (string v in Versions.Installed())
                Console.WriteLine((v == Layout.CurrentVersion ? "* " : "  ") + v + (v == Layout.CurrentVersion ? "  (current)" : v == prev ? "  (previous: --rollback returns to it)" : ""));
            return 0;
        }

        /// <summary>Setup, before it copies files: stop, a verified pre-update backup (Setup stops when it fails), and the move of a flat
        /// installation into its version folder. Run as the NEW AgastyaCtl.exe with --install-dir.</summary>
        public static int PrepareUpgrade(Settings cfg, string label)
        {
            if (!System.IO.File.Exists(Path.Combine(Layout.InstallDir, "AgastyaCtl.exe")) && Layout.CurrentVersion == null) { Console.WriteLine("first installation: nothing to prepare"); return 0; }
            string logFile = OpenLog("setup-upgrade");
            Log("Setup is upgrading " + Layout.InstallDir + " (installed " + Versions.VersionOf(Layout.ExeDir) + ", to " + (label ?? "?") + "; log " + logFile + ")");
            Running was;
            if (!StopEverything(cfg, 90, out was)) return 13;
            bool noDb;
            string backup = PreUpdateBackup(cfg, Layout.ExeDir, null, out noDb);
            if (backup == null && !noDb)
            {
                if (BackupScript(Layout.ExeDir) != null) { Restore(cfg, was); Log("Setup stops: no verified backup, nothing was changed"); return 14; }
                // the installed version predates the backup tool (2.0.0): a copy of the stopped database is the only safety net it can give
                try { if (CopyDatabase(cfg, "setup-from-" + Versions.VersionOf(Layout.ExeDir)) == null) { Restore(cfg, was); return 14; } }
                catch (Exception e) { Log("the database copy failed: " + e.Message); Restore(cfg, was); return 14; }
                Log("the installed version has no platform backup tool: the stopped database was copied instead (make a platform backup after the upgrade)");
            }
            if (Layout.CurrentVersion == null && AdoptFlat() != 0) { Restore(cfg, was); return 1; }
            return 0;
        }

        /// <summary>Setup, after it copied versions\&lt;version&gt;\: point "current" at it (the version it replaces becomes "previous"), refresh the
        /// launcher, remove versions beyond KeepVersions.</summary>
        public static int Activate(Settings cfg, string version)
        {
            if (!Versions.ValidName(version) || !Directory.Exists(Path.Combine(Layout.VersionsDir, version))) { Console.Error.WriteLine("no program folder for version " + version); return 1; }
            OpenLog("setup-activate");
            string cur = Versions.ReadPointer("current");
            if (cur != null && cur != version) { Versions.WritePointer("previous", cur); History(cur, version, "updated", null, null); }
            Versions.WritePointer("current", version);
            Layout.ResolveProgram();
            Versions.RefreshLauncher(Log);
            Versions.Prune(cfg.KeepVersions, Log);
            Log("version " + version + " is current" + (cur != null && cur != version ? "; previous " + cur + " (AgastyaCtl.exe --rollback)" : ""));
            return 0;
        }

        /// <summary>The unattended first administrator: the password is read from a file and handed to the server's tool on standard input.</summary>
        public static int FirstAdmin(Settings cfg, string user, string passwordFile)
        {
            if (string.IsNullOrEmpty(user) || user.StartsWith("-")) { Console.Error.WriteLine("Usage: AgastyaCtl.exe --first-admin <username> --password-file <file>"); return 2; }
            if (string.IsNullOrEmpty(passwordFile) || !System.IO.File.Exists(passwordFile)) { Console.Error.WriteLine("--password-file: no such file " + passwordFile); return 2; }
            string script = Path.Combine(Path.Combine(Path.Combine(Layout.AppDir, "backend"), "scripts"), "first-admin.js");
            if (!System.IO.File.Exists(script) || !System.IO.File.Exists(Layout.NodeExe)) { Console.Error.WriteLine("The installation is incomplete: " + script); return 1; }
            string pw;
            using (StreamReader r = new StreamReader(passwordFile, Encoding.UTF8, true)) pw = r.ReadLine() ?? "";
            if (pw.Length == 0) { Console.Error.WriteLine("The password file is empty."); return 1; }
            string o;
            int rc = RunNode(Layout.ExeDir, "\"" + script + "\" \"" + user.Replace("\"", "") + "\" --workspace \"" + cfg.WorkspaceDir + "\"", pw + "\n", 300000, out o);
            Console.WriteLine(o);
            Host.Info("first-admin for " + user + " finished with code " + rc);
            return rc;
        }

        /// <summary>Phase 3 P3-6: the standalone installation's default accounts, made by Setup before the first start so its finish page shows the
        /// credentials that really exist (scripts/default-accounts.js; the same step the server takes at its first start). Exit 0 = created now,
        /// 3 = nothing to do (an upgrade, or a data folder that already has accounts), 1 = refused or failed. No password is printed or written.</summary>
        public static int DefaultAccounts(Settings cfg)
        {
            if (cfg.Deployment != "standalone") { Console.Error.WriteLine("agastya.ini [server] Deployment is not standalone: a common server gets no default accounts."); return 3; }
            string script = Path.Combine(Path.Combine(Path.Combine(Layout.AppDir, "backend"), "scripts"), "default-accounts.js");
            if (!System.IO.File.Exists(script) || !System.IO.File.Exists(Layout.NodeExe)) { Console.Error.WriteLine("The installation is incomplete: " + script); return 1; }
            string o;
            int rc = RunNode(Layout.ExeDir, "\"" + script + "\" --workspace \"" + cfg.WorkspaceDir + "\"", null, 300000, out o);
            Console.WriteLine(o);
            Host.Info("default-accounts finished with code " + rc);
            return rc;
        }

        /// <summary>The uninstaller's "remove my data too" (/PURGEDATA): the data folder and the configuration/log folder, after checks that they
        /// are this product's folders. Never runs without --confirm.</summary>
        public static int RemoveData(Settings cfg, bool confirm)
        {
            if (!confirm) { Console.Error.WriteLine("--remove-data deletes every project and the database. Add --confirm."); return 2; }
            string ws = Path.GetFullPath(cfg.WorkspaceDir).TrimEnd('\\'), state = Path.GetFullPath(Layout.StateDir).TrimEnd('\\');
            string inst = Path.GetFullPath(Layout.InstallDir).TrimEnd('\\');
            foreach (string d in new string[] { ws, state })
            {
                string why = UnsafeToDelete(d, inst);
                if (why != null) { Console.Error.WriteLine("Not removed: " + d + " (" + why + ")"); return 1; }
            }
            if (Probe.Alive(cfg.Port) || LockHeld(ws)) { Console.Error.WriteLine("A server still uses " + ws + "; stop it first."); return 13; }
            if (Directory.Exists(ws) && !System.IO.File.Exists(Path.Combine(ws, "publisher.db")) && !System.IO.File.Exists(Path.Combine(ws, "workspace.json")) && Directory.GetFileSystemEntries(ws).Length > 0)
            { Console.Error.WriteLine("Not removed: " + ws + " does not look like an Agastya Platform data folder"); return 1; }
            Host.HostLog = null;   // nothing may write into the folders being removed
            if (Directory.Exists(ws)) Versions.DeleteTree(ws);
            if (Directory.Exists(state)) Versions.DeleteTree(state);
            Console.WriteLine("Removed " + ws + (state != ws ? " and " + state : ""));
            return 0;
        }

        private static string UnsafeToDelete(string d, string inst)
        {
            if (d.Length <= 3) return "a drive root";
            foreach (Environment.SpecialFolder sf in new Environment.SpecialFolder[] { Environment.SpecialFolder.Windows, Environment.SpecialFolder.UserProfile, Environment.SpecialFolder.ProgramFiles,
                Environment.SpecialFolder.ProgramFilesX86, Environment.SpecialFolder.CommonApplicationData, Environment.SpecialFolder.LocalApplicationData, Environment.SpecialFolder.ApplicationData,
                Environment.SpecialFolder.Desktop, Environment.SpecialFolder.MyDocuments, Environment.SpecialFolder.System })
            {
                string p = Environment.GetFolderPath(sf);
                if (!string.IsNullOrEmpty(p) && string.Equals(p.TrimEnd('\\'), d, StringComparison.OrdinalIgnoreCase)) return "a system or profile folder";
            }
            if (inst.StartsWith(d + "\\", StringComparison.OrdinalIgnoreCase) || string.Equals(inst, d, StringComparison.OrdinalIgnoreCase)) return "it holds the program";
            return null;
        }
    }
}
