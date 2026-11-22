<#
.SYNOPSIS
  Makes a code-signing certificate for Agastya Platform - self-signed, or issued by an internal root CA that this script also makes.

.DESCRIPTION
  Nothing here touches a certificate store, the registry or any policy: the script only writes files into -OutDir. Putting a certificate into
  "Trusted Root" or "Trusted Publishers" is a separate decision for whoever manages the PCs (see docs/SIGNING.md - Group Policy or Intune).

  -Mode SelfSigned   one certificate, signs the software and is its own root.          Files: agastya-codesign.pfx / .cer
  -Mode InternalCa   a root CA (10 years) and a code-signing certificate it issued.    Files: agastya-root-ca.pfx / .cer, agastya-codesign.pfx / .cer
                     Push only agastya-root-ca.cer to the PCs; keep agastya-root-ca.pfx offline and use it again only to issue a new
                     signing certificate when this one expires.

  The .pfx files hold private keys: whoever has one can sign software your PCs will trust. Store them in a vault, not in the repository.
  The .cer files are public and safe to hand out.

  RSA 3072, SHA-256, Code Signing extended key usage (1.3.6.1.5.5.7.3.3), no CA rights on the signing certificate itself.
  Requires Windows PowerShell 5.1 on Windows with .NET Framework 4.7.2 or later (any current Windows 10 / Server 2016+).

.EXAMPLE
  .\New-SigningCertificate.ps1 -OutDir D:\signing -Subject "CN=Example Defence Labs, O=Example Defence Labs, C=IN" -Mode InternalCa
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$OutDir,
  [Parameter(Mandatory = $true)][string]$Subject,
  [ValidateSet('SelfSigned', 'InternalCa')][string]$Mode = 'SelfSigned',
  [int]$Years = 3,
  [System.Security.SecureString]$PfxPassword
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

if ($PSVersionTable.PSVersion.Major -ne 5) { throw 'Run this in Windows PowerShell 5.1 (powershell.exe), not in PowerShell 7: it uses the .NET Framework certificate API.' }
if ($Years -lt 1 -or $Years -gt 10) { throw '-Years must be between 1 and 10.' }
Add-Type -AssemblyName System.Security
$ns = 'System.Security.Cryptography.X509Certificates'

if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
$OutDir = (Resolve-Path -LiteralPath $OutDir).Path
foreach ($n in 'agastya-codesign.pfx', 'agastya-codesign.cer', 'agastya-root-ca.pfx', 'agastya-root-ca.cer') {
  if (Test-Path -LiteralPath (Join-Path $OutDir $n)) { throw "$n already exists in $OutDir. Choose another folder: a certificate is never overwritten." }
}

