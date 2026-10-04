# BioSync Lambda deployment (prepare locally; deploy manually)

This directory builds a ZIP and documents operator-run AWS commands. The build
scripts **do not run AWS commands or create cloud resources**.

```text
Local: React Native → local Flask → existing policy/iAUC → LLM service
Demo:  React Native → API Gateway HTTPS → Lambda → same Flask app
                                               → same policy/iAUC → LLM service → OpenAI
```

`backend/lambda_handler.py` creates the existing `biosync.app.create_app()` once
per execution environment and calls `serverless_wsgi.handle_request`. The
configured handler is **`lambda_handler.handler`**. Flask owns all routing.
The same factory still runs locally:

```powershell
# From backend/
.venv/Scripts/python.exe -m flask --app biosync.app:create_app run --host 0.0.0.0 --port 5000
```

## Target and prototype defaults

| Setting | Value |
|---|---|
| Region | `ap-southeast-2` |
| Runtime / package | `python3.12` / ZIP |
| Architecture | `x86_64` (must match the build) |
| Memory | `512 MB` |
| Lambda timeout | `28 seconds` |
| API Gateway | Regional **REST API**, Lambda `AWS_PROXY`, payload v1 |
| Integration timeout | `29000 ms` |
| Methods | `ANY /`, `ANY /{proxy+}` |
| Stage / Lambda alias | `demo` / `demo` |
| Network | Default Lambda networking, no VPC attachment |

512 MB gives this small Python/SDK app startup headroom. A 28-second Lambda
limit leaves room for an external call and fits within the chosen 29-second
Gateway limit. These are prototype defaults, not production-tuned measurements.
The **existing OpenAI SDK timeout remains 10 seconds, with no SDK retries**, and
the existing mobile timeout remains 15 seconds. Increasing Lambda timeout does
not extend either of those. Cold starts or slower models may still cause client
timeouts; measure real calls before changing application settings. No scientific
or LLM business logic was changed for deployment.

No CORS middleware or Gateway OPTIONS/CORS configuration was added. Native
React Native requests use the existing HTTP contract. This does not introduce
browser support, authentication, storage, CV, or a database.

## Build on Windows

Prerequisite: Docker Desktop running **Linux containers**, with permission to
mount the repository. Dependency installation needs internet access; validation
uses mock mode, blocks sockets and makes no AWS/OpenAI requests. No host AWS or
OpenAI environment variables are forwarded into the container.

