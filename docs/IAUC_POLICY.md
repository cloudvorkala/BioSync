
# BioSync iAUC Calculation Policy

Status: BioSync v1 implementation policy.

Implementation notes synchronized on 2026-10-11; scientific constants and
calculation rules are unchanged. Both policy and numerical integration execute
in the Python backend, whether hosted locally or on Lambda.

This document defines how BioSync selects and prepares meal-associated CGM data before calling the standalone numerical iAUC calculation module.

The underlying numerical integration remains implemented separately in `iauc_service.py`.

This policy is intended for the BioSync university project and should not be interpreted as a clinical diagnostic protocol.

---

## 1. Purpose

BioSync calculates postprandial incremental Area Under the Curve (iAUC) to quantify the incremental glucose response associated with a logged meal.

The calculation pipeline is:

```text
Meal logged
    ↓
Determine meal time
    ↓
Select pre-meal glucose readings
    ↓
Calculate baseline
    ↓
Check available postprandial glucose coverage (otherwise return a policy error)
    ↓
Validate glucose coverage
    ↓
Prepare calculation points
    ↓
Calculate positive incremental AUC
    ↓
Return iAUC in (mmol/L)·min
```

The numerical trapezoidal integration is performed by the existing standalone iAUC calculation module.

This document defines the meal-specific policy that determines which glucose readings and baseline are supplied to that module.

---

## 2. Terminology

### 2.1 Meal time

`meal_at` represents the user's recorded start time of a meal.

The current manual form initializes a JavaScript Date to the phone's current
instant and lets the user select the local calendar date and clock time, or
reset it with Use current time. Native/JavaScript date handling resolves the
selected date's timezone/DST; submission uses `toISOString()`.

The backend receives `meal_at` explicitly. It never derives it from image,
Computer Vision, request or current time. No camera/CV flow is implemented.

At API boundaries, `meal_at` is represented as a UTC ISO 8601 timestamp.

Example:

```text
2026-09-14T00:30:00Z
```

---

### 2.2 Baseline glucose

Baseline glucose represents the pre-meal glucose level against which the postprandial glucose response is evaluated.

BioSync v1 calculates the baseline as the arithmetic mean of valid CGM readings recorded during the 15 minutes immediately before `meal_at`.

The baseline window is:

```text
[meal_at - 15 minutes, meal_at)
```

A reading recorded exactly at `meal_at` is not included in the baseline calculation.

At least two valid pre-meal glucose readings are required.

The baseline is calculated as:

```text
baseline =
    sum(pre-meal glucose values)
    /
    number of valid pre-meal readings
```

Example:

```text
Meal time: 12:00

11:48    5.2 mmol/L
11:51    5.3 mmol/L
11:54    5.4 mmol/L
11:57    5.3 mmol/L

Baseline = (5.2 + 5.3 + 5.4 + 5.3) / 4
         = 5.30 mmol/L
```

If fewer than two valid readings are available in the baseline window, BioSync must not calculate a complete meal iAUC.

---

## 3. Postprandial Monitoring Window

BioSync v1 uses a 120-minute postprandial monitoring window.

The calculation interval is:

```text
meal_at → meal_at + 120 minutes
```

For example:

```text
11:45              12:00                              14:00
│-------------------│-----------------------------------│
 baseline window    meal_at                      window end
    15 min                         120 min
```

The monitoring window is based on `meal_at`, not on:

- image upload time;
- Computer Vision completion time;
- backend request time;
- application restart time.

The backend does not run a monitoring timer. The current app keeps only an
in-memory draft, so closing/terminating it does not guarantee meal recovery.
After restarting, the user can select the original historical meal time again.

---

## 4. Incremental Area Definition

BioSync v1 uses positive incremental AUC.

The glucose increment at time `t` is:

```text
increment(t) = glucose(t) - baseline
```

Only area above the baseline contributes to BioSync's iAUC.

Area below the baseline does not subtract from the result.

Therefore, BioSync calls the numerical calculation module using:

```python
below_baseline_policy="positive_only"
```

