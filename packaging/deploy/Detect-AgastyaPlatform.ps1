<#
.SYNOPSIS
  Detection rule for Microsoft Intune (Win32 app, "custom detection script") and Configuration Manager (application, "script" detection):
  reports whether Agastya Platform of at least -MinimumVersion is installed on this computer.

.DESCRIPTION
  WP-24 (DEP-014, ENT-014, gate G-DEP-3). Detected = exit code 0 AND something written to standard output - the convention both tools use.
  Not detected = exit code 0 and no output. It reads only:
    * the installer's Add/Remove Programs entry, HKLM (per-machine) or HKCU (per-user):
      SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{A4F8C61E-1D9A-4BF9-B9B8-092ECA4E3CBC}_is1   (the AppId in packaging/product.json; it never changes)
    * DisplayVersion there, and the file version of AgastyaCtl.exe in InstallLocation - both must reach -MinimumVersion, so an entry left
      behind by a removed program folder is not reported as installed.
  Changes nothing. Runs in the 64-bit PowerShell that Intune and ConfigMgr use for detection scripts (set "Run script as 32-bit process" = No).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File Detect-AgastyaPlatform.ps1 -MinimumVersion 2.0.0
#>
[CmdletBinding()]
param([string]$MinimumVersion = '0.0.0', [string]$AppId = 'A4F8C61E-1D9A-4BF9-B9B8-092ECA4E3CBC')
$ErrorActionPreference = 'SilentlyContinue'
$min = [version]$MinimumVersion
$key = "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{$AppId}_is1"
foreach ($hive in 'HKLM:', 'HKCU:') {
  $e = Get-ItemProperty -LiteralPath "$hive\$key"
  if (-not $e -or -not $e.DisplayVersion -or -not $e.InstallLocation) { continue }
  $ctl = Join-Path $e.InstallLocation 'AgastyaCtl.exe'
  if (-not (Test-Path -LiteralPath $ctl)) { continue }
  $fv = (Get-Item -LiteralPath $ctl).VersionInfo.FileVersion
  try { $dv = [version]$e.DisplayVersion; $f = [version]$fv } catch { continue }
  if ($dv -ge $min -and $f -ge $min) {
    Write-Output ("Agastya Platform {0} installed in {1} ({2})" -f $e.DisplayVersion, $e.InstallLocation, $(if ($hive -eq 'HKLM:') { 'per-machine' } else { 'per-user' }))
    exit 0
  }
}
exit 0
