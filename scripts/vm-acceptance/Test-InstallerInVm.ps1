<#
.SYNOPSIS
  Installs, upgrades, restarts and uninstalls the Agastya Platform installer inside the throw-away guest made by New-TestVm.ps1, and reports PASS/FAIL.

.DESCRIPTION
  PowerShell Direct, no network. The host only copies the installer in and reads results out; every change (service, firewall rule, files, registry) happens
  inside the guest. Phases: install with service + LAN + firewall rule, smoke publish of a real PDF (bundled Java, no internet), reboot (the service must
  come back by itself), upgrade over the same version, uninstall (everything removed, data kept), default install (no service, loopback only), uninstall.
  Exit code 0 only when every check passed. The log is <WorkDir>\out\vm-test-<Label>.log.
#>
param(
  [Parameter(Mandatory)][string]$Setup,
  [string]$Label = 'run',
  [string]$VmName = 'AGASTYA-INSTALL-TEST',
  [string]$WorkDir = (Join-Path $env:TEMP 'agastya-vmtest')
)
$ErrorActionPreference = 'Stop'
$vm = $VmName
$s = $WorkDir
New-Item -ItemType Directory -Force "$s\out" | Out-Null
$log = "$s\out\vm-test-$Label.log"
Set-Content $log ''
$cred = New-Object System.Management.Automation.PSCredential('Administrator', (ConvertTo-SecureString (Get-Content "$s\vm-cred.txt" -Raw) -AsPlainText -Force))
$script:pass = 0; $script:fail = 0
function Say($m) { $l = "$(Get-Date -Format 'HH:mm:ss') $m"; Add-Content $log $l; Write-Output $l }
function Check($name, $ok, $detail = '') { if ($ok) { $script:pass++; Say "  PASS  $name" } else { $script:fail++; Say "  FAIL  $name   $detail" } }
function NewSession { for ($i = 0; $i -lt 30; $i++) { try { return New-PSSession -VMName $vm -Credential $cred -ErrorAction Stop } catch { Start-Sleep 8 } }; throw 'guest not reachable' }
function G([scriptblock]$sb, $a = @()) { Invoke-Command -Session $script:ses -ScriptBlock $sb -ArgumentList $a }

$script:ses = NewSession
Say "guest: $(G { $env:COMPUTERNAME + ' ' + (Get-CimInstance Win32_OperatingSystem).Caption })"
Say "installer: $Setup ($([math]::Round((Get-Item $Setup).Length/1MB,1)) MB)"
G { New-Item -ItemType Directory -Force C:\agtest | Out-Null }
# phase 1 exercises the fresh-configuration path; a configuration kept by an earlier run (an uninstall keeps it on purpose) is exercised by phase 6
G { Remove-Item 'C:\ProgramData\Agastya Platform' -Recurse -Force -ErrorAction SilentlyContinue }
Copy-Item -Path $Setup -Destination 'C:\agtest\Setup.exe' -ToSession $script:ses -Force
$base = G { [pscustomobject]@{ fw = (Get-NetFirewallRule -DisplayName 'Agastya Platform*' -ErrorAction SilentlyContinue | Measure-Object).Count; svc = (Get-Service AgastyaPlatform -ErrorAction SilentlyContinue | Measure-Object).Count; pf = (Test-Path 'C:\Program Files\Agastya Platform') } }
Check 'guest starts clean (no rule, no service, no install)' (($base.fw -eq 0) -and ($base.svc -eq 0) -and (-not $base.pf)) ($base | Out-String)

