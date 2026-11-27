# Agastya Platform - building and releasing the Windows package

For the person who produces the installer. (To install and run the product, read OPERATIONS.md.)

## 1. What comes out

`npm run package:win` writes to `release/`:

| File | What it is |
| --- | --- |
| `Agastya-Platform-<version>-win-x64-Setup.exe` | the installer (Inno Setup): per-machine or per-user, optional Windows service, optional LAN firewall rule, upgrade in place, uninstall that keeps data |
| `Agastya-Platform-<version>-win-x64-portable.zip` | unzip anywhere and run `AgastyaPlatform.exe`; data goes in `data\` beside it |
| `Agastya-Platform-<version>-win-x64\` | the staged folder both of them are made from; it holds `MANIFEST.sha256` (SHA-256 of every shipped file, `.sig` when signed) and `SBOM.cdx.json` |
| `Agastya-Platform-<version>-win-x64-SBOM.cdx.json` | the software bill of materials, CycloneDX 1.5 (WP-24) |
| `Verify-Release.ps1`, `Detect-AgastyaPlatform.ps1` | the customer's offline verifier and the deployment detection rule (`DEPLOYMENT-KIT.md`) |
| `SHA256SUMS.txt` (+ `SHA256SUMS.txt.sig` when signed) | checksums of all the files above |
| `BUILD-INFO.json` | commit, clean/dirty tree, toolchain, signing set-up (no secrets), artefact hashes |

At the end the packager verifies the finished release the way the customer will (`scripts/release/verify-release.mjs`) and fails when anything does
not match.

Both contain the same product, and it is self-contained: a 64-bit Node.js 22 (`runtime\node.exe`), the compiled backend with its production
dependencies, the web client, the publishing engine with the Temurin 21 Java runtime and Apache FOP, `xsltproc`, the fonts, the host programs
(`AgastyaPlatform.exe` tray application / service, `AgastyaCtl.exe` command line), and the licence texts. It needs no internet, no installed Java, no
installed Node and no Visual C++ runtime; it never contacts the internet when it runs (section 5 proves it).

## 2. What the build machine needs

* Windows 10 or later, 64-bit, and a **64-bit Node.js 22** - the same major version the product was tested with. This is the Node that gets shipped
  (`--node <node.exe>` chooses another).
* `npm run install:all` done (`backend/node_modules`, `frontend/node_modules`).
* **Inno Setup 6** (https://jrsoftware.org/isinfo.php) - found in `%LOCALAPPDATA%\Programs\Inno Setup 6`, `C:\Program Files (x86)\Inno Setup 6` or
  `ISCC_PATH`. Only for `Setup.exe`; use `--no-installer` without it.
* The .NET Framework 4 compiler (`csc.exe`) that every Windows ships under `C:\Windows\Microsoft.NET\Framework64\v4.0.30319` - the host programs are
  C# 5 and need nothing else.
* `tar.exe` (bsdtar, part of Windows 10 and later) for the ZIP.

## 3. Building

```
npm run package:win -- --build            build the backend and web client, then package
npm run package:win                       package what is already built (stops if the build is older than the source)
```

Options: `--no-installer`, `--no-zip`, `--out <folder>`, `--node <node.exe>`, `--no-arial` (section 7). Nothing is downloaded; a clean build takes a few
minutes, mostly compressing the 270 MB product.

The script refuses to produce a package when something is off: a stale build, fewer than 20 production dependencies found, a native module without a
`win32-x64` binary, a path inside the product longer than 150 characters (Windows' 260-character limit would bite an ordinary install folder), a
missing licence file for a bundled component.

What it leaves out on purpose: the developer tools and tests, the sources of the web client, FOP's javadocs and examples (they alone are 94 MB and hold
the longest paths), the HTML documentation of libxslt, native binaries for other operating systems, source maps and logs.

## 4. Version and identity

* The version is `version` in the root `package.json`; the host programs, the installer and the ZIP name take it from there.
* `packaging/product.json`: the name, the **publisher** and the **url** that Windows shows in *Apps*, the default port and service name, and `appId`.
  **Never change `appId`** once an installer has been released: it is how a new installer finds the old installation to upgrade it.
* `packaging/agastya.ini.template` is the configuration file the installer writes on first install.
* `packaging/assets/` holds the icon (`agastya.svg` → `agastya.ico`, `agastya-256.png`; `node packaging/assets/make-icon.mjs` regenerates them).

## 5. Proving a package before it leaves the building

Two scripts check the real artefacts. Both use only ports 4070-4079 and scratch folders they create and delete; neither touches `workspace\`.

```
npm run package:win
node scripts/verify-installer.mjs                         # the installer: install, run, upgrade, uninstall (silent, per-user, scratch folders)
npm run verify:package                                    # the ZIP: offline proof and a full workflow (about 5 minutes)
node scripts/verify-package-offline.mjs --import-dir "<folder of S1000D files>"   # use another sample for the import step
```

`verify-installer.mjs` installs with `/VERYSILENT /CURRENTUSER` (no administrator rights; it never registers a service or a firewall rule) into folders with
spaces and non-ASCII letters, checks the files, `state.dir` and `agastya.ini`, starts the installed server and checks it answers and logs where it should,
checks that nothing was written into the program folder, installs again over the top (the configuration and data must survive, and the database must be
backed up first), uninstalls (the program, shortcuts and registry entry must go; the data and configuration must stay), and removes everything it made.

`verify-package-offline.mjs` unpacks the ZIP, then:

1. scans the web client for anything loaded from another host and for `url()` references to files that are not shipped;
2. sets up four instruments and **proves each one by a canary that it must catch** (a silent instrument that cannot see anything proves nothing): a Node
   preload that records every connection, DNS lookup and UDP send to anything but this computer; a JVM proxy trap that receives everything the PDF
   renderer tries to fetch over http/https; a poll of the operating system's TCP table for every process that runs from the product folder; and the
   request log of Chrome, started so that no host name except 127.0.0.1 resolves;
3. starts the portable copy (first-run administrator prompt, data beside it);
4. copies the product to a folder with **every file read-only**, with data elsewhere, and runs a whole workflow with the instruments watching: first
   administrator, an author, the ready-made sample project published to a PDF, an import of a subset of an S1000D package (opened read-only), validation, a
   gated publish with a draft waiver, and the web client's pages in Chrome;
5. checks that nothing was written into the program folder, that nothing is left running, and that no instrument saw a connection to another host.

It exits 0 only when every check passed. Checks that cannot run on a machine (no Chrome, no sample folder) are reported as SKIPPED, never as passed.
What it cannot prove: it observes this machine for the length of one run. It is evidence, not a mathematical guarantee; the guarantee comes from the
product containing no code path that contacts the internet, which the static scan and the browser log support.

## 6. Signing

Signing is optional and the product does not need it to run. Unsigned, Windows may show *"Windows protected your PC - Unknown publisher"* when a user runs
a `Setup.exe` that was downloaded (that decision is Microsoft's reputation service, which an organisation's own certificate does not influence), and the
installer and executables carry no publisher name. Signing with your organisation's own certificate makes them show your organisation as the publisher and makes a
tampered copy fail verification on PCs you have given your root certificate to.

Signing is one configured step (WP-24): set the variables, then build. With a certificate in a store or on a hardware token (the only way for a public
certificate since March 2026):

```
set AGASTYA_SIGN_THUMBPRINT=<SHA-1 thumbprint>
set AGASTYA_SIGN_TIMESTAMP_URL=<RFC 3161 time-stamp server>
npm run package:win -- --build --release --node <pinned node.exe>
```

or with an internal-CA / self-signed `.pfx` (made offline by `scripts\signing\New-SigningCertificate.ps1`): `AGASTYA_SIGN_PFX` and `AGASTYA_SIGN_PASSWORD`
instead of the thumbprint. The packager signs every executable file of the product its vendor left unsigned (with `signtool` from an installed Windows SDK,
or `Set-AuthenticodeSignature` without one), signs the file manifest and `SHA256SUMS.txt` with the same certificate, and has Inno Setup sign `Setup.exe` and
the uninstaller. `--release` refuses an unsigned or untimestamped build, a tree with uncommitted changes, a `node_modules` that differs from the lockfile,
empty `copyright`/`url` in `packaging/product.json` and a missing `docs/EULA.txt`. `node scripts/release/signing.mjs --show` prints the set-up. The older
`AGASTYA_SIGN_CMD` (a command with `$f`) still signs the executables. The build tells you at the end when it is unsigned.

**[SIGNING.md](SIGNING.md)** covers which kind of certificate to use, making one, pushing it to managed PCs by Group Policy or Intune, verifying signatures, renewal
and timestamping, and exactly what was and was not tested.

## 7. Before you distribute - things only you can settle

These are deliberately not decided by the build:

1. **Publisher, copyright, URL, icon.** `packaging/product.json` carries placeholders (publisher "Agastya Platform", empty copyright, no URL) and
   `packaging/assets` a generated placeholder icon. Put in your organisation's name, copyright line, address and artwork. The publisher and copyright appear
   in Add/Remove Programs, on the installer's and executables' Properties > Details tab, and (once signed) as the signing certificate's subject.
2. **Arial.** The four `arial*.ttf` files were copied from a licensed Windows installation, and are included because that was decided for this
   product (see `backend/vendor/tools/fonts/README.md`). Arial is Monotype's proprietary font; whoever *distributes* the package must hold a licence that
   allows redistributing it. If you do not, build with `--no-arial`: the product then prints in Liberation Sans, which has the same character widths, so
   line and page breaks do not change; only the letter shapes do.
3. **End-user licence.** The installer shows a licence page only if `docs/EULA.txt` exists. None is supplied; the terms are yours to write.
   `docs/legal/EULA.template.txt` is a headings-only skeleton (it is not read by the installer) listing what such a licence usually covers and the
   product-specific facts to state accurately; it is for your legal adviser to turn into the real text.
4. **Third-party licences.** `THIRD-PARTY-NOTICES.txt` (generated) lists every component with its licence and ships the licence texts in `licenses\`.
   The texts of libxml2, libxslt, zlib, libiconv, GnuWin32 regex, libgcc and winpthreads were fetched from their upstream projects (the file for each
   states where). The LGPL libraries are separate DLLs that can be replaced. The exact binary build provenance of those DLLs (who compiled them, from
   what source) is not recorded in the repository; the version and licence attributions come from the files' own version resources and strings.
   Check the notices against your own legal requirements.
5. **Inno Setup's licence.** The compiler printed "Non-commercial use only" in its banner on the build machine, while the `license.txt` that comes with it
   grants use "for any purpose, including commercial applications". Confirm the terms that apply to you on https://jrsoftware.org/ before you ship
   a commercial installer built with it; the portable ZIP does not involve Inno Setup.
6. **Linux.** Only Windows is supported for now. A Linux package would need its own Node.js and Java runtime images, `xsltproc`, a systemd unit and
   fonts; the application code itself is not Windows-specific.

### Installer acceptance test in a throw-away Windows guest (Hyper-V)

`verify-installer.mjs` checks the installer script and a package on the build machine; it cannot install anything. For the parts that need a real Windows
(the service, the firewall rule, Add/Remove Programs, a reboot, an upgrade, the default per-machine paths), `scripts/vm-acceptance/` builds a disposable guest and
runs the installer in it:

```
powershell -ExecutionPolicy Bypass -File scripts\vm-acceptance\New-TestVm.ps1 -IsoPath "D:\isos\Windows Server 2025.iso"      # once; elevated, Hyper-V host
powershell -ExecutionPolicy Bypass -File scripts\vm-acceptance\Test-InstallerInVm.ps1 -Setup release\Agastya-Platform-2.0.0-win-x64-Setup.exe -Label release
```

The guest has no network adapter; the host talks to it over PowerShell Direct and every change happens inside the guest. Phases: silent install with the service
and LAN access, a smoke publish of a real PDF with the bundled Java, a reboot (the service must start by itself), the same package installed over itself,
uninstall (the program, service, firewall rule and registry entry must go; the data must stay), a default install (no service, no firewall rule,
loopback only) with its uninstall, and finally an install over the configuration that uninstall kept, with the switches that take no value (`/LAN`, and
`/NOSERVICE` while the service task is selected). The run ends `RESULT: <n> passed, <n> failed` (43 checks at the time of writing); the report is under the
work folder (`%TEMP%\agastya-vmtest\out`). The guest cleans its own configuration folder before phase 1 and after the last phase, so the run can be repeated.

This is what found two installer bugs that the host-side checks cannot reach: the crash on a clean machine ("expand the app constant before it was
initialized", the wizard code runs without a previous install only on a clean guest), and the value-less switches being invisible to Inno Setup's `{param:}`
(`/LAN` left `Bind=loopback` in an existing `agastya.ini` while the firewall rule was opened, and `/NOSERVICE` was ignored; `SwitchGiven` in `agastya.iss`
now reads the command line itself). The evaluation Windows licence of the guest is time-limited, so rebuild the guest rather than keeping it.

## 8. Release checklist

1. Update `version` in the root `package.json`; update the changelog.
2. `npm test` in `backend` and `frontend`, `npm run e2e` in `frontend`.
3. `npm ci` in `backend` (the release ships exactly the lockfile), then `npm run package:win -- --build --release` with the signing variables set
   (section 6, SIGNING.md).
4. `node scripts/verify-installer.mjs` and `npm run verify:package`; both must end with every check passed. `node scripts/ci/readiness.mjs`
   (G-SEC-11a/b/c, RES-005, G-DEP-4; with `--install <folder>` also G-SEC-6, G-DEP-6, DEP-013, G-DEP-3) must pass.
5. On a clean Windows machine or VM: run `Setup.exe` normally (not silently) once, open the application, create the administrator, publish the sample project.
6. Publish `Setup.exe`, the ZIP, the SBOM, `Verify-Release.ps1`, `Detect-AgastyaPlatform.ps1`, `SHA256SUMS.txt` and `SHA256SUMS.txt.sig` together,
   and the certificate thumbprint through a separate channel (DEPLOYMENT-KIT.md). Keep the installer of every released version: it is the way back (OPERATIONS.md, section 8).
