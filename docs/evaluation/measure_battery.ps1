<#
.SYNOPSIS
  Estimated battery (energy) and network use of the BioSync app per analysis (Milestone 2, runtime characteristics).
.DESCRIPTION
  Android only accumulates battery statistics while the phone runs on battery, so the phone must
  be UNPLUGGED. Connect adb over Wi-Fi (Developer options > Wireless debugging):
      adb pair <ip>:<pairing-port>     (enter the pairing code shown on the phone)
      adb connect <ip>:<port>
  then unplug the USB cable and run this script.

  One run = (optional) idle baseline with the app open, then N analyses performed by you.
  The script resets batterystats before each phase, saves the raw output next to this script,
  and appends a summary row to battery_summary.csv. Run it three times for reproducibility.

  Values come from Android's power model (dumpsys batterystats), i.e. they are estimates,
  not measured current.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File docs\evaluation\measure_battery.ps1
  powershell -ExecutionPolicy Bypass -File docs\evaluation\measure_battery.ps1 -Serial 192.168.1.20:37099 -Analyses 10 -IdleMinutes 5
#>
param(
  [string]$Package = 'com.biosync',
  [int]$Analyses = 10,
  [int]$IdleMinutes = 5,
  [int]$UsesPerDay = 3,
  [string]$Serial = ''
)
$ErrorActionPreference = 'Continue'
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'

# Simple function (no param block) so flags such as -p, -U and --reset pass straight to adb.
function Invoke-Adb {
  if ($Serial) { & adb -s $Serial @args } else { & adb @args }
}

# --- checks --------------------------------------------------------------
if (-not $Serial) {
  $listed = @(adb devices | Select-String '^(\S+)\s+device$' | ForEach-Object { $_.Matches[0].Groups[1].Value })
  $wifi = @($listed | Where-Object { $_ -match ':\d+$' })
  if ($listed.Count -eq 1) { $Serial = $listed[0] }   # ignores 'offline'/'unauthorized' entries that make plain adb fail
  elseif ($listed.Count -gt 1 -and $wifi.Count -eq 1) { $Serial = $wifi[0]; "Several devices connected; using the Wi-Fi device $Serial" }
}
$state = (Invoke-Adb get-state 2>&1 | Out-String).Trim()
if ($state -ne 'device') { Write-Error "No authorised device (adb get-state: $state). With several devices connected, pass -Serial <ip:port>."; exit 1 }

$battery = Invoke-Adb shell dumpsys battery
$plugged = $battery | Select-String -Pattern '(AC|USB|Wireless|Dock) powered:\s*true'
if ($plugged) {
  Write-Error ("The phone is charging (" + ($plugged -join '; ').Trim() + "). Unplug it and use adb over Wi-Fi; batterystats does not record while charging.")
  exit 1
}

$uidLine = "$(Invoke-Adb shell cmd package list packages -U $Package | Select-String "package:$Package ")"
if ($uidLine -notmatch 'uid:(\d+)') { Write-Error "Cannot find the UID of $Package. Is the release APK installed?"; exit 1 }
$uid = [int]$Matches[1]
$appId = $uid % 100000
$uidName = 'u0a' + ($appId - 10000)   # e.g. 10234 -> u0a234
"Package $Package has UID $uid ($uidName)"

function Get-Level { $l = (Invoke-Adb shell dumpsys battery | Select-String 'level:\s*(\d+)'); if ($l) { [int]$l.Matches[0].Groups[1].Value } else { -1 } }

function Parse-Stats($human, $checkin) {
  $r = [ordered]@{ app_mAh = $null; capacity_mAh = $null; wifi_rx_bytes = $null; wifi_tx_bytes = $null; mobile_rx_bytes = $null; mobile_tx_bytes = $null }
  foreach ($l in $human) {
    if ($null -eq $r.capacity_mAh -and $l -match 'Capacity:\s*([\d.]+)') { $r.capacity_mAh = [double]$Matches[1] }
    if ($null -eq $r.app_mAh -and $l -match ('^\s*U(?:id|ID) ' + [regex]::Escape($uidName) + ':\s*([\d.]+)')) { $r.app_mAh = [double]$Matches[1] }
  }
  foreach ($l in $checkin) {
    $f = $l -split ','
    if ($f.Count -lt 6 -or $f[1] -ne "$uid") { continue }
    if ($f[3] -eq 'nt' -and $f.Count -ge 8) {
      $r.mobile_rx_bytes = [double]$f[4]; $r.mobile_tx_bytes = [double]$f[5]; $r.wifi_rx_bytes = [double]$f[6]; $r.wifi_tx_bytes = [double]$f[7]
    }
    if ($null -eq $r.app_mAh -and $f[3] -eq 'pwi' -and $f.Count -ge 6) { $r.app_mAh = [double]$f[5] }
  }
  return $r
}

