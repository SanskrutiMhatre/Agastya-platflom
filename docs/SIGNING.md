# Code signing, release integrity and offline verification

Agastya Platform ships as an installer (`Setup.exe`) and a portable ZIP. Both contain two executables of their own (`AgastyaPlatform.exe`,
`AgastyaCtl.exe`) and third-party programs (Node.js, a Java runtime, `xsltproc.exe` with its DLLs). **Signing** puts a cryptographic signature on
them so a PC can tell who built them and that nothing changed afterwards.

Since WP-24 (audit DEP-003, ENT-014, RES-005, DEP-013, DEP-026) a release carries four layers, all checkable with no network:

| Layer | What | Checked by |
|---|---|---|
| Authenticode | every `.exe`/`.dll`/`.node` of the product that its vendor left unsigned (the host executables, `xsltproc.exe` and its DLLs, the `argon2` module), `Setup.exe` and the uninstaller; vendor-signed files (`node.exe`, the JRE) keep their own signature | Windows itself, `Get-AuthenticodeSignature`, `scripts/signing/Test-Signature.ps1` |
| File manifest | `MANIFEST.sha256` inside the product: SHA-256 and size of every shipped file, with `MANIFEST.sha256.sig` made by the same certificate | `AgastyaCtl.exe --verify`, `--doctor` (quick) / `--doctor --deep`, at every start of the server (logged), `Verify-Release.ps1 -Tree` |
| Release checksums | `SHA256SUMS.txt` over Setup, the portable ZIP, the SBOM, `Verify-Release.ps1` and the detection script, with `SHA256SUMS.txt.sig` | `Verify-Release.ps1` (beside Setup), `node scripts/release/verify-release.mjs` |
| SBOM | `Agastya-Platform-<v>-win-x64-SBOM.cdx.json` (CycloneDX 1.5): every npm package, Node.js, the JRE, FOP and each jar, xsltproc and each DLL, fonts, XSD sets, with hashes; also inside the product as `SBOM.cdx.json` | `node scripts/release/sbom.mjs --check`, covered by the checksum signature |

Nothing in the product needs a signature to run. An unsigned development build gets the manifest and the checksums too (hashes only); a
**customer release** (`npm run package:win -- --release`) refuses to build unsigned, without a time stamp, from a tree with uncommitted changes, with
the placeholder publisher data, or without `docs/EULA.txt`, and fails unless the finished release verifies offline.

## 1. Which certificate

| Option | Cost | Who trusts it | Use it when |
|---|---|---|---|
| **Internal CA** - a root certificate you make, which issues the signing certificate | none | every PC you push the root to | your organisation manages the PCs (domain / Intune). **Recommended** for an air-gapped customer. |
| **Self-signed** - one certificate that is its own root | none | every PC you push that certificate to | a small group of PCs, or a trial. The same mechanism, one file fewer. |
| **Public code-signing certificate** (from a commercial CA) | paid, identity checks, key on hardware | all Windows PCs, no set-up | you distribute outside your own organisation |

**Public certificates since 1 March 2026** (CA/Browser Forum code-signing requirements, audit DEP-003): a publicly trusted code-signing certificate
is valid for at most **460 days**, and its private key must be generated and kept in **hardware** (a token, an HSM or a cloud signing service). A
`.pfx` file on a build machine is therefore only possible with an internal CA or a self-signed certificate. For a public certificate use the
**certificate-store mode** below (`AGASTYA_SIGN_THUMBPRINT`): the token's or HSM's provider exposes the key to Windows and `signtool` signs with it;
no key or password ever sits in a file.

You can make the first two yourself, offline, with `scripts/signing/New-SigningCertificate.ps1`. You cannot make a certificate that *strangers'* PCs
trust: that is what a public CA's identity checks are paid for. Which option the owner takes is decision **D4** of the roadmap (an owner task: there
is no certificate in the repository and none is made by the build).

## 2. Make the certificate (internal CA or self-signed)

In Windows PowerShell 5.1 (`powershell.exe`, not PowerShell 7), on a PC you trust, from the repository folder:

```
powershell -ExecutionPolicy Bypass -File scripts\signing\New-SigningCertificate.ps1 `
    -OutDir D:\signing -Subject "CN=<Your organisation>, O=<Your organisation>, C=IN" -Mode InternalCa -Years 3
