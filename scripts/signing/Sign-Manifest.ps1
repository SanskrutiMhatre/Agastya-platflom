<#
.SYNOPSIS
  Writes a detached signature (<file>.sig) for each file given, with the code-signing certificate that Authenticode-signs the executables.

.DESCRIPTION
  WP-24 (RES-005, DEP-013): the file manifest of the product (MANIFEST.sha256) and the release checksum list (SHA256SUMS.txt, which covers the
  installer, the portable ZIP and the SBOM) are not executables, so Authenticode cannot sign them. This script signs their exact bytes with the
  same certificate and writes the "agastya-detached-signature/1" format described in scripts/release/lib.mjs. The signature carries the public
  certificate, so it can be checked offline with no other file: scripts/signing/Verify-Release.ps1, scripts/release/verify-release.mjs and
  AgastyaCtl.exe --verify.

  The certificate comes from a .pfx file (-Pfx; the password from -Password or AGASTYA_SIGN_PASSWORD, never the command line of the build) or
  from a certificate store by thumbprint (-Thumbprint; CurrentUser\My unless -StoreLocation LocalMachine) - the second also works with a key held
  in a hardware token or HSM whose provider exposes it to Windows. Nothing is added to any certificate store.

  RSA keys sign with PKCS#1 v1.5 / SHA-256, ECDSA keys with SHA-256 (IEEE P1363 r||s).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\signing\Sign-Manifest.ps1 -File release\SHA256SUMS.txt -Pfx D:\signing\agastya-codesign.pfx
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string[]]$File,
  [string]$Pfx,
  [System.Security.SecureString]$Password,
  [string]$Thumbprint,
  [ValidateSet('CurrentUser', 'LocalMachine')][string]$StoreLocation = 'CurrentUser'
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ne 5) { Write-Error 'Run this in Windows PowerShell 5.1 (powershell.exe).'; exit 2 }
if ([bool]$Pfx -eq [bool]$Thumbprint) { Write-Error 'Give either -Pfx or -Thumbprint.'; exit 2 }
Add-Type -AssemblyName System.Security
$x509 = 'System.Security.Cryptography.X509Certificates'

$cert = $null
if ($Pfx) {
  if (-not (Test-Path -LiteralPath $Pfx)) { Write-Error "Certificate file not found: $Pfx"; exit 2 }
  if (-not $Password) {
    if (-not $env:AGASTYA_SIGN_PASSWORD) { Write-Error 'Give -Password or set AGASTYA_SIGN_PASSWORD.'; exit 2 }
    $Password = ConvertTo-SecureString -String $env:AGASTYA_SIGN_PASSWORD -AsPlainText -Force
  }
  $flags = [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]
  foreach ($f in @($flags::EphemeralKeySet, $flags::DefaultKeySet)) {   # a key that never touches disk when the system allows it
    try { $cert = New-Object "$x509.X509Certificate2" -ArgumentList (Resolve-Path -LiteralPath $Pfx).Path, $Password, $f; break } catch { $last = $_ }
  }
  if (-not $cert) { Write-Error "Cannot open $Pfx : $($last.Exception.Message)"; exit 1 }
} else {
  $tp = $Thumbprint.Replace(' ', '').ToUpperInvariant()
  $cert = Get-Item -LiteralPath "Cert:\$StoreLocation\My\$tp" -ErrorAction SilentlyContinue
  if (-not $cert) { Write-Error "No certificate $tp in Cert:\$StoreLocation\My."; exit 1 }
}
if (-not $cert.HasPrivateKey) { Write-Error "The certificate $($cert.Subject) has no private key here."; exit 1 }

$rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
$ec = $null
if (-not $rsa) { $ec = [System.Security.Cryptography.X509Certificates.ECDsaCertificateExtensions]::GetECDsaPrivateKey($cert) }
if (-not $rsa -and -not $ec) { Write-Error 'Only RSA and ECDSA keys are supported.'; exit 1 }
$sha = [System.Security.Cryptography.HashAlgorithmName]::SHA256
$hasher = [System.Security.Cryptography.SHA256]::Create()

foreach ($one in $File) {
  if (-not (Test-Path -LiteralPath $one)) { Write-Error "File not found: $one"; exit 2 }
  $full = (Resolve-Path -LiteralPath $one).Path
  $bytes = [IO.File]::ReadAllBytes($full)
  if ($rsa) { $sig = $rsa.SignData($bytes, $sha, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1); $alg = 'RSA-PKCS1-SHA256' }
  else { $sig = $ec.SignData($bytes, $sha); $alg = 'ECDSA-P1363-SHA256' }
  $hex = -join ($hasher.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') })
  $lines = @(
    'format: agastya-detached-signature/1',
    "algorithm: $alg",
    "signed-file: $(Split-Path -Leaf $full)",
    "signed-sha256: $hex",
    "signer: $($cert.Subject)",
    "thumbprint: $($cert.Thumbprint.ToUpperInvariant())",
    "certificate: $([Convert]::ToBase64String($cert.RawData))",
    "signature: $([Convert]::ToBase64String($sig))",
    ''
  )
  [IO.File]::WriteAllText("$full.sig", ($lines -join "`n"), (New-Object System.Text.UTF8Encoding($false)))
  Write-Host ("signed {0} -> {0}.sig  [{1}; {2}]" -f (Split-Path -Leaf $full), $cert.Subject, $alg)
}
exit 0
