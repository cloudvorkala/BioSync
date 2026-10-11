# BioSync Project Specification

Status: lecturer/user-clarified scope, synchronized with repository code on
**2026-10-11**. This replaces the original mandatory image/CV/SQLite workflow;
it does not add implementation requirements.

## Project Goal

The required university-project vertical slice is:

```text
Manual food description + optional approximate weight
  + Health Connect or Samsung Health blood glucose
  → Flask POST /v1/analyses
  → deterministic meal policy / iAUC
  → OpenAI dietary feedback (or deterministic development mock)
  → simple React Native Android UI
```

AI food recognition is optional and unimplemented. Polished UI and SQLite are
not required for the current slice. The fixed prototype goal is `weight loss`,
supplied internally to the LLM rather than through a user profile.

## Functional Requirements and Current Status

| Area | Current implementation |
|---|---|
| Health data | Read-only BloodGlucose via Health Connect; selectable Samsung Health Data SDK provider, including CGM series flattening. Both yield normalized GlucoseReading records. |
| Meal input | One manual description, optional positive finite `weight_g`, local date/time picker and Use current time action. |
| Meal time | Canonical JavaScript Date, serialized with `toISOString()`; native/JavaScript date handling respects the phone timezone and historical DST. |
| Calculation | Backend-only positive incremental AUC using actual timestamps and trapezoidal integration. See IAUC_POLICY.md. |
| Feedback | OpenAI Responses API with structured validation; deterministic mock available. Direct postprandial interpretation and practical meal changes for weight loss. |
| Display | Data/request states, iAUC, summary, suggestions, limitations and readable errors; separate diagnostic panels. |
| Regression | Run Test Analysis sends a fixed synthetic request; expected iAUC is 225 (mmol/L)·min. |
| Persistence | No SQLite or persistent meal history. Drafts, readings and results are in memory; no restart recovery/offline cache. |
| Deployment | Same Flask factory runs locally or through a WSGI adapter on Lambda/API Gateway. Mobile currently selects the AWS HTTPS demo endpoint. |

Samsung SDK code/build support does not prove access to imported records.
Physical Samsung/爱看健康 acceptance has been completed on a Galaxy Z Flip7;
see [SAMSUNG_HEALTH.md](../mobile/SAMSUNG_HEALTH.md). The user has reported successful
Health Connect reads and the Samsung-to-Health Connect forwarding limitation.

## Architecture and Technology

Mobile: React Native CLI, TypeScript, simplified MVVM using hooks; no Expo or
Redux. Health access uses provider services; Samsung uses a thin Kotlin bridge.
Minimum Android API is 29. See [mobile/README.md](../mobile/README.md) for versions.

Backend: Python 3.12, Flask, Pydantic, OpenAI SDK and serverless-wsgi.

```text
View → ViewModel → selected glucose provider → GlucoseReading[]
                → backendClient → Flask route → analysis_service
                                               → meal_analysis → iauc_service
                                               → llm_service → mock / OpenAI
```

Neither mobile nor the LLM calculates iAUC. Food weight and the interpretation
goal never change the baseline, coverage rules or numerical result.

## Runtime Workflow

1. Select Health Connect (default) or Samsung Health and grant blood-glucose READ access.
2. Enter description, optional approximate weight and local meal time.
3. On Analyse, serialize the time to UTC and read **[meal_at − 15 min, meal_at + 135 min)**.
4. Send food information, normalized readings and `other_meal_times: []` in a
   self-contained analysis request. There is no meal-history source.
5. Backend validates input and prepares the exact 0–120 minute interval under
   [IAUC_POLICY.md](IAUC_POLICY.md). Missing data produces a policy error.
6. Backend calculates iAUC, then sends food/optional weight and derived context
   to the LLM provider. It does not wait through the monitoring period in a request.
7. Mobile displays the actual response. Retry is manual after data sync; there
   is no background polling, notification or automatic resubmission.

## Data Location and Privacy

Diagnostic panels load/display locally. Their “data stays on this device”
wording applies only to those operations. Meal analysis uploads selected glucose
records (including source record IDs), food and meal time to the BioSync backend.
With the current URL, iAUC runs in AWS Lambda; with local Flask, it runs on the
development host. It never runs on the phone.

OpenAI receives food names, optional weight, iAUC, durations, policy version,
interpretation context and fixed goal. It receives no raw glucose sequence,
meal UUID, source IDs or Samsung package/device metadata. The backend has no
meal database or cross-request meal state; this is not a claim about external
provider retention. See [LLM_INTEGRATION.md](LLM_INTEGRATION.md).

## Non-functional Requirements

- Numerical iAUC for <= 500 readings: target <= 500 ms, excluding network/API latency.
- HTTPS for deployed traffic; local HTTP is restricted to Android debug builds.
- API credentials stay on the backend.
- Keep source access, scientific policy, numerical integration and LLM interpretation separate.
- Keep scope small. The original <= 4-action meal-logging target has not been
  evaluated for this development form and its permission flow.
- The original offline-cache/data-survival requirement is deferred with SQLite;
  current session data is not guaranteed to survive app termination.

## Deferred / Out of Scope

Not implemented or required for this slice: camera, CV recognition, automatic
weight estimation, nutrition database/calorie calculation, SQLite, meal history,
notifications, profiles, authentication, cloud database or polished UI.

Do not implement direct CGM BLE access, reverse-engineer Sinocare/iCan protocols,
train custom CV/LLM models, diagnose disease, recommend medication/insulin dosing
or claim production clinical readiness.

## Supporting Documents

- [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md): code snapshot and verification evidence.
- [API_CONTRACTS.md](API_CONTRACTS.md): implemented API and reserved recognition/storage design.
- [IAUC_POLICY.md](IAUC_POLICY.md): scientific rules and implementation details.
- [LLM_INTEGRATION.md](LLM_INTEGRATION.md): exact prompt, provider input and configuration.
- [mobile/MEAL_ANALYSIS.md](../mobile/MEAL_ANALYSIS.md): input/query flow and device checks.
- [backend/deploy/README.md](../backend/deploy/README.md): packaging and manual deployment.
