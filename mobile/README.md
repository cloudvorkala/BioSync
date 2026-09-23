# BioSync Android development slice

Minimal React Native CLI 0.87.1 / React 19.2.3 / TypeScript application.
Android only; no Expo. Scaffold generated with Community CLI 20.2.0.

## Scope and architecture

`AnalysisScreen` → `useAnalysisViewModel` → `backendClient.analyzeMeal`
→ Flask `POST /v1/analyses` → meal policy → numerical iAUC → mock LLM
→ `AnalysisResult` → ViewModel → screen.

- Transport types follow [API_CONTRACTS.md](../docs/API_CONTRACTS.md).
- The backend alone implements [IAUC_POLICY.md](../docs/IAUC_POLICY.md).
- `src/dev/analysisFixture.json` is deterministic, invented development input.
  It is not Health Connect data or a real CV response. Record IDs are stable.
- Request states (`idle`, `loading`, `success`, `error`) are transient screen
  states, not the persistent `MealRecord.status` workflow.
- There is no client iAUC calculation, precomputed result, storage, camera,
  Health Connect, CV, real LLM, authentication, or deployment in this slice.
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

- compile SDK 37, target SDK 36, minimum SDK 24;
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

Implementation verification on this machine:

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

No authoritative documents or backend files were changed. Full SQLite caching,
Health Connect and meal logging remain deferred as requested, rather than being
replaced with new production behavior.

## Files added in this task

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

