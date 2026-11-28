# Agastya Platform - administrator guide (Windows)

For the person who installs, runs and looks after the server. Nothing here needs the internet: the product never contacts one.

## 1. What is installed, and where

| What | Where (installed for all users) | Where (portable ZIP) |
| --- | --- | --- |
| The program | `C:\Program Files\Agastya Platform\` (never written to at run time): the launcher, and `versions\<version>\` per version (section 8) | the unzipped folder |
| Configuration `agastya.ini` | `C:\ProgramData\Agastya Platform\agastya.ini` | `config\agastya.ini` |
| **Your data** (projects, templates, `publisher.db`) | `C:\ProgramData\Agastya Platform\workspace\` (or the folder chosen at install) | `data\workspace\` |
| Logs | `C:\ProgramData\Agastya Platform\logs\` | `data\logs\` |

An installation "for me only" (no administrator rights) uses `%LOCALAPPDATA%\Agastya Platform\` instead of ProgramData.
Upgrading and uninstalling never touch the data folder. **Back it up** (section 7).

## 2. Starting it

* **Tray application** (default): Start menu → *Agastya Platform*. A tray icon appears, the server starts, and the application opens at
  `http://localhost:4040/` in its own window (an app window of Microsoft Edge, which shares the WebView2 engine) or - when Edge is not on the
  computer, or `[app] Window=browser` - in the default browser, with a notice saying why. Right-click the icon for *Open*, *Open data folder*,
  *Open log folder*, *Restart server*, *Exit*. It runs while the user is signed in. The installer can start it at sign-in (*Start Agastya
  Platform when I sign in*).
* **Windows service** (servers): starts with Windows whether or not anyone is signed in. Chosen in the installer (*Run as a Windows service*), or
  later from an elevated prompt:

  ```
  "C:\Program Files\Agastya Platform\AgastyaCtl.exe" --install-service [--port 4040] [--lan]
  "C:\Program Files\Agastya Platform\AgastyaCtl.exe" --start
  ```

  The service is named `AgastyaPlatform` (change it in `[service] Name`), runs as **NT AUTHORITY\LocalService** (no network identity, no
  rights beyond the data and log folders), restarts the server within seconds if it stops (and gives up after six stops in two minutes, which it logs), has Windows restart the service
  itself (after 5 s, 30 s, then 60 s) if the host process ends unexpectedly, and writes to the Windows *Application* event log with source
  *Agastya Platform*. `AgastyaCtl.exe --stop`, `--uninstall-service`, `--status` do what they say. Do not run the tray application and
  the service on the same port; the tray application notices and just opens the browser.
* **Console** (diagnosis): `AgastyaCtl.exe --console` runs the server in the window; Ctrl+C stops it cleanly.

**First visit** depends on how the accounts begin (`[server] Deployment=` in `agastya.ini`, written by Setup; shown read-only under
Administration > Access > Security; owner decision P3-6, `docs/phase3/standalone.md`):

* **Standalone** (`Deployment=standalone`: the single-computer installation, Setup without *Allow other computers*, and the portable ZIP). The
  first start of a fresh data folder creates one account per role with **fixed, published** credentials:

  | Role | Username | Password |
  |---|---|---|
  | Administrator | `admin` | `Admin@123` |
  | Project Manager | `manager` | `Manager@123` |
  | Author | `author` | `Author@123` |
  | Auditor (read-only) | `auditor` | `Auditor@123` |

  Setup's finish page lists them with *Save a copy...* (written only to the file you choose); the application's first screen lists them too,
  with the same button, until someone chooses *I have stored them*. Each account must choose its own password at its first sign-in (the
  screen cannot be skipped; a default password is never accepted again), and until then it signs in from this computer only. The overview of
  the administration page lists the default accounts that still have their default password. They are created **once** per data folder:
  never on an upgrade, never on a data folder that already has accounts, never again after they are deleted. Setup creates them with
  `AgastyaCtl.exe --default-accounts` (exit 0 created, 3 nothing to do); the server does the same at its first start, so a silent
  installation or the portable ZIP gets them too. `/ADMINUSER` (below) takes precedence: that data folder then has an account and gets none.
* **Common server** (`Deployment=server`: a team server, a client installation, and every server that does not say). No default accounts:
  the application asks for the administrator account at the first visit, everyone else is added under Administration. A standalone
  installation made a team server with `AgastyaCtl.exe --configure-server` (or `--install-service --lan`) is switched to `Deployment=server`;
  `Deployment=standalone` with a network address does not start (the server log names `AGASTYA_DEPLOYMENT`).
**Forgotten administrator password** (run on the server, in an elevated prompt):

```
"C:\Program Files\Agastya Platform\AgastyaCtl.exe" --reset-admin <username>
```

It uses the data folder from `agastya.ini`, asks for the new password twice and does not show it. It works while the server runs.
From a script, run the script itself with the password on standard input:

```
set AGASTYA_WORKSPACE_DIR=C:\ProgramData\Agastya Platform\workspace
"C:\Program Files\Agastya Platform\runtime\node.exe" "C:\Program Files\Agastya Platform\app\backend\scripts\reset-admin.js" <username> --stdin < password.txt
```

 The password is never accepted on the command line, where it would stay in the command history and be visible in the process list.

The account must change the password at its next sign-in and every session is signed out.

## 3. Checking the installation

```
"C:\Program Files\Agastya Platform\AgastyaCtl.exe" --doctor
```

(or Start menu → *Check this installation*). It lists what is wrong and changes nothing: missing files, the Node and Java runtimes, the port, whether the
data folder is writable, free disk space, the service, a value in `agastya.ini` it cannot use, and whether the program files are as shipped (sizes of
every file and hashes of the executables, the runtime and the server code against `MANIFEST.sha256`). Exit code 0 means no problem was found.

```
"C:\Program Files\Agastya Platform\AgastyaCtl.exe" --verify [--require-signed]
"C:\Program Files\Agastya Platform\AgastyaCtl.exe" --doctor --deep
```

`--verify` hashes **every** program file against the signed manifest `MANIFEST.sha256`, names any file that is missing, changed or not part of the
product (a DLL planted beside the program, for example), checks the manifest's signature and that it was made by the certificate that signed
`AgastyaCtl.exe`, and reports Windows' view of that signature (offline). Exit code 0 = intact. `--doctor --deep` puts the same full check into the
self-check. Every start of the server runs the quick check in the background and writes the result to `logs\agastya-host.log` (`integrity: ...`); when
the files are not as shipped it also writes a **warning** to the Windows Application log. It never stops the server. To repair, run the same `Setup.exe`
again. More: `docs/SIGNING.md`.

```
"C:\Program Files\Agastya Platform\AgastyaCtl.exe" --support-bundle [<file.zip>]
```