# The password protecting the .pfx files: yours, or a random one written next to them.
$generated = $false
if (-not $PfxPassword) {
  if ($env:AGASTYA_PFX_PASSWORD) { $PfxPassword = ConvertTo-SecureString -String $env:AGASTYA_PFX_PASSWORD -AsPlainText -Force }
  else {
    $bytes = New-Object byte[] 24; (New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes($bytes)
    $PfxPassword = ConvertTo-SecureString -String ([Convert]::ToBase64String($bytes).Replace('+', 'x').Replace('/', 'y').Replace('=', 'z')) -AsPlainText -Force
    $generated = $true
  }
}
$plain = (New-Object System.Net.NetworkCredential('', $PfxPassword)).Password
if ($plain.Length -lt 12) { throw 'The .pfx password must be at least 12 characters.' }

function New-Key { New-Object System.Security.Cryptography.RSACng 3072 }
function New-Serial { $b = New-Object byte[] 16; (New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes($b); $b[0] = $b[0] -band 0x7F; $b }
function Add-Common($req, [bool]$ca) {
  $ski = New-Object "$ns.X509SubjectKeyIdentifierExtension" -ArgumentList $req.PublicKey, $false
  $req.CertificateExtensions.Add($ski)
  if ($ca) {
    $req.CertificateExtensions.Add((New-Object "$ns.X509BasicConstraintsExtension" -ArgumentList $true, $true, 0, $true))
    $req.CertificateExtensions.Add((New-Object "$ns.X509KeyUsageExtension" -ArgumentList ([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]'KeyCertSign, CrlSign'), $true))
  } else {
    $req.CertificateExtensions.Add((New-Object "$ns.X509BasicConstraintsExtension" -ArgumentList $false, $false, 0, $true))
    $req.CertificateExtensions.Add((New-Object "$ns.X509KeyUsageExtension" -ArgumentList ([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]'DigitalSignature'), $true))
    $eku = New-Object System.Security.Cryptography.OidCollection; [void]$eku.Add((New-Object System.Security.Cryptography.Oid '1.3.6.1.5.5.7.3.3'))
    $req.CertificateExtensions.Add((New-Object "$ns.X509EnhancedKeyUsageExtension" -ArgumentList $eku, $true))
  }
}
function New-Request([string]$dn, $key) {
  New-Object "$ns.CertificateRequest" -ArgumentList (New-Object System.Security.Cryptography.X509Certificates.X500DistinguishedName $dn), $key,
    ([System.Security.Cryptography.HashAlgorithmName]::SHA256), ([System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
}
function Save-Pair($cert, [string]$base) {
  [IO.File]::WriteAllBytes((Join-Path $OutDir "$base.pfx"), $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, $PfxPassword))
  [IO.File]::WriteAllBytes((Join-Path $OutDir "$base.cer"), $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
}

$notBefore = [DateTimeOffset]::UtcNow.AddMinutes(-10)
$notAfter = $notBefore.AddYears($Years)
$result = @()

if ($Mode -eq 'SelfSigned') {
  $key = New-Key
  $req = New-Request $Subject $key; Add-Common $req $false
  $cert = $req.CreateSelfSigned($notBefore, $notAfter)
  # CreateSelfSigned returns a certificate whose key is in memory; Export(Pfx) needs it attached with an exportable key.
  Save-Pair $cert 'agastya-codesign'
  $result += $cert
} else {
  $caKey = New-Key
  $caReq = New-Request ($Subject -replace '^CN=([^,]*)', 'CN=$1 Root CA') $caKey; Add-Common $caReq $true
  $ca = $caReq.CreateSelfSigned($notBefore, $notBefore.AddYears(10))
  Save-Pair $ca 'agastya-root-ca'
  $key = New-Key
  $req = New-Request $Subject $key; Add-Common $req $false
  $issued = $req.Create($ca, $notBefore, $notAfter, (New-Serial))
  $withKey = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::CopyWithPrivateKey($issued, $key)
  Save-Pair $withKey 'agastya-codesign'
  $result += $ca, $withKey
}

Write-Host ''
Write-Host "Written to $OutDir :"
foreach ($c in $result) { Write-Host ("  {0,-48} valid until {1:yyyy-MM-dd}   SHA-1 {2}" -f $c.Subject, $c.NotAfter, $c.Thumbprint) }
if ($generated) {
  $pwFile = Join-Path $OutDir 'PFX-PASSWORD.txt'
  [IO.File]::WriteAllText($pwFile, $plain + [Environment]::NewLine)
  Write-Host ''
  Write-Host "No password was given, so a random one was written to $pwFile - move it to your password vault and delete the file."
}
Write-Host ''
if ($Mode -eq 'InternalCa') { Write-Host 'Push agastya-root-ca.cer to the PCs (Trusted Root Certification Authorities and Trusted Publishers). Keep both .pfx files offline.' }
else { Write-Host 'Push agastya-codesign.cer to the PCs (Trusted Root Certification Authorities and Trusted Publishers). Keep agastya-codesign.pfx private.' }
Write-Host 'No certificate store on this computer was changed.'
