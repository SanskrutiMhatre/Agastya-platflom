# Deployment kit - managed rollout of Agastya Platform (Intune, Configuration Manager, Group Policy)

Written for audit WP-24 (DEP-014, DEP-019, ENT-014, gate G-DEP-3). It collects, on one page, what a desktop-management team needs to roll the
standalone product out to managed Windows PCs with no network access to the internet. Everything here is offline.

What the release folder contains (built by `npm run package:win`, see `docs/PACKAGING.md`):

| File | Use |
|---|---|
| `Agastya-Platform-<v>-win-x64-Setup.exe` | the installer (Inno Setup; Authenticode-signed in a release) |
| `Agastya-Platform-<v>-win-x64-portable.zip` | the same product without an installer |
| `Agastya-Platform-<v>-win-x64-SBOM.cdx.json` | the software bill of materials (CycloneDX 1.5) for the security review |
| `SHA256SUMS.txt` + `SHA256SUMS.txt.sig` | checksums of all of the above, signed |
| `Verify-Release.ps1` | checks the release offline before it is imported into the deployment tool (`docs/SIGNING.md` section 5) |
| `Detect-AgastyaPlatform.ps1` | the detection rule below |

## 1. Before import: verify the release

```
powershell -ExecutionPolicy Bypass -File .\Verify-Release.ps1 -Thumbprint <vendor's published thumbprint> -RequireSigned -RequireTimestamp
```

Exit code 0 = every file matches its signed checksum, the SBOM is covered and `Setup.exe` carries an intact signature by that certificate. Push the
signing root to the PCs first if it is an internal CA (`docs/SIGNING.md` section 3), or the installer shows "unknown publisher".

## 2. Commands

| Action | Command (run as SYSTEM / elevated) | Success |
|---|---|---|
| Install, per machine | `Agastya-Platform-<v>-win-x64-Setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG="%TEMP%\agastya-setup.log"` | exit code 0 |
| Install as a Windows service reachable from the LAN | add `/TASKS="service,lan" /PORT=4040` | exit code 0 |
| Data elsewhere | add `/DATADIR="E:\AgastyaData"` (`/DIR=` for the program folder) | exit code 0 |
| Upgrade | the new Setup with the same switches; data and `agastya.ini` are kept, `publisher.db` is backed up first | exit code 0 |
| Uninstall | `"C:\Program Files\Agastya Platform\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART` | exit code 0; data kept |
| Check after install | `"C:\Program Files\Agastya Platform\AgastyaCtl.exe" --verify --require-signed` then `--doctor` | exit code 0 each |

All switches: `docs/OPERATIONS.md` section 9. Inno Setup exit codes: 0 success; 1 setup failed to initialise; 2 cancelled before installing;
3 fatal error preparing; 4 fatal error while installing; 5 cancelled while installing; 6 killed; 7 the preparing stage refused (e.g. files in use);
8 the preparing stage needs a restart. Map 0 to *success* and the others to *failure* in the deployment tool; 8 to *soft reboot* if the tool allows.

The first administrator account is created in the browser the first time the product is opened (nothing ships with a default password). An unattended
first administrator from the installer (`/ADMINUSER`, `/ADMINPASSWORDFILE`, DEP-014) is **not implemented**; it belongs to the installer work
package (WP-25).

## 3. Detection rule (G-DEP-3)

`Detect-AgastyaPlatform.ps1 [-MinimumVersion <x.y.z>]` - detected = exit code 0 **and** a line on standard output; not detected = exit 0 and no
output. It reads the installer's uninstall entry
`HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{A4F8C61E-1D9A-4BF9-B9B8-092ECA4E3CBC}_is1` (HKCU for a per-user install), its
`DisplayVersion` and `InstallLocation`, and requires `AgastyaCtl.exe` there with a file version of at least `-MinimumVersion`. The AppId never
changes between releases (`packaging/product.json`).

The equivalent rule without a script, where the tool prefers one:

* Registry: key above, value `DisplayVersion`, *Version* greater than or equal to the release; and
* File: `%ProgramFiles%\Agastya Platform\AgastyaCtl.exe`, *File version* greater than or equal to `<v>.0`.

`scripts/release/host.test.mjs` exercises the script against a throwaway uninstall entry (not installed, entry without program, installed, too old,
removed). A run inside Intune or Configuration Manager has **not** been done here (no tenant, no site server): it is the open half of G-DEP-3.

## 4. Microsoft Intune (Win32 app)

