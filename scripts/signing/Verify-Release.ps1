<#
.SYNOPSIS
  Checks an Agastya Platform release offline before it is installed: checksums, the signature over them, the SBOM, and the Authenticode
  signature of Setup.exe. With -Tree, also checks a product folder (unzipped portable copy or installed program folder) against its signed
  file manifest.

.DESCRIPTION
  WP-24 (RES-005, ENT-014). Ships next to Setup.exe in the release folder. Needs only Windows PowerShell 5.1 - no network, no Node.js, no
  other tool. Changes nothing.

  What is checked:
    * SHA256SUMS.txt: every file it lists exists here and has that SHA-256.
    * SHA256SUMS.txt.sig: a valid signature over SHA256SUMS.txt by the certificate it carries; with -Thumbprint, that it is that certificate.
      Whether this PC's Windows trusts the certificate (your organisation's root pushed by policy) is reported too.
    * The SBOM (*.cdx.json) is listed in SHA256SUMS.txt (so the signature covers it) and is a CycloneDX document.
    * Setup.exe (and any other .exe here): Authenticode signature intact, by the same certificate, with or without an RFC 3161 time stamp.
    * -Tree <folder>: every file in MANIFEST.sha256 is there with its SHA-256, nothing unlisted besides the installation's own files
      (config, data, logs, the uninstaller), and MANIFEST.sha256.sig is valid and made by the certificate that signed AgastyaCtl.exe.

  Exit code 0 = nothing failed. The thumbprint to compare with comes from your vendor through another channel (e-mail, release letter):
  a signature only proves who signed if you know which certificate is theirs.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\Verify-Release.ps1
  powershell -ExecutionPolicy Bypass -File .\Verify-Release.ps1 -Thumbprint 0123456789ABCDEF0123456789ABCDEF01234567 -RequireSigned
  powershell -ExecutionPolicy Bypass -File .\Verify-Release.ps1 -Tree "C:\Program Files\Agastya Platform" -RequireSigned