writes one ZIP for support (default `C:\ProgramData\Agastya Platform\support\`): version, the `--doctor` report, the file check, `agastya.ini` with
every value whose key names a secret masked, the last 2 MB of the host and server logs with passwords, tokens, cookies and password hashes masked,
Windows, service, firewall and disk facts, and the server's public `/api/version` and `/api/ready` answers. It never contains `publisher.db`, project
files or project names. Read it before you send it.

## 4. Configuration - `agastya.ini`

Plain text; every key is optional; restart the application or service after a change. The installer writes the file once and keeps your edits on upgrade.

| Section / key | Default | Meaning |
| --- | --- | --- |
| `[server] Port` | `4040` | TCP port. |
| `[server] Bind` | `loopback` | `loopback` = this computer only. `lan` = every network interface. Or one IPv4 address. Anything but loopback needs `[tls]` (section 5). |
| `[server] Mode` | (from `Bind`) | `local` (Mode A) or `server` (Mode B). Empty = `server` when `Bind` is not loopback. `server` with `Bind=loopback` = behind a TLS proxy on this computer. |
| `[server] ServerNames` | (none) | Other host names people type, comma-separated. The names in the certificate are always accepted; any other name is refused (421). |
| `[tls] Certificate`, `Key` | (none) | PEM server certificate (then any intermediate CA) and its private key. Relative paths are relative to `agastya.ini`. |
| `[tls] Pfx` | (none) | Instead of the two above: one PKCS#12 file. |
| `[tls] PassphraseFile` | (none) | A file holding the passphrase of an encrypted key or `.pfx`. |
| `[tls] HstsMaxAge` | `15552000` | `Strict-Transport-Security` max-age (seconds) on HTTPS answers in Mode B; `0` = none. No `includeSubDomains`, no preload. |
| `[storage] DataDir` | `<state>\workspace` | Where projects and the database live. Move it by stopping the server, moving the folder, and editing this line. |
| `[security] SecureCookies` | `0` | Set `1` if people reach the server over HTTPS (a reverse proxy in front). |
| `[app] OpenBrowser` | `1` | Open the browser when the tray application starts. |
| `[logging] MaxFileMB`, `KeepFiles` | `10`, `5` | Log rotation: at the size limit a log is renamed `.1`, `.2` ...; the oldest beyond `KeepFiles` go. |
| `[service] Name` | `AgastyaPlatform` | Windows service name. |

## 5. Letting other computers connect

By default the server answers on this computer only (`Bind=loopback`). To serve a team:

1. Set `Bind=lan` (or choose *Allow other computers on the network* in the installer, or `AgastyaCtl.exe --install-service --lan`).
2. Allow the port through the Windows Firewall. The installer option does it for you (an inbound rule named *Agastya Platform (LAN access)* for
   the port, TCP, **private and domain networks only**; bound to the port because the program folder changes with every update). By hand:
   `AgastyaCtl.exe --configure-server --firewall` (elevated), or
   `netsh advfirewall firewall add rule name="Agastya Platform (LAN access)" dir=in action=allow protocol=TCP localport=4040 profile=private,domain`
3. Give the server a certificate (below, "Mode B: TLS"). Without one the server does **not** start on a network address; the server log and
   `AgastyaCtl.exe --doctor` name the missing setting.
4. People open `https://<server name>:4040/`.

The whole team-server set-up - certificate, configuration, service, backup with a standby copy, clients, load and capacity - is the runbook in
section 14.

Every action needs a signed-in account; there is no anonymous access.

### Mode B: TLS

On a network address the server speaks HTTPS only (WP-26): a plain `http://` request to the port gets no answer, session cookies are
`Secure`, answers carry `Strict-Transport-Security`, and the progress channel is `wss://`. On this computer only (Mode A) it stays plain HTTP
on `127.0.0.1` / `::1` and never listens on a network interface.

* **Certificate from your organisation's CA (recommended).** Ask for a server certificate whose *subjectAltName* lists every name and address
  people type (browsers ignore the common name). Put the PEM certificate (server first, then intermediates) and key, or a `.pfx`, in the
  state folder, for example `tls\`, and set `[tls] Certificate` and `Key` (or `Pfx` and `PassphraseFile`). Clients already trust the CA.
* **No CA.** `node app\backend\scripts\make-tls-cert.js --out tls --name docs.example.local --name 10.0.0.5 --with-ca` (from the program
  folder, with `runtime\node.exe`) writes a small private CA and a server certificate signed by it, and prints the SHA-256 thumbprints.
  Install `ca.pem` once on each client as a trusted root (Group Policy, or *Manage computer certificates*), or compare the printed thumbprint
  when the browser asks. It installs nothing itself.
* **Reverse proxy instead.** A proxy *on the same computer* may terminate TLS: then keep `Bind=loopback`, set `Mode=server`, and the proxy's
  `X-Forwarded-Proto: https` makes cookies `Secure` (the proxy is trusted because it connects from loopback). A proxy on another machine
  would need plain HTTP on the network, which the server refuses.
* **Host names.** The server answers only to the loopback names, the names and addresses in the certificate, `ServerNames`, and the `Bind`
  address. Anything else gets `421 Misdirected Request` (this stops a web page that re-points its own DNS name at the server).
* **Certificate renewal.** The start-up log and `--doctor` show the days left; under 30 days the log warns at every start; an expired
  certificate stops the server with a message naming the setting. To renew: put the new files in place (same paths, or change the ini),
  restart the service. With the private CA, a new server certificate signed by the same `ca-key.pem` needs nothing on the clients; keep
  `ca-key.pem` offline. On an air-gapped network plan the renewal date when the certificate is issued.
* **Version handshake.** The page asks `/api/version` at start and sends its version on every request; a page older than the server allows
  (an open tab across an upgrade) is answered `426` and offers *Reload*; a server older than the page says the server needs an update.

## 6. Logs

| File | Content |
| --- | --- |
| `logs\agastya-host.log` | start, stop, restart and failure of the server by the host program; the program-file check at each start (`integrity:`) |
| `logs\agastya-server.log` | everything the server prints, including errors (`[stderr]` lines); in the installed product one JSON object per line (`{"t":..., "level":..., "msg":..., "req":...}`) |
| `<data folder>\logs\agastya-server.jsonl` (+ `.1` ... `.5`) | the same records, always JSON, written by the server itself and rotated at 10 MB (`AGASTYA_LOG_DIR`, `AGASTYA_LOG_MAX_MB`, `AGASTYA_LOG_KEEP`); with JSON on, one access line per request: method, route template, status, milliseconds, user id - never a body, query string or cookie (`AGASTYA_ACCESS_LOG=0` turns the access lines off) |
| `<data folder>\logs\audit-failures.log` | every action whose audit row could not be written (section 13) |
| Windows Event Log → Application → *Agastya Platform* | service start/stop, restarts, "server keeps stopping", and the **security events** of section 13 with fixed ids |

Passwords, password hashes, session cookies and Bearer/Basic credentials are replaced by `[redacted]` before any line is written.
`AGASTYA_LOG_FORMAT=text` gives readable lines on standard output (the default when the server is run from source).
The *Audit log* inside the application (Administrator) records who did what; it is part of the database, not these files (section 13).

## 7. Backups

Everything worth keeping is in the **data folder**: the database `publisher.db` (accounts and password hashes, sessions, revision history,
releases and approvals, locks, grants, settings, the audit log) and the files (every project, the shared repository, house templates).

### The platform backup

*Administrator → Maintenance → Platform backup* makes **one archive that restores the whole platform**:
`agastya-backup-<date>-<time>Z-<kind>.zip` in `<data folder>\backups\platform\` (or the folder in `AGASTYA_BACKUP_DIR`). It holds

* `database/publisher.db` - a consistent image of the database taken with SQLite's online-backup API while the server runs, checked
  (`integrity_check`) before it is added;
* `workspace/...` - every file of the data folder, except the live database files, the server lock and the backups themselves;
* `manifest.json` - the version that made it, the database schema it carries, per table the row count and a SHA-256 over every row, and per
  file its size and SHA-256.

The archive is written to disk as it is made (it is never held in memory, the server keeps answering) and works above 4 GB (ZIP64).
Only administrators can make, download, copy, verify or restore one. **It contains every account's password hash: keep it, and every
copy of it, where only administrators can read it.**

* **Schedule.** The server makes a backup every 24 hours (`AGASTYA_BACKUP_INTERVAL_HOURS`; `0` switches it off; the first one 10 minutes
  after a start) and keeps 7 daily, 4 weekly and 12 monthly scheduled backups (`AGASTYA_BACKUP_KEEP`, default `7/4/12`). Backups made by
  hand or before an update are never removed automatically; delete them on the page when they are no longer needed.
* **Restore test.** Once a week (`AGASTYA_RESTORE_TEST_DAYS`, `0` = off) the newest backup is restored into a scratch folder, every file and
  table is compared with its manifest, and the folder is removed. *Verify* on the page does the same for one archive at once. A failed
  backup or restore test appears on the page and in every administrator's notifications.
* **Keep a copy elsewhere.** *Copy to…* copies an archive to another folder (a second disk, a USB stick) and checks the copy byte for
  byte; *Download* saves it through the browser. A backup on the same disk as the data does not survive that disk.
* The page warns when the newest backup is older than 7 days; `--doctor` (and `npm run doctor`) reports it too.

From the command line (the server may be running or stopped):

```
"C:\Program Files\Agastya Platform\runtime\node.exe" "C:\Program Files\Agastya Platform\app\backend\scripts\agastya-backup.js" backup --workspace "C:\ProgramData\Agastya Platform\workspace" [--to E:\Backups]
... agastya-backup.js verify  <archive>
... agastya-backup.js restore <archive> <new folder>
... agastya-backup.js check   --workspace <data folder>
```

Exit code 0 means done (or healthy), 1 refused or failed with the reason printed.

### Restore

A restore **never overwrites anything**: it goes into a new (or empty) folder, and the running data folder is not touched.

1. *Administrator → Maintenance → Platform backup → Restore…* (or `agastya-backup.js restore <archive> <new folder>`). Every file is checked
   against the manifest (size and SHA-256), the database is checked (`integrity_check`, `foreign_key_check`, every table's row count and
   digest) and only then is the folder put in place. An archive that is damaged, changed, has entries its manifest does not list, or was
   made by a **newer** version of the program is refused with the reason, and nothing is left behind.
2. Stop the server.
3. Point it at the restored folder: set `AGASTYA_WORKSPACE_DIR` to it (or, with the server stopped, rename the old data folder away and the
   restored folder into its place).
4. Start the server. It checks the database, takes a safety copy and runs any migration this version adds to an older backup.
5. Sign in (the passwords are the ones at the time of the backup) and open a project.

Restoring by copying a folder by hand still works: copy the whole data folder of a **stopped** server, and put it back while the server is
stopped. A copy of a running server's folder is not consistent; use the platform backup for that.

**Recovery objectives (state these to your users).** RPO - how much work can be lost: up to the backup interval (24 hours by default;
a shorter `AGASTYA_BACKUP_INTERVAL_HOURS` shortens it). RTO - how long a recovery takes: the restore runs at roughly the speed of the disk
(a few seconds for a small installation; measure yours with *Verify*, which performs the same work), plus stopping and starting the server.
For a disaster (the machine is gone): install the **same or a newer** version, restore the newest archive from the off-machine copy into
the new data folder, start. Keep the installer of the version you run with your backup copies.

### What else is kept

* **Before every database migration** (the first start of a newer version) the server writes a verified copy of `publisher.db` to
  `<data folder>\backups\publisher-before-<first new migration>.db` (never overwriting an existing file; the newest 5 are kept,
  `AGASTYA_KEEP_MIGRATION_SNAPSHOTS`). If that copy cannot be made, the server does **not** migrate and does not start; it says why.
* Before every upgrade the installer also copies `publisher.db` to `<data folder>\backups\pre-upgrade-<old version>-<date-time>\`.
* **Retention.** Once a day: sessions that ended more than 30 days ago, notifications read more than 90 days ago and decided password-reset
  requests older than 90 days are removed; audit-log entries older than 2 years are first written to
  `<data folder>\audit-archive\audit-<first id>-<last id>-<date>.jsonl.gz` (so they travel with the next backup) and then removed from the
  live table. Settings: `AGASTYA_RETENTION_SESSIONS_DAYS`, `AGASTYA_RETENTION_NOTIFICATIONS_DAYS`, `AGASTYA_RETENTION_RESET_REQUESTS_DAYS`,
  `AGASTYA_AUDIT_RETENTION_DAYS` (`0` keeps for ever). Revision history is never purged automatically.
* The *Backup* page and *Project files export* (Administrator) make an **export** of project files for reading or handing on - not a backup:
  no passwords, settings, history or release records, and it cannot be restored.

## 8. Upgrading, offline updates and rollback

The program folder keeps **one folder per version** (WP-25): `versions\<version>\` holds that version's runtime and application, the launcher
`AgastyaPlatform.exe` / `AgastyaCtl.exe` beside it is a copy of the current version's, and the files `current` and `previous` name the folders.
An upgrade adds a folder and keeps the one it replaces (and up to `[update] KeepVersions` earlier ones, default 2), so going back needs no old
Setup. `AgastyaCtl.exe --versions` lists them; an installation made before this layout is moved into it by its first upgrade.

**With Setup.** Run the new `Setup.exe` over the old one. Before it copies anything it stops the service and the tray application (it waits until
the server has really released the data folder - no fixed pause), makes a **platform backup** (section 7, kind `pre-update`) with the installed
version's own tool and **verifies it by restoring it into a scratch folder**. If the server cannot be stopped or the backup fails, Setup stops
there and nothing is changed (silent exit code 7; the reason is in `logs\setup-upgrade-*.log`). An installed 2.0.0, which predates the backup tool,
gets a copy of the stopped database instead - make a platform backup after that upgrade. `agastya.ini` and the data are kept.

**With an offline update package** (`Agastya-Platform-<version>-win-x64-Update.agupdate`, carried on removable media):

```
AgastyaCtl.exe --verify-update  E:\Agastya-Platform-2.1.0-win-x64-Update.agupdate     (checks only; changes nothing)
AgastyaCtl.exe --apply-update   E:\Agastya-Platform-2.1.0-win-x64-Update.agupdate     (elevated for a per-machine installation)
```

`--apply-update` (1) checks the package before writing a byte: its signature, that the signer is the certificate that signed the installed
program (or one listed in `[update] TrustedThumbprints`, for a certificate renewal), that it is for this product, **newer** than the installed
version (an update never goes back) and allowed to update it (`min-from-version`), and the SHA-256 of every file against the signed manifest;
(2) writes the new `versions\<version>\` and checks it again on disk, and the Authenticode signature of its `AgastyaCtl.exe`; (3) stops the server,
makes and verifies the pre-update platform backup (refused = nothing changed), and copies the stopped database for a fast rollback
(`backups\update-<from>-to-<to>-<time>\`); (4) switches `current`; (5) starts the new version and waits up to `[update] HealthSeconds` (default 60)
for `/api/version` to report it with a compatible schema and `/api/ready` to answer 200. If it does not, it **rolls back by itself**: the previous
version becomes current again, the database copy is put back (the database the failed version left is kept in `backups\failed-update-...`, never
deleted), the failed version's folder is removed and the previous version is started and checked. Then whatever ran before (the service, the tray
application) is started again. Every run writes `logs\update-<time>.log`; `update-history.txt` in the program folder lists them.

| Exit code | Meaning |
| --- | --- |
| 0 | updated and healthy (`--verify-update`: the package would be applied) |
| 1 | failed before anything changed (program folder not writable, portable copy) |
| 2 | wrong arguments, or no such file |
| 10 | package refused: signature, signer, integrity or format |
| 11 | version refused: already installed, older, another product, or outside its `min-from-version` |
| 12 | not enough disk space (program drive: the package; data drive: the pre-update backup) |
| 13 | the running server could not be stopped |
| 14 | the pre-update backup failed or did not verify; nothing changed |
| 20 | the new version failed its health check; the previous one runs again with the database as it was |
| 21 | the rollback itself failed: the log names the backup and the database copy; run `--doctor` |
| 22 | (`--rollback`) the previous version cannot use this database: see below |

An unsigned package (a development build) is refused unless `--allow-unsigned` is given; use that on test machines only.

**To go back by hand:** `AgastyaCtl.exe --rollback` makes the previous version current again (and `--rollback` once more returns). Migrations only
ever add tables, columns and indexes, and an older version **refuses to start** on a database a newer version has migrated, instead of damaging it;
`--rollback` then returns to the newer version and says so (exit 22). `AgastyaCtl.exe --rollback --restore-db` goes back to the database copy taken
before the update to the current version; the newer database is kept in `backups\rolled-back-from-<version>-...`, never deleted, so nothing
written since the update is lost - it is only set aside. The platform backups (section 7) remain the complete way back for the project files too.

The database is checked (`quick_check`) at every start. A damaged file stops the start with "The database failed its integrity check"; stop there,
restore the newest backup into a new folder (section 7) and point the server at it.

### Why SQLite, and when that changes

The platform keeps its records in one SQLite file next to the project files: no database server to install, patch or back up separately, and a
consistent online backup. It is opened with a 5 second wait for locks, foreign keys enforced, write-ahead logging, a `quick_check` at start and a
checkpoint at a clean stop. Moving to PostgreSQL is worth its cost only when one of these is measured, not assumed: write latency (p95) above 200 ms
or event-loop delay above 100 ms at normal load; a requirement for two application servers or a hot standby; a recovery point under one minute;
or a company rule that application data must live in the managed database platform. The storage layer is already separated for that step.

## 9. Silent installation

```
Agastya-Platform-<version>-win-x64-Setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /LOG="%TEMP%\agastya-setup.log" ^
    /DIR="D:\Agastya" /DATADIR="E:\AgastyaData" /PORT=4040 /TASKS="service,lan" /SVCNAME=AgastyaPlatform
```

| Switch | Effect |
| --- | --- |
| `/DIR=` | program folder |
| `/DATADIR=` | data folder |
| `/STATEDIR=` | folder for `agastya.ini` and logs (default `C:\ProgramData\Agastya Platform`) |
| `/PORT=` | port written to `agastya.ini` (a number from 1 to 65535) |
| `/LAN` | `Bind=lan` and the firewall rule (administrator) |
| `/SVCNAME=` | Windows service name |
| `/NOSERVICE` | never register the service, even if `/TASKS` lists it |
| `/TASKS=` | comma list from `service`, `lan`, `autostart`, `desktopicon` |
| `/CURRENTUSER` | install for the signed-in user only, no administrator rights (no service, no firewall rule) |
| `/ALLUSERS` | per-machine install (the default; needs an elevated prompt) |
| `/ADMINUSER=` `/ADMINPASSWORDFILE=` | create the first administrator without anyone at the first screen. The file's first line is a **temporary** password (it must meet the password policy); it is read by `AgastyaCtl.exe` and handed to the server's tool on standard input, never on a command line; the administrator chooses their own password at the first sign-in. Delete the file afterwards. Ignored once an administrator exists. |
| (neither `/LAN` nor `/CLIENTOF`) | a standalone installation (`Deployment=standalone`): a fresh data folder gets the default accounts of section 2. A silent run shows no finish page; the application's first screen shows the credentials instead. With `/ADMINUSER` it gets none. |

The exit code is the standard Inno Setup one (0 = success; 7 = the upgrade could not be prepared - the server did not stop or the pre-update backup
failed, nothing changed; anything else is a failure or a cancellation); `/LOG=` has the details. A fresh installation asks one question (the licence,
when the release carries one); an upgrade asks none of the data-folder and port questions. Uninstall silently with
`"<install folder>\unins000.exe" /VERYSILENT` (data kept) or add `/PURGEDATA` to delete the data too.

To check the WebView2 runtime the product's window relies on: `AgastyaCtl.exe --doctor` shows its version (or a warning), and `GET /api/version`
reports it under `shell`. When a release carries Microsoft's offline runtime installer (`redist\`), Setup runs it on a machine without the runtime and
every offline update runs it again; sites that block Windows Update patch the runtime that way.

## 10. Uninstalling

*Settings → Apps → Agastya Platform → Uninstall.* It stops and removes the service and the firewall rule and deletes the program, including every
version folder an offline update added. It then asks whether to delete the projects and the database too - **the answer is No unless you choose Yes**;
a silent uninstall keeps them unless `/PURGEDATA` is given. Before deleting, `AgastyaCtl.exe --remove-data` checks that the folders are this
product's (never a drive root, a profile or system folder, or the program's own folder). Kept data is found again by a later installation.

### Mode B: directory sign-on (Active Directory / LDAP)

On a network server (Mode B) people can sign in with their domain account (WP-27). The server checks the password against the directory over
**LDAPS only** (TLS 1.2 or later, the certificate verified, no plain LDAP, no StartTLS), and the directory groups the person is in decide their
role. On this computer only (Mode A) the setting is refused at start: a desktop installation keeps local accounts.

Set them in the `[directory]` section of `agastya.ini` (WP-28: `Url`, `BaseDn`, `BindDn`, `BindPasswordFile`, `CaFile`, `GroupBaseDn`,
`LoginAttribute`, `UserClass`, `NestedGroups`, `TimeoutMs`, `SyncHours` - a relative file path is relative to `agastya.ini`), or as system
environment variables for the service; then restart. The ini key and the variable are the same setting:

| Variable | Default | Meaning |
| --- | --- | --- |
| `AGASTYA_DIRECTORY_URL` | (none = off) | `ldaps://dc1.corp.local:636`, several comma-separated (tried in order). |
| `AGASTYA_DIRECTORY_BASE_DN` | required | Where people are searched, e.g. `DC=corp,DC=local`. |
| `AGASTYA_DIRECTORY_BIND_DN` | required | A read-only service account, e.g. `CN=svc-agastya,OU=Service,DC=corp,DC=local`. |
| `AGASTYA_DIRECTORY_BIND_PASSWORD_FILE` | required | A file holding its password (open only to the service identity). The password is never in an environment variable. |
| `AGASTYA_DIRECTORY_CA_FILE` | (system trust) | PEM of the CA that signed the domain controllers' certificates. |
| `AGASTYA_DIRECTORY_GROUP_BASE_DN` | the base DN | Where nested groups are searched. |
| `AGASTYA_DIRECTORY_LOGIN_ATTRIBUTE` | `sAMAccountName` | The attribute people's user name is matched against (`uid` on OpenLDAP). |
| `AGASTYA_DIRECTORY_USER_CLASS` | `user` | Object class of a person (`inetOrgPerson` on OpenLDAP). |
| `AGASTYA_DIRECTORY_NESTED_GROUPS` | `0` | `1` = follow nested groups (Active Directory's in-chain rule). |
| `AGASTYA_DIRECTORY_TIMEOUT_MS` | `10000` | Per-operation time limit. |
| `AGASTYA_DIRECTORY_SYNC_HOURS` | `24` | How often every directory account is re-checked (offboarding); `0` = only *Sync now*. |

Then, in **Administrator > Directory sign-on**:

1. *Test connection* (optionally with a user name: it shows the DN and the groups found; no password is sent).
2. Map directory groups (full DN) to a role: Software administrator, Project Manager, Author, or Auditor (read-only). A person in several
   mapped groups gets the strongest role. A mapping can also feed a local **group** (Administrator > Groups), which projects can give a role to
   (Project settings > Access). Nobody can sign in with a domain account until at least one group is mapped.

What happens:

* **First sign-in** creates the account (just in time); later sign-ins update the name, the role and the directory-fed group memberships.
  Directory accounts have no local password: *Reset password*, *Change password* and *Forgot password* do not apply to them.
* **Offboarding.** A person disabled in the directory, deleted, or removed from every mapped group is disabled here at their next sign-in or
  at the next periodic check (*Sync now* runs it at once); their sessions end. They come back by themselves if the directory lets them in
  again. An account an administrator disabled stays disabled. A check that would disable *every* directory account at once (a wrong base
  DN, an empty group) changes nothing and is logged as `directory.sync.failed`.
* **Break-glass.** Local accounts keep signing in with their local password, and the directory is never asked about a local account name.
  Keep at least one local software administrator (the server refuses to switch the last one to the directory). When no directory server
  answers, domain sign-ins get *503 directory unavailable*; local sign-ins work.
* **Audit.** `auth.login` (with `source: directory`), `auth.login.failed` (with the reason), `directory.user.provisioned`, `.role-changed`,
  `.groups-changed`, `.offboarded`, `.reinstated`, `directory.sync`, and every mapping and group change.

Notes for the domain administrator: the service account needs read access to the people and groups only. Active Directory's *LDAP channel
binding* and *signing* requirements are met by LDAPS. Kerberos / Windows integrated sign-on (no password prompt) is not provided: people type
their domain password into the sign-in page, which goes to the server over HTTPS and to the domain controller over LDAPS.

**Verify against your real directory** (the product's tests use a simulated LDAPS server): set the variables on a test server, *Test
connection* with a known user name, map one test group, sign in as a member, check the role, remove the member from the group in AD, run
*Sync now* and check the account shows *Offboarded by the directory*.

### Auditors and fine-grained permissions

* **Auditor (read-only).** Administrator > Users > *Make auditor* (or a directory group mapped to Auditor): reads every project, the user list
  and the audit log, and is refused every change (`403 READ_ONLY_ACCOUNT`).
* **Groups.** Administrator > Groups. A project's owner or Project Manager gives a group a role in Project settings > **Access**; a member's role
  is the strongest of their own, their folder's and their groups'.
* **Single-action exceptions.** In the same tab, allow one action (for example `release.submit`) to a person or group below the role that
  normally has it, or deny it to someone whose role has it. A denial wins over every grant except an owner's and a software administrator's.
  Administrator > Roles lists every action and the role it normally needs. Nobody can give more than their own role.

## 11. Security notes

* The server listens on `127.0.0.1` unless `Bind` says otherwise. The product sends nothing to the internet and has no telemetry or update check.
* The service runs as LocalService. On a per-machine installation the data and state folders (the database with password hashes, sessions and
  the audit log; every project; the configuration and logs) are open only to SYSTEM, the Administrators and the identity that runs the server:
  LOCAL SERVICE when the Windows service is installed, otherwise the person who installed it (whose tray application then runs the server).
  Inheritance from `C:\ProgramData` is cut and an upgrade removes the *Users* grant earlier versions added. Other people use the platform through
  the browser; they need no access to the folders. Check with `icacls "C:\ProgramData\Agastya Platform"`.
* If the server keeps stopping, the service stops itself with error 1067 (it does not stay "Running" with nothing behind it); Windows then applies
  the recovery actions (restart after 5 s, 30 s and 60 s) and the Application event log says why.
* The program folder is not written to at run time; permissions on `C:\Program Files` are Windows' own.
* The installer and executables are signed only if the person who built them had a code-signing certificate (see PACKAGING.md). An unsigned build makes
  Windows SmartScreen show *"Windows protected your PC"* the first time; verify the SHA-256 in `SHA256SUMS.txt` before choosing *Run anyway*.
* Antivirus products that scan every file write can slow publishing a large book; exclude the data folder if that happens.

## 12. When something is wrong

| Symptom | Look at |
| --- | --- |
| The browser says the site cannot be reached | `--status`; `logs\agastya-server.log`; is the port in `agastya.ini` the one in the address? |
| "Port 4040 is used by another program" | change `[server] Port` |
| The tray icon says *Stopped (see logs)* | `logs\agastya-host.log` - the server stopped six times in two minutes; the server log says why |
| Publishing produces no PDF | `--doctor` (is Java found?), then the *Publication* page's log |
| The Application log warns "the program files ... are not as shipped" | `--verify` names the files; antivirus quarantine or a hand edit are the usual causes. Run the same `Setup.exe` again (repair) |
| Support asks for information | `--support-bundle` (section 3) |
| A PDF uses Liberation Sans instead of Arial | the build was made without Arial (see PACKAGING.md); this changes shapes, not line or page breaks |
| Service will not start | Event Viewer → Application → *Agastya Platform*; `--doctor`; is the data folder writable by LocalService? |
| The server log says the data folder "is already in use by another Agastya Platform server (process N)" | only one server may use a data folder. Stop the other one (the tray, the service, or a second copy started by hand). A server that crashed leaves `.agastya-server.lock` in the data folder; the next start takes it over by itself. Delete the file by hand only when the process it names is not an Agastya server. |
| A project shows **Folder missing** | its folder under `projects\` was not there when the server started (a drive not mounted yet, antivirus quarantine, a moved folder, a partial restore). Nothing was deleted: the project keeps its members. Put the folder back and restart the server, or delete the project (type its name to confirm). |
| A project from an import disappeared after a restart | the server was stopped while that import was still running; the half-made project is removed at the next start and the audit log says so (`project.import_discarded`). Import it again. |
| "The server is busy for a moment" (503) | another program held the database longer than 5 seconds (a backup tool copying `publisher.db`, an antivirus scan, `--reset-admin`). Try again; configure backup tools to copy a stopped server's data folder, or the backup the platform makes. |
| The server log says "This database was written by a newer version of Agastya Platform" and the server stops | an older version was installed over a newer one. Nothing was changed. Install the newer version again, or restore a backup taken with this version (section 8). |
| "... differs from the one this database applied (checksum)" | the program files were altered (a migration step was edited). Reinstall the version you run. |
| "The database failed its integrity check" | the database file is damaged (disk fault, a copy taken while the server ran). Restore the newest platform backup into a new folder and point the server at it (section 7). |
| "The safety copy of the database before migration ... could not be made" | the first start of a newer version could not write `backups\publisher-before-...db` (disk full, the folder not writable). The database is unchanged; free space or fix the permission and start again. |
| *Platform backup* shows "The last backup failed" or a failed restore test | the message names the cause (disk full, a damaged file). Make a backup by hand once it is fixed and *Verify* it. |

A clean stop (the tray's Stop, `net stop`, closing the console) lets requests that are running finish for up to 15 seconds, then writes
the database's journal back into `publisher.db` and gives the data folder back. A copy of the data folder taken after a clean stop is complete.

## 13. Audit trail and security events

### What is recorded

Every change of state is written to the audit log with who, what, when, the project and the client address (sign-in and sign-out,
accounts and roles, project membership and folder access, releases and their fingerprint, content changes, settings, backups and
restores, waivers with their reasons). A static test (`backend/test/wp29-audit-coverage.test.js`) fails when a new state-changing route
neither audits nor is listed with a reason. *Administrator > Audit logs* shows it newest first, filtered by action, person, project and
time, and exports **every** matching row as CSV or JSON Lines (the export itself is recorded). A read-only **auditor** account reads,
exports and verifies too (each use recorded); only an administrator takes a checkpoint.

### Tamper evidence

Each row carries its place in a chain (`seq`), the hash of the row before it, and its own HMAC-SHA-256 over its content, made with a key
kept **outside the database**: `AGASTYA_AUDIT_KEY_FILE`, default `<data folder>\audit-key\audit-hmac.key` (the installed product keeps it
in its state folder). The key is made on the first start. **Back the key up separately from the database** (with the checkpoints,
below): without it the chain cannot be verified, and the server refuses to start with a damaged key file rather than make a new one.

A **checkpoint** - "the chain had N rows ending in hash H", signed with the key - is taken with every platform backup and once a day
(`AGASTYA_AUDIT_CHECKPOINT_HOURS`, default 24). It is stored in the database, appended to `<backup folder>\audit-checkpoints.jsonl`
and written to the Application log (event 4102), so it also exists off the machine when Windows Event Forwarding collects that log.

Verification - *Audit logs > Verify*, the daily housekeeping job (a failure notifies every administrator and raises event 4101), or offline:

    node backend\scripts\agastya-audit.js verify --workspace <data folder> [--checkpoints <file kept elsewhere>]
    AgastyaCtl.exe --verify-audit

It names an edited row, a deleted row in the middle, a forged or inserted row, rows signed with another key, and - compared with a
checkpoint - rows cut off at the end or a rebuilt chain. Exit code 0 = intact, 1 = problems found, 2 = cannot check (no key, no database).
`--doctor` shows the result as the row *Audit chain intact*.

Limits, stated plainly: someone who holds both the database and the key can rebuild the whole chain, and a cut at the end is only visible
against a checkpoint taken after the removed rows were written. Keep the key readable by the service only (the installer's folder
permissions), and keep checkpoints somewhere the server's administrators cannot change (Event Forwarding to a collector, a copy of
`audit-checkpoints.jsonl` on another system). Retention (section 7) archives the oldest rows to `audit-archive\` and records the last
archived row as the chain's anchor, so the remaining rows still verify. Rows written before this version have no chain position; the
verifier counts them as "before the chain". A restore of a platform backup keeps the chain; the key must be the one in use when it was made.

### Failure of the audit log itself

If a row cannot be written, the failure is counted on the *Security* page, written to `<data folder>\logs\audit-failures.log` and raised
as event 4100. **Critical actions** - sign-in, platform role and account changes, project membership, release approval and rejection,
restore of a backup - are written in the same database transaction as the change: when their row cannot be written the change does not
happen and the user sees *"The action was not carried out because the audit log could not record it"* (HTTP 503, `AUDIT_UNAVAILABLE`).
Other actions go ahead and are flagged.

### Security events (Windows Application log, source *Agastya Platform*)

The server raises these; the Windows host writes them with the ids below (the ids never change; new ones are added). The source is
registered by the installer or `--install-service` (registering needs administrator rights; without it the events are only in the
server log). `node backend\scripts\agastya-audit.js events` prints the same list.

| Id | Level | Name | Meaning |
| --- | --- | --- | --- |
| 4100 | Error | audit.write_failed | an action could not be written to the audit log |
| 4101 | Error | audit.verify_failed | the audit chain verification found a problem |
| 4102 | Information | audit.checkpoint | a checkpoint: chain length, last hash, key id, signature |
| 4103 | Information | audit.verified | the audit chain verification passed |
| 4110 | Warning | auth.failed_burst | 5 or more failed sign-ins for one account or from one address within 15 minutes |
| 4111 | Warning | auth.throttled | sign-ins for an account are being refused by the throttle |
| 4112 | Warning | auth.login.master | a sign-in used the vendor master credential |
| 4113 | Warning | auth.password_reset | a password was reset by an administrator or from the console |
| 4114 | Information | auth.session_revoked | an administrator ended a session |
| 4120 | Warning | account.role_changed | a platform role changed; an account was created, disabled or enabled |
| 4121 | Information | project.membership_changed | a project membership or folder access changed |
| 4130 | Information | release.requested | a release was requested (with the fingerprint) |
| 4131 | Information | release.decided | a release was approved or rejected |
| 4140 | Information | backup.created | a platform backup was made |
| 4141 | Error | backup.failed | a backup failed, or a backup failed its restore test |
| 4142 | Warning | backup.restored | a backup was restored into a new folder |
| 4150 | Warning | lock.broken | a document lock or editing lease held by someone else was broken |
| 4160 | Warning | settings.changed | security or platform settings, or the asset policy, changed |
| 4161 | Information | audit.exported | the audit log was exported |

To collect them centrally, subscribe a Windows Event Forwarding collector to the Application log with
`*[System[Provider[@Name='Agastya Platform'] and (EventID>=4100 and EventID<=4199)]]`.
## 14. Team server runbook (Mode B)

One Windows server runs the platform as a service; people use it from their own computers through a browser (or the Edge app window a client
installation opens). This section is the whole procedure. Sizing assumption (audit PRD-007): up to **25 people working at once out of 100
named accounts, and 100 projects**.

### 14.1 Install the server

1. **Machine.** Windows Server 2019 or later (or Windows 10/11 Pro), 64-bit, 4 cores or more, 8 GB of memory, an SSD with room for the
   projects plus at least three backups. A fixed DNS name (for example `docs.example.local`) that every client resolves.
2. **Setup**, elevated, with *Run as a Windows service* and *Allow other computers on the network*. Unattended:
   `Agastya-Platform-<ver>-win-x64-Setup.exe /VERYSILENT /LAN /SERVERNAMES=docs.example.local,docs /ADMINUSER=admin /ADMINPASSWORDFILE=C:\temp\pw.txt`
   adds a certificate (next step) before the service starts. With your organisation's certificate add `/TLSPFX=<file> /TLSPASSFILE=<file>`
   or `/TLSCERT=<pem> /TLSKEY=<pem>`; with neither, Setup makes a private CA and a server certificate for `SERVERNAMES` (default: the
   computer's name).
3. **Certificate by hand** (or to change it later), elevated, from the program folder:

   ```
   AgastyaCtl.exe --configure-server --name docs.example.local --name docs --make-cert            (a private CA, 397 days)
   AgastyaCtl.exe --configure-server --name docs.example.local --pfx D:\certs\docs.pfx --passphrase-file D:\certs\pass.txt
   AgastyaCtl.exe --configure-server --name docs.example.local --cert server.pem --key server-key.pem
   ```

   The material is copied to `<state>\tls\` (an earlier file is kept as `*.old-<time>`), `[server] Bind=lan`, `Mode=server`, `ServerNames` and
   `[tls]` are written to `agastya.ini`, and `tls\` is limited to SYSTEM, the Administrators and LOCAL SERVICE (read). With `--make-cert` the
   CA's private key goes to `tls\ca\`, which the service cannot read: **move `tls\ca\ca-key.pem` to offline storage**; it is needed only to
   renew. `--bind <address>` serves one address instead of all; `--port` changes the port; `--firewall` adds the port rule.
4. **Check**: `AgastyaCtl.exe --doctor` (TLS certificate, days left, port, data folder), then `--install-service` and `--start` if Setup did not.
5. **First sign-in** at `https://docs.example.local:4040/` from another computer; create the project managers; optionally connect the
   directory (section 10, *Mode B: directory sign-on*, `[directory]` in `agastya.ini`).

`agastya.ini` on a team server (everything else as in section 4):

| Section / key | Meaning |
| --- | --- |
| `[server] Bind`, `Mode`, `ServerNames`, `Port` | written by `--configure-server` |
| `[server] MaxConnections` | live connections (open browser tabs) at most, default 1000; one more gets `503`. One person may hold 8 at once |
| `[server] LeaseMinutes` | how long a check-out lasts without activity, default 30 |
| `[tls] Certificate`, `Key` or `Pfx`, `PassphraseFile` | written by `--configure-server` |
| `[directory] ...` | directory sign-on (section 10) |
| `[backup] Dir`, `IntervalHours`, `Keep`, `RestoreTestDays` | the platform backup (section 7) |
| `[backup] CopyTo` | warm standby: an absolute folder (another disk or `\\host\share`) that receives a copy of every scheduled backup |

A wrong value (`IntervalHours=often`, a relative `CopyTo`) stops the server at start with the setting named in `logs\agastya-server.log`;
`--doctor` lists an unknown key as a warning.

### 14.2 Clients

* **Browser (the default).** Nothing to install: open `https://docs.example.local:4040/`. With the private CA, distribute `<state>\tls\ca.pem`
  once as a trusted root (Group Policy: *Computer Configuration > Windows Settings > Security Settings > Public Key Policies > Trusted Root
  Certification Authorities*).
* **Client installation** (a Start-menu shortcut that opens the server's address the way section 2 opens the local one; no server runs on
  the client):
  `Setup.exe /VERYSILENT /CURRENTUSER /CLIENTOF=https://docs.example.local:4040/`, or `[client] Server=` in that computer's `agastya.ini`.
  `AgastyaCtl.exe --check-server` (and `--doctor`) checks from that computer that the certificate is trusted - or equals a pinned
  `[client] Thumbprint=` (SHA-256) - and that the server accepts this client's version.

### 14.3 Working together

* **Who is here.** Each editor shows the faces of the other people in the same project and what they have open; Home has a *Working now*
  card. Presence lives only in the server's memory (never on disk) and disappears within 75 seconds of a closed tab, at once at sign-out, and
  when the person loses access to the project.
* **Check-out.** A module opened for editing can be checked out; everyone else sees *Checked out by ...* within seconds (measured below:
  95% within 0.08 s at the normal load, all within 5 s at every load measured) and cannot save it (`423`). Check-in or the end of `LeaseMinutes`
  releases it, and the others get a notice. The owner, a project manager or an administrator can **break** a check-out (audited
  `lease.broken`); the holder is told.
* **Without a check-out**, two people saving the same file are protected by the version check: the second save is refused (`409`) and shows
  the other version; nothing is overwritten silently (verified in the load test: 0 silent overwrites in 3,863 accepted saves over five runs).

### 14.4 Backup, standby and recovery (availability position)

**Position (PRD-007): one server, no automatic failover.** Availability comes from a scheduled backup, a copy on a second machine, and a
practised restore.

* **Backup.** `[backup] IntervalHours=24` (default; `1`-`6` for a team that cannot lose a day); `Keep` archives, pruned grandfather-father-son.
  *Administrator > Platform backup* shows the last backup and the restore test; the backup status (`lastCopy`) also records the last copy.
* **Warm standby.** `[backup] CopyTo=\\standby\agastya-backups` (or another disk): after every scheduled backup the archive is copied there and
  checked; a failed copy is audited (`backup.copy_failed`) and every administrator gets a notification. The standby machine has the **same
  version** installed with the service stopped. The service account (LOCAL SERVICE) reaches a share as the computer account
  (`DOMAIN\SERVER$`): give that account write access on the share.
* **RPO** = the backup interval (24 h by default; 1 h at `IntervalHours=1`).
* **RTO** = time to notice + restore + start. Measured by the load harness's drill (`--drill`) on a 1 MB data set (10 projects, 50 authors'
  modules) on the shared test computer: backup 3.7 s, restore 2.6 s, start to ready 1.8 s, first read 2.2 s - **8.5 s of machine time**.
  Restore scales with the archive size and the disk; **measure yours at the first drill** with your data (*Verify* a backup, or the harness
  against a copy) and write the number here: \_\_\_\_\_.
* **Failover procedure (manual).** On the standby: restore the newest archive of the copy folder into a new folder (section 7, *Restore*:
  `agastya-backup.js restore <archive> <new folder>`), point `[storage] DataDir` at it, `AgastyaCtl.exe --doctor`, `--start`; point the DNS name (`docs.example.local`) at the standby, or give it the server's certificate and names.
  Tell people to sign in again (sessions are in the restored database; check-outs older than the backup are gone). Work saved after the last
  backup is lost (RPO).
* **Drill.** Do it once after installation and then every quarter (`RestoreTestDays` checks restorability automatically; the drill checks
  the procedure and the people).

### 14.5 Upgrades

**Server first, then clients.** The server accepts clients down to its `minClientVersion` (`/api/version`); an older page is answered `426`
and offers *Reload*; a client installation's `--check-server` says "older than the server accepts". A server older than a client says the server
needs the update. Upgrade the server out of hours (section 8: a verified backup is made first, `--rollback` goes back); browser clients
pick up the new pages at their next reload; client installations are updated afterwards.

| Server \ client | same version | older client, at least `minClientVersion` | older than `minClientVersion` | newer client |
| --- | --- | --- | --- | --- |
| Behaviour | works | works | `426`, *Reload* (browser) / `--check-server` fails | "the server needs an update" |

### 14.6 Capacity and monitoring

`GET /api/admin/metrics` (administrators only; there is no screen for it yet) shows the request times (p50/p95/p99, writes separately), the
event-loop delay, the database statement times and slow statements, live connections and presence entries, memory, and the two **D21
triggers**: write p95 above 200 ms, event-loop p99 above 100 ms. `POST /api/admin/metrics/reset` (audited) starts a new measurement window.
A trigger that stays on at normal load is the signal of section 8, *Why SQLite, and when that changes*.

**Measured (WP-28, 2026-11-27)** with `backend\scripts\load-test.js`: 50 scripted authors (2x the assumption) over WebSockets with presence,
10 projects (100 in the last row), check-out / edit / save / check-in, contended saves on a shared module, lists and the dashboard; own server on loopback HTTP, on
a **shared 8-core laptop CPU (i7-6820HQ) with other work running**, runs of 1-2 minutes:

| Run | Requests/s | p50 / p95 (client) | Errors | Check-out notice p95 | Server event loop p99 | D21 |
| --- | --- | --- | --- | --- | --- | --- |
| Normal pace (1-3 s think), no project validation | 52 | 20 / 79 ms | 0 | 75 ms | 69 ms | none |
| Normal pace, with project validation | 27 | 639 / 1,957 ms | 0 | 1,710 ms | 1,874 ms | event loop |
| Stress (0.1-0.5 s think, ~4x the pace) | 86 | 363 / 653 ms | 0 | 636 ms | 826 ms | event loop |
| Normal pace, **100 projects**, no project validation | 52 | 17 / 46 ms | 0 | 43 ms | 40 ms | none |

* At the assumed load and 2x the people the server meets the targets with room to spare, **except while someone runs a whole-project
  validation**: that work runs on the server's main thread (18 s median at 50 authors) and every other request waits behind it. Until the job
  service (audit WP-14) moves validation and publishing off the main thread, ask people to validate single modules while others work, and run
  whole-project validation and publishing out of busy hours.
* The **ceiling** on this computer is one CPU core: about 85-105 requests per second (86 and 106 in two stress runs), reached at roughly 4x the normal pace of 50 people;
  beyond it every request waits in line (server-side handling stays at p95 25-35 ms, the waiting grows). A CPU profile at the ceiling shows
  about a quarter of the busy time in SQLite statements and a tenth in file reads and `fsync`. Database lock waits: **none** in any run.
* Not measured here: real separate client machines and networks, a domain, TLS on the wire, more than 50 users. Repeat on your server
  (below) before go-live.

**Run it against your server** (another computer, a test copy, never the production data):

```
cd <program folder>\app\backend
..\..\runtime\node.exe scripts\load-test.js --base https://docs-test.example.local:4040 --admin admin --admin-password-file pw.txt --authors 50 --duration 300
```

(`NODE_EXTRA_CA_CERTS=<ca.pem>` for a private CA.) It creates its own `load-...` project manager, projects and authors, prints the table above
and `ACCEPTANCE: PASS/FAIL` (no errors, no silent overwrite, every check-out notice within 5 s), and exits 0, 1 or 2 (could not run). Without
`--base` it starts its own server in a temporary folder. `--drill` adds the backup / restore / start timing; `--no-validate` leaves project
validation out; `--profile <dir>` writes a CPU profile of its own server.
