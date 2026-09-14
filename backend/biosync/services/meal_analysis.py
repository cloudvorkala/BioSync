"""Prepare meal-associated glucose data under docs/IAUC_POLICY.md.

This Python 3.12 policy layer accepts normalized mmol/L values and UTC
datetime objects. It performs no I/O, JSON parsing, unit conversion, or
numerical integration; integration remains in iauc_service.py.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from math import isfinite
from statistics import mean

from .iauc_service import GlucoseReading, calculate_incremental_auc


POLICY_VERSION = "biosync-iauc-v1"
_BASELINE_DURATION = timedelta(minutes=15)
_ANALYSIS_DURATION = timedelta(minutes=120)
_MAX_GAP = timedelta(minutes=15)


class MealAnalysisPolicyError(ValueError):
    """Policy failure with a stable ``code`` for a future API error envelope."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class GlucoseRecord:
    """Internal source measurement; not a database or API transport model.

    A source ID is optional here because timestamp/value equality suffices
    for duplicate normalization. Existing IDs are preserved, never generated.
    Fields are validated by analyze_meal, including out-of-window records.
    """

    measured_at: datetime
    value_mmol_l: float
    source_record_id: str | None = None


@dataclass(frozen=True, slots=True)
class MealAnalysisResult:
    """Calculation metadata without feedback or synthetic source records.

    ``reading_count`` counts final numerical calculation points, including
    the synthetic start and exact/interpolated end. It excludes baseline
    source readings, any real meal-time record, and the after-end support
    reading used only for interpolation.
    """

    policy_version: str
    meal_at: datetime
    baseline_window_start: datetime
    baseline_window_end: datetime
    baseline_mmol_l: float
    analysis_window_start: datetime
    analysis_window_end: datetime
    reading_count: int
    iauc_mmol_l_min: float


def _require_utc(value: object, field: str) -> datetime:
    if not isinstance(value, datetime) or value.utcoffset() != timedelta(0):
        raise MealAnalysisPolicyError(
            "INVALID_GLUCOSE_DATA",
            f"{field} must be a timezone-aware UTC datetime",
        )
    return value


def _glucose_value(value: object) -> float | int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise MealAnalysisPolicyError(
            "INVALID_GLUCOSE_DATA", "value_mmol_l must be a finite number"
        )
    try:
        normalized = float(value)
    except OverflowError as exc:
        raise MealAnalysisPolicyError(
            "INVALID_GLUCOSE_DATA", "value_mmol_l must be a finite number"
        ) from exc
    if not isfinite(normalized):
        raise MealAnalysisPolicyError(
            "INVALID_GLUCOSE_DATA", "value_mmol_l must be a finite number"
        )
    # Preserve exact numeric equality until duplicate comparison: converting
    # large distinct integers to float here could hide conflicting readings.
    return value


def _normalize(readings: Iterable[GlucoseRecord]) -> list[GlucoseRecord]:
    """Validate all records, sort copies, and retain one copy per measurement.

    At equal timestamps/values, the lexicographically first supplied ID is
    retained, with missing IDs ordered last. Repeated identical source
    records also collapse by this rule. ID equality alone never discards
    measurements with differing timestamps or values.
    """
    records = []
    for reading in readings:
        if not isinstance(reading, GlucoseRecord):
            raise MealAnalysisPolicyError(
                "INVALID_GLUCOSE_DATA", "readings must contain GlucoseRecord instances"
            )
        timestamp = _require_utc(reading.measured_at, "measured_at")
        value = _glucose_value(reading.value_mmol_l)
        record_id = reading.source_record_id
        if record_id is not None and not isinstance(record_id, str):
            raise MealAnalysisPolicyError(
                "INVALID_GLUCOSE_DATA", "source_record_id must be a string when supplied"
            )
        records.append(GlucoseRecord(timestamp, value, record_id))

    records.sort(
        key=lambda record: (
            record.measured_at,
            record.source_record_id is None,
            record.source_record_id or "",
        )
    )
    normalized: list[GlucoseRecord] = []
    for record in records:
        if normalized and record.measured_at == normalized[-1].measured_at:
            if record.value_mmol_l != normalized[-1].value_mmol_l:
                raise MealAnalysisPolicyError(
                    "CONFLICTING_GLUCOSE_READINGS",
                    "Different glucose values share the same timestamp",
                )
            continue
        normalized.append(record)
    return normalized


