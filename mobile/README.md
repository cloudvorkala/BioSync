# BioSync Android development

Code/documentation snapshot: **2026-10-11**. See
[implementation status](../docs/IMPLEMENTATION_STATUS.md) for verification evidence.

## Current scope and architecture

React Native CLI **0.87.1**, React **19.2.3**, TypeScript, Community CLI **20.2.0**;
Android only, no Expo. Minimal MVVM using hooks, without Redux.

```text
Manual description + optional weight + local meal date/time
  → useHealthMealViewModel → selected GlucoseDataProvider
      Health Connect / Samsung Health → normalized GlucoseReading[]
  → backendClient → API Gateway HTTPS → Lambda → Flask
  → meal policy → deterministic iAUC → mock / OpenAI feedback → UI
```

Health Connect is the default source. Samsung Health Data SDK **1.1.0** is a
second provider; native access and imported 爱看健康 visibility remain **device
verification pending** in the repository. See [SAMSUNG_HEALTH.md](SAMSUNG_HEALTH.md).
Health Connect setup/mapping is in [HEALTH_CONNECT.md](HEALTH_CONNECT.md).

The manual form supports one description, optional approximate grams, separate
local date/time pickers and **Use current time**. `selectedMealTime: Date` is the
single time state; API/provider boundaries receive UTC via `toISOString()`.
Native date handling uses the selected historical date's DST, with no manual
UTC offsets. Samsung diagnostic UTC start/end text inputs are unchanged.
See [MEAL_ANALYSIS.md](MEAL_ANALYSIS.md) for the exact query/request and device checks.

**Run Test Analysis** remains a separate synthetic fixture path with expected
backend iAUC **225 (mmol/L)·min**. It needs no health permissions. Mobile contains
no iAUC mathematics or hard-coded successful API response.

The backend supports `mock` and `openai`; default is mock unless explicitly
configured otherwise. See [LLM_INTEGRATION.md](../docs/LLM_INTEGRATION.md).
No mobile setting selects the provider/model, and no API key belongs in this app.

Drafts/results are in memory only. No SQLite, persistent meal history, background
polling, camera, CV, nutrition database, authentication or charts are implemented.
Errors distinguish input, provider access/read, waiting, scientific policy,
network and backend failures. The client aborts a request after 15 seconds.

## Privacy and calculation location

The Health Connect and Samsung diagnostic panels only read/display locally.
Their “data stays on this device” statements refer to diagnostic loads, not the
whole app. Pressing **Analyse Health Connect Meal** or **Analyse Samsung Health
Meal** uploads the selected normalized records, food and meal time to BioSync.

With the checked-in AWS URL, iAUC runs in Lambda. If configured for local Flask,
it runs on the development host. OpenAI receives food, optional weight and derived
analysis, never raw glucose records/source IDs. Samsung package metadata stays
in the diagnostic layer and is not sent to the backend. Health/source record IDs
are included in analysis transport records but stripped before LLM interpretation.

## Prerequisites

Use Node compatible with `package.json` (22.14.0 was previously tested), npm,
JDK 17, Android Studio and the SDK. The native project declares:

- Minimum SDK **29**, compile SDK **37**, target SDK **36**.
- Build-Tools **37.0.0**, NDK **27.1.12297006**, Gradle wrapper **9.4.1**.
- `react-native-health-connect` **4.1.3**.
- `@react-native-community/datetimepicker` **9.2.1**.
- `react-native-uuid` **2.0.4**.
- Required developer-supplied AAR:
  `android/app/libs/samsung-health-data-api-1.1.0.aar` (Git-ignored).
  Follow [Samsung setup](SAMSUNG_HEALTH.md); builds fail clearly if it is missing.

