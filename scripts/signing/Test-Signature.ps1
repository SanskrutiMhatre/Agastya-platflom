<#
.SYNOPSIS
  Reports the Authenticode signature of one or more files, and (with -RequireTrusted) fails unless Windows trusts it on this PC.

.EXAMPLE
  .\Test-Signature.ps1 -Path .\release\Agastya-Platform-2.0.0-win-x64-Setup.exe
  .\Test-Signature.ps1 -Path .\release\*.exe -RequireTrusted -Thumbprint 0123456789ABCDEF0123456789ABCDEF01234567

  Status meanings (Get-AuthenticodeSignature): Valid = signed, intact, and the chain ends in a root this PC trusts.
  UnknownError / NotTrusted with "terminated in a root certificate which is not trusted" = signed and intact, but this PC has not been given
  the root (push it by policy - docs/SIGNING.md). HashMismatch = the file was changed after signing. NotSigned = no signature.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string[]]$Path,
  [switch]$RequireTrusted,
  [string]$Thumbprint
)
$bad = 0
foreach ($f in (Get-ChildItem -Path $Path -File)) {
  $s = Get-AuthenticodeSignature -FilePath $f.FullName
  $who = if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { '-' }
  $tp = if ($s.SignerCertificate) { $s.SignerCertificate.Thumbprint } else { '-' }
  $ts = if ($s.TimeStamperCertificate) { 'timestamped' } else { 'no timestamp' }
  Write-Host ("{0,-52} {1,-12} {2}  {3}  {4}" -f $f.Name, $s.Status, $tp, $ts, $who)
  $ok = ($s.Status -eq 'Valid') -or (-not $RequireTrusted -and $s.Status -ne 'NotSigned' -and $s.Status -ne 'HashMismatch')
  if ($Thumbprint -and $tp -ne $Thumbprint.ToUpperInvariant().Replace(' ', '')) { $ok = $false }
  if (-not $ok) { $bad++ }
}
if ($bad) { Write-Host "$bad file(s) failed."; exit 1 }
exit 0
