# Agastya Platform - administrator guide (Windows)

For the person who installs, runs and looks after the server. Nothing here needs the internet: the product never contacts one.

## 1. What is installed, and where

| What | Where (installed for all users) | Where (portable ZIP) |
| --- | --- | --- |
| The program | `C:\Program Files\Agastya Platform\` (never written to at run time) | the unzipped folder |
| Configuration `agastya.ini` | `C:\ProgramData\Agastya Platform\agastya.ini` | `config\agastya.ini` |
| **Your data** (projects, templates, `publisher.db`) | `C:\ProgramData\Agastya Platform\workspace\` (or the folder chosen at install) | `data\workspace\` |
| Logs | `C:\ProgramData\Agastya Platform\logs\` | `data\logs\` |

An installation "for me only" (no administrator rights) uses `%LOCALAPPDATA%\Agastya Platform\` instead of ProgramData.
Upgrading and uninstalling never touch the data folder. **Back it up** (section 7).

## 2. Starting it

* **Tray application** (default): Start menu → *Agastya Platform*. A tray icon appears, the server starts, and the browser opens at
  `http://localhost:4040/`. Right-click the icon for *Open*, *Open data folder*, *Open log folder*, *Restart server*, *Exit*. It runs while the
  user is signed in. The installer can start it at sign-in (*Start Agastya Platform when I sign in*).
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

**First visit:** the application asks for the administrator account. Nothing ships with a default password.
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
data folder is writable, free disk space, the service. Exit code 0 means no problem was found.

## 4. Configuration - `agastya.ini`

Plain text; every key is optional; restart the application or service after a change. The installer writes the file once and keeps your edits on upgrade.

| Section / key | Default | Meaning |
| --- | --- | --- |
| `[server] Port` | `4040` | TCP port. |
| `[server] Bind` | `loopback` | `loopback` = this computer only. `lan` = every network interface. Or one IPv4 address. |
| `[storage] DataDir` | `<state>\workspace` | Where projects and the database live. Move it by stopping the server, moving the folder, and editing this line. |
| `[security] SecureCookies` | `0` | Set `1` if people reach the server over HTTPS (a reverse proxy in front). |
| `[app] OpenBrowser` | `1` | Open the browser when the tray application starts. |
| `[logging] MaxFileMB`, `KeepFiles` | `10`, `5` | Log rotation: at the size limit a log is renamed `.1`, `.2` ...; the oldest beyond `KeepFiles` go. |
| `[service] Name` | `AgastyaPlatform` | Windows service name. |

## 5. Letting other computers connect

By default the server answers on this computer only (`Bind=loopback`). To serve a team:

1. Set `Bind=lan` (or choose *Allow other computers on the network* in the installer, or `AgastyaCtl.exe --install-service --lan`).
2. Allow the port through the Windows Firewall. The installer option does it for you (an inbound rule named *Agastya Platform (LAN access)* for
   `runtime\node.exe`, TCP, **private and domain networks only**). By hand:
   `netsh advfirewall firewall add rule name="Agastya Platform" dir=in action=allow protocol=TCP localport=4040 program="C:\Program Files\Agastya Platform\runtime\node.exe" profile=private,domain`
3. People open `http://<server name>:4040/`.

The server speaks plain HTTP. On an untrusted network put a reverse proxy that terminates HTTPS in front of it (and set `SecureCookies=1`).
Every action needs a signed-in account; there is no anonymous access.

## 6. Logs

| File | Content |
| --- | --- |
| `logs\agastya-host.log` | start, stop, restart and failure of the server by the host program |
| `logs\agastya-server.log` | everything the server prints, including errors (`[stderr]` lines) |
| Windows Event Log → Application → *Agastya Platform* | service start/stop, restarts, "server keeps stopping" |

The *Audit log* inside the application (Administrator) records who did what; it is part of the database, not these files.

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

## 8. Upgrading

Run the new `Setup.exe` over the old one (same install folder is offered). It closes the running copy, backs up the database (section 7), replaces the
program, keeps `agastya.ini` and the data, and starts the service again if one was installed. At its first start the new version takes a verified copy
of the database before it changes anything (section 7). Migrations only ever add tables, columns and indexes; there are no "down" migrations - **the way
back is a copy taken before the upgrade**.

**To go back:** uninstall, install the older version, and restore the platform backup made before the upgrade (section 7), or put the `publisher.db`
from `backups\publisher-before-...db` (or `backups\pre-upgrade-...`) back into the data folder. An older version **refuses to start** on a database a
newer version has migrated ("This database was written by a newer version of Agastya Platform ...") instead of damaging it; it also refuses to restore
a backup made by a newer version. Either install the newer version again or restore a copy taken with the older one.

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

The exit code is the standard Inno Setup one (0 = success; anything else is a failure or a cancellation); `/LOG=` has the details. Uninstall silently with `"<install folder>\unins000.exe" /VERYSILENT`. Data is kept.

## 10. Uninstalling

*Settings → Apps → Agastya Platform → Uninstall.* It stops and removes the service and the firewall rule and deletes the program. **The data folder and
`agastya.ini` stay.** Delete them yourself to remove everything.

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
