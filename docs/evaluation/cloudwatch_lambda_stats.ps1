<#
.SYNOPSIS
  Lambda duration, cold-start and memory statistics from CloudWatch Logs Insights (Milestone 2, criterion C2).
.DESCRIPTION
  Requires the AWS CLI configured for the account that owns biosync-backend.
  Queries the Lambda REPORT lines of the last $Days days and prints the summary.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File docs\evaluation\cloudwatch_lambda_stats.ps1
#>
param(
  [int]$Days = 7,
  [string]$Region = 'ap-southeast-2',
  [string]$LogGroup = '/aws/lambda/biosync-backend'
)
$end = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$start = $end - ($Days * 86400)
# Regex filter avoids quote characters, which Windows PowerShell 5.1 mangles when calling native programs.
$query = 'filter @message like /^REPORT/ | stats count(*) as invocations, avg(@duration) as avg_ms, pct(@duration, 50) as p50_ms, pct(@duration, 95) as p95_ms, max(@duration) as max_ms, count(@initDuration) as cold_starts, avg(@initDuration) as avg_init_ms, max(@maxMemoryUsed / 1000 / 1000) as peak_memory_mb'
$queryId = aws logs start-query --region $Region --log-group-name $LogGroup --start-time $start --end-time $end --query-string $query --query queryId --output text
if (-not $queryId) { Write-Error 'start-query failed; check AWS CLI credentials and region.'; exit 1 }
do {
  Start-Sleep -Seconds 2
  $result = aws logs get-query-results --region $Region --query-id $queryId --output json | ConvertFrom-Json
} while ($result.status -eq 'Scheduled' -or $result.status -eq 'Running')
"Query status: {0}; window: last {1} days" -f $result.status, $Days
foreach ($row in $result.results) { foreach ($cell in $row) { "{0} = {1}" -f $cell.field, $cell.value } }