function Run-Phase($name, [scriptblock]$during) {
  Invoke-Adb shell dumpsys batterystats --reset | Out-Null
  $level0 = Get-Level
  $t0 = Get-Date
  & $during | Out-Null
  $mins = ((Get-Date) - $t0).TotalMinutes
  $human = Invoke-Adb shell dumpsys batterystats --charged $Package
  $checkin = Invoke-Adb shell dumpsys batterystats --checkin --charged
  $human | Set-Content (Join-Path $PSScriptRoot "batterystats_${name}_$stamp.txt")
  $checkin | Set-Content (Join-Path $PSScriptRoot "batterystats_checkin_${name}_$stamp.txt")
  $s = Parse-Stats $human $checkin
  $s.minutes = [math]::Round($mins, 1)
  $s.level_start = $level0
  $s.level_end = Get-Level
  return $s
}

# Keep the screen on during both phases (the phone is unplugged, so 'stay awake' does not apply).
$oldTimeout = ("$(Invoke-Adb shell settings get system screen_off_timeout)").Trim()
Invoke-Adb shell settings put system screen_off_timeout 1800000 | Out-Null
"Screen timeout set to 30 min for the test (was $oldTimeout ms); it is restored at the end."
try {
Invoke-Adb shell monkey -p $Package -c android.intent.category.LAUNCHER 1 | Out-Null
Start-Sleep -Seconds 3

# --- phase 1: idle baseline -----------------------------------------------
$idle = $null
if ($IdleMinutes -gt 0) {
  Read-Host "Idle baseline: leave BioSync open on screen and do not touch the phone for $IdleMinutes min. Press Enter to start"
  $idle = Run-Phase 'idle' { Start-Sleep -Seconds ($IdleMinutes * 60) }
  "Idle: app {0} mAh over {1} min" -f $idle.app_mAh, $idle.minutes
}

# --- phase 2: analyses ------------------------------------------------------
Read-Host "Analyses: keep the screen on and press Run Test Analysis (or a full analysis) $Analyses times, waiting for each result. Press Enter to start"
$an = Run-Phase 'analyses' { Read-Host "Press Enter here after the $Analyses-th result has appeared" | Out-Null }
} finally {
  if ($oldTimeout -match '^\d+$') { Invoke-Adb shell settings put system screen_off_timeout $oldTimeout | Out-Null; "Screen timeout restored to $oldTimeout ms." }
}

# --- summary ----------------------------------------------------------------
$perAnalysis = $null; $netPerAnalysis = $null; $idleShare = 0
if ($an.app_mAh -ne $null) {
  if ($idle -and $idle.app_mAh -ne $null -and $idle.minutes -gt 0) { $idleShare = $idle.app_mAh / $idle.minutes * $an.minutes }
  $perAnalysis = [math]::Max([double]0, [double]($an.app_mAh - $idleShare)) / $Analyses
}
if ($an.wifi_rx_bytes -ne $null) { $netPerAnalysis = ($an.wifi_rx_bytes + $an.wifi_tx_bytes + $an.mobile_rx_bytes + $an.mobile_tx_bytes) / $Analyses }
$cap = $an.capacity_mAh
$pctPerAnalysis = if ($perAnalysis -ne $null -and $cap) { 100 * $perAnalysis / $cap } else { $null }
$pctPerDay = if ($pctPerAnalysis -ne $null) { $pctPerAnalysis * $UsesPerDay } else { $null }

$row = [pscustomobject]@{
  stamp = $stamp; analyses = $Analyses; analysis_minutes = $an.minutes; app_mAh = $an.app_mAh
  idle_minutes = if ($idle) { $idle.minutes } else { 0 }; idle_app_mAh = if ($idle) { $idle.app_mAh } else { $null }
  mAh_per_analysis = if ($perAnalysis -ne $null) { [math]::Round($perAnalysis, 4) } else { $null }
  capacity_mAh = $cap
  pct_battery_per_analysis = if ($pctPerAnalysis -ne $null) { [math]::Round($pctPerAnalysis, 4) } else { $null }
  pct_battery_per_day = if ($pctPerDay -ne $null) { [math]::Round($pctPerDay, 4) } else { $null }
  network_bytes_per_analysis = if ($netPerAnalysis -ne $null) { [math]::Round($netPerAnalysis) } else { $null }
  level_start = $an.level_start; level_end = $an.level_end
}
$row | Export-Csv (Join-Path $PSScriptRoot 'battery_summary.csv') -NoTypeInformation -Append
$row | Format-List
if ($an.app_mAh -eq $null) { Write-Warning "Could not parse the app's mAh from batterystats on this Android version; open batterystats_analyses_$stamp.txt and look for '$uidName' under 'Estimated power use'." }
"Raw output saved as batterystats_*_$stamp.txt in docs\evaluation; summary appended to battery_summary.csv."
"Estimates come from Android's power model, not measured current."
