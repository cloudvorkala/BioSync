# Build only: never invokes AWS or forwards host secrets to Docker.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$backendRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dist = Join-Path $backendRoot 'dist'
New-Item -ItemType Directory -Path $dist -Force | Out-Null
$image = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'lambda-image.txt') -Raw).Trim()
try {
    # Windows PowerShell 5 can treat native stderr warnings as terminating
    # errors when output is redirected. Use Docker's exit code for success.
    $ErrorActionPreference = 'Continue'
    & docker run --rm --platform linux/amd64 `
        --mount "type=bind,source=$backendRoot,target=/src,readonly" `
        --mount "type=bind,source=$dist,target=/out" `
        --env PYTHONDONTWRITEBYTECODE=1 `
        --entrypoint /var/lang/bin/python $image /src/deploy/build_lambda.py
    $buildExit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = 'Stop'
}
if ($buildExit -ne 0) { throw 'Lambda Linux build/validation failed. Check Docker Desktop is running in Linux-container mode.' }
Write-Output "Validated artifact: $dist\biosync-lambda.zip"