# ------------------------------------------------------------------ phase 1: install with service + LAN
Say '--- phase 1: silent install, /TASKS="service,lan" /PORT=4071 /LAN'
$r = G { $p = Start-Process -FilePath C:\agtest\Setup.exe -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/LOG=C:\agtest\setup1.log','/TASKS=service,lan','/PORT=4071','/LAN' -Wait -PassThru; $p.ExitCode }
Check 'installer exit code 0' ($r -eq 0) "exit=$r"
$o = G {
  $app = 'C:\Program Files\Agastya Platform'
  $svc = Get-CimInstance Win32_Service -Filter "Name='AgastyaPlatform'"
  $rule = Get-NetFirewallRule -DisplayName 'Agastya Platform (LAN access)' -ErrorAction SilentlyContinue
  $app_f = if ($rule) { ($rule | Get-NetFirewallApplicationFilter).Program } else { $null }
  $port_f = if ($rule) { ($rule | Get-NetFirewallPortFilter) } else { $null }
  $unin = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'Agastya Platform*' }
  [pscustomobject]@{
    files = @('AgastyaPlatform.exe','AgastyaCtl.exe','runtime\node.exe','unins000.exe') | ForEach-Object { "{0}={1}" -f $_, (Test-Path (Join-Path $app $_)) }
    svcState = $svc.State; svcStart = $svc.StartMode; svcAccount = $svc.StartName; svcPath = $svc.PathName
    ruleEnabled = [string]$rule.Enabled; ruleDir = [string]$rule.Direction; ruleAction = [string]$rule.Action; ruleProfile = [string]$rule.Profile
    ruleProgram = $app_f; ruleProto = $port_f.Protocol; ruleCount = (Get-NetFirewallRule -DisplayName 'Agastya Platform*' -ErrorAction SilentlyContinue | Measure-Object).Count
    uninstPublisher = $unin.Publisher; uninstVersion = $unin.DisplayVersion; uninstName = $unin.DisplayName
    ini = if (Test-Path 'C:\ProgramData\Agastya Platform\agastya.ini') { Get-Content 'C:\ProgramData\Agastya Platform\agastya.ini' -Raw } else { '' }
  }
}
Check 'program files installed' (($o.files | Where-Object { $_ -like '*=False' }).Count -eq 0) ($o.files -join ', ')
Check 'service running' ($o.svcState -eq 'Running') $o.svcState
Check 'service starts automatically' ($o.svcStart -eq 'Auto') $o.svcStart
Check 'service runs as LocalService' ($o.svcAccount -match 'LocalService') $o.svcAccount
Check 'firewall rule: one rule, enabled, inbound, allow' (($o.ruleCount -eq 1) -and ($o.ruleEnabled -eq 'True') -and ($o.ruleDir -eq 'Inbound') -and ($o.ruleAction -eq 'Allow')) "$($o.ruleCount) $($o.ruleEnabled) $($o.ruleDir) $($o.ruleAction)"
Check 'firewall rule: private+domain only, never public' (($o.ruleProfile -match 'Private') -and ($o.ruleProfile -match 'Domain') -and ($o.ruleProfile -notmatch 'Public') -and ($o.ruleProfile -notmatch 'Any')) $o.ruleProfile
Check 'firewall rule: bound to runtime\node.exe, TCP' (($o.ruleProgram -like '*\Agastya Platform\runtime\node.exe') -and ($o.ruleProto -eq 'TCP')) "$($o.ruleProgram) $($o.ruleProto)"
Check 'Add/Remove Programs entry present' ($o.uninstName -like 'Agastya Platform*') "$($o.uninstName) / $($o.uninstPublisher) / $($o.uninstVersion)"
Check 'agastya.ini written with Port=4071 and Bind=lan' (($o.ini -match '(?m)^\s*Port\s*=\s*4071') -and ($o.ini -match '(?im)^\s*Bind\s*=\s*lan')) ($o.ini -replace "`r?`n", ' | ')
Say "  info  publisher in Add/Remove Programs: '$($o.uninstPublisher)'"

