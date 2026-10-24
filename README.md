# BioSync

BioSync is an Android prototype developed for COMP826 Mobile Systems Development at Auckland University of Technology. It connects a manually recorded meal with its measured postprandial glucose response. The mobile app retrieves glucose readings, a Python backend calculates incremental area under the curve (iAUC), and an optional LLM returns structured dietary feedback.

## Features

- Select Health Connect or Samsung Health as the glucose source.
- Check platform availability and request blood-glucose read permission.
- Inspect timestamp-bounded glucose records through diagnostic panels.
- Enter a meal description, an optional approximate weight in grams, and the meal time with native local date and time pickers (or **Use current time**). The app sends the time as UTC using `Date.toISOString()`, so the device applies historical daylight-saving rules.
- Analyse historical meals using the selected provider's glucose readings.
- Display backend-calculated iAUC, feedback, and distinct input, permission, data-coverage, network, and provider errors.
- Run a labelled synthetic example with a known iAUC of **225 (mmol/L)·min**.

## Live demo deployment

| Item | Value |
| --- | --- |
| API base URL | `https://iax8d3mquk.execute-api.ap-southeast-2.amazonaws.com/demo` (API Gateway REST API, stage `demo`) |
| Endpoints | `GET /health`, `POST /v1/analyses` |
| Backend runtime | AWS Lambda `biosync-backend`: Python 3.12, x86_64, 512 MB, 28 s timeout, region `ap-southeast-2` |
| Feedback model | OpenAI Responses API with `BIOSYNC_LLM_MODE=openai` and `BIOSYNC_LLM_MODEL=gpt-6-luna` |
| Verified device | Samsung Galaxy Z Flip7 running the signed standalone release APK (no Metro, USB or laptop) |
| Verified data path | Sinocare CGM → Sinocare app (`com.sino.care`) → Samsung Health → Samsung Health Data SDK 1.1.0 → BioSync → AWS → OpenAI |

The demo endpoint exists for assessment and may be disabled after the course. Each `POST /v1/analyses` call in OpenAI mode is a billed model request.

## Architecture

The React Native client uses views, hook-based ViewModels, and provider/service adapters. Health Connect uses `react-native-health-connect`; Samsung Health uses a Kotlin bridge to Samsung Health Data SDK 1.1.0. The client submits meal information and selected glucose readings to Flask. The backend applies the calculation policy before generating mock or OpenAI feedback, then returns the result to the app.

The same Flask application runs locally or through API Gateway and AWS Lambda. BioSync accesses health-platform datastores; the CGM and its companion app supply data upstream. BioSync does not communicate directly with a sensor over Bluetooth.

| Path | Contents |
| --- | --- |
| [`mobile/`](mobile/) | React Native Android application, Kotlin bridge, and Jest tests |
| [`backend/`](backend/) | Flask API, schemas, calculation services, and pytest tests |
| [`backend/deploy/`](backend/deploy/) | Lambda packaging, validation, and deployment instructions |
| [`docs/API_CONTRACTS.md`](docs/API_CONTRACTS.md) | Request, response, and error contracts |
| [`docs/IAUC_POLICY.md`](docs/IAUC_POLICY.md) | Versioned calculation and data-sufficiency rules |
| [`docs/LLM_INTEGRATION.md`](docs/LLM_INTEGRATION.md) | Feedback configuration, provider input, and validation |

## Requirements

The checked-in configuration uses the following versions:

| Component | Requirement |
| --- | --- |
| Python | 3.12 |
| Node.js | `^22.13.0`, `^24.3.0`, or `>=26.0.0`, as declared in `mobile/package.json` |
| Java | JDK 17 |
| Mobile framework | React Native 0.87.1, React 19.2.3, TypeScript |
| Android | Minimum API 29 / Android 10; compile SDK 37; target SDK 36 |
| Android build tools | Build-Tools 37.0.0; NDK 27.1.12297006; Gradle wrapper 9.4.1 |
| Samsung integration | Samsung Health Data SDK 1.1.0 AAR, supplied separately |
| Device testing | Compatible physical Android phone, health platform, and available glucose records |
| Cloud packaging | Docker with Linux containers; AWS CLI for manual deployment |

