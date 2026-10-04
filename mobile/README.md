# BioSync Android development slice

Minimal React Native CLI 0.87.1 / React 19.2.3 / TypeScript application.
Android only; no Expo. Scaffold generated with Community CLI 20.2.0.

Health Connect read-only blood glucose diagnostics are now available below the
existing analysis screen. See [HEALTH_CONNECT.md](HEALTH_CONNECT.md) for the exact
native API, mapping, permission configuration and physical-device test procedure.

The **Analyse Health Connect Meal** form now combines manually entered food and
meal time with Health Connect readings, then calls the existing analysis API.
See [MEAL_ANALYSIS.md](MEAL_ANALYSIS.md) for its exact query/request, error states
and end-to-end physical-device checks. **Run Test Analysis** remains separate.

The backend now supports explicit OpenAI mode as well as the default offline
mock. See [LLM_INTEGRATION.md](../docs/LLM_INTEGRATION.md) for environment setup,
provider data disclosure, errors and real-provider/device verification. Both
buttons use whichever mode the backend selects; API keys never belong here.

## Scope and architecture

### Local Windows white-screen recovery (2026-10-04)

On this development machine, Windows reserved TCP range `8037–8136`, which
includes Metro's default `8081` (`listen EACCES`). Port `9000` also conflicted
with an unrelated Jupyter kernel bound to `127.0.0.1:9000`: Metro listening on
`0.0.0.0:9000` did not make emulator connections reach the correct service.
The app could not load JavaScript and showed a white screen.

The running emulator has been configured to use `localhost:18081`, with ADB
reverse to Metro on the host. To restore this setup after restarting:

```powershell
# Terminal 1, from mobile/: keep Metro running.
npm.cmd start -- --host 127.0.0.1 --port 18081 --max-workers 2
```

```powershell
# Terminal 2: emulator must already be running.
$biosyncAdb = Join-Path $env:LOCALAPPDATA 'Android/Sdk/platform-tools/adb.exe'
& $biosyncAdb -s emulator-5554 reverse tcp:18081 tcp:18081
curl.exe --noproxy '*' http://127.0.0.1:18081/status
# Expected: packager-status:running
& $biosyncAdb -s emulator-5554 shell am force-stop com.biosync
& $biosyncAdb -s emulator-5554 shell am start -n com.biosync/.MainActivity
```

For a fresh installation, set the React Native development server host/port in
the app's Dev Settings to `localhost:18081`; the current emulator already has
this saved. Replace `emulator-5554` if `adb devices` reports a different serial.
ADB reverse must be restored after device/emulator reconnection. Port `18081`
is for Metro only; the Flask API remains `http://10.0.2.2:5000` in the emulator.
Do not stop unrelated Jupyter processes or remove Windows port exclusions.

### Application structure

`AnalysisScreen` → `useAnalysisViewModel` → `backendClient.analyzeMeal`
→ Flask `POST /v1/analyses` → meal policy → numerical iAUC → mock or OpenAI feedback
→ `AnalysisResult` → ViewModel → screen.

- Transport types follow [API_CONTRACTS.md](../docs/API_CONTRACTS.md).
- The backend alone implements [IAUC_POLICY.md](../docs/IAUC_POLICY.md).
- `src/dev/analysisFixture.json` is deterministic, invented development input.
  It is not Health Connect data or a real CV response. Record IDs are stable.
- Request states (`idle`, `loading`, `success`, `error`) are transient screen
  states, not the persistent `MealRecord.status` workflow.
- There is no client iAUC calculation, precomputed result, storage, camera,
  CV, direct LLM API call, authentication, or deployment in the mobile app. The separate Health
  Connect diagnostic reads locally. The manual meal form separately reads and
  submits the meal's glucose data only when its Analyse button is pressed.
- `backendClient` validates HTTP status and response shape, preserves documented
  API error codes/messages/retryability, and aborts requests after 15 seconds.
  `NETWORK_ERROR`, `REQUEST_TIMEOUT`, `INVALID_RESPONSE`, and `CLIENT_ERROR` are
  local client errors, not additions to the backend API contract.