Start-Sleep 6
$n = G {
  $h = $null; for ($i = 0; $i -lt 24 -and $h -ne 200; $i++) { try { $h = (Invoke-WebRequest -Uri 'http://127.0.0.1:4071/' -UseBasicParsing -TimeoutSec 10).StatusCode } catch { Start-Sleep 5 } }
  $l = Get-NetTCPConnection -State Listen -LocalPort 4071 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalAddress
  $doctor = & 'C:\Program Files\Agastya Platform\AgastyaCtl.exe' --doctor 2>&1 | Out-String; $dx = $LASTEXITCODE
  $status = & 'C:\Program Files\Agastya Platform\AgastyaCtl.exe' --status 2>&1 | Out-String
  $ev = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; ProviderName = 'Agastya Platform' } -MaxEvents 5 -ErrorAction SilentlyContinue | ForEach-Object { $_.Message.Split("`n")[0] }
  [pscustomobject]@{ listen = ($l -join ','); http = $h; doctorExit = $dx; doctor = $doctor.Trim(); status = $status.Trim(); events = ($ev -join ' || ') }
}
Check 'server listens on every interface (Bind=lan)' ($n.listen -match '0\.0\.0\.0|::') $n.listen
Check 'GET / returns 200' ($n.http -eq 200) $n.http
Check 'AgastyaCtl --doctor reports no problem (exit 0)' ($n.doctorExit -eq 0) "exit=$($n.doctorExit)`n$($n.doctor)"
Say "  info  --status: $($n.status -replace "`r?`n",' | ')"
Check 'service wrote to the Application event log' ([bool]$n.events) 'no events from source "Agastya Platform"'
Say "  info  events: $($n.events)"

# a real publish on a clean machine with no Java/Node installed (bundled runtimes only)
Say '--- smoke: first-run admin, author, project, publish a PDF (bundled Java, no internet)'
$p = G {
  $Base = 'http://127.0.0.1:4071'; $PW = 'Correct-Horse-9!'
  function J($sess, $m, $u, $b) { $a = @{ Uri = $Base + $u; Method = $m; WebSession = $sess; UseBasicParsing = $true; TimeoutSec = 600 }; if ($b) { $a.Body = ($b | ConvertTo-Json -Depth 6); $a.ContentType = 'application/json' }; Invoke-WebRequest @a }
  $adm = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $x = J $adm POST '/api/auth/setup' @{ username = 'admin'; password = $PW; fullName = 'Site Admin' }
  $m = (J $adm POST '/api/team/users' @{ username = 'alice'; fullName = 'Alice Author'; role = 'author' }).Content | ConvertFrom-Json
  $al = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $null = J $al POST '/api/auth/login' @{ username = 'alice'; password = $m.tempPassword }
  $null = J $al POST '/api/auth/onboarding' @{ username = 'alice'; password = $PW }
  $pr = (J $al POST '/api/projects' @{ name = 'Clean machine smoke'; profile = 'uhb' }).Content | ConvertFrom-Json
  $pid2 = $pr.project.id
  $pub = J $al POST "/api/projects/$pid2/publish" @{}
  $pdf = Invoke-WebRequest -Uri "$Base/api/projects/$pid2/publish/pdf" -WebSession $al -UseBasicParsing -TimeoutSec 120
  $bytes = $pdf.Content
  [pscustomobject]@{ pubStatus = $pub.StatusCode; pdfLen = $bytes.Length; magic = [Text.Encoding]::ASCII.GetString($bytes[0..4]); db = (Test-Path 'C:\ProgramData\Agastya Platform\workspace\publisher.db') }
}
Check 'publish returns 200 and a real PDF' (($p.pubStatus -eq 200) -and ($p.magic -eq '%PDF-') -and ($p.pdfLen -gt 5000)) ($p | Out-String)
Check 'database written by the LocalService account' ($p.db) 'publisher.db missing'

