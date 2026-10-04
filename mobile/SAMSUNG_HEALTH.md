# Samsung Health blood glucose provider

Status: implemented and locally built against **Samsung Health Data SDK 1.1.0**.
**Device verification pending.** Neither SDK reads nor access to records imported
from **爱看健康** have been verified on a physical phone in this implementation task.
Passing Jest/build checks does not establish that Samsung exposes those records.

## Why a second provider

The reported real-device finding is that 爱看健康 blood glucose appears in Samsung
Health but is not forwarded to Health Connect by Samsung Health. BioSync can read
manually entered Health Connect BloodGlucose successfully. This provider therefore
reads Samsung's datastore directly; it does not replace Health Connect, implement
the importer's protocol, or combine two stores automatically.

## SDK and build setup

Download **Samsung Health Data SDK v1.1.0** from the
[official SDK page](https://developer.samsung.com/health/data/overview.html).
Use the new `com.samsung.android.sdk.health.data` API, not the retired
`com.samsung.android.sdk.healthdata` API. Place the official AAR at:

```text
mobile/android/app/libs/samsung-health-data-api-1.1.0.aar
```

If the official extracted file is named `samsung-health-data-api.aar`, rename that
same v1.1.0 file to the versioned filename above. Do not substitute another SDK.
Gradle fails with a setup message if this file is missing. All AARs in `app/libs`
are Git-ignored. The binary is developer-supplied, not redistributed by this repo;
review Samsung's download licence/terms before distributing an app containing it.

The local AAR was inspected through its manifest and public JVM signatures:

- `SdkVersion.getVersionName()` returns `1.1.0` (version code `1010004`).
- SHA-256: `f5d3d83cf00b97d0bb1b1db4da076e861eb1c3e6e704d89a34e68909d2f38654`.
- The AAR manifest declares minimum API **29**. BioSync's Android minimum is now
  29 instead of 26. Android 8/9 can no longer install this combined build.
- Java **17+**, Android **10+**, Samsung Health **6.30.2+**, physical phone required.
  Samsung does not support emulator SDK access.
- App Gradle imports the AAR, applies `kotlin-parcelize`, and includes Gson
  `2.13.2`, following the [official module setup](https://developer.samsung.com/health/data/guide/hello-sdk/app-module.html).
  `kotlinx-coroutines-android:1.10.2` is explicit because the bridge calls suspend
  SDK APIs and manages its coroutine lifecycle. No new npm package was needed.
- The AAR merges package visibility queries for Samsung Health into the manifest.
  No extra Android health permission or legacy SDK manifest permission is added.
  Existing Health Connect `READ_BLOOD_GLUCOSE` and configuration remain intact.

From `mobile/android` in PowerShell:

```powershell
$env:JAVA_HOME = '<your JDK 17 directory>'
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android/Sdk'
$env:GRADLE_USER_HOME = Join-Path $env:TEMP 'biosync-gradle'
$env:ANDROID_USER_HOME = Join-Path $env:TEMP 'biosync-android'
.\gradlew.bat :app:assembleDebug '-Pandroid.builder.sdkDownload=false' --no-daemon
```

APK: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`.
Native changes require rebuilding/installing this APK; Metro reload alone is insufficient.

## Architecture and exact SDK calls

```text
HealthMealPanel -> useHealthMealViewModel -> glucoseProviders[selectedSource]
  health_connect -> existing healthConnectService -> react-native-health-connect
  samsung_health -> samsungHealthService -> SamsungHealthNativeModule -> Data SDK
                          |
                    GlucoseReading[]
                          |
          existing manualAnalysisRequest -> backendClient -> AWS backend

SamsungHealthPanel -> useSamsungHealthViewModel -> samsungHealthService
                     (diagnostic results stay on device)
```

`GlucoseDataProvider` exposes `getAccess(requestPermission = false)` and
`getReadings(start: Date, end: Date)`. Health Connect remains the default selection.
Switching source clears the old result/status. Source selection is part of the
transient draft identity; no meal history/storage or additional API field is added.

The native module is registered by `SamsungHealthPackage` in `MainApplication`.
It uses React Native's native-module interoperability and a lifecycle-cancelled
coroutine scope. Permissions run with the foreground Activity; page reads and
serialization run on the IO dispatcher. SDK exceptions are mapped to fixed
messages, not logged with raw records.

Verified v1.1.0 calls:

```kotlin
val store = HealthDataService.getStore(reactApplicationContext)
val permissions = setOf(Permission.of(DataTypes.BLOOD_GLUCOSE, AccessType.READ))
store.getGrantedPermissions(permissions)
store.requestPermissions(permissions, activity) // explicit button press only
val builder = DataTypes.BLOOD_GLUCOSE.readDataRequestBuilder
    .setInstantTimeFilter(InstantTimeFilter.of(start, end, true, false))
    .setOrdering(Ordering.ASC)
    .setPageSize(500)
// On subsequent pages: builder.setPageToken(previousPageToken)
val response = store.readData(builder.build())
// response.dataList, response.pageToken; read until no token remains.
```

No source-package filter is applied, no WRITE access is requested, and no other
data types are requested. Reading never triggers a permission prompt implicitly.
The module rechecks granted permission on every read; stale UI status is not
treated as proof of access. Repeated page tokens fail instead of looping forever.

## Data mapping and time handling

| SDK property | BioSync meaning |
|---|---|
| `HealthDataPoint.uid` | Single-record `source_record_id` |
| `HealthDataPoint.startTime` | Single measurement `measured_at` |
| `BloodGlucoseType.GLUCOSE_LEVEL` | Single measurement `value_mmol_l`, already mmol/L |
| `BloodGlucoseType.SERIES_DATA` | List of CGM samples, each produces one reading |
| `BloodGlucose.timestamp` | Series sample `measured_at` |
| `BloodGlucose.glucose` | Series sample `value_mmol_l`, Float promoted to JS number; no unit conversion |
| `HealthDataPoint.dataSource.appId` | Local diagnostic package lookup only |

For a nonempty series, ignore the parent's `GLUCOSE_LEVEL`: Samsung defines it
as the series average, not an extra measurement. A point with no samples uses
its single glucose value. No glucose value means invalid data, not an invented zero.
See [GLUCOSE_LEVEL](https://developer.samsung.com/health/data/api-reference/-shd/com.samsung.android.sdk.health.data.request/-data-type/-blood-glucose-type/-companion/-g-l-u-c-o-s-e_-l-e-v-e-l.html)
and [BloodGlucoseType](https://developer.samsung.com/health/data/api-reference/-shd/com.samsung.android.sdk.health.data.request/-data-type/-blood-glucose-type/index.html).

Series IDs are `encodeURIComponent(parentUID) + ':series:' + canonicalSampleUTC`.
They do not depend on sample order or random UUIDs. Exact repetitions of the same
ID/time/value are removed. Same timestamp with different values raises
`CONFLICTING_GLUCOSE_READINGS` and prevents submission; nothing is averaged or
overwritten. Equal measurements from distinct parent IDs remain traceable; the
existing backend policy normalizes equal timestamp/value duplicates. Readings
are sorted by timestamp and then ID, without mutating the input.

Native input parses UTC `Z` strings into `Instant`; no `LocalDateTime` or phone
timezone conversion is used. Samsung's documented millisecond timestamps are
serialized as `Instant` strings, normalized to UTC ISO milliseconds with `Z` in
TypeScript. The mapping rejects non-finite glucose, missing IDs, invalid dates,
and timestamps without a timezone. It filters expanded samples to **[start,end)**,
including samples of a returned series whose parent starts before the interval.

The SDK receives the exact supplied interval. Parent-record selection/visibility
across a boundary must still be verified on the phone with imported CGM sessions.
If Samsung does not return an overlapping parent, the mapper cannot reconstruct
its unseen samples; do not widen the meal window or fabricate readings to hide it.

Meal retrieval remains **meal_at - 15 minutes inclusive to meal_at + 135 minutes
exclusive**. This is the existing retrieval range supporting the backend's exact
0–120 minute analysis and possible endpoint interpolation. Neither provider
calculates baseline, missing-data eligibility or iAUC.

Backend reading objects contain exactly:

```json
{
  "source": "samsung_health",
  "source_record_id": "parent-uid:series:2026-10-04T00:05:00.000Z",
  "measured_at": "2026-10-04T00:05:00.000Z",
  "value_mmol_l": 5.75
}
```

`sourcePackages` is a separate diagnostic result, never attached to those objects.
Device IDs are not exported by the bridge. API contracts, backend, iAUC, Lambda,
OpenAI input boundary and `other_meal_times: []` remain unchanged.

## Availability and errors

| State/code | Meaning/action |
|---|---|
| `available` + `granted` | SDK permission currently granted; read may still fail separately |
| `available` + `denied` / `SAMSUNG_PERMISSION_DENIED` | User permission not granted or revoked |
| `unavailable` / `SAMSUNG_UNAVAILABLE` | Missing/disabled platform, emulator, or absent native bridge |
| `update_required` | SDK reports old Samsung Health version |
| `initialization_required` | Finish initial Samsung Health setup |
| `read_access_unavailable` | SDK access control, caller registration, platform signature or account restriction; development Data Read mode may resolve developer access |
| `SAMSUNG_READ_ERROR` | Native connection/read/operation failure; not an empty result |
| `SAMSUNG_INVALID_DATA` | Invalid source payload; no data submitted |
| `CONFLICTING_GLUCOSE_READINGS` | Incompatible values at the same instant; no data submitted |

SDK access-control codes do not prove a specific cause such as Developer Mode
being disabled; the UI describes the possible access restrictions. Zero records
is a successful read with a separate empty state. In the meal form, empty readings
still go to the backend, which applies its existing sufficiency policy.

## Physical Samsung phone verification (developer testing only)

1. Use Android 10+ and Samsung Health 6.30.2+. Record the phone OS/Samsung Health
   versions and a known interval containing imported **爱看健康** glucose readings.
   Note their local timestamps, timezone and mmol/L values in Samsung Health.
2. In Samsung Health open **Settings → About Samsung Health**, tap the version
   area quickly at least ten times, open **Developer Mode (Samsung Health Data SDK)**,
   accept its developer notice and enable **Developer Mode for Data Read**.
   Do not enable write access. This is a testing setup, not an end-user workflow.
   See [Samsung's developer-mode instructions](https://developer.samsung.com/health/data/guide/developer-mode.html).
3. Build the APK above. Enable USB debugging, connect the phone, and install it:

   ```powershell
   # From mobile/; replace <device-serial> using adb devices.
   $biosyncAdb = Join-Path $env:LOCALAPPDATA 'Android/Sdk/platform-tools/adb.exe'
   & $biosyncAdb devices
   & $biosyncAdb -s <device-serial> install -r android/app/build/outputs/apk/debug/app-debug.apk
   & $biosyncAdb -s <device-serial> reverse tcp:18081 tcp:18081
   npm.cmd start -- --host 127.0.0.1 --port 18081 --max-workers 2
   ```

   Keep Metro running. Open BioSync and set its development-server address to
   `localhost:18081` in Dev Settings if necessary; reload. Restore ADB reverse on
   reconnection. The API URL remains the existing HTTPS AWS URL in
   `src/config/development.ts`; port 18081 is only for Metro.
4. In the **Samsung Health** diagnostic, check SDK status, press **Request Samsung
   Health Permission**, and explicitly grant blood-glucose READ. Verify no unrelated
   data permission or write permission is requested. Deny once to verify the denied
   state, then grant access.
5. Enter the known interval as UTC `Z` timestamps in the diagnostic start/end fields.
   Convert local times using the offset for that date, including daylight saving.
   Press **Load Samsung Health Blood Glucose**. Compare the count, latest displayed
   timestamps and mmol/L with Samsung Health. Narrow the interval when inspecting
   older samples because the panel displays only the latest five.
6. Check the displayed source package. Verify independently whether it corresponds
   to 爱看健康; the SDK may identify Samsung Health as the importer instead. Do not
   infer an app's Chinese display name from an unknown package. Confirm that a
   continuous parent yields multiple distinct samples, including a query beginning
   inside a CGM session. If imported samples are missing despite granted access,
   compare with Samsung's official DataViewer and record the limitation. This is
   not a successful import acceptance test until timestamps/values actually match.
7. In the manual meal form choose **Samsung Health**, enter food/optional weight
   and a historical UTC meal time with pre-meal and complete post-meal coverage.
   Press **Analyse Samsung Health Meal**. The existing request builder sends only
   normalized readings to AWS. Confirm an iAUC result and OpenAI advice return.
   Real data need not yield 225; that value belongs to the deterministic fixture.
8. Confirm **Run Test Analysis** still yields iAUC **225**, then select **Health Connect**
   and confirm its existing permission/read/meal analysis path still works.
9. Test an empty interval (successful zero count), revoked Samsung permission
   (denied, no backend submission), disabled Data Read access (restriction state
   if enforced by Samsung), and missing coverage (backend policy message).

Production distribution requires Samsung Health partnership/registration of the
app package/signature and data scope. This task does not request a partnership or
create an account. See the [official process](https://developer.samsung.com/health/data/process.html).
Do not instruct production users to enable developer mode to bypass registration.

## Automated validation and remaining acceptance

Local verification for this change: **155 Jest tests passed** (42 added; all
113 existing tests retained), TypeScript and ESLint passed, Android debug APK
and Metro Android bundle built successfully. Backend regression: **318 passed**;
backend files were not changed. Build output retains existing React Native/AGP
deprecation warnings and Metro's private feature-flag export fallback warning.

Jest tests mock only native/HTTP boundaries and exercise real mapping, provider
selection, ViewModel and rendering. They do not simulate successful Samsung SDK
execution. Tests cover single and series records, direct mmol/L values, UTC,
stable IDs, range clipping, sorting, duplicates/conflicts, invalid values,
empty results, denied/revoked permission, access restrictions, native failures,
diagnostic rendering and unchanged analysis requests. Existing Health Connect
tests and the fixture path remain in the suite.

Run from `mobile/`:

```powershell
npm.cmd test -- --runInBand
npm.cmd run typecheck
npm.cmd run lint
npm.cmd exec -- react-native bundle --platform android --dev true --entry-file index.js --bundle-output build/index.android.bundle --assets-dest build/assets --max-workers 2
```

Device acceptance remains **pending**, especially third-party imported CGM
visibility and session-boundary selection. No backend contracts or scientific
rules were changed. This second supported source is an explicit scope extension
requested after the original project specification selected Health Connect.
