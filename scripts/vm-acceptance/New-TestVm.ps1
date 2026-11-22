<#
.SYNOPSIS
  Creates a throw-away Windows Server guest in Hyper-V for installer acceptance tests (Test-InstallerInVm.ps1).

.DESCRIPTION
  Applies the "Standard Evaluation (Desktop Experience)" image from a Windows Server ISO you supply to a new VHDX, adds an unattend file that sets a
  random Administrator password, and creates a Generation 2 VM with NO network adapter (the tests drive it over PowerShell Direct). The password is
  written to <WorkDir>\vm-cred.txt. Run from an elevated Windows PowerShell on a Hyper-V host.

  It touches only: the ISO (mounted read-only, then dismounted), the new folder -VmRoot, and the new VM -VmName. It refuses to run if either exists.
  The Windows evaluation licence is time-limited: this is a test guest, not something to keep.
#>
param(
  [Parameter(Mandatory)][string]$IsoPath,
  [string]$VmName = 'AGASTYA-INSTALL-TEST',
  [string]$VmRoot = 'C:\VMs\AGASTYA-INSTALL-TEST',
  [string]$WorkDir = (Join-Path $env:TEMP 'agastya-vmtest')
)
$ErrorActionPreference = 'Stop'
$vmName = $VmName; $root = $VmRoot; $iso = $IsoPath; $scratch = $WorkDir
$log = Join-Path $scratch 'out\vm-create.log'
function Log($m) { $line = "$(Get-Date -Format 'HH:mm:ss') $m"; Add-Content -Path $log -Value $line; Write-Output $line }
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
Set-Content -Path $log -Value ''
if (Get-VM -Name $vmName -ErrorAction SilentlyContinue) { throw "VM $vmName already exists - refusing to touch it" }
if (Test-Path $root) { throw "$root already exists - refusing to reuse it" }
New-Item -ItemType Directory -Path $root | Out-Null

# random administrator password (kept only in the work folder, never in the repository)
$chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
$pwd = 'Ag-' + (-join (1..16 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })) + '-9!'
Set-Content -Path (Join-Path $scratch 'vm-cred.txt') -Value $pwd -NoNewline

$vhd = Join-Path $root 'disk.vhdx'
$mounted = $false; $vhdMounted = $false
try {
  Log 'mounting the ISO read-only'
  $m = Mount-DiskImage -ImagePath $iso -Access ReadOnly -PassThru; $mounted = $true
  $dl = ($m | Get-Volume).DriveLetter
  $wim = "${dl}:\sources\install.wim"
  Log "creating the virtual disk (dynamic, 60 GB)"
  New-VHD -Path $vhd -SizeBytes 60GB -Dynamic | Out-Null
  $disk = Mount-VHD -Path $vhd -Passthru | Get-Disk; $vhdMounted = $true
  Initialize-Disk -Number $disk.Number -PartitionStyle GPT
  $efi = New-Partition -DiskNumber $disk.Number -Size 260MB -GptType '{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}'
  $win = New-Partition -DiskNumber $disk.Number -UseMaximumSize -GptType '{ebd0a0a2-b9e5-4433-87c0-68b6b72699c7}'
  Format-Volume -Partition $efi -FileSystem FAT32 -NewFileSystemLabel 'EFI' -Confirm:$false | Out-Null
  Format-Volume -Partition $win -FileSystem NTFS -NewFileSystemLabel 'Windows' -Confirm:$false | Out-Null
  $efi | Add-PartitionAccessPath -AssignDriveLetter; $win | Add-PartitionAccessPath -AssignDriveLetter
  $efiLetter = (Get-Partition -DiskNumber $disk.Number | Where-Object { $_.PartitionNumber -eq $efi.PartitionNumber }).DriveLetter
  $winLetter = (Get-Partition -DiskNumber $disk.Number | Where-Object { $_.PartitionNumber -eq $win.PartitionNumber }).DriveLetter
  Log "applying image index 2 (Standard Evaluation, Desktop Experience) to ${winLetter}: - this takes several minutes"
  Expand-WindowsImage -ImagePath $wim -Index 2 -ApplyPath "${winLetter}:\" | Out-Null
  Log 'writing boot files'
  & bcdboot "${winLetter}:\Windows" /s "${efiLetter}:" /f UEFI | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "bcdboot failed ($LASTEXITCODE)" }
  $panther = "${winLetter}:\Windows\Panther"; New-Item -ItemType Directory -Force $panther | Out-Null
  $unattend = @"
<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
  <settings pass="specialize">
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <ComputerName>AGTEST01</ComputerName>
    </component>
  </settings>
  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <OOBE>
        <HideEULAPage>true</HideEULAPage>
        <HideLocalAccountScreen>true</HideLocalAccountScreen>
        <HideOEMRegistrationScreen>true</HideOEMRegistrationScreen>
        <HideOnlineAccountScreens>true</HideOnlineAccountScreens>
        <HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE>
        <ProtectYourPC>3</ProtectYourPC>
        <SkipMachineOOBE>true</SkipMachineOOBE>
        <SkipUserOOBE>true</SkipUserOOBE>
      </OOBE>
      <UserAccounts>
        <AdministratorPassword><Value>$pwd</Value><PlainText>true</PlainText></AdministratorPassword>
      </UserAccounts>
    </component>
    <component name="Microsoft-Windows-International-Core" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <InputLocale>en-US</InputLocale><SystemLocale>en-US</SystemLocale><UILanguage>en-US</UILanguage><UserLocale>en-US</UserLocale>
    </component>
  </settings>
</unattend>
"@
  [IO.File]::WriteAllText("$panther\unattend.xml", $unattend, (New-Object Text.UTF8Encoding($false)))
  Log 'detaching the virtual disk'
  Dismount-VHD -Path $vhd; $vhdMounted = $false
  Dismount-DiskImage -ImagePath $iso | Out-Null; $mounted = $false

  Log 'creating the VM (generation 2, 2 vCPU, 4 GB, no network adapter)'
  New-VM -Name $vmName -Generation 2 -MemoryStartupBytes 4GB -VHDPath $vhd -Path $root | Out-Null
  Set-VMProcessor -VMName $vmName -Count 2
  Set-VMMemory -VMName $vmName -DynamicMemoryEnabled $false
  Set-VM -Name $vmName -AutomaticStartAction Nothing -AutomaticStopAction ShutDown -CheckpointType Disabled
  Enable-VMIntegrationService -VMName $vmName -Name 'Guest Service Interface'
  Log 'starting the VM'
  Start-VM -Name $vmName
  Log 'DONE-CREATE'
} catch {
  Log "FAILED: $($_.Exception.Message)"
  if ($vhdMounted) { try { Dismount-VHD -Path $vhd } catch {} }
  if ($mounted) { try { Dismount-DiskImage -ImagePath $iso | Out-Null } catch {} }
  Log 'DONE-FAILED'
  exit 1
}