- Native React Native networking does not require a browser CORS package.

## Prerequisites

See the official [React Native environment guide](https://reactnative.dev/docs/set-up-your-environment)
and [CLI setup guide](https://reactnative.dev/docs/getting-started-without-a-framework).

Use Node compatible with `package.json` (tested: 22.14.0), npm, JDK 17,
Android Studio, and an Android SDK. Set `JAVA_HOME` to your JDK 17 directory.
The generated native project declares:

- compile SDK 37, target SDK 36, minimum SDK 26 (Health Connect);
- Android SDK Build-Tools 37.0.0;
- NDK (Side by side) 27.1.12297006;
- Gradle 9.4.1 via the checked-in wrapper.

In Android Studio's SDK Manager, enable **Show Package Details** to install
these versions, plus Platform-Tools, Command-line Tools and an emulator/system
image. The current AGP also reports preferred NDK 28.2.13676358 when none is
installed; install that side-by-side version too if requested during setup.
Gradle may request CMake for native dependency compilation.

On Windows PowerShell, use `npm.cmd` to avoid npm.ps1 execution-policy issues.
For each terminal used to build/run Android (adjust the SDK path if needed):

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:Path"
```

## Start Flask

From the repository root, in a dedicated terminal:

```powershell
cd backend
# Existing Python 3.12 virtual environment; install only if not already present:
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m flask --app biosync.app run --host 0.0.0.0 --port 5000
```

If creating the environment on another machine, first run
`py -3.12 -m venv .venv` inside `backend/`.
The development server binds to the host interfaces so an emulator or phone
can reach it. No backend source or CORS configuration changes are needed.

## Configure the address

Edit only `src/config/development.ts`:

- Android Studio emulator: `http://10.0.2.2:5000` (default).
- Physical Android phone: `http://<reachable-host-LAN-IP>:5000` on the same
  network, with the host firewall allowing that connection; alternatively use
  a reachable HTTPS endpoint. The phone's `localhost` is the phone itself.
- If the Flask port changes, update the port here too.

Local HTTP is enabled only by `android/app/src/debug/AndroidManifest.xml`.
The main manifest sets `usesCleartextTraffic=false`; release builds retain that
restriction and are not signed with the development key. A release build needs
an HTTPS endpoint and proper signing. No production security setting is relaxed.
This debug-only HTTP exception is explicitly permitted by the task; the project
specification's general HTTPS requirement is unchanged.

## Install, build and run Android

From `mobile/`:

```powershell
npm.cmd ci
npm.cmd start
```

Leave Metro running. Start an emulator in Android Studio Device Manager (or
connect a USB-debugging-enabled phone). In a second terminal, from `mobile/`:

```powershell
npm.cmd run android -- --no-packager
```

The CLI builds/installs the debug app. For a connected phone, if Metro is not
reachable, run `adb reverse tcp:8081 tcp:8081`. This only forwards Metro, not the
Flask endpoint; use the configured LAN URL for Flask.

To build the debug APK without installing, from `mobile/android/`:

```powershell
.\gradlew.bat :app:assembleDebug
```

The APK is `android/app/build/outputs/apk/debug/app-debug.apk` relative to
`mobile/`. A debug build needs Metro running to load JavaScript.

## Manual end-to-end verification

1. Start Flask, Metro and the debug Android application as above.
2. Confirm the screen says **BioSync**, marks the data as development test
   data, and initially displays `Request state: idle`.
3. Press **Run Test Analysis**. The screen enters `loading`; the button is
   disabled while the request runs. Flask should log `POST /v1/analyses` 200.
4. Confirm `success`, iAUC **225 (mmol/L)·min**, and the returned development mock
   summary mentioning Rice and Broccoli. The existing backend returns an empty
   suggestions array, so the screen displays an explicit empty message; it does
   not manufacture dietary advice. Backend limitations are also displayed.
5. The expected value is a manual reference only: baseline mean `(4 + 6) / 2 = 5`,
   then a synthetic t=0 baseline and glucose 7 at minutes 15, 30, ..., 120.
   Area is `15 × 2 / 2 + 105 × 2 = 225`. No such calculation or expected response
   is implemented in the mobile application.
6. Stop Flask and press the button again. Confirm `error` and a connection or
   timeout message, never a fabricated zero iAUC. Restart Flask and retry to
   confirm recovery. A slow failed connection times out after 15 seconds.

This verifies React Native → Flask → iAUC → mock LLM → React Native. Timestamps
in the fixture stay fixed; they do not follow the device clock. Restarting this
development app resets its screen state because persistence is outside this task.

## Automated checks and verification limits

From `mobile/`:

```powershell
npm.cmd test -- --runInBand
npm.cmd run typecheck
npm.cmd run lint
```

From `backend/`:

```powershell
.\.venv\Scripts\python.exe -B -m pytest -p no:cacheprovider -q -s
```

Original mobile-slice verification (before Health Connect integration):

- Python: **237 passed, 0 failed**; existing backend code/tests unchanged.
- Jest: **27 passed, 0 failed** (client parsing/errors and ViewModel transitions).
- TypeScript checking and ESLint passed.
- Metro generated the Android JavaScript bundle successfully. It emitted an
  upstream React Native private-feature-flag export fallback warning.
- The actual TypeScript client, run in Node with native fetch, called a real
  local Flask HTTP server with the checked-in fixture: HTTP 200, iAUC 225,
  and the mock feedback. An empty-readings request correctly produced the
  parsed HTTP 422 `INSUFFICIENT_BASELINE_DATA` error. This was not an Android
  emulator test.
- APK build attempted, but stopped at missing NDK configuration. This machine
  has SDK/Build-Tools 35 only and no NDK; install the above native prerequisites
  before building. An APK and on-device UI have **not** been verified here.

No authoritative documents or backend files were changed. Full SQLite caching
and persistent meal logging remain deferred as requested. The manual meal form
keeps only an in-memory draft for the current app session.

## Files added in the original mobile-slice task

All repository changes for this task are under `mobile/`. The following inventory
includes the CLI-generated Android scaffolding and application/test files.
Ignored dependency caches and build outputs are excluded.

```text
mobile/.eslintrc.js
mobile/.gitignore
mobile/.prettierrc.js
mobile/.watchmanconfig
mobile/App.tsx
mobile/README.md
mobile/__tests__/backendClient.test.ts
mobile/__tests__/testData.ts
mobile/__tests__/useAnalysisViewModel.test.tsx
mobile/android/app/build.gradle
mobile/android/app/debug.keystore
mobile/android/app/proguard-rules.pro
mobile/android/app/src/debug/AndroidManifest.xml
mobile/android/app/src/main/AndroidManifest.xml
mobile/android/app/src/main/java/com/biosync/MainActivity.kt
mobile/android/app/src/main/java/com/biosync/MainApplication.kt
mobile/android/app/src/main/res/drawable/rn_edit_text_material.xml
mobile/android/app/src/main/res/mipmap-hdpi/ic_launcher.png
mobile/android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png
mobile/android/app/src/main/res/mipmap-mdpi/ic_launcher.png
mobile/android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png
mobile/android/app/src/main/res/mipmap-xhdpi/ic_launcher.png
mobile/android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png
mobile/android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png
mobile/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png
mobile/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png
mobile/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png
mobile/android/app/src/main/res/values/strings.xml
mobile/android/app/src/main/res/values/styles.xml
mobile/android/build.gradle
mobile/android/gradle.properties
mobile/android/gradle/wrapper/gradle-wrapper.jar
mobile/android/gradle/wrapper/gradle-wrapper.properties
mobile/android/gradlew
mobile/android/gradlew.bat
mobile/android/settings.gradle
mobile/app.json
mobile/babel.config.js
mobile/index.js
mobile/jest.config.js
mobile/metro.config.js
mobile/package-lock.json
mobile/package.json
mobile/src/config/development.ts
mobile/src/dev/analysisFixture.json
mobile/src/models/api.ts
mobile/src/services/backendClient.ts
mobile/src/viewmodels/useAnalysisViewModel.ts
mobile/src/views/AnalysisScreen.tsx
mobile/tsconfig.json
```

