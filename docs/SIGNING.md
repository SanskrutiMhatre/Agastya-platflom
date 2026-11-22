# Code signing

Agastya Platform ships as an installer (`Setup.exe`) and a portable ZIP. Both contain two executables of their own (`AgastyaPlatform.exe`,
`AgastyaCtl.exe`). **Signing** puts a cryptographic signature on them so a PC can tell who built them and that nothing changed afterwards.

The packager does not sign by default, and nothing in the product needs a signature to run. Sign when the software goes onto PCs you manage and you want
them to show your organisation as the publisher and to reject a tampered copy.

## 1. Which certificate

| Option | Cost | Who trusts it | Use it when |
|---|---|---|---|
| **Internal CA** - a root certificate you make, which issues the signing certificate | none | every PC you push the root to | your organisation manages the PCs (domain / Intune). **Recommended.** |
| **Self-signed** - one certificate that is its own root | none | every PC you push that certificate to | a small group of PCs, or a trial. The same mechanism, one file fewer. |
| **Public code-signing certificate** (from a commercial CA) | paid, annual, identity checks | all Windows PCs, no set-up | you distribute outside your own organisation |

You can make the first two yourself, offline, with `scripts/signing/New-SigningCertificate.ps1`. You cannot make a certificate that *strangers'* PCs
trust: that is what a public CA's identity checks are paid for.

## 2. Make the certificate

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

## 4. Sign the build

```
set AGASTYA_SIGN_PASSWORD=<the .pfx password>
set AGASTYA_SIGN_CMD=powershell -NoProfile -ExecutionPolicy Bypass -File scripts\signing\Sign-File.ps1 -Pfx D:\signing\agastya-codesign.pfx -File $f
npm run package:win -- --build
```

`$f` stands for each file; the packager signs `AgastyaPlatform.exe` and `AgastyaCtl.exe` before they are packed and has Inno Setup sign `Setup.exe` and the
uninstaller. It needs no Windows SDK: `Sign-File.ps1` uses the signing support built into Windows PowerShell. (If you already have `signtool.exe` and a
certificate in a store or an HSM, put your own `signtool sign ...` command in `AGASTYA_SIGN_CMD` instead.)

The signature is **not timestamped** by default, because the product is built to work with no internet. Such a signature stops verifying on the day the
signing certificate expires, and the installer must then be signed again with a renewed certificate. To keep signatures valid past expiry, add
`-TimestampServer <RFC 3161 URL>` (your CA's, or one on your network) to the command.

## 5. Check it

```
powershell -ExecutionPolicy Bypass -File scripts\signing\Test-Signature.ps1 -Path release\*.exe release\Agastya-Platform-*\*.exe
powershell -ExecutionPolicy Bypass -File scripts\signing\Test-Signature.ps1 -Path release\*Setup.exe -RequireTrusted -Thumbprint <thumbprint>
```

| Status | Meaning |
|---|---|
| `Valid` | signed, intact, and this PC trusts the root |
| `UnknownError` ("...root certificate which is not trusted") | signed and intact, but this PC has not been given your root (section 3) |
| `HashMismatch` | the file was changed after it was signed - do not install it |
| `NotSigned` | no signature |

## 6. What was and was not verified

Verified (Windows Server 2025 build host, and a disposable Windows guest VM):

* `New-SigningCertificate.ps1` produces a root and a signing certificate (RSA 3072, SHA-256, Code Signing usage) and changes no certificate store.
* `Sign-File.ps1` signs a copy of `AgastyaCtl.exe`; the signature reports `UnknownError` (untrusted root) on a PC that was not given the root.
* In the guest, after the root was added to *Local Machine → Trusted Root Certification Authorities*, the same signed file reports `Valid`; a copy with one
  byte changed reports `HashMismatch`. The guest was returned to its prior state.

Not verified, and not claimed:

* **SmartScreen.** "Windows protected your PC - Unknown publisher" is decided by Microsoft's reputation service for files that carry a web
  "Mark of the Web" (downloaded, or copied from a browser/e-mail). It cannot be tested offline, and a signature from your own CA earns no reputation with
  Microsoft. A file delivered by software-deployment tooling or a network share normally carries no such mark and is not subject to it. If your users
  download the installer and still see the warning, that is SmartScreen, and the remedies are Microsoft's: a public certificate with reputation, or
  your administrators allowing the publisher by policy (Defender SmartScreen / WDAC / AppLocker publisher rules).
* The Group Policy and Intune steps above are the standard Microsoft procedures, not something run here (there is no domain controller or Intune tenant in
  this environment). The trust *effect* they produce - the root in the Local Machine Root store - was tested directly in the guest.
