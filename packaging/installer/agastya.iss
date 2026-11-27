; =============================================================================
; Agastya Platform - Windows installer (Inno Setup 6).
; Built by scripts/package-windows.mjs, which passes the /D defines below. Do not compile this by hand unless you pass them too.
;
; Silent installation (see docs/OPERATIONS.md):
;   Agastya-Platform-<ver>-win-x64-Setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART [/DIR="D:\Agastya"] [/DATADIR="D:\AgastyaData"]
;        [/STATEDIR="D:\AgastyaConfig"] [/PORT=4040] [/LAN] [/SVCNAME=AgastyaPlatform] [/NOSERVICE] [/TASKS="service,lan,autostart,desktopicon"]
;   /CURRENTUSER installs for the signed-in user only (no administrator rights; the service and LAN options are then unavailable).
;   /ADMINUSER=<name> /ADMINPASSWORDFILE=<file>   create the first administrator unattended (the file's first line is a TEMPORARY password,
;        changed at the first sign-in; it is read by AgastyaCtl.exe, never put on a command line; delete the file afterwards).
; Uninstall:  unins000.exe /VERYSILENT [/PURGEDATA]   - the data folder is KEPT unless /PURGEDATA is given (interactive: a question, default No).
; Exit codes: Inno Setup's (0 = done; 7 = "preparing to install" failed: the server could not be stopped or the pre-update backup failed -
;        nothing was changed; see <state>\logs\setup-upgrade-*.log). docs/DEPLOYMENT-KIT.md has the table.
;
; Layout (WP-25, DEP-023): {app}\versions\<version>\ holds each version's program; {app}\AgastyaPlatform.exe and AgastyaCtl.exe are copies of
; the current one's (the shortcuts and the service use them); {app}\current and {app}\previous name the folders. An upgrade adds a folder and
; keeps the previous one, so "AgastyaCtl.exe --rollback" goes back without the old Setup. Offline updates (.agupdate) use the same layout.
; =============================================================================

#ifndef AppVersion
  #error "Pass /DAppVersion=x.y.z - run scripts/package-windows.mjs instead of compiling this file directly."
#endif
#ifndef SourceDir
  #error "Pass /DSourceDir=<staged product folder>."
#endif
#ifndef OutputDir
  #define OutputDir "."
#endif
#ifndef SetupIcon
  #error "Pass /DSetupIcon=<path to agastya.ico>."
#endif
#ifndef AppGuid
  #error "Pass /DAppGuid=<product GUID from packaging/product.json>."
#endif
#ifndef AppPublisher
  #define AppPublisher "Agastya Platform"
#endif
#ifndef AppUrl
  #define AppUrl ""
#endif
#ifndef AppCopyright
  #define AppCopyright "Copyright (C) " + AppPublisher
#endif
#ifndef FirewallRule
  #define FirewallRule "Agastya Platform (LAN access)"
#endif
#define AppName "Agastya Platform"