def analyze_meal(
    readings: Iterable[GlucoseRecord],
    meal_at: datetime,
    *,
    other_meal_times: Iterable[datetime] = (),
) -> MealAnalysisResult:
    """Calculate BioSync v1 meal iAUC in (mmol/L)·min without modifying inputs.

    meal_at is explicit; no image time, current time, or CGM lag is inferred.
    All input timestamps must be aware UTC, including other logged meals.
    Invalid timestamps use INVALID_GLUCOSE_DATA, with the field identified in
    the error message. Inputs may be unsorted; normalization uses copies.

    Baseline is the mean of at least two distinct measurements in
    [meal_at - 15 minutes, meal_at). Other meals strictly inside the following
    120 minutes reject analysis. Real meal-time readings are replaced only in
    the numerical sequence by a temporary baseline point.

    An exact endpoint is used when present; otherwise its nearest real
    neighbors must bracket it within 15 minutes. There is no extrapolation.
    Gap validation includes meal_at to the first strictly post-meal reading
    and every real source interval needed through the endpoint or its later
    support reading. Unneeded earlier/later intervals do not affect coverage.

    Missing endpoint coverage raises WAITING_FOR_GLUCOSE_DATA; unacceptable
    gaps raise INSUFFICIENT_GLUCOSE_DATA. Errors never return a fabricated zero.
    """
    meal_at = _require_utc(meal_at, "meal_at")
    other_meals = tuple(
        _require_utc(timestamp, "other_meal_times") for timestamp in other_meal_times
    )
    try:
        baseline_start = meal_at - _BASELINE_DURATION
        analysis_end = meal_at + _ANALYSIS_DURATION
    except OverflowError as exc:
        raise MealAnalysisPolicyError(
            "INVALID_GLUCOSE_DATA", "meal_at cannot represent the complete analysis window"
        ) from exc

    normalized = _normalize(readings)
    baseline_records = [
        record for record in normalized
        if baseline_start <= record.measured_at < meal_at
    ]
    if len(baseline_records) < 2:
        raise MealAnalysisPolicyError(
            "INSUFFICIENT_BASELINE_DATA",
            "At least two distinct readings are required in the pre-meal window",
        )
    baseline = float(mean(record.value_mmol_l for record in baseline_records))

    if any(meal_at < timestamp < analysis_end for timestamp in other_meals):
        raise MealAnalysisPolicyError(
            "OVERLAPPING_MEAL", "Another meal occurs inside the analysis window"
        )

    # Keep real readings only, through the first exact/after-end measurement.
    # Do not add a synthetic endpoint before checking the real source gaps.
    coverage: list[GlucoseRecord] = []
    for record in normalized:
        if record.measured_at > meal_at:
            coverage.append(record)
            if record.measured_at >= analysis_end:
                break
    if not coverage or coverage[-1].measured_at < analysis_end:
        raise MealAnalysisPolicyError(
            "WAITING_FOR_GLUCOSE_DATA",
            "No glucose reading at or after the analysis endpoint is available",
        )

    previous_time = meal_at
    for record in coverage:
        if record.measured_at - previous_time > _MAX_GAP:
            raise MealAnalysisPolicyError(
                "INSUFFICIENT_GLUCOSE_DATA",
                "Required glucose coverage contains a gap greater than 15 minutes",
            )
        previous_time = record.measured_at

    endpoint = coverage[-1]
    endpoint_value = endpoint.value_mmol_l
    if endpoint.measured_at > analysis_end:
        # Passing the initial-gap check guarantees a genuine pre-end neighbor.
        before = coverage[-2]
        fraction = (analysis_end - before.measured_at) / (
            endpoint.measured_at - before.measured_at
        )
        endpoint_value = (
            before.value_mmol_l * (1 - fraction) + endpoint.value_mmol_l * fraction
        )

    prepared = [GlucoseReading(meal_at, baseline)]
    prepared.extend(
        GlucoseReading(record.measured_at, record.value_mmol_l)
        for record in coverage if record.measured_at < analysis_end
    )
    prepared.append(GlucoseReading(analysis_end, endpoint_value))
    try:
        iauc = calculate_incremental_auc(
            prepared, baseline, below_baseline_policy="positive_only"
        )
    except ValueError as exc:
        raise MealAnalysisPolicyError(
            "INVALID_GLUCOSE_DATA", f"Glucose data cannot be integrated: {exc}"
        ) from exc

    return MealAnalysisResult(
        policy_version=POLICY_VERSION,
        meal_at=meal_at,
        baseline_window_start=baseline_start,
        baseline_window_end=meal_at,
        baseline_mmol_l=baseline,
        analysis_window_start=meal_at,
        analysis_window_end=analysis_end,
        reading_count=len(prepared),
        iauc_mmol_l_min=iauc,
    )