Install the Android SDK components through Android Studio. Set `JAVA_HOME` to JDK 17 and `ANDROID_HOME` to the Android SDK directory. Samsung SDK access requires a physical phone; an emulator can exercise the synthetic example and UI but cannot establish Samsung data access.

## Local setup

The primary commands below use **Windows PowerShell**, matching the project's development environment. Run each command block from the indicated directory. Use `npm.cmd` on Windows to avoid PowerShell's `npm.ps1` execution-policy issue.

### 1. Clone the project

```powershell
git clone https://github.com/cloudvorkala/BioSync.git
cd BioSync
```

### 2. Start the backend in mock mode

In a dedicated terminal, from the repository root:

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
$env:BIOSYNC_LLM_MODE = 'mock'
.\.venv\Scripts\python.exe -m flask --app biosync.app:create_app run --host 0.0.0.0 --port 5000
```

Keep this terminal running. Mock mode makes no OpenAI request and requires no API key.

For Linux/macOS, the equivalent backend setup is:

```bash
cd backend
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
BIOSYNC_LLM_MODE=mock .venv/bin/python -m flask --app biosync.app:create_app run --host 0.0.0.0 --port 5000
```

### 3. Supply the Samsung SDK AAR

Download **Samsung Health Data SDK 1.1.0** from [Samsung Developer](https://developer.samsung.com/health/data/overview.html). Place the official AAR at:

```text
mobile/android/app/libs/samsung-health-data-api-1.1.0.aar
```

If the extracted v1.1.0 file is named `samsung-health-data-api.aar`, rename it to the filename above. This AAR is required by the combined Android build even when testing only Health Connect or synthetic data. It is Git-ignored and is not redistributed in this repository.

### 4. Configure the backend address

Edit [`mobile/src/config/development.ts`](mobile/src/config/development.ts), which supplies the backend URL for both debug and release builds. The checked-in value currently points to the project's AWS HTTPS demo endpoint. Choose an address appropriate to your setup:

| Runtime | `BACKEND_BASE_URL` |
| --- | --- |
| Android Studio emulator with local Flask | `http://10.0.2.2:5000` |
| Physical phone with local Flask | `http://<your-computer-LAN-IP>:5000` |
| Independently installed release APK | Your reachable HTTPS backend URL, including the API Gateway stage |

For local phone testing, use the same network as the computer and allow the Flask connection through the host firewall. The phone's `localhost` refers to the phone. Local HTTP is permitted only in the debug manifest; release builds require HTTPS. A configured cloud endpoint does not require a local Flask process.

### 5. Run the Android debug app

Connect a USB-debugging-enabled phone or start an Android emulator. In a new terminal, from the repository root:

```powershell
cd mobile
npm.cmd ci
adb devices -l
adb reverse tcp:8081 tcp:8081
npm.cmd start
```

Keep Metro running. In another terminal, from `mobile/`:

```powershell
npm.cmd run android -- --no-packager
```

If multiple devices are connected, select the intended device using the CLI device option and use `adb -s <device-serial>` for ADB commands. Restore port forwarding after reconnecting. ADB reverse above forwards Metro, not Flask.

To build the debug APK without installing it, run from `mobile/android/`:

```powershell
.\gradlew.bat :app:assembleDebug
```

