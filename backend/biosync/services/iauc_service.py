"""Pure numerical iAUC integration for Python 3.12.

Meal-specific decisions remain TBD – iAUC calculation policy. The caller
supplies the readings, baseline, and area mode explicitly. This module does
not select a monitoring window, infer a baseline, fill missing readings, or
apply a maximum gap. Crossing the baseline within a supplied segment is part
of positive-area integration, not interpolation at monitoring boundaries.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from math import fsum, isfinite
from typing import Literal


@dataclass(frozen=True, slots=True)
class GlucoseReading:
    """Internal calculation input, not the complete API transport record.

    ``measured_at`` must be a timezone-aware UTC datetime. Future API code
    must parse UTC ISO 8601 strings before calling this module. Source record
    identifiers are unnecessary for integration and remain outside this type.
    Fields are validated by ``calculate_incremental_auc``.
    """

    measured_at: datetime
    value_mmol_l: float


def _finite_number(value: object, field: str) -> float:
    """Accept finite Python int/float values without coercing strings or bools."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field} must be a finite number")
    try:
        result = float(value)
    except OverflowError as exc:
        raise ValueError(f"{field} must be a finite number") from exc
    if not isfinite(result):
        raise ValueError(f"{field} must be a finite number")
    return result


def _segment_area(
    left: float,
    right: float,
    minutes: float,
    policy: Literal["signed", "positive_only"],
) -> float:
    if policy == "signed" or (left >= 0 and right >= 0):
        return (left / 2 + right / 2) * minutes
    if left <= 0 and right <= 0:
        return 0.0

    # At a crossing, the positive triangle occupies the fraction
    # positive / (positive + abs(negative)) of the segment's duration.
    # Scale both heights to avoid overflowing their sum.
    positive = max(left, right)
    negative_magnitude = -min(left, right)
    scale = max(positive, negative_magnitude)
    positive_scaled = positive / scale
    positive_fraction = positive_scaled / (
        positive_scaled + negative_magnitude / scale
    )
    positive_minutes = minutes * positive_fraction
    return (positive / 2) * positive_minutes


def calculate_incremental_auc(
    readings: Iterable[GlucoseReading],
    baseline_mmol_l: float,
    *,
    below_baseline_policy: Literal["signed", "positive_only"],
) -> float:
    """Return incremental area in (mmol/L)·min using actual elapsed time.

    A copy of the validated input is sorted chronologically; caller-owned
    records and their order are not modified. At least two distinct UTC
    timestamps are required. Integration covers exactly the first through
    last supplied timestamps with no boundary extension or gap filtering.

    ``signed`` applies the trapezoidal rule to glucose minus baseline,
    including negative area. ``positive_only`` integrates only above-baseline
    area, splitting crossing segments at their linear zero crossing. Neither
    mode is selected as the final BioSync scientific policy; no mode defaults.

    Raises ValueError for invalid readings, timestamps, baseline, mode, or
    arithmetic outside the finite floating-point range. Input values have no
    additional physiological range restriction in this numerical module.
    """
    if below_baseline_policy not in ("signed", "positive_only"):
        raise ValueError("below_baseline_policy must be 'signed' or 'positive_only'")
    baseline = _finite_number(baseline_mmol_l, "baseline_mmol_l")

    points: list[tuple[datetime, float]] = []
    for reading in readings:
        if not isinstance(reading, GlucoseReading):
            raise ValueError("readings must contain GlucoseReading instances")
        timestamp = reading.measured_at
        if not isinstance(timestamp, datetime) or timestamp.utcoffset() != timedelta(0):
            raise ValueError("measured_at must be a timezone-aware UTC datetime")
        value = _finite_number(reading.value_mmol_l, "value_mmol_l")
        increment = _finite_number(value - baseline, "glucose increment")
        points.append((timestamp, increment))

    if len(points) < 2:
        raise ValueError("at least two readings are required")
    points.sort(key=lambda point: point[0])

    areas: list[float] = []
    for (left_time, left), (right_time, right) in zip(points, points[1:]):
        if left_time == right_time:
            raise ValueError("duplicate timestamps are not allowed")
        minutes = (right_time - left_time).total_seconds() / 60.0
        area = _segment_area(left, right, minutes, below_baseline_policy)
        areas.append(_finite_number(area, "segment area"))

    try:
        total = fsum(areas)
    except OverflowError as exc:
        raise ValueError("iAUC exceeds the finite numeric range") from exc
    return _finite_number(total, "iAUC")