#>
[CmdletBinding()]
param(
  [string]$Release,
  [string]$Tree,
  [string]$Thumbprint,
  [switch]$RequireSigned,
  [switch]$RequireTimestamp
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
Add-Type -AssemblyName System.Security
if (-not $Release -and -not $Tree) { $Release = $PSScriptRoot }
if ($Thumbprint) { $Thumbprint = $Thumbprint.Replace(' ', '').ToUpperInvariant() }

$script:fails = 0
$script:signers = @{}
function Row([string]$status, [string]$check, [string]$detail) {
  if ($status -eq 'FAIL') { $script:fails++ }
  Write-Host ('{0,-4}  {1}: {2}' -f $status, $check, $detail)
}
$sha = [System.Security.Cryptography.SHA256]::Create()
function Hash([string]$file) {
  $s = [IO.File]::OpenRead($file)
  try { return (-join ($sha.ComputeHash($s) | ForEach-Object { $_.ToString('x2') })) } finally { $s.Dispose() }
}

function Test-Detached([string]$label, [string]$file) {
  $sigFile = "$file.sig"
  if (-not (Test-Path -LiteralPath $sigFile)) {
    if ($RequireSigned) { Row 'FAIL' "$label signature" "$(Split-Path -Leaf $sigFile) is missing" } else { Row 'WARN' "$label signature" 'not signed (development build): integrity rests on the hashes alone' }
    return
  }
  $f = @{}
  foreach ($l in [IO.File]::ReadAllLines($sigFile)) { if ($l -match '^([a-z0-9-]+):\s?(.*)$') { $f[$Matches[1]] = $Matches[2].Trim() } }
  if ($f['format'] -ne 'agastya-detached-signature/1') { Row 'FAIL' "$label signature" 'not an agastya-detached-signature/1 file'; return }
  $bytes = [IO.File]::ReadAllBytes($file)
  $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList (, [Convert]::FromBase64String($f['certificate']))
  if ($f['signed-file'] -ne (Split-Path -Leaf $file)) { Row 'FAIL' "$label signature" "the signature is for $($f['signed-file'])"; return }
  if ($cert.Thumbprint.ToUpperInvariant() -ne $f['thumbprint'].ToUpperInvariant()) { Row 'FAIL' "$label signature" 'the thumbprint line does not match the certificate'; return }
  if ((-join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') })) -ne $f['signed-sha256'].ToLowerInvariant()) { Row 'FAIL' "$label signature" 'the file was changed after it was signed'; return }
  $sig = [Convert]::FromBase64String($f['signature'])
  $alg = [System.Security.Cryptography.HashAlgorithmName]::SHA256
  $ok = $false
  if ($f['algorithm'] -eq 'RSA-PKCS1-SHA256') { $ok = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPublicKey($cert).VerifyData($bytes, $sig, $alg, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1) }
  elseif ($f['algorithm'] -eq 'ECDSA-P1363-SHA256') { $ok = [System.Security.Cryptography.X509Certificates.ECDsaCertificateExtensions]::GetECDsaPublicKey($cert).VerifyData($bytes, $sig, $alg) }
  else { Row 'FAIL' "$label signature" "unknown algorithm $($f['algorithm'])"; return }
  if (-not $ok) { Row 'FAIL' "$label signature" 'the signature does not match (file or signature altered)'; return }
  if ($Thumbprint -and $cert.Thumbprint -ne $Thumbprint) { Row 'FAIL' "$label signature" "signed by $($cert.Thumbprint), expected $Thumbprint"; return }
  $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
  $chain.ChainPolicy.RevocationMode = 'NoCheck'     # offline: no CRL/OCSP fetch
  $trusted = $chain.Build($cert)
  $script:signers[$cert.Thumbprint] = $cert.Subject
  Row 'PASS' "$label signature" ("signed by {0} ({1}); {2}" -f $cert.Subject, $cert.Thumbprint, $(if ($trusted) { 'Windows trusts this certificate here' } else { 'Windows on this PC does not trust its root (push the root by policy, or compare the thumbprint with the one your vendor published)' }))
}

function Test-Authenticode([string]$label, [string[]]$files, [switch]$OwnOnly, [string]$base) {
  if (-not $files -or $files.Count -eq 0) { return }
  $unsigned = @(); $broken = @(); $noTs = @(); $foreign = @(); $good = 0
  foreach ($p in $files) {
    $s = Get-AuthenticodeSignature -LiteralPath $p
    $rel = $p.Substring($base.Length).TrimStart('\')
    if ($s.Status -eq 'HashMismatch') { $broken += $rel; continue }
    if ($s.Status -eq 'NotSigned' -or -not $s.SignerCertificate) { $unsigned += $rel; continue }
    $good++
    if (-not $s.TimeStamperCertificate) { $noTs += $rel }
    $own = ($rel -match '^Agastya(Ctl|Platform)\.exe$') -or ($rel -match 'Setup\.exe$')
    if ($script:signers.Count -gt 0 -and -not $script:signers.ContainsKey($s.SignerCertificate.Thumbprint) -and ($own -or -not $OwnOnly)) { $foreign += "$rel ($($s.SignerCertificate.Subject))" }
  }
  if ($broken) { Row 'FAIL' "Authenticode $label" ("changed after signing: " + ($broken -join ', ')) }
  if ($unsigned) { Row $(if ($RequireSigned) { 'FAIL' } else { 'WARN' }) "Authenticode $label" ("not signed: " + (($unsigned | Select-Object -First 8) -join ', ') + $(if ($unsigned.Count -gt 8) { " (+$($unsigned.Count - 8))" } else { '' })) }
  if ($noTs -and $good) { Row $(if ($RequireTimestamp) { 'FAIL' } else { 'WARN' }) "time stamps $label" ("no RFC 3161 time stamp (stops verifying when the certificate expires): " + (($noTs | Select-Object -First 5) -join ', ')) }
  if ($foreign) { Row 'FAIL' "signer $label" ("not signed by the release certificate: " + (($foreign | Select-Object -First 5) -join '; ')) }
  if (-not $broken -and -not $unsigned -and -not $foreign) { Row 'PASS' "Authenticode $label" "$good file(s) signed and intact" }
}

$runtimeOwned = '^(MANIFEST\.sha256(\.sig)?|portable\.flag|state\.dir|unins\d{3}\.(exe|dat|msg))$|^(config|data|logs)\\'

if ($Release) {
  $Release = (Resolve-Path -LiteralPath $Release).Path
  $sums = Join-Path $Release 'SHA256SUMS.txt'
  if (-not (Test-Path -LiteralPath $sums)) { Row 'FAIL' 'SHA256SUMS.txt' "missing in $Release" }
  else {
    $bad = @(); $n = 0; $sbom = $null
    foreach ($l in [IO.File]::ReadAllLines($sums)) {
      if (-not $l.Trim()) { continue }
      if ($l -notmatch '^([0-9a-fA-F]{64}) [ *](.+)$') { $bad += "malformed line: $l"; continue }
      $h = $Matches[1].ToLowerInvariant(); $name = $Matches[2]; $n++
      if ($name -match '\.cdx\.json$') { $sbom = $name }
      $p = Join-Path $Release $name
      if (-not (Test-Path -LiteralPath $p)) { $bad += "$name missing" } elseif ((Hash $p) -ne $h) { $bad += "$name does not match" }
    }
    if ($bad) { Row 'FAIL' 'release checksums' ($bad -join '; ') } else { Row 'PASS' 'release checksums' "$n file(s) match SHA256SUMS.txt" }
    Test-Detached 'SHA256SUMS.txt' $sums
    if (-not $sbom) { Row $(if ($RequireSigned) { 'FAIL' } else { 'WARN' }) 'SBOM' 'no *.cdx.json listed in SHA256SUMS.txt' }
    else {
      try { $j = Get-Content -LiteralPath (Join-Path $Release $sbom) -Raw | ConvertFrom-Json; if ($j.bomFormat -ne 'CycloneDX' -or -not $j.components) { throw 'not a CycloneDX document' }; Row 'PASS' 'SBOM' "$sbom is listed in the checksums; CycloneDX $($j.specVersion), $(@($j.components).Count) components" }
      catch { Row 'FAIL' 'SBOM' "$sbom : $_" }
    }
  }
  $exes = @(Get-ChildItem -LiteralPath $Release -Filter *.exe -File | ForEach-Object { $_.FullName })
  Test-Authenticode 'in the release folder' $exes -base $Release
}

if ($Tree) {
  $Tree = (Resolve-Path -LiteralPath $Tree).Path.TrimEnd('\')
  $mf = Join-Path $Tree 'MANIFEST.sha256'
  if (-not (Test-Path -LiteralPath $mf)) { Row 'FAIL' 'manifest' "MANIFEST.sha256 is missing in $Tree" }
  else {
    Test-Detached 'MANIFEST.sha256' $mf
    $listed = @{}; $missing = @(); $changed = @(); $pes = @()
    foreach ($l in [IO.File]::ReadAllLines($mf)) {
      if (-not $l -or $l.StartsWith('#')) { continue }
      if ($l -notmatch '^([0-9a-f]{64}) (\d+) (.+)$') { $changed += "malformed line"; continue }
      $rel = $Matches[3].Replace('/', '\'); $listed[$rel.ToLowerInvariant()] = $true
      $p = Join-Path $Tree $rel
      if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { $missing += $rel; continue }
      if ((Get-Item -LiteralPath $p).Length -ne [long]$Matches[2] -or (Hash $p) -ne $Matches[1]) { $changed += $rel }
      if ($rel -match '\.(exe|dll|node)$') { $pes += $p }
    }
    $extra = @(Get-ChildItem -LiteralPath $Tree -Recurse -File -Force | ForEach-Object { $_.FullName.Substring($Tree.Length + 1) } |
      Where-Object { -not $listed.ContainsKey($_.ToLowerInvariant()) -and $_ -notmatch $runtimeOwned })
    $msg = @()
    if ($missing) { $msg += "missing: " + (($missing | Select-Object -First 5) -join ', ') + $(if ($missing.Count -gt 5) { " (+$($missing.Count - 5))" } else { '' }) }
    if ($changed) { $msg += "changed: " + (($changed | Select-Object -First 5) -join ', ') + $(if ($changed.Count -gt 5) { " (+$($changed.Count - 5))" } else { '' }) }
    if ($extra) { $msg += "not in the manifest: " + (($extra | Select-Object -First 5) -join ', ') + $(if ($extra.Count -gt 5) { " (+$($extra.Count - 5))" } else { '' }) }
    if ($msg) { Row 'FAIL' 'manifest' ($msg -join '; ') } else { Row 'PASS' 'manifest' "$($listed.Count) files match MANIFEST.sha256" }
    Test-Authenticode 'in the product folder' $pes -OwnOnly -base $Tree
  }
}

if ($script:signers.Count -gt 1) { Row 'FAIL' 'one signer' ("signed by several certificates: " + ($script:signers.Keys -join ', ')) }
Write-Host ''
if ($script:fails) { Write-Host "Verify-Release: FAILED ($($script:fails) check(s))"; exit 1 }
Write-Host 'Verify-Release: OK'
exit 0