# ------------------------------------------------------------------ phase 2: reboot
Say '--- phase 2: reboot the guest, the service must come back by itself'
G { Add-Content 'C:\ProgramData\Agastya Platform\agastya.ini' "`r`n; kept-across-upgrade-marker`r`n" }
Remove-PSSession $script:ses
Stop-VM -Name $vm -Force -ErrorAction SilentlyContinue; Start-Sleep 5; Start-VM -Name $vm
$script:ses = NewSession
Start-Sleep 25
$q = G {
  $svc = Get-Service AgastyaPlatform -ErrorAction SilentlyContinue
  $h = $null; for ($i = 0; $i -lt 20 -and $h -ne 200; $i++) { try { $h = (Invoke-WebRequest -Uri 'http://127.0.0.1:4071/' -UseBasicParsing -TimeoutSec 10).StatusCode } catch { Start-Sleep 5 } }
  [pscustomobject]@{ svc = [string]$svc.Status; http = $h; uptimeMin = [math]::Round(((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalMinutes, 1) }
}
Check 'service running after reboot, nobody signed in' ($q.svc -eq 'Running') ($q | Out-String)
Check 'server answers after reboot' ($q.http -eq 200) ($q | Out-String)
$lg = G { $l = @{}; try { $s2 = New-Object Microsoft.PowerShell.Commands.WebRequestSession; $r = Invoke-WebRequest -Uri 'http://127.0.0.1:4071/api/auth/login' -Method POST -WebSession $s2 -ContentType 'application/json' -Body (@{ username = 'alice'; password = 'Correct-Horse-9!' } | ConvertTo-Json) -UseBasicParsing; $r.StatusCode } catch { "ERR $($_.Exception.Message)" } }
Check 'data survived the reboot (the author can still sign in)' ($lg -eq 200) "$lg"

# ------------------------------------------------------------------ phase 3: upgrade in place
Say '--- phase 3: install the same package over itself (upgrade path)'
$r = G { $p = Start-Process -FilePath C:\agtest\Setup.exe -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/LOG=C:\agtest\setup2.log' -Wait -PassThru; $p.ExitCode }
Check 'upgrade exit code 0' ($r -eq 0) "exit=$r"
Start-Sleep 8
$u = G {
  $svc = Get-Service AgastyaPlatform -ErrorAction SilentlyContinue
  $ini = Get-Content 'C:\ProgramData\Agastya Platform\agastya.ini' -Raw
  $bk = Get-ChildItem 'C:\ProgramData\Agastya Platform\workspace\backups' -Directory -ErrorAction SilentlyContinue | Where-Object Name -like 'pre-upgrade-*' | Select-Object -ExpandProperty Name
  $h = $null; for ($i = 0; $i -lt 20 -and $h -ne 200; $i++) { try { $h = (Invoke-WebRequest -Uri 'http://127.0.0.1:4071/' -UseBasicParsing -TimeoutSec 10).StatusCode } catch { Start-Sleep 5 } }
  [pscustomobject]@{ svc = [string]$svc.Status; ruleCount = (Get-NetFirewallRule -DisplayName 'Agastya Platform*' -ErrorAction SilentlyContinue | Measure-Object).Count; marker = ($ini -match 'kept-across-upgrade-marker'); port = ($ini -match '(?m)^\s*Port\s*=\s*4071'); backups = ($bk -join ','); http = $h }
}
Check 'service still running after upgrade' (($u.svc -eq 'Running') -and ($u.http -eq 200)) ($u | Out-String)
Check 'upgrade keeps edited agastya.ini' (($u.marker) -and ($u.port)) ($u | Out-String)
Check 'upgrade did not duplicate the firewall rule' ($u.ruleCount -eq 1) "$($u.ruleCount) rules"
Check 'upgrade backed up publisher.db first' ([bool]$u.backups) 'no pre-upgrade-* folder in workspace\backups'

# ------------------------------------------------------------------ phase 4: uninstall
Say '--- phase 4: silent uninstall'
$r = G { $p = Start-Process -FilePath 'C:\Program Files\Agastya Platform\unins000.exe' -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -Wait -PassThru; $p.ExitCode }
Check 'uninstaller exit code 0' ($r -eq 0) "exit=$r"
Start-Sleep 4
$d = G {
  [pscustomobject]@{
    svc = (Get-Service AgastyaPlatform -ErrorAction SilentlyContinue | Measure-Object).Count
    rule = (Get-NetFirewallRule -DisplayName 'Agastya Platform*' -ErrorAction SilentlyContinue | Measure-Object).Count
    prog = (Test-Path 'C:\Program Files\Agastya Platform')
    data = (Test-Path 'C:\ProgramData\Agastya Platform\workspace\publisher.db'); ini = (Test-Path 'C:\ProgramData\Agastya Platform\agastya.ini')
    reg = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'Agastya Platform*' } | Measure-Object).Count
    node = (Get-Process node -ErrorAction SilentlyContinue | Measure-Object).Count; java = (Get-Process java -ErrorAction SilentlyContinue | Measure-Object).Count
    left = ((Get-ChildItem 'C:\Program Files' -Directory -Filter 'Agastya*' -ErrorAction SilentlyContinue | Measure-Object).Count)
  }
}
Check 'uninstall removed the service' ($d.svc -eq 0) ($d | Out-String)
Check 'uninstall removed the firewall rule' ($d.rule -eq 0) ($d | Out-String)
Check 'uninstall removed the program folder and registry entry' ((-not $d.prog) -and ($d.reg -eq 0) -and ($d.left -eq 0)) ($d | Out-String)
Check 'uninstall left no node or java process behind' (($d.node -eq 0) -and ($d.java -eq 0)) ($d | Out-String)
Check 'uninstall kept the data and agastya.ini (as documented)' (($d.data) -and ($d.ini)) ($d | Out-String)

# ------------------------------------------------------------------ phase 5: per-machine default install, no service, loopback only
Say '--- phase 5: default install (no tasks), console run must bind loopback only'
G { Remove-Item 'C:\ProgramData\Agastya Platform' -Recurse -Force -ErrorAction SilentlyContinue }
$r = G { $p = Start-Process -FilePath C:\agtest\Setup.exe -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/LOG=C:\agtest\setup3.log','/PORT=4072' -Wait -PassThru; $p.ExitCode }
Check 'default install exit code 0' ($r -eq 0) "exit=$r"
$c = G {
  $env:AGASTYA_NO_BROWSER = '1'
  $pr = Start-Process -FilePath 'C:\Program Files\Agastya Platform\AgastyaCtl.exe' -ArgumentList '--console' -PassThru -WindowStyle Hidden
  $h = $null; for ($i = 0; $i -lt 30 -and $h -ne 200; $i++) { Start-Sleep 3; try { $h = (Invoke-WebRequest -Uri 'http://127.0.0.1:4072/' -UseBasicParsing -TimeoutSec 5).StatusCode } catch {} }
  $l = Get-NetTCPConnection -State Listen -LocalPort 4072 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalAddress
  Stop-Process -Id $pr.Id -Force -ErrorAction SilentlyContinue; Start-Sleep 3
  Get-Process node, java -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  [pscustomobject]@{ http = $h; listen = ($l -join ','); svc = (Get-Service AgastyaPlatform -ErrorAction SilentlyContinue | Measure-Object).Count; rule = (Get-NetFirewallRule -DisplayName 'Agastya Platform*' -ErrorAction SilentlyContinue | Measure-Object).Count }
}
Check 'console run answers and binds loopback only' (($c.http -eq 200) -and ($c.listen -match '127\.0\.0\.1') -and ($c.listen -notmatch '0\.0\.0\.0')) ($c | Out-String)
Check 'default install registers no service and no firewall rule' (($c.svc -eq 0) -and ($c.rule -eq 0)) ($c | Out-String)
$r = G { $p = Start-Process -FilePath 'C:\Program Files\Agastya Platform\unins000.exe' -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -Wait -PassThru; $p.ExitCode }
Check 'second uninstall exit code 0' ($r -eq 0) "exit=$r"
$z = G { [pscustomobject]@{ pf = (Test-Path 'C:\Program Files\Agastya Platform'); rule = (Get-NetFirewallRule -DisplayName 'Agastya Platform*' -ErrorAction SilentlyContinue | Measure-Object).Count; svc = (Get-Service AgastyaPlatform -ErrorAction SilentlyContinue | Measure-Object).Count } }
Check 'guest is clean again' ((-not $z.pf) -and ($z.rule -eq 0) -and ($z.svc -eq 0)) ($z | Out-String)

# ------------------------------------------------------------------ phase 6: value-less switches over a configuration that an uninstall kept
# Phase 5's uninstall kept agastya.ini (Port=4072, Bind=loopback). Inno's {param:} does not see a switch without "=value", so "/LAN" once left
# Bind=loopback here (while the firewall rule, which follows the task, was opened) and "/NOSERVICE" was ignored when the service task was selected.
Say '--- phase 6: /LAN over a kept agastya.ini, and /NOSERVICE although the service task is selected'
$k = G { if (Test-Path 'C:\ProgramData\Agastya Platform\agastya.ini') { Get-Content 'C:\ProgramData\Agastya Platform\agastya.ini' -Raw } else { '' } }
Check 'a configuration is left over from phase 5 (precondition)' (($k -match '(?m)^\s*Port\s*=\s*4072') -and ($k -match '(?im)^\s*Bind\s*=\s*loopback')) ($k -replace "`r?`n", ' | ')
$r = G { $p = Start-Process -FilePath C:\agtest\Setup.exe -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/LOG=C:\agtest\setup4.log','/TASKS=service,lan','/NOSERVICE','/PORT=4073','/LAN' -Wait -PassThru; $p.ExitCode }
Check 'install over the kept configuration, exit code 0' ($r -eq 0) "exit=$r"
$w = G {
  $ini = if (Test-Path 'C:\ProgramData\Agastya Platform\agastya.ini') { Get-Content 'C:\ProgramData\Agastya Platform\agastya.ini' -Raw } else { '' }
  [pscustomobject]@{
    ini  = $ini
    svc  = (Get-Service AgastyaPlatform -ErrorAction SilentlyContinue | Measure-Object).Count
    rule = (Get-NetFirewallRule -DisplayName 'Agastya Platform*' -ErrorAction SilentlyContinue | Measure-Object).Count
  }
}
Check '/LAN sets Bind=lan and /PORT sets Port=4073 in the kept agastya.ini' (($w.ini -match '(?im)^\s*Bind\s*=\s*lan') -and ($w.ini -match '(?m)^\s*Port\s*=\s*4073')) (($w.ini -replace "`r?`n", ' | '))
Check '/NOSERVICE: no service is registered although the service task was selected' ($w.svc -eq 0) "services=$($w.svc)"
Check 'the LAN task still opens its one firewall rule' ($w.rule -eq 1) "rules=$($w.rule)"
$r = G { $p = Start-Process -FilePath 'C:\Program Files\Agastya Platform\unins000.exe' -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -Wait -PassThru; $p.ExitCode }
Check 'uninstall after phase 6, exit code 0' ($r -eq 0) "exit=$r"
$z6 = G {
  Remove-Item 'C:\ProgramData\Agastya Platform' -Recurse -Force -ErrorAction SilentlyContinue
  [pscustomobject]@{ pf = (Test-Path 'C:\Program Files\Agastya Platform'); rule = (Get-NetFirewallRule -DisplayName 'Agastya Platform*' -ErrorAction SilentlyContinue | Measure-Object).Count; svc = (Get-Service AgastyaPlatform -ErrorAction SilentlyContinue | Measure-Object).Count; data = (Test-Path 'C:\ProgramData\Agastya Platform') }
}
Check 'guest is clean again after phase 6 (program, rule, service and configuration removed)' ((-not $z6.pf) -and ($z6.rule -eq 0) -and ($z6.svc -eq 0) -and (-not $z6.data)) ($z6 | Out-String)

# keep the guest's own installer logs next to the report
foreach ($f in 'setup1.log', 'setup2.log', 'setup3.log', 'setup4.log') { try { Copy-Item -FromSession $script:ses -Path "C:\agtest\$f" -Destination "$s\out\vm-$Label-$f" -Force -ErrorAction Stop } catch {} }
Remove-PSSession $script:ses
Say "RESULT: $($script:pass) passed, $($script:fail) failed"
Say 'DONE-VMTEST'