[Setup]
AppId={{{#AppGuid}}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
#if AppUrl != ""
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}
#endif
AppCopyright={#AppCopyright}
VersionInfoVersion={#AppVersion}.0
VersionInfoCompany={#AppPublisher}
VersionInfoCopyright={#AppCopyright}
VersionInfoProductName={#AppName}
VersionInfoDescription={#AppName} Setup
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=commandline dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename=Agastya-Platform-{#AppVersion}-win-x64-Setup
SetupIconFile={#SetupIcon}
UninstallDisplayIcon={app}\AgastyaPlatform.exe
UninstallDisplayName={#AppName}
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
CloseApplications=yes
RestartApplications=no
UsePreviousAppDir=yes
SetupLogging=yes
ChangesEnvironment=no
#ifdef RepoRoot
#ifexist RepoRoot + "\docs\EULA.txt"
LicenseFile={#RepoRoot}\docs\EULA.txt
#endif
#endif
#ifdef Signed
SignTool=agastyasign
SignedUninstaller=yes
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "autostart"; Description: "Start Agastya Platform when I sign in to Windows"; GroupDescription: "Startup:"; Flags: unchecked
Name: "service"; Description: "Run as a Windows service (starts with Windows, whether or not anyone is signed in)"; GroupDescription: "Startup:"; Flags: unchecked; Check: IsAdminInstallMode
Name: "lan"; Description: "Allow other computers on the network to connect (opens the Windows Firewall for this program on private and domain networks)"; GroupDescription: "Network:"; Flags: unchecked; Check: IsAdminInstallMode

[Files]
; the launcher first: ExtractTemporaryFile('AgastyaCtl.exe') in PrepareToInstall takes the first entry of that name
Source: "{#SourceDir}\AgastyaCtl.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\AgastyaPlatform.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\*"; DestDir: "{app}\versions\{#AppVersion}"; Excludes: "portable.flag,config\*,data\*,state.dir"; Flags: ignoreversion recursesubdirs

[Icons]
Name: "{autoprograms}\{#AppName}\{#AppName}"; Filename: "{app}\AgastyaPlatform.exe"; WorkingDir: "{app}"
Name: "{autoprograms}\{#AppName}\Check this installation"; Filename: "{cmd}"; Parameters: "/k """"{app}\AgastyaCtl.exe"" --doctor"""; WorkingDir: "{app}"; Comment: "Runs the self-check and shows the result"
Name: "{autoprograms}\{#AppName}\Open the log folder"; Filename: "{win}\explorer.exe"; Parameters: """{code:GetStateDir}\logs"""
Name: "{autoprograms}\{#AppName}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\AgastyaPlatform.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Registry]
Root: HKA; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "AgastyaPlatform"; ValueData: """{app}\AgastyaPlatform.exe"""; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{app}\AgastyaPlatform.exe"; Description: "Start {#AppName} now"; Flags: nowait postinstall skipifsilent; Check: not ServiceWanted

[UninstallDelete]
Type: files; Name: "{app}\state.dir"
; WP-25: version folders written by offline updates are not in Setup's own list; they hold program files only (never data)
Type: filesandordirs; Name: "{app}\versions"
Type: files; Name: "{app}\current"
Type: files; Name: "{app}\previous"
Type: files; Name: "{app}\update-history.txt"
Type: files; Name: "{app}\*.exe.old-*"
Type: dirifempty; Name: "{app}"

[Code]
var
  DataPage: TInputDirWizardPage;
  PortPage: TInputQueryWizardPage;

// ---------------------------------------------------------------------------------------------------------------
// Settings: a command-line switch wins, then what an existing installation already uses, then the wizard's answer, then the default.
// ---------------------------------------------------------------------------------------------------------------
// {param:NAME|...} only sees the "/NAME=value" form: a switch written without a value ("/LAN", "/NOSERVICE") is invisible to it. That is why
// "/LAN" did not change Bind on an existing agastya.ini and "/NOSERVICE" was ignored when the service task was selected (found by the guest
// acceptance test, which installs over a configuration left by an earlier install). So the command line is read as well.
function SwitchGiven(const Name: String): Boolean;
var
  I: Integer;
  P: String;
begin
  Result := CompareText(ExpandConstant('{param:' + Name + '|__absent__}'), '__absent__') <> 0;
  if Result then Exit;
  for I := 1 to ParamCount do
  begin
    P := ParamStr(I);
    if (CompareText(P, '/' + Name) = 0) or (CompareText(P, '-' + Name) = 0) or
       (CompareText(Copy(P, 1, Length(Name) + 2), '/' + Name + '=') = 0) or
       (CompareText(Copy(P, 1, Length(Name) + 2), '-' + Name + '=') = 0) then
    begin
      Result := True;
      Exit;
    end;
  end;
end;

// The program folder as the wizard currently has it. {app} cannot be used here: it does not exist until the folder has been chosen, and this
// code also runs from InitializeWizard (Setup then stops with "attempt was made to expand the app constant before it was initialized").
function ChosenAppDir: String;
begin
  if IsUninstaller then Result := ExpandConstant('{app}')
  else Result := WizardDirValue;
  if Result = '' then Result := ExpandConstant('{autopf}\{#AppName}');
end;

function ExistingStateDir: String;
var
  Lines: TArrayOfString;
begin
  Result := '';
  if LoadStringsFromFile(ChosenAppDir + '\state.dir', Lines) then
    if GetArrayLength(Lines) > 0 then Result := Trim(Lines[0]);
end;

function GetStateDir(Param: String): String;
begin
  Result := ExpandConstant('{param:STATEDIR|}');
  if Result = '' then Result := ExistingStateDir;
  if Result = '' then
  begin
    if IsAdminInstallMode then Result := ExpandConstant('{commonappdata}\Agastya Platform')
    else Result := ExpandConstant('{localappdata}\Agastya Platform');
  end;
end;

function IniPath: String;
begin
  Result := GetStateDir('') + '\agastya.ini';
end;

function ExistingValue(const Section, Key, Default: String): String;
begin
  Result := GetIniString(Section, Key, Default, IniPath);
end;

function WantedPort: String;
begin
  Result := ExpandConstant('{param:PORT|}');
  if Result = '' then
  begin
    if Assigned(PortPage) and (PortPage.Values[0] <> '') then Result := PortPage.Values[0]
    else Result := ExistingValue('server', 'Port', '4040');
  end;
end;

function WantedDataDir: String;
begin
  Result := ExpandConstant('{param:DATADIR|}');
  if Result = '' then
  begin
    if Assigned(DataPage) and (DataPage.Values[0] <> '') then Result := DataPage.Values[0]
    else Result := ExistingValue('storage', 'DataDir', '');
  end;
  if Result = '' then Result := GetStateDir('') + '\workspace';
end;

function WantedServiceName: String;
begin
  Result := ExpandConstant('{param:SVCNAME|}');
  if Result = '' then Result := ExistingValue('service', 'Name', 'AgastyaPlatform');
end;

function LanWanted: Boolean;
begin
  Result := IsAdminInstallMode and (WizardIsTaskSelected('lan') or SwitchGiven('LAN'));
end;

function ServiceWanted: Boolean;
begin
  Result := IsAdminInstallMode and WizardIsTaskSelected('service') and (not SwitchGiven('NOSERVICE'));
end;

function ValidPort(const S: String): Boolean;
var
  N: Integer;
begin
  N := StrToIntDef(S, -1);
  Result := (N >= 1) and (N <= 65535);
end;

function InitializeSetup: Boolean;
begin
  Result := True;
  if SwitchGiven('PORT') and (not ValidPort(ExpandConstant('{param:PORT|}'))) then
  begin
    MsgBox('/PORT must be a number from 1 to 65535.', mbCriticalError, MB_OK);
    Result := False;
  end;
end;

procedure InitializeWizard;
begin
  DataPage := CreateInputDirPage(wpSelectDir, 'Data folder', 'Where should projects and the database be kept?',
    'Everything people create is stored in this folder. It is separate from the program, so upgrading or uninstalling never removes it. ' +
    'Choose a folder on a disk that is backed up.', False, '');
  DataPage.Add('');
  DataPage.Values[0] := ExpandConstant('{param:DATADIR|}');
  if DataPage.Values[0] = '' then DataPage.Values[0] := ExistingValue('storage', 'DataDir', '');
  if DataPage.Values[0] = '' then DataPage.Values[0] := GetStateDir('') + '\workspace';

  PortPage := CreateInputQueryPage(DataPage.ID, 'Server port', 'Which port should Agastya Platform use?',
    'People open the application in a web browser at http://localhost:<port>/. Change this only if another program already uses the port.');
  PortPage.Add('Port:', False);
  PortPage.Values[0] := ExistingValue('server', 'Port', '4040');
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  // An administrator who passed the value on the command line is not asked again.
  // WP-25 (G-DEP-2): an upgrade keeps the data folder and the port it has, so it asks for neither.
  if Assigned(DataPage) and (PageID = DataPage.ID) then Result := SwitchGiven('DATADIR') or FileExists(IniPath);
  if Assigned(PortPage) and (PageID = PortPage.ID) then Result := SwitchGiven('PORT') or FileExists(IniPath);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if Assigned(PortPage) and (CurPageID = PortPage.ID) then
  begin
    if not ValidPort(PortPage.Values[0]) then
    begin
      MsgBox('Enter a port number from 1 to 65535.', mbError, MB_OK);
      Result := False;
    end;
  end;
  if Assigned(DataPage) and (CurPageID = DataPage.ID) then
  begin
    if Trim(DataPage.Values[0]) = '' then
    begin
      MsgBox('Choose a data folder.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

// ---------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------
function RunHidden(const FileName, Params: String): Integer;
var
  Code: Integer;
begin
  if not Exec(FileName, Params, '', SW_HIDE, ewWaitUntilTerminated, Code) then Code := -1;
  Result := Code;
  Log(FileName + ' ' + Params + ' -> ' + IntToStr(Code));
end;

// WP-04: SYSTEM and Administrators full control, the server's identity modify, nobody else; inheritance removed.
// S-1-5-18 SYSTEM, S-1-5-32-544 Administrators, S-1-5-19 LOCAL SERVICE, S-1-5-32-545 Users, S-1-5-11 Authenticated Users.
procedure LockDownFolder(const Dir: String);
var
  Icacls, Who: String;
begin
  ForceDirectories(Dir);
  Icacls := ExpandConstant('{sys}\icacls.exe');
  if ServiceWanted then Who := '*S-1-5-19:(OI)(CI)M'
  else Who := '"' + GetUserNameString + '":(OI)(CI)M';
  RunHidden(Icacls, '"' + Dir + '" /inheritance:r /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F ' + Who + ' /C /Q');
  RunHidden(Icacls, '"' + Dir + '" /remove:g *S-1-5-32-545 *S-1-5-11 /T /C /Q');
end;

// WP-25 (DEP-001, G-DEP-5): before an upgrade changes anything, THIS release's AgastyaCtl.exe (extracted to Setup's temporary folder, so an old
// installed one does not have to know the steps) stops the service and the tray application and waits until the server has really let go of
// the data folder (no fixed wait), makes a platform backup with the installed version's own tool and verifies it by a restore into a scratch
// folder, and moves a flat installation of an older release into versions\<its version>. When any of that fails Setup stops here and
// nothing is changed (exit code 7 in a silent run). The host reads agastya.ini as UTF-8, so a data folder with non-Latin letters is found.
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Ctl: String;
  Code: Integer;
begin
  Result := '';
  if not (FileExists(ExpandConstant('{app}\AgastyaCtl.exe')) or FileExists(ExpandConstant('{app}\current'))) then Exit;   // a first installation
  ExtractTemporaryFile('AgastyaCtl.exe');
  Ctl := ExpandConstant('{tmp}\AgastyaCtl.exe');
  Code := RunHidden(Ctl, '--install-dir "' + ExpandConstant('{app}') + '" --prepare-upgrade "{#AppVersion}"');
  if Code = 13 then Result := 'Agastya Platform is still running and could not be stopped. Close it (and stop its Windows service), then run Setup again. Nothing was changed.'
  else if Code = 14 then Result := 'The backup of your data before the upgrade failed, so Setup stopped. Nothing was changed. The reason is in the log folder (setup-upgrade-*.log).'
  else if Code <> 0 then Result := 'Setup could not prepare the upgrade (code ' + IntToStr(Code) + '). Nothing was changed. See setup-upgrade-*.log in the log folder.';
end;

procedure WriteConfigurationIfNeeded;
var
  Tpl: AnsiString;
  Text, Bind: String;
  Lines: TArrayOfString;
begin
  ForceDirectories(GetStateDir(''));
  ForceDirectories(WantedDataDir);
  // The host reads these two files as UTF-8, so folder names with accented or non-Latin letters work.
  if (not FileExists(ExpandConstant('{app}\state.dir'))) or SwitchGiven('STATEDIR') then
  begin
    SetArrayLength(Lines, 1); Lines[0] := GetStateDir('');
    SaveStringsToUTF8File(ExpandConstant('{app}\state.dir'), Lines, False);
  end;

  if not FileExists(IniPath) then
  begin
    // WP-25: the template is in this version's folder (versions\<version>\docs); a missing one is logged, never silent
    if not LoadStringFromFile(ExpandConstant('{app}\versions\{#AppVersion}\docs\agastya.ini.template'), Tpl) then
      Log('agastya.ini.template is missing from the program folder: agastya.ini was not written (the defaults apply)')
    else
    begin
      Text := String(Tpl);
      if LanWanted then Bind := 'lan' else Bind := 'loopback';
      StringChangeEx(Text, '@PORT@', WantedPort, True);
      StringChangeEx(Text, '@BIND@', Bind, True);
      StringChangeEx(Text, '@DATADIR@', WantedDataDir, True);
      StringChangeEx(Text, '@SERVICENAME@', WantedServiceName, True);
      SetArrayLength(Lines, 1); Lines[0] := Text;
      SaveStringsToUTF8File(IniPath, Lines, False);
    end;
  end
  else
  begin
    // An upgrade keeps the administrator's file. Only what was explicitly asked for on the command line is changed.
    if SwitchGiven('PORT') then SetIniString('server', 'Port', WantedPort, IniPath);
    if SwitchGiven('DATADIR') then SetIniString('storage', 'DataDir', WantedDataDir, IniPath);
    if SwitchGiven('SVCNAME') then SetIniString('service', 'Name', WantedServiceName, IniPath);
    if SwitchGiven('LAN') then SetIniString('server', 'Bind', 'lan', IniPath);
  end;

  // The data folder holds the database (password hashes, sessions, the audit log) and every project; the state folder holds the
  // configuration and the logs. On a per-machine installation only SYSTEM, the Administrators and the identity that runs the
  // server may use them (audit WP-04: ENT-004, SEC-005, gate G-SEC-6): inheritance from C:\ProgramData (which gives every
  // user read access) is cut, and the former "Users: modify" grant is removed. The server runs as LOCAL SERVICE when it is a
  // Windows service (AgastyaCtl --install-service grants that account modify rights itself); without the service it runs in
  // the tray of the person who installed it, who is granted modify rights here. A per-user installation (/CURRENTUSER)
  // lives in that person's profile, whose permissions are already private.
  if IsAdminInstallMode then
  begin
    LockDownFolder(GetStateDir(''));
    LockDownFolder(WantedDataDir);
  end;
end;

procedure ConfigureFirewall;
var
  Rule: String;
begin
  Rule := '{#FirewallRule}';
  RunHidden(ExpandConstant('{sys}\netsh.exe'), 'advfirewall firewall delete rule name="' + Rule + '"');
  // WP-25 (DEP-023): node.exe now lives in versions\<version>\runtime and moves with every update, so the rule is bound to the port, not
  // to a program path (Mode B's own firewall handling belongs to WP-28)
  if LanWanted then
    RunHidden(ExpandConstant('{sys}\netsh.exe'),
      'advfirewall firewall add rule name="' + Rule + '" dir=in action=allow protocol=TCP localport=' + WantedPort +
      ' profile=private,domain enable=yes');
end;

// WP-25 (PRD-005): the WebView2 runtime. When it is missing and the release carries Microsoft's offline installer (redist\), run it silently.
function WebView2Installed: Boolean;
var
  V: String;
begin
  V := '';
  if not RegQueryStringValue(HKLM64, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', V) then
    if not RegQueryStringValue(HKLM64, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', V) then
      RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', V);
  Result := (V <> '') and (V <> '0.0.0.0');
  Log('WebView2 runtime: ' + V);
end;

procedure ProvisionWebView2;
var
  Redist: String;
begin
  if WebView2Installed then Exit;
  Redist := ExpandConstant('{app}\versions\{#AppVersion}\redist\MicrosoftEdgeWebView2RuntimeInstallerX64.exe');
  if FileExists(Redist) then RunHidden(Redist, '/silent /install')
  else Log('The WebView2 runtime is not installed and this release carries no offline installer: the interface opens in an Edge app window or the default browser.');
end;

// WP-25 (G-DEP-2): /ADMINUSER + /ADMINPASSWORDFILE create the first administrator, so a silent install needs nobody at the first screen.
procedure CreateFirstAdministrator;
var
  User, PwFile: String;
  Code: Integer;
begin
  User := ExpandConstant('{param:ADMINUSER|}');
  PwFile := ExpandConstant('{param:ADMINPASSWORDFILE|}');
  if User = '' then Exit;
  if (PwFile = '') or (not FileExists(PwFile)) then
  begin
    Log('/ADMINUSER was given without a readable /ADMINPASSWORDFILE: no administrator created');
    if not WizardSilent then MsgBox('/ADMINUSER needs /ADMINPASSWORDFILE=<file with the temporary password>. No administrator was created; the first person to open the application creates one.', mbError, MB_OK);
    Exit;
  end;
  Code := RunHidden(ExpandConstant('{app}\AgastyaCtl.exe'), '--first-admin "' + User + '" --password-file "' + PwFile + '"');
  if Code <> 0 then Log('The first administrator could not be created (code ' + IntToStr(Code) + '); see the host log');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Ctl: String;
begin
  if CurStep = ssPostInstall then
  begin
    WriteConfigurationIfNeeded;
    // WP-25: "current" names the version just copied, the one it replaces becomes "previous" (AgastyaCtl.exe --rollback), older ones beyond
    // [update] KeepVersions are removed
    if RunHidden(ExpandConstant('{app}\AgastyaCtl.exe'), '--activate "{#AppVersion}"') <> 0 then
      MsgBox('The new version could not be made current. Run "AgastyaCtl.exe --doctor" for details.', mbError, MB_OK);
    ConfigureFirewall;
    ProvisionWebView2;
    CreateFirstAdministrator;
    if ServiceWanted then
    begin
      Ctl := ExpandConstant('{app}\AgastyaCtl.exe');
      RunHidden(Ctl, '--uninstall-service');                         // an upgrade re-registers it cleanly
      if RunHidden(Ctl, '--install-service') = 0 then RunHidden(Ctl, '--start')
      else MsgBox('The Windows service could not be registered. The application was installed; run "AgastyaCtl.exe --doctor" for details.', mbError, MB_OK);
    end;
  end;
end;

var
  UninstStateDir: String;     // read while state.dir still exists: [UninstallDelete] removes it before the closing message
  PurgeData, DataRemoved: Boolean;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Ctl: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    UninstStateDir := GetStateDir('');
    Ctl := ExpandConstant('{app}\AgastyaCtl.exe');
    if FileExists(Ctl) then
    begin
      RunHidden(Ctl, '--stop');
      RunHidden(Ctl, '--uninstall-service');
      RunHidden(Ctl, '--quit');
      Sleep(3000);
      // WP-25 (G-DEP-1): the data stays unless asked for - /PURGEDATA in a silent run, a question (default No) otherwise. AgastyaCtl checks
      // that the folders are this product's (never a drive root, a profile or system folder, or one holding the program) before removing them.
      PurgeData := SwitchGiven('PURGEDATA');
      if (not PurgeData) and (not UninstallSilent) then
        PurgeData := MsgBox('Also DELETE all projects and the database (the data folder named in ' + UninstStateDir + '\agastya.ini)?' + #13#10#13#10 +
                            'Choose No to keep them (recommended): a later installation finds them again.', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
      if PurgeData then
      begin
        if RunHidden(Ctl, '--remove-data --confirm') = 0 then DataRemoved := True
        else Log('The data folder was not removed (AgastyaCtl --remove-data refused; see above)');
      end;
    end;
    RunHidden(ExpandConstant('{sys}\netsh.exe'), 'advfirewall firewall delete rule name="{#FirewallRule}"');
  end;
  if CurUninstallStep = usPostUninstall then
  begin
    if (not UninstallSilent) and DataRemoved then
      MsgBox('Agastya Platform and its data were removed.', mbInformation, MB_OK)
    else if not UninstallSilent then
      MsgBox('Agastya Platform was removed.' + #13#10#13#10 + 'Your projects and database were NOT deleted. The data folder is the one named in' + #13#10 +
             UninstStateDir + '\agastya.ini  (by default: ' + UninstStateDir + '\workspace).' + #13#10#13#10 +
             'Delete that folder yourself if you no longer need it.', mbInformation, MB_OK);
  end;
end;
