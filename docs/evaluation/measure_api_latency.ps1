<#
.SYNOPSIS
  Repeatable latency and concurrency measurement for a deployed BioSync API (Milestone 2 evaluation).
.DESCRIPTION
  Sends GET /health and POST /v1/analyses (synthetic fixture from
  mobile/src/dev/analysisFixture.json) sequentially, Warmup + Runs times, and
  writes every timing to a CSV file next to this script. It then sends one
  burst of $Concurrency simultaneous analysis requests (scalability check).
  Use -BurstOnly to run only the concurrency burst.
  In OpenAI mode every analysis call is a billed model request.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File docs\evaluation\measure_api_latency.ps1
  powershell -ExecutionPolicy Bypass -File docs\evaluation\measure_api_latency.ps1 -BurstOnly
#>
param(
  [string]$BaseUrl = 'https://iax8d3mquk.execute-api.ap-southeast-2.amazonaws.com/demo',
  [int]$Runs = 30,
  [int]$Warmup = 2,
  [int]$PauseMs = 500,
  [int]$Concurrency = 10,
  [switch]$BurstOnly
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# .NET Framework allows only 2 parallel connections per host by default; lift it for the burst.
[Net.ServicePointManager]::DefaultConnectionLimit = 100
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$body = Get-Content -Raw -Path (Join-Path $repoRoot 'mobile/src/dev/analysisFixture.json')

function Measure-Request([string]$Name, [scriptblock]$Call, [int]$Iteration, [bool]$IsWarmup) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $status = -1
  try {
    $response = & $Call
    $status = [int]$response.StatusCode
  } catch {
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
  }
  $sw.Stop()
  [pscustomobject]@{
    iteration = $Iteration; warmup = $IsWarmup; endpoint = $Name; status = $status
    ms = [math]::Round($sw.Elapsed.TotalMilliseconds, 1)
    utc = (Get-Date).ToUniversalTime().ToString('o')
  }
}

function Get-Percentile([double[]]$Sorted, [double]$P) {
  $index = [int]([math]::Ceiling($P * $Sorted.Length) - 1)
  if ($index -lt 0) { $index = 0 }
  return $Sorted[$index]
}

if (-not $BurstOnly) {
  $csv = Join-Path $PSScriptRoot ("api_latency_{0}.csv" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))
  $results = New-Object System.Collections.Generic.List[object]
  for ($i = 1; $i -le ($Warmup + $Runs); $i++) {
    $isWarmup = $i -le $Warmup
    $results.Add((Measure-Request 'GET /health' { Invoke-WebRequest -UseBasicParsing -Method Get -Uri "$BaseUrl/health" -TimeoutSec 30 } $i $isWarmup))
    $results.Add((Measure-Request 'POST /v1/analyses' { Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$BaseUrl/v1/analyses" -ContentType 'application/json' -Body $body -TimeoutSec 30 } $i $isWarmup))
    Start-Sleep -Milliseconds $PauseMs
  }
  $results | Export-Csv -NoTypeInformation -Path $csv

  "First call (possible Lambda cold start): health {0} ms, analysis {1} ms" -f $results[0].ms, $results[1].ms
  foreach ($group in ($results | Where-Object { -not $_.warmup } | Group-Object endpoint)) {
    [double[]]$times = @($group.Group | Where-Object { $_.status -eq 200 } | ForEach-Object { [double]$_.ms } | Sort-Object)
    if ($times.Length -eq 0) { "{0}: no successful responses" -f $group.Name; continue }
    $n = $times.Length
    if ($n % 2 -eq 1) { $median = $times[[int][math]::Floor($n / 2)] } else { $median = ($times[[int]($n / 2) - 1] + $times[[int]($n / 2)]) / 2 }
    "{0}: {1}/{2} succeeded; median {3} ms; p95 {4} ms; max {5} ms" -f $group.Name, $n, $group.Count, $median, (Get-Percentile $times 0.95), $times[$n - 1]
  }
  "Raw results: $csv"
}

# Scalability: one burst of simultaneous analysis requests, each timed individually.
Add-Type -AssemblyName System.Net.Http
$client = New-Object System.Net.Http.HttpClient
$client.Timeout = [TimeSpan]::FromSeconds(30)
$burstWatch = [System.Diagnostics.Stopwatch]::StartNew()
$tasks = @()
for ($i = 0; $i -lt $Concurrency; $i++) {
  $content = New-Object System.Net.Http.StringContent($body, [System.Text.Encoding]::UTF8, 'application/json')
  $tasks += $client.PostAsync("$BaseUrl/v1/analyses", $content)
}
$finished = @{}
while ($finished.Count -lt $tasks.Count) {
  for ($i = 0; $i -lt $tasks.Count; $i++) {
    if (-not $finished.ContainsKey($i) -and $tasks[$i].IsCompleted) { $finished[$i] = $burstWatch.Elapsed.TotalMilliseconds }
  }
  Start-Sleep -Milliseconds 20
}
$burstWatch.Stop()
$burstOk = @($tasks | Where-Object { $_.Status -eq 'RanToCompletion' -and [int]$_.Result.StatusCode -eq 200 }).Count
$codes = ($tasks | ForEach-Object { if ($_.Status -eq 'RanToCompletion') { [int]$_.Result.StatusCode } else { 'failed' } }) -join ','
[double[]]$burstTimes = @($finished.Values | Sort-Object)
$client.Dispose()
"Concurrency burst: {0}/{1} succeeded; fastest {2} ms; median {3} ms; slowest {4} ms; status codes: {5}" -f $burstOk, $Concurrency, [math]::Round($burstTimes[0], 0), [math]::Round($burstTimes[[int][math]::Floor($burstTimes.Length / 2)], 0), [math]::Round($burstTimes[$burstTimes.Length - 1], 0), $codes