```

* `-Mode InternalCa` writes `agastya-root-ca.pfx/.cer` (10 years) and `agastya-codesign.pfx/.cer` (signs the software, `-Years`).
  `-Mode SelfSigned` writes only `agastya-codesign.pfx/.cer`.
* The `.pfx` files contain **private keys**. Give them a password (`-PfxPassword`, or the `AGASTYA_PFX_PASSWORD` environment variable; if you give none,
  a random one is written to `PFX-PASSWORD.txt` - move it to your vault and delete it). Keep the root's `.pfx` offline. Never put either in the repository.
* The `.cer` files are public. These are the ones you hand to the PCs.
* The script writes files only. It does not touch any certificate store on the PC it runs on, and it never overwrites an existing certificate.

The *Subject* is the name Windows shows as the publisher. Use your organisation's real name; that is the one thing the script cannot choose for you.

## 3. Make your PCs trust it (managed PCs)

A signature made with your own certificate is *intact* on every PC, but only *trusted* on PCs that have been given your root. Give them the
**root** (`agastya-root-ca.cer` for an internal CA, `agastya-codesign.cer` for a self-signed certificate) once, by policy:

* **Active Directory Group Policy:** Group Policy Management → edit a GPO linked to the PCs → *Computer Configuration → Policies → Windows Settings →
  Security Settings → Public Key Policies → Trusted Root Certification Authorities* → *Import…* the `.cer`. Repeat under *Trusted Publishers* if you
  also want the publisher pre-approved for the Windows features that ask about it.
* **Microsoft Intune:** *Devices → Configuration → Create → Templates → Trusted certificate*, upload the `.cer`, destination store *Computer
  certificate store - Root*; assign it to the device group.

The PCs pick the policy up at the next policy refresh (`gpupdate /force` to hurry it).

## 4. Sign the build: one configured step

Set the signing variables, then build. `node scripts/release/signing.mjs --show` prints the set-up the packager will use (never the password).

**Certificate store or hardware key (recommended; required for a public certificate):**

```
set AGASTYA_SIGN_THUMBPRINT=<SHA-1 thumbprint of the code-signing certificate>     (CurrentUser\My; AGASTYA_SIGN_STORE=LocalMachine for LocalMachine\My)
set AGASTYA_SIGN_TIMESTAMP_URL=<RFC 3161 time-stamp server: your CA's, or one the build machine can reach>
npm run package:win -- --build --release --node <pinned node.exe>
```

**A .pfx file (internal CA / self-signed):**

```
set AGASTYA_SIGN_PFX=D:\signing\agastya-codesign.pfx
set AGASTYA_SIGN_PASSWORD=<the .pfx password>
set AGASTYA_SIGN_TIMESTAMP_URL=<RFC 3161 server>
npm run package:win -- --build --release --node <pinned node.exe>
```

What happens:

1. `signtool sign /fd SHA256 [/tr <url> /td SHA256]` (the newest x64 `signtool.exe` of an installed Windows SDK, or `AGASTYA_SIGNTOOL`) signs every
   portable-executable file of the staged product that carries no signature yet. Without a Windows SDK the packager falls back to
   `Set-AuthenticodeSignature` (Windows PowerShell), which needs nothing installed. Afterwards every executable file must report an intact signature.
2. The SBOM and `MANIFEST.sha256` are written from the signed bytes; `scripts/signing/Sign-Manifest.ps1` writes `MANIFEST.sha256.sig` with the same
   certificate (RSA PKCS#1 v1.5 / SHA-256, or ECDSA P-256 / SHA-256; the public certificate is inside the `.sig`).
3. Inno Setup signs `Setup.exe` and the uninstaller (`SignedUninstaller=yes`) by calling `node scripts/release/signing.mjs --sign <file>`, so the
   password stays in the environment and never reaches the ISCC command line.
4. `SHA256SUMS.txt` (Setup, ZIP, SBOM, `Verify-Release.ps1`, `Detect-AgastyaPlatform.ps1`) gets `SHA256SUMS.txt.sig`.
5. The packager runs the offline verifier over the release folder (`--release`: every check must pass, unsigned or untimestamped = refused) and
   records the signing set-up (mode, thumbprint, time stamp yes/no; no secrets) and the toolchain in `BUILD-INFO.json`.

**Time stamps.** A signature without an RFC 3161 time stamp stops verifying on the day the certificate expires (at most 460 days for a public one).
A `--release` build refuses to sign without `AGASTYA_SIGN_TIMESTAMP_URL`. An air-gapped organisation that has no time-stamp authority can accept
untimestamped signatures explicitly with `AGASTYA_SIGN_ALLOW_NO_TIMESTAMP=1` (recorded in `BUILD-INFO.json`); it must then re-sign and re-issue the
release before the certificate expires. The detached signatures over the manifest and the checksums carry no time stamp; they are checked against the
certificate inside them, not against the clock.

`AGASTYA_SIGN_CMD` (a whole command with `$f` for the file, e.g. the older
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\signing\Sign-File.ps1 -Pfx D:\signing\agastya-codesign.pfx -File $f`) still works for
the executables; a release then also needs `AGASTYA_SIGN_THUMBPRINT` or `AGASTYA_SIGN_PFX`, because the manifest and the checksums are signed with the
certificate directly.

## 5. Check it, offline

On the receiving side, before installing (Windows PowerShell 5.1, nothing else; the script ships next to `Setup.exe`):

