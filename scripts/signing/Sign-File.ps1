<#
.SYNOPSIS
  Authenticode-signs one file with a .pfx, with the tools built into Windows PowerShell (no Windows SDK / signtool needed).

.DESCRIPTION
  This is what AGASTYA_SIGN_CMD calls for each file the packager signs:

    set AGASTYA_SIGN_PASSWORD=...
    set AGASTYA_SIGN_CMD=powershell -NoProfile -ExecutionPolicy Bypass -File scripts\signing\Sign-File.ps1 -Pfx D:\signing\agastya-codesign.pfx -File $f
    npm run package:win -- --build

  The password is read from -Password or the AGASTYA_SIGN_PASSWORD environment variable, never from the command line of the build.
  The certificate is read from the file into memory; nothing is added to any certificate store.

  -TimestampServer is optional. The product is meant to work with no internet, so by default the signature is NOT timestamped: it then stops
  verifying when the signing certificate expires, and the installer must be signed again with the renewed certificate. Give an RFC 3161 server
  (your CA's, or one on your network) to keep a signature valid after expiry.

  The exit code is 0 only when the file ends up carrying a signature made by THIS certificate that the file's contents still match.
  (A self-signed or internal-CA certificate is reported by Windows as "not trusted" on a PC that has not been given the root: that is
  expected, and not an error here.)
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$File,
  [Parameter(Mandatory = $true)][string]$Pfx,
  [System.Security.SecureString]$Password,
  [string]$TimestampServer
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ne 5) { Write-Error 'Run this in Windows PowerShell 5.1 (powershell.exe).'; exit 2 }
if (-not (Test-Path -LiteralPath $File)) { Write-Error "File not found: $File"; exit 2 }
if (-not (Test-Path -LiteralPath $Pfx)) { Write-Error "Certificate file not found: $Pfx"; exit 2 }
if (-not $Password) {
  if (-not $env:AGASTYA_SIGN_PASSWORD) { Write-Error 'Give -Password or set AGASTYA_SIGN_PASSWORD.'; exit 2 }
  $Password = ConvertTo-SecureString -String $env:AGASTYA_SIGN_PASSWORD -AsPlainText -Force
}
Add-Type -AssemblyName System.Security
$flags = [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]
$cert = $null
foreach ($f in @($flags::EphemeralKeySet, $flags::DefaultKeySet)) {       # prefer a key that never touches disk; some systems need the default
  try {
    $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList (Resolve-Path -LiteralPath $Pfx).Path, $Password, $f
    $args2 = @{ FilePath = (Resolve-Path -LiteralPath $File).Path; Certificate = $cert; HashAlgorithm = 'SHA256' }
    if ($TimestampServer) { $args2.TimestampServer = $TimestampServer }
    $null = Set-AuthenticodeSignature @args2
    break
  } catch { $last = $_; $cert = $null }
}
if (-not $cert) { Write-Error "Signing failed: $($last.Exception.Message)"; exit 1 }

$sig = Get-AuthenticodeSignature -FilePath $File
if (-not $sig.SignerCertificate -or $sig.SignerCertificate.Thumbprint -ne $cert.Thumbprint) { Write-Error "The file does not carry a signature from $($cert.Subject)."; exit 1 }
if ($sig.Status -eq 'HashMismatch' -or $sig.Status -eq 'NotSigned') { Write-Error "Signature status is $($sig.Status)."; exit 1 }
Write-Host ("signed {0}  [{1}; {2}; {3}]" -f (Split-Path $File -Leaf), $cert.Subject, $sig.Status, $(if ($sig.TimeStamperCertificate) { 'timestamped' } else { 'not timestamped' }))
exit 0