The low-level numerical module may continue to support `signed` integration for testing and reuse, but `signed` is not the BioSync v1 meal-analysis policy.

---

## 5. Baseline Crossing

A segment may cross the baseline between two CGM readings.

Example:

```text
t1                  crossing                 t2
3 mmol/L                 │                  9 mmol/L
    ╲                     │                ╱
     ╲                    │               ╱
------╲-------------------●--------------╱------ baseline = 5
```

For positive-only iAUC, BioSync must calculate the linear crossing point and include only the portion of the segment above baseline.

It must not simply clamp the negative endpoint to zero and calculate a full-width trapezoid.

This behaviour is already implemented in the standalone numerical iAUC module.

---

## 6. Integration Method

BioSync uses trapezoidal numerical integration.

For two adjacent glucose increments:

```text
y1 = glucose1 - baseline
y2 = glucose2 - baseline
```

separated by:

```text
Δt = t2 - t1
```

the signed trapezoidal area would be:

```text
area = ((y1 + y2) / 2) × Δt
```

BioSync v1 applies this using the `positive_only` policy.

Time intervals must be calculated from the actual timestamps.

The calculation must not assume that CGM readings always occur every three minutes, five minutes, or any other fixed interval.

The final unit is:

```text
(mmol/L)·min
```

---

## 7. Start of the Postprandial Curve

BioSync creates a synthetic calculation point at the meal time:

```text
time  = meal_at
value = baseline
```

Therefore, the incremental glucose value at `t = 0` is:

```text
0 mmol/L
```

Conceptually:

```text
meal_at
   │
   ● baseline
    ╲
     ╲
      ● first post-meal CGM reading
```

The synthetic baseline point is used only for iAUC calculation. A real reading
exactly at `meal_at` is excluded from the numerical sequence, avoiding a duplicate
timestamp and preserving the synthetic start required by this policy.

It does not represent an additional CGM measurement and must not be stored as if it were a real Health Connect record.

---

## 8. End of the Monitoring Window

The iAUC interval must end exactly at:

```text
meal_at + 120 minutes
```

### 8.1 Exact reading available

If a CGM reading exists exactly at the 120-minute boundary, that reading is used directly.

---

### 8.2 Boundary between two readings

If the 120-minute boundary lies between two valid CGM readings, BioSync uses linear interpolation.

Example:

```text
13:57              14:00              14:03
5.7 mmol/L            ?               5.5 mmol/L
```

The interpolated value at 14:00 is:

```text
5.6 mmol/L
```

The interpolated point is used only as the calculation boundary.

It is not stored as a real CGM measurement.

---

### 8.3 No reading after the boundary

BioSync must not extrapolate beyond available glucose data.

If the application has not yet received sufficient data to establish the 120-minute boundary, the meal remains in:

```text
waiting_glucose
```

`waiting_glucose` names the reserved persistent workflow stage. The implemented
backend returns `WAITING_FOR_GLUCOSE_DATA`; the mobile ViewModel displays its
transient `waiting` state. The user can retry retrieval manually later.

---

## 9. Missing CGM Data

Small irregularities in CGM sampling are permitted.

BioSync performs integration using the actual elapsed time between readings.

However, BioSync v1 defines a maximum acceptable interval of:

```text
15 minutes
```

between adjacent real glucose records needed to cover the interval. Validate
the original source gap across an interpolated endpoint too; a synthetic or
interpolated point must not hide a larger source-data gap. Exactly 15 minutes
is accepted. Baseline readings have the separate two-reading requirement;
unneeded earlier/later source gaps do not invalidate postprandial coverage.

If any adjacent interval required for the 0–120 minute calculation exceeds 15 minutes, the glucose data are considered insufficient for reliable BioSync meal analysis.

Example:

```text
12:03
12:06
12:12
```

is acceptable.

Example:

```text
12:03
12:27
```

is not acceptable.

The 15-minute threshold is a BioSync v1 engineering/data-quality rule. It must not be described as a universal clinical standard.

The same maximum-gap rule applies between the synthetic `t = 0` baseline point and the first post-meal CGM reading.