Output: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`. The debug application needs Metro to load JavaScript. On Linux/macOS, use `npm` and `./gradlew` in place of `npm.cmd` and `gradlew.bat`.

## Using real glucose data

1. Ensure the source application has synchronized glucose records to the selected health platform. Permission alone does not create records, and data visible in Samsung Health may not also be available in Health Connect.
2. Select the glucose provider in BioSync and grant blood-glucose **read** permission.
3. Check a known historical interval in the corresponding diagnostic panel.
4. Enter a meal description and an optional weight such as `350`, then pick the local meal date and time. Weight fields accept numbers, not text such as `350g`.
5. Use a completed historical meal with sufficient pre-meal and post-meal coverage, then press Analyse.

The app retrieves **[meal time − 15 minutes, meal time + 135 minutes)**. The backend calculates positive incremental area over **120 minutes**, using the mean of at least two pre-meal readings as the baseline. The additional retrieval time supports endpoint interpolation; it does not extend the integration window. Gaps and missing coverage produce policy errors. The complete rules are in [IAUC_POLICY.md](docs/IAUC_POLICY.md).

Real data will usually return a value different from 225. That expected value belongs only to the synthetic fixture. A recent meal may return `WAITING_FOR_GLUCOSE_DATA`; synchronize additional readings and retry when the window is complete.

### Samsung developer testing

For a development test device, complete Samsung Health setup and follow [Samsung's developer-mode instructions](https://developer.samsung.com/health/data/guide/developer-mode.html): open **Settings → About Samsung Health**, tap the version area quickly at least ten times, open **Developer Mode (Samsung Health Data SDK)**, and enable **Developer Mode for Data Read**. Then request read permission inside BioSync. Write access is not needed.

This path has been verified on a Samsung Galaxy Z Flip7: the Samsung diagnostic panel read 480 Sinocare readings (`com.sino.care`, 3-minute interval) for a 24-hour window, and historical meals were analysed end-to-end through the release APK and the AWS deployment.

This is a developer testing procedure. Public distribution requires Samsung's app registration/partnership process for the package, signing certificate, and data scope. See [SAMSUNG_HEALTH.md](mobile/SAMSUNG_HEALTH.md) for setup, record mapping, and device acceptance checks, and [HEALTH_CONNECT.md](mobile/HEALTH_CONNECT.md) for the other provider.

## Feedback configuration

Set environment variables in the **backend process** or Lambda environment:

| Variable | Behaviour |
| --- | --- |
| `BIOSYNC_LLM_MODE` | `mock` by default; set `openai` to enable live feedback |
| `OPENAI_API_KEY` | Required only for `openai` mode |
| `BIOSYNC_LLM_MODEL` | Optional model override; the source fallback is `gpt-4.1-mini`. The demo Lambda sets `gpt-6-luna`. |

For local OpenAI mode, stop the existing Flask process and run from `backend/`:

```powershell
$biosyncKey = Read-Host 'OpenAI API key' -AsSecureString
$env:OPENAI_API_KEY = [System.Net.NetworkCredential]::new('', $biosyncKey).Password
Remove-Variable biosyncKey
$env:BIOSYNC_LLM_MODE = 'openai'
.\.venv\Scripts\python.exe -m flask --app biosync.app:create_app run --host 0.0.0.0 --port 5000
```

The model must support Responses API structured output. The implementation does **not** automatically load `.env`; [`backend/.env.example`](backend/.env.example) documents variable names. A key alone does not activate OpenAI mode. Live feedback uses the configured account and billing; provider failures are returned as errors rather than silently replaced by mock feedback.

## Tests and API smoke checks

From `backend/`:

```powershell
.\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider
```

From `mobile/`:

```powershell
npm.cmd test -- --runInBand
npm.cmd run typecheck
npm.cmd run lint
```

For the real local HTTP integration check, keep a Flask server running in **mock mode**, then run from `mobile/`:

```powershell
npm.cmd run test:backend
```

This checks the actual TypeScript client against Flask using synthetic inputs. Backend pytest tests block external network calls, and mobile unit tests mock native/network boundaries. Neither suite establishes physical CGM access or live-model output quality; record those checks separately using the device procedures.

Recorded results for the submitted version (11 October 2026): backend **340 passed**; mobile **159 Jest tests passed** in 9 suites; TypeScript and ESLint clean.

To check the API directly, open another PowerShell terminal at the repository root:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:5000/health
$biosyncBody = Get-Content mobile/src/dev/analysisFixture.json -Raw
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:5000/v1/analyses -ContentType 'application/json' -Body $biosyncBody
```

