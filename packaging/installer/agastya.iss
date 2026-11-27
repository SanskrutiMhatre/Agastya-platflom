; =============================================================================
; Agastya Platform - Windows installer (Inno Setup 6).
; Built by scripts/package-windows.mjs, which passes the /D defines below. Do not compile this by hand unless you pass them too.
;
; Silent installation (see docs/OPERATIONS.md):
;   Agastya-Platform-<ver>-win-x64-Setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART [/DIR="D:\Agastya"] [/DATADIR="D:\AgastyaData"]
;        [/STATEDIR="D:\AgastyaConfig"] [/PORT=4040] [/LAN] [/SVCNAME=AgastyaPlatform] [/NOSERVICE] [/TASKS="service,lan,autostart,desktopicon"]
;   /CURRENTUSER installs for the signed-in user only (no administrator rights; the service and LAN options are then unavailable).
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
Source: "{#SourceDir}\*"; DestDir: "{app}"; Excludes: "portable.flag,config\*,data\*,state.dir"; Flags: ignoreversion recursesubdirs

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
  if Assigned(DataPage) and (PageID = DataPage.ID) then Result := SwitchGiven('DATADIR');
  if Assigned(PortPage) and (PageID = PortPage.ID) then Result := SwitchGiven('PORT');
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

procedure StopRunningCopy;
var
  Ctl: String;
begin
  Ctl := ExpandConstant('{app}\AgastyaCtl.exe');
  if FileExists(Ctl) then
  begin
    RunHidden(Ctl, '--stop');     // the Windows service, if there is one
    RunHidden(Ctl, '--quit');     // the tray application, if it is running
    Sleep(4000);                  // let the server finish and release publisher.db
  end;
end;

// The host program does the copying: it reads agastya.ini as UTF-8, so a data folder with accented or non-Latin letters in its name is found
// (Inno's own ini functions are ANSI-only, and a silent miss here would mean an upgrade without its safety copy).
procedure BackupDatabaseBeforeUpgrade;
var
  Old, Ctl: String;
  Code: Integer;
begin
  Ctl := ExpandConstant('{app}\AgastyaCtl.exe');
  if not FileExists(Ctl) then Exit;                                           // a first installation
  Old := '';
  RegQueryStringValue(HKA, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{{#AppGuid}}_is1', 'DisplayVersion', Old);
  if Old = '' then Old := 'unknown';
  Code := RunHidden(Ctl, '--backup-db "' + Old + '"');
  if Code <> 0 then Log('The pre-upgrade database backup returned ' + IntToStr(Code));
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  StopRunningCopy;
  BackupDatabaseBeforeUpgrade;
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
    if LoadStringFromFile(ExpandConstant('{app}\docs\agastya.ini.template'), Tpl) then
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
  if LanWanted then
    RunHidden(ExpandConstant('{sys}\netsh.exe'),
      'advfirewall firewall add rule name="' + Rule + '" dir=in action=allow protocol=TCP localport=' + WantedPort +
      ' program="' + ExpandConstant('{app}\runtime\node.exe') + '" profile=private,domain enable=yes');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Ctl: String;
begin
  if CurStep = ssPostInstall then
  begin
    WriteConfigurationIfNeeded;
    ConfigureFirewall;
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
    end;
    RunHidden(ExpandConstant('{sys}\netsh.exe'), 'advfirewall firewall delete rule name="{#FirewallRule}"');
  end;
  if CurUninstallStep = usPostUninstall then
  begin
    if not UninstallSilent then
      MsgBox('Agastya Platform was removed.' + #13#10#13#10 + 'Your projects and database were NOT deleted. The data folder is the one named in' + #13#10 +
             UninstStateDir + '\agastya.ini  (by default: ' + UninstStateDir + '\workspace).' + #13#10#13#10 +
             'Delete that folder yourself if you no longer need it.', mbInformation, MB_OK);
  end;
end;