---

## 10. Incomplete Data

BioSync must not convert missing or insufficient data into:

```text
iAUC = 0
```

because zero may also be a valid calculated result.

If the glucose data do not satisfy the policy, the calculation must fail explicitly.

Examples include:

- fewer than two valid baseline readings;
- failure to cover the complete 0–120 minute interval;
- an internal glucose-data gap greater than 15 minutes;
- conflicting glucose readings with the same timestamp.

The policy layer should return a specific calculation/data-quality error rather than a fabricated numerical result.

---

## 11. Duplicate Readings

Duplicate records must be handled before numerical integration.

### 11.1 Exact duplicates

If two records represent the same source record or have:

```text
same timestamp
same glucose value
```

the duplicate is removed during normalization. The implementation validates all
supplied readings, then sorts copies and normalizes before selecting the baseline.
For identical timestamp/value measurements it keeps the lexicographically first
supplied source ID, with missing IDs ordered last. Matching IDs alone do not
discard measurements with differing timestamps or values.

---

### 11.2 Conflicting duplicates

If two different readings have:

```text
same timestamp
different glucose values
```

BioSync must reject the data rather than arbitrarily choosing one value.

The numerical iAUC service already rejects duplicate timestamps.

The policy/data normalization layer is responsible for handling exact duplicate source records before calling the numerical module.

---

## 12. Units

All values supplied to the iAUC calculation module must use:

```text
mmol/L
```

If the source provides glucose in another unit, the mobile data layer must normalize the value before storage and analysis.

The API field remains:

```text
value_mmol_l
```

The iAUC result is:

```text
iauc_mmol_l_min
```

with unit:

```text
(mmol/L)·min
```

---

## 13. Multiple Meals and Snacks

BioSync v1 assumes that an analysed meal has an interpretable postprandial period.

If another logged meal or snack begins inside the active 120-minute analysis window, the glucose response can no longer be cleanly attributed to the original meal.

Example:

```text
12:00    Lunch
13:10    Snack
14:00    End of lunch analysis window
```

BioSync v1 must not generate a normal isolated-meal iAUC interpretation for the first meal in this situation.

The policy layer should return an explicit reason such as:

```text
OVERLAPPING_MEAL
```

This document does not require changing the existing `MealRecord.status` enum.

The application may record the policy failure using the existing error mechanism.

For controlled project testing and demonstration, meals should preferably be selected where no additional food is consumed during the following 120 minutes.

---

## 14. CGM Physiological Lag

BioSync v1 does not manually shift CGM timestamps to compensate for estimated physiological or interstitial glucose lag.

The calculation uses the timestamps supplied by the normalized health-data source.

No fixed offset such as:

```text
+5 minutes
+10 minutes
+15 minutes
```

is applied.

Adding such a correction would introduce another model assumption and is outside the BioSync v1 scope.

---

## 15. Data Selection Procedure

For a meal with timestamp `meal_at`, the policy layer should perform the following steps.

### Step 1 — Select baseline readings

Retrieve readings from:

```text
meal_at - 15 minutes
```

up to, but excluding:

```text
meal_at
```

Require at least two valid readings.

---

### Step 2 — Calculate baseline

Calculate:

```text
baseline_mmol_l = arithmetic mean of baseline readings
```

---

### Step 3 — Check for overlapping meals

Check whether another logged meal occurs during:

```text
(meal_at, meal_at + 120 minutes)
```

If so, reject isolated-meal analysis with:

```text
OVERLAPPING_MEAL
```

---

### Step 4 — Retrieve postprandial data

Retrieve glucose readings covering:

```text
meal_at → meal_at + 120 minutes
```

Data may extend slightly beyond the 120-minute boundary when required to interpolate the final boundary point.

---

### Step 5 — Normalize and sort

Normalize glucose values to:

```text
mmol/L
```

Sort readings chronologically without mutating source records.

Remove exact duplicate source records.

Reject conflicting duplicate timestamps.

---

### Step 6 — Add the start boundary

Create a temporary synthetic point:

```text
measured_at = meal_at
value_mmol_l = baseline_mmol_l
```

---

### Step 7 — Establish the end boundary

If an exact reading exists at:

```text
meal_at + 120 minutes
```

use it.

Otherwise, if valid readings exist immediately before and after the boundary, calculate the boundary value using linear interpolation.

Do not extrapolate beyond available data.

---

### Step 8 — Validate gaps

For the required real source sequence through the exact endpoint or its first
later support reading, and from meal_at to the first strictly post-meal reading,
verify that no adjacent timestamps differ by more than:

```text
15 minutes
```

If a gap exceeds this threshold, reject the analysis as insufficient glucose data.

---

### Step 9 — Calculate iAUC

Call:

```python
calculate_incremental_auc(
    readings,
    baseline_mmol_l,
    below_baseline_policy="positive_only",
)
```

The numerical module returns:

```text
(mmol/L)·min
```

---

### Step 10 — Produce analysis metadata

The policy layer should retain enough metadata to make the calculation interpretable and testable.

Recommended metadata includes:

```text
meal_at
baseline_window_start
baseline_window_end
baseline_mmol_l
analysis_window_start
analysis_window_end
reading_count
iauc_mmol_l_min
policy_version
```

The implemented `MealAnalysisResult` dataclass contains all these fields.
`reading_count` counts final numerical points, including the synthetic start
and exact/interpolated endpoint. It excludes baseline records, any real t=0
record and the after-end support record. This metadata is internal; the public
AnalysisResult response shape is unchanged.

For this policy:

```text
policy_version = "biosync-iauc-v1"
```

---

## 16. Error Conditions

The policy layer should use explicit error conditions.

Recommended codes are:

| Code | Meaning |
|---|---|
| `INSUFFICIENT_BASELINE_DATA` | Fewer than two usable readings exist in the 15-minute pre-meal baseline window. |
| `WAITING_FOR_GLUCOSE_DATA` | The 120-minute boundary has not yet been covered by available CGM data. |
| `INSUFFICIENT_GLUCOSE_DATA` | Required glucose data contain an unacceptable gap or otherwise cannot cover the analysis interval. |
| `CONFLICTING_GLUCOSE_READINGS` | Different glucose values exist at the same timestamp. |
| `OVERLAPPING_MEAL` | Another logged meal occurs during the active 120-minute postprandial window. |
| `INVALID_GLUCOSE_DATA` | A reading contains invalid or non-finite data. |

These policy errors are separate from transport errors such as HTTP failures or external CV/LLM failures.

---

## 17. Separation of Responsibilities

The BioSync implementation should keep three responsibilities separate.

### Health/data layer

Responsible for:

- reading glucose records;
- converting units;
- preserving source identifiers;
- provider-specific normalization (Samsung also removes exact source repeats
  and surfaces conflicting samples; Health Connect does not deduplicate);
- holding normalized readings in memory for display/submission. SQLite is deferred.

The backend policy always normalizes duplicates independently of provider behaviour.

It does not calculate iAUC.

---

### Meal-analysis policy layer

Responsible for:

- selecting baseline readings;
- calculating the baseline mean;
- selecting the postprandial window;
- identifying overlapping meals;
- validating glucose coverage;
- handling the 120-minute boundary;
- preparing the calculation sequence;
- selecting the BioSync `positive_only` policy.

It does not implement numerical trapezoidal integration itself.

---

### Numerical iAUC service

`iauc_service.py` is responsible only for:

- validating normalized numerical input;
- ordering a copy of supplied readings;
- calculating actual timestamp intervals;
- trapezoidal integration;
- baseline-crossing mathematics;
- returning numerical iAUC.

It must remain independent of:

- meals;
- Health Connect;
- Flask;
- SQLite;
- AWS;
- CV services;
- LLM services.

---

## 18. Implementation Boundary

The intended backend structure is:

```text
backend/
└── biosync/
    └── services/
        ├── iauc_service.py
        └── meal_analysis.py
```

`iauc_service.py` is the already-tested pure numerical calculation module.