1. Put `Setup.exe` alone in a folder, e.g. `C:\pkg\agastya`, and wrap it with the Microsoft Win32 Content Prep Tool:
   `IntuneWinAppUtil.exe -c C:\pkg\agastya -s Agastya-Platform-<v>-win-x64-Setup.exe -o C:\pkg\out`
2. *Apps → Windows → Add → Windows app (Win32)*, upload the `.intunewin`.
3. Install command: `Agastya-Platform-<v>-win-x64-Setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG="%TEMP%\agastya-setup.log"`;
   uninstall command: `"%ProgramFiles%\Agastya Platform\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART`; install behaviour *System*;
   return codes as in section 2.
4. Requirements: Windows 10 22H2 or later, 64-bit (section 7).
5. Detection: *Use a custom detection script*, upload `Detect-AgastyaPlatform.ps1` (edit its `-MinimumVersion` default to the release first, or use the
   registry + file rule of section 3); *Run script as 32-bit process on 64-bit clients* = **No**; *Enforce signature check* = Yes once the script is
   signed with your certificate (`Set-AuthenticodeSignature`), else No.
6. Assign the trusted-certificate profile with your root (`docs/SIGNING.md` section 3) to the same group first.

## 5. Configuration Manager (application)

Deployment type *Script Installer*: content = the folder with `Setup.exe`; installation and uninstall programs as in Intune; detection method *Use a
custom script*, PowerShell, `Detect-AgastyaPlatform.ps1`; user experience *Install for system*, *Whether or not a user is logged on*; return codes as in
section 2 (add 8 as *Soft reboot*). Requirement: operating system as in section 7.

## 6. Group Policy

Group Policy *Software Installation* only accepts Windows Installer (`.msi`) packages; this product ships an `.exe` (an MSI wrapper is an optional,
on-demand item, roadmap WP-31 / decision D6). Without Intune or Configuration Manager, use a **computer startup script** in a GPO:

```
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "\\server\share\agastya\Detect-AgastyaPlatform.ps1" -MinimumVersion <v> | findstr /r "." >nul && exit /b 0
"\\server\share\agastya\Agastya-Platform-<v>-win-x64-Setup.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG="%WINDIR%\Temp\agastya-setup.log"
```

The share needs read access for the *Domain Computers* group (startup scripts run as the computer account).

## 7. Windows support matrix (DEP-019)

| Windows | Architecture | Status |
|---|---|---|
| Windows Server 2025 | x64 | Supported. Installer, service, upgrade and uninstall verified in a no-network Hyper-V guest (`scripts/vm-acceptance`, earlier runs); the WP-24 additions to that harness (signatures, `--verify`, seeded file fault, support bundle) are written but **not yet run** in the guest |
| Windows 11 23H2 / 24H2 | x64 | Supported target, **not verified** |
| Windows 10 22H2 | x64 | Supported target, **not verified** (`MinVersion=10.0` in the installer) |
| Windows Server 2019 / 2022 | x64 | Supported target, **not verified** |
| Windows Server 2016 and older, Windows 10 before 22H2 | x64 | Not supported |
| Any Windows on ARM64 | x64 emulation | **Not supported** until tested: the jlink JRE, the `argon2` win32-x64 module and the 32-bit `xsltproc.exe` have not been run there |
| 32-bit Windows | x86 | Not supported (`ArchitecturesAllowed=x64compatible`) |

The product depends on one 32-bit program, `xsltproc.exe` (libxslt 1.1.28, WOW64 on x64 Windows); its replacement is tracked in
`docs/BUNDLED-COMPONENTS.md`. Each "not verified" row becomes verified by one archived run of `scripts/vm-acceptance/Test-InstallerInVm.ps1` (with
`-RequireSigned` for a signed release) on that image, with no network adapter; the run log goes next to `SHA256SUMS.txt` in the release record.

## 8. When a PC needs support

`"C:\Program Files\Agastya Platform\AgastyaCtl.exe" --support-bundle` writes `C:\ProgramData\Agastya Platform\support\agastya-support-<pc>-<time>.zip`:
version, the `--doctor` report, the program-file check, `agastya.ini` with secrets masked, the last 2 MB of the host and server logs with passwords,
tokens, cookies and password hashes masked, Windows/service/firewall/disk facts and the server's public `/api/version` and `/api/ready`. It never
contains the database, project files or project names. Read it before sending it: it is plain text in a ZIP. `--verify` tells whether the program files
are still as shipped; *Repair* = run the same `Setup.exe` again.
