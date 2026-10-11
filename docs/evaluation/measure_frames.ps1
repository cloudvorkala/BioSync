<#
.SYNOPSIS
  Frame-rendering, memory and ANR check for the installed BioSync app (Milestone 2, criterion C3).
.DESCRIPTION
  Requires one authorised Android device connected over USB with the release APK installed.
  The script opens the app, resets frame statistics, waits while you repeat the core
  workflow, then saves gfxinfo/meminfo/ANR output next to this script and prints a summary.
  Frozen frames are frames above 700 ms (Android vitals definition), counted from the
  gfxinfo histogram.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File docs\evaluation\measure_frames.ps1
#>
param(
  [string]$Package = 'com.biosync',
  [int]$Workflows = 5
)
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$state = (adb get-state 2>&1 | Out-String).Trim()
if ($state -ne 'device') { Write-Error "No authorised device found (adb get-state: $state). Unlock the phone and accept the USB debugging prompt."; exit 1 }

adb shell monkey -p $Package -c android.intent.category.LAUNCHER 1 | Out-Null
Start-Sleep -Seconds 3
adb logcat -c
adb shell dumpsys gfxinfo $Package reset | Out-Null
Read-Host "On the phone, repeat the core workflow $Workflows times (enter description, choose time, press Analyse, wait for the result). Press Enter here when done"

$gfx = adb shell dumpsys gfxinfo $Package
$mem = adb shell dumpsys meminfo $Package
$anr = adb logcat -d -b events | Select-String 'am_anr' | Select-String $Package
$gfx | Set-Content (Join-Path $PSScriptRoot "gfxinfo_$stamp.txt")
$mem | Set-Content (Join-Path $PSScriptRoot "meminfo_$stamp.txt")

function First-Value($lines, $pattern) {
  foreach ($l in $lines) { if ($l -match $pattern) { return $Matches[1] } }
  return 'n/a'
}
$frozen = 0
foreach ($l in $gfx) {
  if ($l -match '^\s*HISTOGRAM:') {
    foreach ($m in [regex]::Matches($l, '(\d+)ms=(\d+)')) {
      if ([int]$m.Groups[1].Value -gt 700) { $frozen += [int]$m.Groups[2].Value }
    }
    break
  }
}
$pss = First-Value $mem 'TOTAL PSS:\s+(\d+)'
if ($pss -eq 'n/a') { $pss = First-Value $mem '^\s*TOTAL\s+(\d+)' }

"Total frames rendered: " + (First-Value $gfx 'Total frames rendered:\s*(\d+)')
"Janky frames: " + (First-Value $gfx '^\s*Janky frames:\s*(.+)$')
"50th / 90th / 95th / 99th percentile: {0} / {1} / {2} / {3}" -f (First-Value $gfx '^\s*50th percentile:\s*(\S+)'), (First-Value $gfx '^\s*90th percentile:\s*(\S+)'), (First-Value $gfx '^\s*95th percentile:\s*(\S+)'), (First-Value $gfx '^\s*99th percentile:\s*(\S+)')
"Frozen frames (> 700 ms, from histogram): $frozen"
"ANR events for ${Package}: " + @($anr).Count
"Total PSS: $pss KB"
"Raw output saved as gfxinfo_$stamp.txt and meminfo_$stamp.txt in docs\evaluation"