`GET /health` returns `{"status":"ok"}` and checks liveness only. `POST /v1/analyses` calculates the supplied meal response; the checked-in fixture returns iAUC **225**. In mock mode, feedback is labelled as a development mock and its suggestions are fixed illustrative text. See [API_CONTRACTS.md](docs/API_CONTRACTS.md) for complete schemas and error codes.

## Evaluation artefacts

Scripts and raw results from the Milestone 2 evaluation:

| File | Purpose |
| --- | --- |
| [`backend/benchmarks/benchmark_analysis.py`](backend/benchmarks/benchmark_analysis.py) | iAUC correctness against an independent trapezoidal implementation (fixture + 300 random curves) and timing of the meal-analysis policy for 50–5000 readings. Run from `backend/` with `python benchmarks/benchmark_analysis.py`. |
| [`docs/evaluation/measure_api_latency.ps1`](docs/evaluation/measure_api_latency.ps1) | Repeated `GET /health` and `POST /v1/analyses` calls against a deployed endpoint plus a burst of 10 concurrent analyses; writes a CSV and prints median, p95, max and the concurrency result. |
| [`docs/evaluation/cloudwatch_lambda_stats.ps1`](docs/evaluation/cloudwatch_lambda_stats.ps1) | Lambda duration, cold starts and peak memory from CloudWatch Logs Insights (AWS CLI). |
| [`docs/evaluation/measure_frames.ps1`](docs/evaluation/measure_frames.ps1) | ADB frame statistics, frozen frames, ANR check and memory for the installed release APK. |
| [`docs/evaluation/README.md`](docs/evaluation/README.md) | Measurement plan, ADB and CloudWatch commands, and recorded results. |
| [`docs/evaluation/evaluate_llm_feedback.ps1`](docs/evaluation/evaluate_llm_feedback.ps1) | Sends 18 meals with designed glucose curves (known iAUC) plus two prompt-injection meals to the deployed API, applies automatic rule checks to each live LLM response, and writes CSV/JSON results. |
| [`docs/evaluation/measure_battery.ps1`](docs/evaluation/measure_battery.ps1) | Estimated energy and network use per analysis from `dumpsys batterystats` (phone unplugged, adb over Wi-Fi): idle baseline plus 10 analyses per run; appends to `battery_summary.csv`. |
## Build an independent release APK

Use an HTTPS backend URL before building. The current Gradle configuration has no release signing key. The following developer workflow builds an unsigned release, aligns it, and signs it with a private key. Run from `mobile/android/` with JDK 17 and Android Build-Tools 37.0.0 available:

```powershell
.\gradlew.bat :app:assembleRelease
```

Continue only after the build succeeds. Create a private signing key once, outside the repository; reuse your existing release key if you already have one:

```powershell
$biosyncKeystore = Join-Path $env:USERPROFILE 'biosync-release.jks'
keytool -genkeypair -v -keystore $biosyncKeystore -alias biosync -keyalg RSA -keysize 2048 -validity 10000
```

Use the password prompts rather than placing passwords in commands. With the same terminal still in `mobile/android/`, align, sign, and verify:

```powershell
$biosyncBuildTools = Join-Path $env:ANDROID_HOME 'build-tools/37.0.0'
$biosyncUnsigned = 'app/build/outputs/apk/release/app-release-unsigned.apk'
$biosyncAligned = 'app/build/outputs/apk/release/app-release-aligned.apk'
$biosyncSigned = 'app/build/outputs/apk/release/biosync-release.apk'
& "$biosyncBuildTools/zipalign.exe" -P 16 -f -v 4 $biosyncUnsigned $biosyncAligned
# Continue only if alignment succeeds.
& "$biosyncBuildTools/apksigner.bat" sign --ks $biosyncKeystore --ks-key-alias biosync --out $biosyncSigned $biosyncAligned
# Continue only if signing succeeds.
& "$biosyncBuildTools/apksigner.bat" verify --verbose --print-certs $biosyncSigned
```