From the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File backend/deploy/build_lambda.ps1
```

Linux/macOS equivalent:

```bash
bash backend/deploy/build_lambda.sh
```

The scripts use `linux/amd64` and the official Lambda Python 3.12 image pinned
by digest in `lambda-image.txt` (Amazon Linux 2023). Dependencies, including
transitives, are pinned in `requirements-lambda.lock`. The build also checks
`requirements.txt` for compatibility and rejects any installed package not in
the lock. All packages are installed **inside Linux** with `--only-binary=:all:`;
Windows `.venv` contents are never copied.

To refresh dependencies, update the Linux deployment lock deliberately and rerun
the full backend suite and Docker build. To refresh the base image, pull
`public.ecr.aws/lambda/python:3.12` for `linux/amd64`, inspect its RepoDigest,
update `lambda-image.txt`, and rebuild. Keep image and dependency updates reviewed.
Pinned versions/digest plus sorted ZIP entries/fixed timestamps make the process
repeatable; the build records the artifact SHA256 for identifying releases.

Outputs (all ignored by Git):

```text
backend/dist/
├── biosync-lambda.zip
├── biosync-lambda.sha256
└── build-manifest.json
```

ZIP root:

```text
lambda_handler.py
biosync/                         # application Python source only
flask/, werkzeug/, ...
pydantic/, pydantic_core/         # includes CPython 3.12 Linux .so
openai/, jiter/, httpx2/, ...     # includes Linux .so and runtime dependencies
serverless_wsgi.py
*.dist-info/                     # runtime package metadata/licenses
```

No wrapping `backend/` folder. No tests, deployment scripts, `.venv`, `.env`,
secrets, Git metadata or Python caches. The build checks ZIP structure, size,
CRC, native ELF64 x86_64 headers and actual imports from the extracted artifact
in the Lambda runtime image. It then invokes real proxy events for health,
mock iAUC 225 and missing-key errors. A new artifact is published to `dist/`
only after these checks pass; on a build failure an older ZIP may still exist,
so do not deploy after a failed build.

Host-side structural recheck (no Linux imports on Windows):

```powershell
# From backend/
.venv/Scripts/python.exe -B deploy/validate_package.py dist/biosync-lambda.zip
.venv/Scripts/python.exe -B -m pytest -p no:cacheprovider -q
```

## AWS CLI: initial deployment

The following commands are **PowerShell**, run from `backend/`, using AWS CLI v2.
Use an already authenticated course account/profile with permission to manage
IAM, Lambda and API Gateway. No account ID or credential is embedded in files.
The CLI retrieves your account ID only when you run the commands.

First set common variables and a fail-fast wrapper so failed CLI steps do not
silently continue. All later sections use these variables. After reopening a
shell, recreate them and obtain the existing API ID from your saved deployment
record; do not run `create-rest-api` again for a code-only update.

```powershell
$env:AWS_PAGER = ''
# Optional: $env:AWS_PROFILE = '<YOUR_AWS_PROFILE>'
function Invoke-BioSyncAws {
    & aws.exe @args
    if ($LASTEXITCODE -ne 0) { throw 'AWS CLI command failed; stop and resolve it before continuing.' }
}
$Region = 'ap-southeast-2'
$FunctionName = 'biosync-backend'
$RoleName = 'biosync-lambda-execution'
$Stage = 'demo'
$Alias = 'demo'
$AccountId = Invoke-BioSyncAws sts get-caller-identity --query Account --output text
$LambdaArn = "arn:aws:lambda:${Region}:${AccountId}:function:${FunctionName}"
$AliasArn = "${LambdaArn}:${Alias}"
```

### 1. Execution role

For a new role:

```powershell
$RoleArn = Invoke-BioSyncAws iam create-role --role-name $RoleName --assume-role-policy-document file://deploy/role-trust.json --query Role.Arn --output text
Invoke-BioSyncAws iam attach-role-policy --role-name $RoleName --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
Invoke-BioSyncAws iam wait role-exists --role-name $RoleName
```

For an existing role, instead retrieve its ARN and ensure its trust policy allows
`lambda.amazonaws.com` and it has the logging policy above:

```powershell
$RoleArn = Invoke-BioSyncAws iam get-role --role-name $RoleName --query Role.Arn --output text
```

IAM changes can take time to propagate. If function creation says the role cannot
be assumed, wait briefly and retry that step; do not create duplicate roles.

### 2. Create Lambda in deterministic mock mode and publish an alias

```powershell
$Version = Invoke-BioSyncAws lambda create-function --region $Region --function-name $FunctionName --runtime python3.12 --architectures x86_64 --handler lambda_handler.handler --role $RoleArn --memory-size 512 --timeout 28 --zip-file fileb://dist/biosync-lambda.zip --environment 'Variables={BIOSYNC_LLM_MODE=mock,BIOSYNC_LLM_MODEL=gpt-6-luna}' --publish --query Version --output text
Invoke-BioSyncAws lambda wait function-active-v2 --region $Region --function-name $FunctionName
Invoke-BioSyncAws lambda create-alias --region $Region --function-name $FunctionName --name $Alias --function-version $Version --query AliasArn --output text
```

This creates no key and makes no OpenAI call. The specified model is ignored
in mock mode. Published versions/alias make a later rollback straightforward.

### 3. REST API and both proxy methods

```powershell
$ApiId = Invoke-BioSyncAws apigateway create-rest-api --region $Region --name BioSync --endpoint-configuration types=REGIONAL --query id --output text
$RootId = Invoke-BioSyncAws apigateway get-resources --region $Region --rest-api-id $ApiId --query 'items[?path==`/`].id | [0]' --output text
$ProxyId = Invoke-BioSyncAws apigateway create-resource --region $Region --rest-api-id $ApiId --parent-id $RootId --path-part '{proxy+}' --query id --output text
$IntegrationUri = "arn:aws:apigateway:${Region}:lambda:path/2015-03-31/functions/${AliasArn}/invocations"
foreach ($ResourceId in @($RootId, $ProxyId)) {
    Invoke-BioSyncAws apigateway put-method --region $Region --rest-api-id $ApiId --resource-id $ResourceId --http-method ANY --authorization-type NONE
    Invoke-BioSyncAws apigateway put-integration --region $Region --rest-api-id $ApiId --resource-id $ResourceId --http-method ANY --type AWS_PROXY --integration-http-method POST --uri $IntegrationUri --timeout-in-millis 29000
}
```

Gateway accepts all HTTP methods; **the integration method is POST** because
that is how Gateway invokes Lambda. `/v1/analyses` remains a Flask route; the
Lambda handler contains no path dispatch. Root requests also reach Flask and
currently return Flask's normal 404; only `/health` and `/v1/analyses` exist.

### 4. Grant invoke permission, deploy the stage, obtain HTTPS URL

```powershell
Invoke-BioSyncAws lambda add-permission --region $Region --function-name $FunctionName --qualifier $Alias --statement-id biosync-apigateway-demo --action lambda:InvokeFunction --principal apigateway.amazonaws.com --source-account $AccountId --source-arn "arn:aws:execute-api:${Region}:${AccountId}:${ApiId}/${Stage}/*/*"
$DeploymentId = Invoke-BioSyncAws apigateway create-deployment --region $Region --rest-api-id $ApiId --stage-name $Stage --description 'BioSync REST proxy' --query id --output text
$ApiBase = "https://${ApiId}.execute-api.${Region}.amazonaws.com/${Stage}"
Write-Output $ApiBase
```

Keep `ApiId`, `DeploymentId` and the published Lambda version in your private
deployment notes. The source ARN is limited to this API/stage and includes the
root and proxy paths. Gateway console test-invoke uses a different stage and is
not granted by this permission; use the deployed HTTPS smoke tests below.
This course endpoint is public (`authorization-type NONE`), as requested.

## Environment configuration: enable the real provider

| Variable | Demo value |
|---|---|
| `BIOSYNC_LLM_MODE` | `openai` for real advice; `mock` for deterministic/offline checks |
| `BIOSYNC_LLM_MODEL` | `gpt-6-luna` |
| `OPENAI_API_KEY` | Supply privately in the Lambda environment; never in source/mobile/ZIP |

The existing service already reads these variables. Its local fallback model
is unchanged; deployment explicitly chooses the requested model. Actual model
access, real latency and output quality require your account's manual test.

The following reads a masked key, writes a temporary environment JSON outside
the repository, updates Lambda, and removes the file in `finally`. AWS CLI output
is restricted to the function ARN so it cannot print the returned environment.
Do not add `--debug`, echo the JSON, or save the key in shell history. The CLI
operation replaces the environment map, so include all three variables.

```powershell
$SecureKey = Read-Host 'OpenAI API key' -AsSecureString
$EnvironmentFile = [System.IO.Path]::GetTempFileName()
try {
    $EnvironmentJson = @{
        Variables = @{
            BIOSYNC_LLM_MODE = 'openai'
            BIOSYNC_LLM_MODEL = 'gpt-6-luna'
            OPENAI_API_KEY = [System.Net.NetworkCredential]::new('', $SecureKey).Password
        }
    } | ConvertTo-Json -Depth 3
    [System.IO.File]::WriteAllText($EnvironmentFile, $EnvironmentJson, [System.Text.UTF8Encoding]::new($false))
    Invoke-BioSyncAws lambda update-function-configuration --region $Region --function-name $FunctionName --environment "file://$EnvironmentFile" --query FunctionArn --output text
} finally {
    Remove-Item -LiteralPath $EnvironmentFile -ErrorAction SilentlyContinue
    Remove-Variable SecureKey,EnvironmentJson -ErrorAction SilentlyContinue
}
Invoke-BioSyncAws lambda wait function-updated-v2 --region $Region --function-name $FunctionName
$PreviousVersion = Invoke-BioSyncAws lambda get-alias --region $Region --function-name $FunctionName --name $Alias --query FunctionVersion --output text
$Version = Invoke-BioSyncAws lambda publish-version --region $Region --function-name $FunctionName --query Version --output text
Invoke-BioSyncAws lambda update-alias --region $Region --function-name $FunctionName --name $Alias --function-version $Version --query AliasArn --output text
```

Lambda environment variables are acceptable for this course deployment.
Production systems normally use Secrets Manager or Parameter Store with scoped
IAM access. No such infrastructure or runtime dependency is added here. Old
published versions retain their configuration; consider that when rotating keys
or choosing a rollback version. Build output never contains environment values.

To return to mock mode (also removes the key from the unpublished configuration):

```powershell
Invoke-BioSyncAws lambda update-function-configuration --region $Region --function-name $FunctionName --environment 'Variables={BIOSYNC_LLM_MODE=mock,BIOSYNC_LLM_MODEL=gpt-6-luna}' --query FunctionArn --output text
Invoke-BioSyncAws lambda wait function-updated-v2 --region $Region --function-name $FunctionName
$Version = Invoke-BioSyncAws lambda publish-version --region $Region --function-name $FunctionName --query Version --output text
Invoke-BioSyncAws lambda update-alias --region $Region --function-name $FunctionName --name $Alias --function-version $Version --query AliasArn --output text
```

## Smoke tests (run explicitly against the deployed endpoint)

`GET /health` is liveness only, independent of keys, OpenAI and iAUC. It does not
prove provider credentials or outbound internet connectivity.

```powershell
# From backend/; $ApiBase from the deployment step includes /demo.
curl.exe --fail-with-body -i "$ApiBase/health"
$FixtureBody = Get-Content ../mobile/src/dev/analysisFixture.json -Raw
$Result = Invoke-RestMethod -Method Post -Uri "$ApiBase/v1/analyses" -ContentType 'application/json' -Body $FixtureBody
if ($Result.iauc_mmol_l_min -ne 225) { throw 'iAUC regression: expected 225 (mmol/L)·min' }
$Result | ConvertTo-Json -Depth 8
```

Expect health `{"status":"ok"}`, analysis HTTP 200, matching `meal_id`, UTC
`computed_at`, iAUC **225**, and `summary/suggestions/limitations` feedback.
In mock mode the summary starts `Development mock:`. In OpenAI mode confirm
that marker is absent and inspect the real feedback; do not expect identical
text between calls. A provider failure must return the documented error envelope,
never invented mock advice. These real-mode smoke tests incur an OpenAI call.

React Native's backend base URL for the demo is `$ApiBase` (include the stage,
omit `/v1/analyses`). The client appends the existing path itself. No mobile code
or local URL was changed by this task. Run Test Analysis must still show 225;
the manual food + Health Connect path uses the same deployed endpoint.

## Updates, logs and rollback

After rebuilding successfully, update code without recreating the API or role:

```powershell
$PreviousVersion = Invoke-BioSyncAws lambda get-alias --region $Region --function-name $FunctionName --name $Alias --query FunctionVersion --output text
Invoke-BioSyncAws lambda update-function-code --region $Region --function-name $FunctionName --zip-file fileb://dist/biosync-lambda.zip --query FunctionArn --output text
Invoke-BioSyncAws lambda wait function-updated-v2 --region $Region --function-name $FunctionName
# Explicitly preserve/confirm runtime, handler, memory and timeout.
Invoke-BioSyncAws lambda update-function-configuration --region $Region --function-name $FunctionName --runtime python3.12 --handler lambda_handler.handler --memory-size 512 --timeout 28 --query FunctionArn --output text
Invoke-BioSyncAws lambda wait function-updated-v2 --region $Region --function-name $FunctionName
$Version = Invoke-BioSyncAws lambda publish-version --region $Region --function-name $FunctionName --query Version --output text
Invoke-BioSyncAws lambda update-alias --region $Region --function-name $FunctionName --name $Alias --function-version $Version --query AliasArn --output text
```

The function remains x86_64 from creation; do not upload this ZIP to arm64.
Environment is retained by these code-update commands. Configure it separately
before publishing if needed. Since Gateway invokes the alias, a code/config
release does not require a new Gateway deployment. Repeat the smoke tests.

If Gateway resource/method/integration settings change, redeploy the stage:

```powershell
$DeploymentId = Invoke-BioSyncAws apigateway create-deployment --region $Region --rest-api-id $ApiId --stage-name $Stage --description 'Updated BioSync proxy' --query id --output text
```

CloudWatch log group: **`/aws/lambda/biosync-backend`** (created on first invocation
by the execution role). Flask writes standard stderr logs for request failures,
LLM failures and configuration errors, using status/code only. Unexpected
failures include the exception class, never its message/traceback. No credentials,
Health Connect IDs or raw glucose series are logged. Gateway body/execution
data tracing is not enabled.

```powershell
Invoke-BioSyncAws logs tail "/aws/lambda/$FunctionName" --region $Region --since 10m
```

For a code/config rollback, point the alias at your saved working version:

```powershell
Invoke-BioSyncAws lambda update-alias --region $Region --function-name $FunctionName --name $Alias --function-version $PreviousVersion --query AliasArn --output text
```

For a Gateway rollback, set its stage to a previously saved deployment ID:

```powershell
$PreviousDeploymentId = '<PREVIOUS_API_DEPLOYMENT_ID>'
Invoke-BioSyncAws apigateway update-stage --region $Region --rest-api-id $ApiId --stage-name $Stage --patch-operations "op=replace,path=/deploymentId,value=$PreviousDeploymentId" --query deploymentId --output text
```

Keep the last known-good ZIP, SHA256 and version number privately before building
the next release (`dist/` output names are replaced). Do not commit ZIPs or
secret-bearing configuration. Rolling back an alias does not overwrite `$LATEST`;
check its code/configuration before publishing the next release. No automated
deployment, cloud smoke test or rollback is performed by this repository build.

## References

## Local validation record

Prepared and validated on 2026-10-04; **no AWS resources deployed** and no real
OpenAI request made during tests/build validation.

- Full backend suite: **318 passed, 0 failed**, including the previous 294 tests.
- Docker artifact validation: passed in Lambda Linux x86_64 **Python 3.12.15**.
- ZIP: **6,134,159 bytes**, **20,219,492 bytes** uncompressed; 22 runtime distributions.
- Native Linux libraries: Pydantic Core, jiter, MarkupSafe; imports passed.
- ZIP runtime smoke: health OK; mock iAUC **225**; missing key retains
  `LLM_CONFIGURATION_ERROR`; network disabled during these checks.
- PowerShell documentation snippets parse; `pip check` and `git diff --check` pass.
- Cloud deployment, IAM permissions, public HTTPS and real-model access remain
  manual verification steps after you explicitly choose to deploy.

New source/support files:

```text
backend/lambda_handler.py
backend/deploy/.gitattributes
backend/deploy/build_lambda.ps1
backend/deploy/build_lambda.sh
backend/deploy/build_lambda.py
backend/deploy/validate_package.py
backend/deploy/smoke_event.py
backend/deploy/lambda-image.txt
backend/deploy/requirements-lambda.lock
backend/deploy/role-trust.json
backend/deploy/README.md
backend/tests/test_lambda.py
```

Modified for this task:

```text
backend/.gitignore
backend/requirements.txt
backend/biosync/app.py
backend/biosync/routes.py
docs/API_CONTRACTS.md
```

Existing pending changes from earlier tasks are preserved. No mobile, iAUC,
meal-policy, AnalysisResult, provider prompt or LLM business logic changes were
needed for deployment. The only runtime dependency added is
`serverless-wsgi==3.1.0`; pytest remains development-only.

## References

- [serverless-wsgi adapter](https://github.com/logandk/serverless-wsgi): proxy-to-WSGI conversion.
- [AWS Python ZIP packaging](https://docs.aws.amazon.com/lambda/latest/dg/python-package.html): root handler layout and native dependency compatibility.
- [AWS Python container images](https://docs.aws.amazon.com/lambda/latest/dg/python-image.html): Python 3.12 Lambda runtime image.
- [AWS REST proxy CLI setup](https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integration-using-cli.html): proxy methods and integration.
- [AWS Lambda configuration](https://docs.aws.amazon.com/cli/latest/reference/lambda/update-function-configuration.html): runtime, memory, timeout and environment.