```
powershell -ExecutionPolicy Bypass -File .\Verify-Release.ps1 -Thumbprint <thumbprint published by the vendor> -RequireSigned -RequireTimestamp
```

It checks every file against `SHA256SUMS.txt`, the signature over `SHA256SUMS.txt` (and that it was made by the pinned certificate), that the SBOM is
covered, and the Authenticode signature of `Setup.exe` (intact, same certificate, time-stamped). It also reports whether Windows on that PC trusts the
certificate (section 3). The thumbprint to pin comes from the vendor by another channel (release letter, phone): a signature proves who signed only if
you know which certificate is theirs.

After installing, on the installed computer:

```
"C:\Program Files\Agastya Platform\AgastyaCtl.exe" --verify --require-signed
powershell -ExecutionPolicy Bypass -File .\Verify-Release.ps1 -Tree "C:\Program Files\Agastya Platform" -RequireSigned
```

`--verify` hashes every program file against `MANIFEST.sha256`, checks that nothing unlisted sits in the program folder (the installation's own
`unins000.*`, and `config`, `data`, `logs` of a portable copy, are allowed), that `MANIFEST.sha256.sig` holds, and that its signer is the certificate
of `AgastyaCtl.exe`'s own Authenticode signature (checked with `WinVerifyTrust`, revocation and network retrieval switched off). `--doctor` runs a
quick form of the same check, and every start of the server runs the quick form in the background and writes the result to `agastya-host.log`, with a
Windows Application-log **warning** when the files are not as shipped. A modified installation is reported, never blocked: an air-gapped site keeps
working while support looks at it (recorded decision, WP-24).

In the repository: `node scripts/release/verify-release.mjs --release release --require-signed --require-timestamp`; `node scripts/ci/readiness.mjs`
runs it as gate **G-SEC-11c**, with **G-SEC-11a** (Authenticode Valid and time-stamped on Setup and both executables), **RES-005** (SBOM checks and is
covered by the signed checksums) and, with `--install <folder>`, **DEP-013** (`AgastyaCtl --verify --require-signed` on the installed copy).

`scripts/signing/Test-Signature.ps1` still lists the Authenticode status of any set of files:

| Status | Meaning |
|---|---|
| `Valid` | signed, intact, and this PC trusts the root |
| `UnknownError` ("...root certificate which is not trusted") | signed and intact, but this PC has not been given your root (section 3) |
| `HashMismatch` | the file was changed after it was signed - do not install it |
| `NotSigned` | no signature |

## 6. What was and was not verified

Verified (WP-24, Windows Server 2025 build host, 2026-11-27), with a throwaway self-signed certificate made in a temporary folder by
`New-SigningCertificate.ps1` (no certificate store touched; the folder deleted afterwards):

* `signtool` (Windows SDK 10.0.26100, `/f` with the `.pfx`) signs copies of `xsltproc.exe` and a freshly compiled `AgastyaCtl.exe`; Windows reports them
  signed and intact with an untrusted root; one changed byte gives `HashMismatch` (`scripts/release/release.test.mjs`, `host.test.mjs`).
* `Sign-Manifest.ps1` signatures verify in Node (`verify-release.mjs`), in Windows PowerShell (`Verify-Release.ps1`) and in the host
  (`AgastyaCtl --verify`); an edited manifest, a manifest signed by another certificate, a changed file of the same size, a missing file and a planted
  DLL are each reported and fail the check.
* A complete package built with signing on (see the implementation log for the run): every unsigned executable signed, SBOM, signed manifest, signed
  checksums, and the packager's own offline verification passing.

Still from the earlier work: in a disposable guest, after the root was added to *Local Machine → Trusted Root Certification Authorities*, a signed file
reports `Valid`; with one byte changed, `HashMismatch`.

Not verified, and not claimed:

* **A time-stamped signature.** The build host has no network and no time-stamp authority; the time-stamp path (`/tr ... /td SHA256`) is the
  standard signtool usage but was not executed. A release with a time-stamp server is the owner's first signed build.
* **A real organisation or public certificate, and a hardware key.** The certificate-store mode was exercised only through its command line.
* **SmartScreen.** "Windows protected your PC - Unknown publisher" is decided by Microsoft's reputation service for files that carry a web
  "Mark of the Web" (downloaded, or copied from a browser/e-mail). It cannot be tested offline, and a signature from your own CA earns no reputation with
  Microsoft. A file delivered by software-deployment tooling or a network share normally carries no such mark and is not subject to it. If your users
  download the installer and still see the warning, that is SmartScreen, and the remedies are Microsoft's: a public certificate with reputation, or
  your administrators allowing the publisher by policy (Defender SmartScreen / WDAC / AppLocker publisher rules).
* The Group Policy and Intune steps above are the standard Microsoft procedures, not something run here (there is no domain controller or Intune tenant in
  this environment). The trust *effect* they produce - the root in the Local Machine Root store - was tested directly in the guest.