Set `JAVA_HOME` to JDK 17. On Windows, use `npm.cmd` to avoid npm.ps1 policy issues.
In a build/run terminal:

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
```

## Backend address and optional local Flask

`src/config/development.ts` is the single backend-address configuration. Despite
its filename/comment, its current value is the HTTPS API Gateway demo endpoint:

```text
https://iax8d3mquk.execute-api.ap-southeast-2.amazonaws.com/demo
```

The client appends `/v1/analyses`. This documentation sync did not contact AWS or
verify which Lambda version/model is live. An installed bundle may have an older
URL until reloaded/rebuilt. Code/prompt updates require a rebuilt Lambda ZIP and
function update to affect the hosted backend; see [deployment](../backend/deploy/README.md).

For explicit local development, change that one URL to:

- Emulator: `http://10.0.2.2:5000` (alternative, not the current default).
- Phone: `http://<reachable-host-LAN-IP>:5000`; phone localhost is the phone itself.

Then start Flask from the repository root:

```powershell
cd backend
# If needed: py -3.12 -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
$env:BIOSYNC_LLM_MODE = 'mock'
.venv/Scripts/python.exe -m flask --app biosync.app:create_app run --host 0.0.0.0 --port 5000
```

Only the debug Android manifest allows cleartext HTTP. Release builds require
HTTPS and proper release signing. Native React Native fetch does not need browser CORS.

## Build and run

From `mobile/`, after placing the AAR and preparing Android prerequisites:

```powershell
npm.cmd ci
npm.cmd start
# Second terminal, emulator or USB-debugging-enabled phone connected:
npm.cmd run android -- --no-packager
```

Use `adb devices -l` to select the intended device. If needed, forward default
Metro with `adb reverse tcp:8081 tcp:8081`. Metro serves JavaScript; it does not
forward the backend API. Build only, from `mobile/android/`:

```powershell
.\gradlew.bat :app:assembleDebug
```

APK: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`. Debug needs Metro;
new native dependencies require rebuilding/reinstalling, not just Fast Refresh.

### Historical Windows white-screen workaround

On 2026-10-04 this machine reserved ports 8037–8136 (including 8081); port 9000
also conflicted with Jupyter. These are historical observations, not current
process/port checks. Use the previously successful alternate Metro port if needed:

```powershell
# mobile/, terminal 1
npm.cmd start -- --host 127.0.0.1 --port 18081 --max-workers 2
# terminal 2; replace emulator-5554 with the intended adb device serial
adb -s emulator-5554 reverse tcp:18081 tcp:18081
curl.exe --noproxy '*' http://127.0.0.1:18081/status
```

Expected status: `packager-status:running`. Set Dev Settings server address to
`localhost:18081`, then reload. Restore reverse forwarding after reconnection.
Do not stop unrelated processes or remove Windows reservations. This changes
Metro only; the API still uses the configured HTTPS or local Flask address.

## Manual checks

1. Start Metro and install/open the app. Use the configured AWS backend, or
   explicitly select/start local Flask as above.
2. Press **Run Test Analysis**. Confirm loading, success, and iAUC **225**.
   Mock returns a `Development mock:` glucose summary, two suggestions and one
   mock limitation. OpenAI mode returns real generated feedback; wording can vary.
3. Baseline `(4+6)/2=5`, synthetic t=0 and glucose 7 at +15 through +120 yield
   `15×2/2 + 105×2 = 225`. This is a verification reference, not client calculation.
4. Verify [manual meal/provider flow](MEAL_ANALYSIS.md) separately, including
   zero records, denied permission, missing coverage and historical local dates.
5. For a controlled local network-failure check, use local Flask, stop it and
   retry. Stopping local Flask has no effect when the app targets AWS.
6. Restarting the app clears transient drafts/results; there is no restart recovery.

## Automated checks and limits

From `mobile/`:

```powershell
npm.cmd test -- --runInBand
npm.cmd run typecheck
npm.cmd run lint
```

From `backend/`:

```powershell
.venv/Scripts/python.exe -B -m pytest -p no:cacheprovider -q
```

On 2026-10-11, Jest **159 passed (9 suites)** and Python **340 passed** were rerun
for documentation verification; TypeScript and ESLint also passed.
Older stage-specific counts in provider documents
are historical records. No Android build, live HTTP/OpenAI/AWS call or physical
phone acceptance test was performed for this documentation-only update.