`meal_analysis.py` implements the BioSync v1 policy defined in this document.

The policy layer should call the numerical service rather than duplicate its trapezoidal calculation.

---

## 19. Required Policy Tests

The implemented `backend/tests/test_meal_analysis.py` covers these cases:

1. baseline calculated from two or more pre-meal readings;
2. fewer than two baseline readings rejected;
3. exact reading at the 120-minute boundary;
4. interpolation at the 120-minute boundary;
5. no data beyond the end boundary remains waiting;
6. unequal CGM sampling intervals accepted;
7. a gap of exactly 15 minutes accepted;
8. a gap greater than 15 minutes rejected;
9. exact duplicate source records removed;
10. conflicting duplicate timestamps rejected;
11. another meal inside the 120-minute window rejected;
12. no additional meal allows analysis;
13. area below baseline excluded;
14. curve crossing baseline handled correctly;
15. a valid iAUC of zero remains distinguishable from missing data;
16. input records are not mutated.

The existing unit tests for the standalone numerical iAUC module should remain unchanged unless a genuine defect is identified.

---

## 20. Evaluation Relationship

This policy supports the evaluation criteria defined in the BioSync project specification.

### Correctness

Known glucose datasets can be processed using the confirmed policy and compared with manually calculated reference values.

Target:

```text
iAUC numerical error ≤ 1%
```

---

### Performance

The existing numerical service supports calculation of up to 500 glucose readings.

Target:

```text
≤ 500 ms
```

excluding:

- network latency;
- external API latency;
- Health Connect retrieval time.

The existing standalone numerical implementation has already been tested independently from these external operations.

---

## 21. Scope and Limitations

BioSync v1 iAUC should be interpreted as:

> a quantitative estimate of the incremental postprandial glucose response associated with a logged meal.

It is not:

- Glycaemic Index (GI);
- a clinical diagnosis;
- an insulin-response measurement;
- an insulin-dosing tool;
- a validated medical-device metric;
- proof that a specific food caused every observed glucose change.

Free-living glucose responses may also be influenced by factors including:

- previous meals;
- physical activity;
- sleep;
- stress;
- illness;
- individual physiology.

The LLM feedback layer must therefore present iAUC as contextual dietary information rather than a medical diagnosis.

---

## 22. BioSync v1 Policy Summary

The final BioSync v1 iAUC policy is:

| Decision | BioSync v1 |
|---|---|
| Meal time | Explicit user-confirmed start; mobile defaults to current local date/time and submits UTC |
| Baseline window | 15 minutes immediately before the meal |
| Minimum baseline readings | 2 |
| Baseline value | Arithmetic mean |
| Postprandial window | 120 minutes |
| Numerical method | Trapezoidal integration using actual timestamps |
| Below-baseline area | Excluded |
| Calculation mode | `positive_only` |
| Start boundary | Synthetic point at `meal_at` with glucose equal to baseline |
| End boundary | Exact reading or linear interpolation at 120 minutes |
| Extrapolation | Not permitted |
| Maximum adjacent gap | 15 minutes |
| Exact duplicate records | Remove during normalization |
| Conflicting same-time readings | Reject |
| Overlapping meal within 120 min | Reject isolated-meal analysis |
| CGM lag correction | None |
| Glucose unit | `mmol/L` |
| iAUC unit | `(mmol/L)·min` |
| Policy version | `biosync-iauc-v1` |

---

## 23. Scientific Rationale Note

The 120-minute postprandial window, incremental area relative to a pre-meal baseline, and trapezoidal integration are consistent with commonly used approaches for quantifying postprandial glycaemic response.

BioSync's specific operational choices—such as using a 15-minute pre-meal mean, requiring at least two baseline readings, and rejecting gaps greater than 15 minutes—are project-specific engineering rules intended to provide reproducible processing of free-living CGM data.

They should not be described as universal clinical standards.

The final report should distinguish between:

1. externally supported principles such as postprandial iAUC and trapezoidal integration; and
2. BioSync-specific operational rules selected to make the implementation deterministic and testable.
