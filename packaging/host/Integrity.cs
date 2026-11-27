// =============================================================================
// Agastya Platform - integrity of the program files (audit WP-24: DEP-013, DEP-003, RES-005).
//
// The packager writes MANIFEST.sha256 (SHA-256 and size of every shipped file) into the program folder and, in a signed build, MANIFEST.sha256.sig:
// a detached signature over it made with the certificate that Authenticode-signs AgastyaCtl.exe (formats: scripts/release/lib.mjs).
//
//   AgastyaCtl.exe --verify            every file hashed; exit 0 only when all match, nothing unlisted, and the signature holds
//   AgastyaCtl.exe --doctor [--deep]   a quick check (sizes of every file, hashes of the executables, the runtime and the server code) or, with
//                                      --deep, the full one, as one row of the self-check
//   at every start of the server        the quick check runs in the background and is only logged (host log + Windows Event Log warning):
//                                      a modified installation is reported, never blocked, so an air-gapped site keeps working while
//                                      support looks at it (decision recorded in docs/audit/IMPLEMENTATION-LOG.md, WP-24)
//
// What the signature proves: the manifest was signed by the holder of that certificate's key, and the certificate is the one whose Authenticode
// signature AgastyaCtl.exe carries; whether Windows trusts it (an internal root pushed by policy) is reported alongside, checked offline.
// =============================================================================

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace Agastya
{
    internal sealed class IntegrityResult
    {
        public bool ManifestPresent;
        public string Error;
        public string Version = "", Commit = "";
        public int Checked;
        public bool Deep;
        public List<string> Missing = new List<string>();
        public List<string> Changed = new List<string>();
        public List<string> Extra = new List<string>();
        public bool SignaturePresent, SignatureValid;
        public string SignatureProblem, Signer, Thumbprint;
        public string ExeSignature;        // Authenticode state of this program, from WinVerifyTrust (offline)
        public string ExeSignerThumbprint;
        public bool SignerMatchesExe;

        public bool FilesOk { get { return ManifestPresent && Error == null && Missing.Count == 0 && Changed.Count == 0 && Extra.Count == 0; } }
        /// <summary>No tampering seen: files match, and a present signature holds and matches the program's own signer.</summary>
        public bool Ok { get { return FilesOk && (!SignaturePresent || (SignatureValid && SignerMatchesExe)); } }

        private static string Few(List<string> l) { return string.Join(", ", l.GetRange(0, Math.Min(5, l.Count)).ToArray()) + (l.Count > 5 ? " (+" + (l.Count - 5) + ")" : ""); }

        public string FilesLine()
        {
            if (!ManifestPresent) return "MANIFEST.sha256 is missing: the program files cannot be checked (a development build, or the file was removed)";
            if (Error != null) return "MANIFEST.sha256 cannot be read: " + Error;
            if (FilesOk) return Checked + " program files match MANIFEST.sha256 (" + (Deep ? "every file hashed" : "sizes, and the hashes of the executables and server code") + "; version " + Version + ")";
            List<string> p = new List<string>();
            if (Missing.Count > 0) p.Add("missing: " + Few(Missing));
            if (Changed.Count > 0) p.Add("changed: " + Few(Changed));
            if (Extra.Count > 0) p.Add("not part of the product: " + Few(Extra));
            return "program files differ from MANIFEST.sha256 - " + string.Join("; ", p.ToArray()) + ". Repair the installation (run the same Setup again)";
        }

        public string SignatureLine()
        {
            if (!SignaturePresent) return "MANIFEST.sha256 is not signed (unsigned build)";
            if (!SignatureValid) return "MANIFEST.sha256.sig does not hold: " + SignatureProblem;
            if (!SignerMatchesExe) return "MANIFEST.sha256 is signed by " + Signer + " (" + Thumbprint + "), but AgastyaCtl.exe is " + (ExeSignerThumbprint == null ? "not signed by it" : "signed by " + ExeSignerThumbprint);
            return "MANIFEST.sha256 signed by " + Signer + " (" + Thumbprint + "), the signer of this program; Authenticode: " + ExeSignature;
        }
    }

    internal static class Integrity
    {
        public const string ManifestName = "MANIFEST.sha256";
        // what the installation itself writes next to the program (never in the manifest, never "extra") - same list as scripts/release/lib.mjs
        private static readonly Regex RuntimeOwned = new Regex(@"^(MANIFEST\.sha256(\.sig)?|portable\.flag|state\.dir|unins\d{3}\.(exe|dat|msg))$|^(config|data|logs)/", RegexOptions.IgnoreCase);
        // the quick check hashes these (everything else: size only): the executables, the runtime, the server and client code
        private static readonly Regex AlwaysHash = new Regex(@"^[^/]+\.exe$|^runtime/|^app/backend/(dist|scripts)/|^app/backend/package\.json$|^app/frontend/dist/index\.html$", RegexOptions.IgnoreCase);

        public static IntegrityResult Check(string root, bool deep)
        {
            IntegrityResult r = new IntegrityResult(); r.Deep = deep;
            string mf = Path.Combine(root, ManifestName);
            if (!File.Exists(mf)) return r;
            r.ManifestPresent = true;
            byte[] manifestBytes = File.ReadAllBytes(mf);
            Dictionary<string, bool> listed = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
            try
            {
                string[] lines = new UTF8Encoding(false).GetString(manifestBytes).Split('\n');
                if (lines.Length == 0 || lines[0] != "# agastya-manifest/1") throw new InvalidDataException("not an agastya-manifest/1 file");
                using (SHA256 sha = SHA256.Create())
                {
                    foreach (string line in lines)
                    {
                        if (line.Length == 0) continue;
                        if (line.StartsWith("# version: ")) { r.Version = line.Substring(11); continue; }
                        if (line.StartsWith("# commit: ")) { r.Commit = line.Substring(10); continue; }
                        if (line[0] == '#') continue;
                        int a = line.IndexOf(' '), b = a < 0 ? -1 : line.IndexOf(' ', a + 1);
                        if (a != 64 || b < 0) throw new InvalidDataException("malformed line: " + (line.Length > 80 ? line.Substring(0, 80) : line));
                        string hash = line.Substring(0, 64); long size = long.Parse(line.Substring(a + 1, b - a - 1)); string rel = line.Substring(b + 1);
                        listed[rel] = true; r.Checked++;
                        string p = Path.Combine(root, rel.Replace('/', '\\'));
                        FileInfo fi = new FileInfo(p);
                        if (!fi.Exists) { r.Missing.Add(rel); continue; }
                        if (fi.Length != size) { r.Changed.Add(rel); continue; }
                        if (deep || AlwaysHash.IsMatch(rel)) { if (!string.Equals(Hex(HashFile(sha, p)), hash, StringComparison.Ordinal)) r.Changed.Add(rel); }
                    }
                }
                // files that are not part of the product: everywhere with --deep; in the quick check where a planted DLL would be loaded first
                // (beside the executables and the runtime)
                foreach (string f in deep ? Directory.GetFiles(root, "*", SearchOption.AllDirectories) : Concat(Directory.GetFiles(root), SafeFiles(Path.Combine(root, "runtime"))))
                {
                    string rel = f.Substring(root.TrimEnd('\\').Length + 1).Replace('\\', '/');
                    if (!listed.ContainsKey(rel) && !RuntimeOwned.IsMatch(rel)) r.Extra.Add(rel);
                }
            }
            catch (Exception e) { r.Error = e.Message; }
            CheckSignature(root, manifestBytes, r);
            return r;
        }

        private static string[] SafeFiles(string dir) { return Directory.Exists(dir) ? Directory.GetFiles(dir, "*", SearchOption.AllDirectories) : new string[0]; }
        private static string[] Concat(string[] a, string[] b) { string[] c = new string[a.Length + b.Length]; a.CopyTo(c, 0); b.CopyTo(c, a.Length); return c; }
        private static byte[] HashFile(SHA256 sha, string p) { using (FileStream s = new FileStream(p, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1 << 20)) return sha.ComputeHash(s); }
        private static string Hex(byte[] b) { StringBuilder sb = new StringBuilder(b.Length * 2); foreach (byte x in b) sb.Append(x.ToString("x2")); return sb.ToString(); }

        private static void CheckSignature(string root, byte[] manifestBytes, IntegrityResult r)
        {
            string exe = Path.Combine(root, "AgastyaCtl.exe");
            if (!File.Exists(exe)) exe = System.Reflection.Assembly.GetExecutingAssembly().Location;
            r.ExeSignature = WinTrust.Describe(exe);
            try { r.ExeSignerThumbprint = new X509Certificate2(X509Certificate.CreateFromSignedFile(exe)).Thumbprint.ToUpperInvariant(); } catch { r.ExeSignerThumbprint = null; }

            string sigFile = Path.Combine(root, ManifestName + ".sig");
            if (!File.Exists(sigFile)) return;
            r.SignaturePresent = true;
            try
            {
                // the format and the checks are shared with the update package (Update.cs, DetachedSig)
                string signer, thumbprint;
                string problem = DetachedSig.Verify(manifestBytes, File.ReadAllText(sigFile), ManifestName, out signer, out thumbprint);
                r.Signer = signer; r.Thumbprint = thumbprint;
                if (problem != null) { r.SignatureProblem = problem; return; }
                r.SignatureValid = true;
                r.SignerMatchesExe = r.ExeSignerThumbprint != null && r.ExeSignerThumbprint == r.Thumbprint && !r.ExeSignature.StartsWith("TAMPERED");
            }
            catch (Exception e) { r.SignatureProblem = e.Message; }
        }

        /// <summary>AgastyaCtl.exe --verify: the full check, printed; exit 0 = intact.</summary>
        public static int VerifyCommand(bool requireSigned)
        {
            Console.WriteLine("Agastya Platform " + Layout.Version + " - verifying the program files in " + Layout.ExeDir);
            IntegrityResult r = Check(Layout.ExeDir, true);
            Console.WriteLine((r.FilesOk ? "[ OK ] " : "[FAIL] ") + r.FilesLine());
            bool sigBad = r.SignaturePresent ? !(r.SignatureValid && r.SignerMatchesExe) : requireSigned;
            Console.WriteLine((sigBad ? "[FAIL] " : r.SignaturePresent ? "[ OK ] " : "[WARN] ") + r.SignatureLine());
            Console.WriteLine("       Authenticode of this program: " + r.ExeSignature);
            bool good = r.FilesOk && !sigBad;
            Host.Info("verify: " + (good ? "intact" : "NOT intact") + " - " + r.FilesLine() + " / " + r.SignatureLine());
            Console.WriteLine();
            Console.WriteLine(good ? "The installation is intact." : "The installation is NOT intact.");
            return good ? 0 : 1;
        }

        private static int started;
        /// <summary>Once per process, when the server is first started: the quick check in the background, logged only.</summary>
        public static void CheckAtStartInBackground()
        {
            if (Interlocked.Exchange(ref started, 1) == 1) return;
            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    Stopwatch sw = Stopwatch.StartNew();
                    IntegrityResult r = Check(Layout.ExeDir, false);
                    string msg = r.FilesLine() + " / " + r.SignatureLine() + " (" + sw.ElapsedMilliseconds + " ms)";
                    if (!r.ManifestPresent) Host.Info("integrity: " + msg);
                    else if (r.Ok) Host.Info("integrity: " + msg);
                    else
                    {
                        Host.Warn("integrity: " + msg);
                        Host.Event(EventLogEntryType.Warning, "Agastya Platform: the program files in " + Layout.ExeDir + " are not as shipped. " + msg + " Run AgastyaCtl.exe --verify.");
                    }
                }
                catch (Exception e) { Host.Warn("integrity check failed to run: " + e.Message); }
            });
        }
    }

    /// <summary>Authenticode state of a file through WinVerifyTrust, without any network access (revocation not checked, cache only).</summary>
    internal static class WinTrust
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct FileInfoW { public uint cbStruct; public string pcwszFilePath; public IntPtr hFile; public IntPtr pgKnownSubject; }
        [StructLayout(LayoutKind.Sequential)]
        private struct TrustData
        {
            public uint cbStruct; public IntPtr pPolicyCallbackData; public IntPtr pSIPClientData; public uint dwUIChoice; public uint fdwRevocationChecks;
            public uint dwUnionChoice; public IntPtr pFile; public uint dwStateAction; public IntPtr hWVTStateData; public IntPtr pwszURLReference;
            public uint dwProvFlags; public uint dwUIContext; public IntPtr pSignatureSettings;
        }
        [DllImport("wintrust.dll", CharSet = CharSet.Unicode)] private static extern int WinVerifyTrust(IntPtr hwnd, [MarshalAs(UnmanagedType.LPStruct)] Guid action, ref TrustData data);
        private static readonly Guid GenericVerifyV2 = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");

        public static string Describe(string file)
        {
            FileInfoW fi = new FileInfoW(); fi.cbStruct = (uint)Marshal.SizeOf(typeof(FileInfoW)); fi.pcwszFilePath = file;
            IntPtr pFi = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(FileInfoW)));
            try
            {
                Marshal.StructureToPtr(fi, pFi, false);
                TrustData d = new TrustData();
                d.cbStruct = (uint)Marshal.SizeOf(typeof(TrustData));
                d.dwUIChoice = 2;                 // WTD_UI_NONE
                d.fdwRevocationChecks = 0;        // WTD_REVOKE_NONE
                d.dwUnionChoice = 1;              // WTD_CHOICE_FILE
                d.pFile = pFi;
                d.dwStateAction = 0;              // WTD_STATEACTION_IGNORE
                d.dwProvFlags = 0x1000 | 0x80;    // WTD_CACHE_ONLY_URL_RETRIEVAL | WTD_REVOCATION_CHECK_NONE: never touch the network
                int hr = WinVerifyTrust(new IntPtr(-1), GenericVerifyV2, ref d);
                switch ((uint)hr)
                {
                    case 0: return "valid, trusted by Windows on this computer";
                    case 0x800B0100: return "not signed";
                    case 0x80096010: return "TAMPERED: the file was changed after it was signed";
                    case 0x800B0109: return "signed and intact; its root certificate is not trusted on this computer (push your root by policy, docs/SIGNING.md)";
                    case 0x800B0101: return "signed and intact; the certificate has expired and the signature has no time stamp";
                    case 0x800B010A: return "signed and intact; the certificate chain cannot be built offline here";
                    default: return "signature state 0x" + ((uint)hr).ToString("X8");
                }
            }
            catch (Exception e) { return "could not be checked: " + e.Message; }
            finally { Marshal.FreeHGlobal(pFi); }
        }
    }
}
