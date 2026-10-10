# Health Connect blood glucose diagnostic

The diagnostic panel described here reads blood glucose locally and does not
submit it. The separate [manual meal form](MEAL_ANALYSIS.md) now reads the meal's
glucose range and sends it to `/v1/analyses` on explicit user action. Run Test
Analysis still sends the fixed development fixture. No iAUC math, persistence,
background reads or health-data writes were added to mobile.

## Verified dependency API

Installed and pinned `react-native-health-connect` **4.1.3** with React Native
**0.87.1**. Expo is an optional peer of the package and was not installed.
Before implementation, both the current maintainer documentation and the
installed TypeScript declarations/Kotlin bridge were inspected:

- [CLI installation](https://matinzd.github.io/react-native-health-connect/docs/get-started/)
- [Permissions](https://matinzd.github.io/react-native-health-connect/docs/permissions/)
- [Read API](https://matinzd.github.io/react-native-health-connect/docs/api/methods/readRecords/)
- Installed `src/types/results.types.ts`: `RecordResult<'BloodGlucose'>`
- Installed `android/src/main/java/dev/matinzd/healthconnect/records/ReactBloodGlucoseRecord.kt`:
  `bloodGlucoseToJsMap` returns both `inMillimolesPerLiter` and
  `inMilligramsPerDeciliter` using Android's unit accessors.

The read-result shape is different from the library's `{value, unit}` write
input. BioSync uses the explicit mmol/L read accessor; it never interprets an
unlabelled number or divides an already converted result by 18.

## Android setup

- Minimum SDK raised from 24 to **26**, as required by the library. Compile SDK
  37, target SDK 36, JDK 17 and the existing new architecture remain unchanged.
- Only added health permission: `android.permission.health.READ_BLOOD_GLUCOSE`.
- Package visibility query for `com.google.android.apps.healthdata`.
- `MainActivity.onCreate` registers `HealthConnectPermissionDelegate`.
- Local `HealthPermissionsActivity` explains the diagnostic's data use. It
  handles `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE` on older Android.
  The explanation now also discloses the manual meal form's backend upload.
- Android 14+ permission-usage alias targets that same rationale activity, with
  `android.permission.START_VIEW_PERMISSION_USAGE` as the caller requirement.
  This alias is not another requested health permission.
- No health write, background, history, unrelated health or CORS permissions.

## Service and mapping

`HealthConnectPanel → useHealthConnectViewModel → healthConnectService → native library`.
`getHealthConnectAccess(true)` requests only
`[{accessType: 'read', recordType: 'BloodGlucose'}]`.
The default `getHealthConnectAccess()` checks status without showing a prompt.

`getBloodGlucoseReadings(startTime: Date, endTime: Date): Promise<GlucoseReading[]>`
checks SDK availability, initializes, checks permission, and calls
`readRecords('BloodGlucose', {timeRangeFilter: {operator: 'between', startTime,
endTime}, ascendingOrder: true, pageSize: 1000, pageToken?})`.
Input dates are serialized with `toISOString()`. Every page is consumed; results
are sorted chronologically with ID as a deterministic equal-time tiebreaker.
A failed later page fails the operation, rather than displaying partial data as
complete. No deduplication or scientific eligibility policy is applied here.

| BioSync field | Source |
|---|---|
| `source` | Literal `health_connect` |
| `source_record_id` | `record.metadata.id`, unchanged |
| `measured_at` | `new Date(record.time).toISOString()` (UTC, millisecond precision) |
| `value_mmol_l` | `record.level.inMillimolesPerLiter`, already normalized by Android |

A missing/blank metadata ID, invalid timestamp, or non-finite/non-numeric mmol/L
value rejects the read with a readable error. The service does not invent native
record IDs or silently drop malformed records. Health Connect normally supplies
an ID for every stored record. No provider identifiers become backend resources.

## Physical Android device test

1. Use an Android phone with working Health Connect. Android 14+ integrates it
   into Settings; on supported older devices install/update the Health Connect
   app. Enable a PIN/pattern/password screen lock. SDK availability is checked
   at runtime, rather than inferred only from the Android version.
2. Enable Developer options and USB debugging; connect the phone and authorize
   the host. From a terminal with Android Platform-Tools on PATH, run
   `adb devices -l` and confirm exactly the intended phone is listed as `device`.
3. From `mobile/`, run `npm.cmd ci` if needed, then `npm.cmd start`. In another
   terminal, from `mobile/`, run `npm.cmd run android -- --no-packager` to build
   and install the **new native APK**. Fast Refresh alone cannot add this module.
   If Metro cannot connect, run `adb reverse tcp:8081 tcp:8081`.
   Build without installing: from `mobile/android/`, run
   `.\gradlew.bat :app:assembleDebug`.
4. Open BioSync and scroll below the existing analysis section to **Health
   Connect — blood glucose diagnostic**. Verify availability and permission
   status. Flask is not needed for this diagnostic.
5. Tap **Request Health Permission**. Confirm the system dialog asks only to
   read blood glucose. Open its privacy/rationale link and verify it shows the
   local BioSync explanation; return to the permission dialog.
6. First deny/dismiss: expect `permission: denied`. Tap Load Blood Glucose;
   expect a readable access error and `not loaded`, not a fake zero reading.
   Request again and allow blood glucose. If Android suppresses a repeatedly
   denied prompt, use Health Connect → App permissions → BioSync to enable it.
   Return to BioSync; access is checked again on foreground resume.
7. Tap **Load Blood Glucose** while BioSync stays in the foreground. The
   diagnostic queries the preceding 24 elapsed hours and displays the UTC range.
   An empty range must show `success`, count **0** and an explicit no-records
   message. It must not crash or show an error.
8. For a populated test, first ensure a compatible source app has actually
   written BloodGlucose records to Health Connect within that period. Permission
   alone does not create glucose data. For synthetic development records use
   Google's [Health Connect Toolbox](https://developer.android.com/health-and-fitness/health-connect/test/health-connect-toolbox)
   on a test device, following its setup guide. BioSync itself has no write
   permission and does not insert these records.
9. Load again. Compare count, latest five records, UTC instants, IDs and mmol/L
   values with the source. A Toolbox value of 90 mg/dL should be returned by
   Android's unit accessor as 5 mmol/L; the mobile app must not display 90 mmol/L.
   Repeated loads should preserve record IDs and chronological order.
10. Revoke BioSync's glucose permission in Health Connect, return and reload.
    Confirm denial/read error is distinct from a successful empty result and
    previously displayed records are cleared. On an unavailable provider/device,
    expect `unavailable` or `update_required`, not a crash. Unexpected native
    errors must show a readable error, not partially loaded data.
11. Regression-check **Run Test Analysis** with Flask running. It must still
    use its original fixture and display iAUC 225 and mock feedback independently
    of whether Health Connect is granted or contains records.

## Limits and automated checks

The panel is a foreground, last-24-hours diagnostic. It does not subscribe to
live CGM events, read sensors directly, request extended history, or establish
scientific suitability for a meal. Source apps must export data to Health
Connect. Android's [default history and foreground restrictions](https://developer.android.com/health-and-fitness/health-connect/read-data)
still apply. Denied and never-granted permission share the `denied` display;
the native API provides a set of granted permissions, not denial history.

Jest exercises the real mapping, service and ViewModel with only native-facing
calls mocked; it cannot prove Android's permission UI or native datastore behavior.
Physical-device permission/data testing must therefore be recorded separately.

Verification for this change:

- Jest: **57 passed, 0 failed**, including all original mobile tests.
- TypeScript and ESLint: passed.
- Backend regression suite: **237 passed, 0 failed**; no backend changes.
- Android `:app:assembleDebug`: **BUILD SUCCESSFUL**. The merged manifest has
  only `READ_BLOOD_GLUCOSE` among health read/write permissions, and the generated
  native package list includes `HealthConnectPackage`.
- APK: `android/app/build/outputs/apk/debug/app-debug.apk` (debug, requires Metro).
- Physical-device permissions and real records have **not** been verified in
  this development session. Unit tests are not a substitute for steps 4–10 above.

The dependency install reported 48 high-severity npm audit findings in the
dependency tree. Only the pinned Health Connect package was added; no existing
dependency versions were changed or unrelated automatic audit fixes applied.
Native builds retain upstream Gradle deprecation warnings.

From `mobile/`: `npm.cmd test -- --runInBand`, `npm.cmd run typecheck`,
`npm.cmd run lint`. From `backend/`:
`.\.venv\Scripts\python.exe -B -m pytest -p no:cacheprovider -q`.

The lecturer's clarified scope takes precedence over the older specification's
mandatory-CV/persistence workflow. This task changes no API contract or backend
calculation policy and adds neither CV nor persistence.
