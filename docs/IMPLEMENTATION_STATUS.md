# BioSync implementation status

Reviewed against repository code on **2026-10-11**. This is a documentation-only
snapshot; no application, schema, scientific policy or deployment configuration
was changed. Local code, historical test records and physical/cloud acceptance
are distinguished below.

## Implemented path

```text
Manual food + optional weight + local meal date/time
  + selected Health Connect / Samsung Health BloodGlucose
  → normalized GlucoseReading[]
  → POST /v1/analyses
  → Flask / Pydantic → analysis_service
      → meal_analysis → iauc_service (deterministic iAUC)
      → llm_service → mock / OpenAI Responses (interpretation only)
  → AnalysisResult → React Native UI
```

The checked-in mobile URL is an API Gateway HTTPS `demo` endpoint in
`ap-southeast-2`. In that deployment, iAUC executes in Lambda. Local Flask
executes the same calculation on the development host. Neither mobile nor the
LLM calculates iAUC. Source code alone cannot identify the live Lambda version,
environment/model, installed APK or currently running Metro process.

## Current feature matrix

| Feature | Code state / evidence |
|---|---|
| Android app | React Native CLI 0.87.1, TypeScript, MVVM hooks, Android minimum API 29. |
| Manual food | One trimmed description, optional finite positive grams. No invented confidence or weight. |
| Meal time | Date state, native date/time picker 9.2.1, local display and Use current time; UTC serialization uses `toISOString()`. No manual offsets. |
| Health Connect | 4.1.3; read-only BloodGlucose, all pages, explicit mmol/L accessor. User reported successful reads of manually entered records. |
| Samsung Health | Data SDK 1.1.0, local AAR/Kotlin bridge, read-only BloodGlucose, series flattening/stable IDs. Physically verified: imported 爱看健康 (`com.sino.care`) readings are read on a Galaxy Z Flip7. |
| Provider selection | One shared meal workflow; Health Connect default, Samsung selectable. No automatic merging of stores. |
| Diagnostic panels | Local display only; Samsung UTC start/end text inputs unchanged. |
| Query | `[meal_at − 15 min, meal_at + 135 min)`; exact backend analysis window remains 0–120 min. |
| API | `POST /v1/analyses` and `GET /health`. Strict transport validation and stable errors. |
| Scientific layer | Explicit meal time, pre-meal mean, synthetic baseline start, positive-only area, validated endpoint interpolation and real-source gaps. |
| LLM | OpenAI SDK 3.24.0 / Responses; default mock, explicit openai mode, structured validation, no silent fallback. |
| Interpretation | Fixed weight-loss goal; direct glycaemic summary, 2–3 practical suggestions, one short limitation requested by prompt. |
| Regression fixture | Synthetic input still gives iAUC 225 (mmol/L)·min in backend tests. |
| Persistence/history | Not implemented; current drafts/results are in memory. `other_meal_times: []` cannot detect unreported overlapping meals. |
| Lambda support | Python 3.12, serverless-wsgi 3.1.0, Linux/Docker packaging, proxy adapter and manual AWS commands. User reports deployed end-to-end use; no cloud recheck in this review. |
| Camera/CV, SQLite, nutrition DB, auth | Not implemented. Food recognition and persistent MealRecord in API documentation are reserved designs. |

## Data boundaries

“Data stays on this device” applies to diagnostic-panel loads. Pressing meal
Analyse sends normalized glucose records (source, source ID, UTC time, mmol/L),
meal UUID/time and food information to the configured backend. The backend is
stateless between analysis requests and has no application meal database.

Only food names, supplied approximate weight, deterministic iAUC/unit, analysis
durations, policy version, fixed goal and a scope limitation go to OpenAI.
Raw glucose, source record IDs, source package names, device metadata, meal UUID
and unnecessary timestamps do not. External provider retention is a separate
matter; no claim that all application data stays on-device is made.

## Verification performed for this documentation sync

| Check | Result |
|---|---|
| Full Python suite, Python 3.12 environment | **340 passed, 0 failed** |
| Mobile Jest | **159 passed, 0 failed**, 9 suites |
| TypeScript `tsc --noEmit` | Passed |
| ESLint | Passed |
| Android build / Metro bundle | Not rerun; no native or application changes |
| Lambda package build/validation | Not rerun; no backend code or packaging changes |
| Live HTTP / OpenAI / AWS | Not called |
| Physical-device acceptance | Samsung imported-record case verified on a Galaxy Z Flip7 (480 `com.sino.care` records in 24 h; end-to-end analysis with the release APK) |

Backend tests block external network calls and exercise SDK parsing with mocked
HTTP transport. Mobile tests mock native/HTTP boundaries; they do not establish
native SDK access. Historical counts/build results in other documents describe
their named stages, not current suite totals.

No rebuild or deployment is required for these Markdown changes. If a deployed
function still runs older backend code/prompt, that earlier code change separately
requires rebuilding the ZIP and updating Lambda; editing docs does not release it.

## Document index

- [PROJECT_SPEC.md](PROJECT_SPEC.md): lecturer-confirmed scope and current architecture.
- [API_CONTRACTS.md](API_CONTRACTS.md): implemented transport and reserved designs.
- [IAUC_POLICY.md](IAUC_POLICY.md): unchanged scientific rules, implementation details.
- [LLM_INTEGRATION.md](LLM_INTEGRATION.md): exact prompt/context, validation and modes.
- [mobile/README.md](../mobile/README.md): prerequisites, current URL, local alternative, build/run.
- [mobile/MEAL_ANALYSIS.md](../mobile/MEAL_ANALYSIS.md): time input, query, errors and manual workflow.
- [mobile/HEALTH_CONNECT.md](../mobile/HEALTH_CONNECT.md): existing provider setup and limitations.
- [mobile/SAMSUNG_HEALTH.md](../mobile/SAMSUNG_HEALTH.md): AAR/bridge, series mapping and device acceptance.
- [backend/deploy/README.md](../backend/deploy/README.md): packaging, operator-run release/update/rollback.
