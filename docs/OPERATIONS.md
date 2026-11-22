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
set AGASTYA_WORKSPACE_DIR=C:\ProgramData\Agastya Platform\workspace
"C:\Program Files\Agastya Platform\runtime\node.exe" "C:\Program Files\Agastya Platform\app\backend\scripts\reset-admin.js" <username> <new-password>
```

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

Everything worth keeping is in the **data folder**. Back it up with your normal tool while the server is stopped, or use the application's own
*Backup* page. To restore: stop the server, put the folder back, start it.
Before every upgrade the installer copies `publisher.db` (and its `-wal`/`-shm` files) to `<data folder>\backups\pre-upgrade-<old version>-<date-time>\`.
That copy covers the database only; it is a safety net, not a replacement for a backup of the whole folder.

## 8. Upgrading

Run the new `Setup.exe` over the old one (same install folder is offered). It closes the running copy, backs up the database (section 7), replaces the
program, keeps `agastya.ini` and the data, and starts the service again if one was installed. **To go back:** uninstall, install the older version, and put
the `publisher.db` from `backups\pre-upgrade-...` back into the data folder. (A newer version may have changed the database; do not point an older
version at a database a newer one has opened without restoring this copy.)

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
* The service runs as LocalService. A per-machine installation grants the *Users* group modify rights on the data and state folders (so the tray
  application can run for any user). To restrict it to the service account and administrators, change those folders' permissions after installing.
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