The signed output is `mobile/android/app/build/outputs/apk/release/biosync-release.apk`. Follow the official [zipalign](https://developer.android.com/tools/zipalign) and [apksigner](https://developer.android.com/tools/apksigner) references if your tool paths differ.

Install the signed APK on the intended device and verify it with Metro stopped. Release JavaScript is bundled in the APK; cloud analysis still requires network access. Keep the signing key and passwords private. Installing over an app signed with a different key fails; uninstalling the previous app removes its local state. Use a consistent key for subsequent releases.

## AWS deployment

Follow [`backend/deploy/README.md`](backend/deploy/README.md) for dependency locking, Docker packaging, validation, AWS resource setup, configuration, and updates. The documented target is Python 3.12 / Linux x86_64 in `ap-southeast-2`, using a regional REST API with Lambda proxy integration and handler `lambda_handler.handler`.

Packaging commands from the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File backend/deploy/build_lambda.ps1
```

Linux/macOS equivalent:

```bash
bash backend/deploy/build_lambda.sh
```

The scripts create and validate local deployment artifacts; they do not deploy AWS resources. Use your own AWS configuration and keep OpenAI credentials in the backend environment. Update the mobile URL and rebuild the release APK when its endpoint changes. Pushing source changes to GitHub does not update a deployed Lambda function.

## Data handling and current limitations

Diagnostic reads remain local to the phone. Pressing the meal Analyse button uploads the meal information and selected raw glucose readings to the BioSync backend. In OpenAI mode, only food information, optional approximate weight, calculated iAUC, and derived interpretation context are passed to the model; the raw glucose sequence is excluded. API keys remain on the backend.

The current prototype has these limitations:

- Android implementation only; no iOS/HealthKit path.
- Manual food entry; no camera or computer-vision recognition.
- No SQLite cache, persisted meal history, or restart recovery; drafts and results are held in memory.
- No glucose charts, background monitoring, or automatic resubmission.
- No application authentication or persistent user ownership.
- The client sends an empty `other_meal_times` list, so unrecorded overlapping meals cannot be detected.
- Fixed calculation windows with no CGM lag correction. The interpretation goal is fixed to weight loss; there is no user profile or nutrition database.

Feedback is general dietary information. Automated schema and numerical checks do not establish clinical validity or sensor accuracy.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Gradle reports a missing Samsung AAR | Supply the exact v1.1.0 file at the path above, then rebuild |
| White screen or JavaScript bundle cannot load | Check Metro, selected device, development-server address, and ADB reverse |
| Port 8081 is unavailable on Windows | Start Metro with `npm.cmd start -- --host 127.0.0.1 --port 18081 --max-workers 2`, forward `tcp:18081`, and set the app's development-server address to `localhost:18081` |
| Phone cannot reach local Flask | Check the LAN IP, network, firewall, and `--host 0.0.0.0`; use a debug build for local HTTP |
| Samsung access is restricted | Check platform initialization, developer Data Read access or registered app signature, and explicit permission |
| Permission is granted but no readings appear | Check actual source synchronization and query interval in the selected datastore |
| `WAITING_FOR_GLUCOSE_DATA` | Use a completed meal window or synchronize later readings and retry |
| `INSUFFICIENT_BASELINE_DATA` | Check that at least two valid pre-meal readings are available |
| `LLM_CONFIGURATION_ERROR` | Check backend mode, private key, model configuration, and account availability |

Further setup and historical verification notes are in [`mobile/README.md`](mobile/README.md), [`mobile/MEAL_ANALYSIS.md`](mobile/MEAL_ANALYSIS.md), and the provider-specific documents. Test totals in those notes refer to their recorded code versions; run the checks above for the version being evaluated.

## License

Project source is released under the [MIT License](LICENSE). The separately supplied Samsung SDK and other dependencies retain their own licences.
