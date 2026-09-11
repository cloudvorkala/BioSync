"""Deterministic calculation tests for Python 3.12.

Run from backend/: python -B -m pytest -p no:cacheprovider -q -s
All intervals and baselines below are arithmetic examples, not meal policy.
"""

from datetime import UTC, datetime, timedelta, timezone
from statistics import median
from time import perf_counter

import pytest

from biosync.services.iauc_service import GlucoseReading, calculate_incremental_auc


START = datetime(2026, 9, 11, tzinfo=UTC)
MODES = ("signed", "positive_only")


def make_readings(points: list[tuple[float, float]]) -> list[GlucoseReading]:
    """Build readings from elapsed minutes and glucose in mmol/L."""
    return [
        GlucoseReading(START + timedelta(minutes=minutes), value)
        for minutes, value in points
    ]


@pytest.mark.parametrize("mode", MODES)
def test_constant_glucose_equal_to_baseline(mode):
    readings = make_readings([(0, 5), (3, 5), (8, 5)])
    assert calculate_incremental_auc(
        readings, 5, below_baseline_policy=mode
    ) == pytest.approx(0)


@pytest.mark.parametrize("mode", MODES)
def test_constant_glucose_above_baseline(mode):
    readings = make_readings([(0, 7), (5, 7), (10, 7)])
    # Increment 2 mmol/L over 10 minutes = 20 (mmol/L)*min.
    assert calculate_incremental_auc(
        readings, 5, below_baseline_policy=mode
    ) == pytest.approx(20)


@pytest.mark.parametrize("mode", MODES)
def test_rising_glucose_has_manually_verified_trapezoids(mode):
    readings = make_readings([(0, 5), (5, 7), (10, 9)])
    # (0 + 2) / 2 * 5 + (2 + 4) / 2 * 5 = 20.
    assert calculate_incremental_auc(
        readings, 5, below_baseline_policy=mode
    ) == pytest.approx(20)


@pytest.mark.parametrize("mode", MODES)
def test_actual_unequal_fractional_minute_intervals(mode):
    readings = make_readings([(0, 5), (1.5, 7), (4, 9)])
    # (0 + 2) / 2 * 1.5 + (2 + 4) / 2 * 2.5 = 9.
    assert calculate_incremental_auc(
        readings, 5, below_baseline_policy=mode
    ) == pytest.approx(9)


@pytest.mark.parametrize("mode, expected", [("signed", -20), ("positive_only", 0)])
def test_entire_curve_below_baseline(mode, expected):
    readings = make_readings([(0, 2), (10, 4)])
    assert calculate_incremental_auc(
        readings, 5, below_baseline_policy=mode
    ) == pytest.approx(expected)


@pytest.mark.parametrize("values", [(3, 9), (9, 3)])
def test_positive_only_splits_asymmetric_baseline_crossing(values):
    readings = make_readings([(0, values[0]), (9, values[1])])
    # Increments -2 and +4 (or reversed): positive duration 6 minutes,
    # triangle area 6 * 4 / 2 = 12. Endpoint clamping would give 18.
    assert calculate_incremental_auc(
        readings, 5, below_baseline_policy="positive_only"
    ) == pytest.approx(12)


@pytest.mark.parametrize("values", [(3, 7), (7, 3)])
def test_positive_only_splits_symmetric_baseline_crossing(values):
    readings = make_readings([(0, values[0]), (10, values[1])])
    assert calculate_incremental_auc(
        readings, 5, below_baseline_policy="positive_only"
    ) == pytest.approx(5)


def test_signed_crossing_preserves_negative_area():
    readings = make_readings([(0, 3), (9, 9)])
    # Signed area (-2 + 4) / 2 * 9 = 9.
    assert calculate_incremental_auc(
        readings, 5, below_baseline_policy="signed"
    ) == pytest.approx(9)


@pytest.mark.parametrize("values", [(5, 9), (9, 5), (5, 3), (3, 5)])
def test_positive_only_segment_touching_baseline(values):
    readings = make_readings([(0, values[0]), (3, values[1])])
    expected = 6 if 9 in values else 0
    assert calculate_incremental_auc(
        readings, 5, below_baseline_policy="positive_only"
    ) == pytest.approx(expected)


@pytest.mark.parametrize("duplicate_value", [5, 7])
def test_duplicate_timestamps_rejected_even_when_values_match(duplicate_value):
    readings = make_readings([(2, 6), (0, 5), (0, duplicate_value)])
    with pytest.raises(ValueError):
        calculate_incremental_auc(readings, 5, below_baseline_policy="signed")


@pytest.mark.parametrize("points", [[], [(0, 5)]])
def test_fewer_than_two_readings_rejected(points):
    with pytest.raises(ValueError):
        calculate_incremental_auc(
            make_readings(points), 5, below_baseline_policy="signed"
        )


@pytest.mark.parametrize(
    "value", [float("nan"), float("inf"), -float("inf"), "6", None, True, 6j]
)
def test_invalid_or_nonfinite_glucose_rejected(value):
    readings = make_readings([(0, 5), (1, value)])
    with pytest.raises(ValueError):
        calculate_incremental_auc(readings, 5, below_baseline_policy="signed")


@pytest.mark.parametrize(
    "baseline", [float("nan"), float("inf"), -float("inf"), "5", None, True, 5j]
)
def test_invalid_or_nonfinite_baseline_rejected(baseline):
    readings = make_readings([(0, 5), (1, 6)])
    with pytest.raises(ValueError):
        calculate_incremental_auc(
            readings, baseline, below_baseline_policy="signed"
        )


@pytest.mark.parametrize(
    "measured_at",
    [
        datetime(2026, 9, 11),
        datetime(2026, 9, 11, tzinfo=timezone(timedelta(hours=12))),
        "2026-09-11T00:00:00Z",
        None,
    ],
)
def test_internal_readings_require_utc_datetime_objects(measured_at):
    readings = [GlucoseReading(measured_at, 5), GlucoseReading(START, 6)]
    with pytest.raises(ValueError):
        calculate_incremental_auc(readings, 5, below_baseline_policy="signed")


def test_sorts_copy_without_mutating_callers_readings():
    readings = make_readings([(10, 9), (0, 5), (5, 7)])
    original_objects = tuple(readings)
    original_values = [(reading.measured_at, reading.value_mmol_l) for reading in readings]

    result = calculate_incremental_auc(readings, 5, below_baseline_policy="signed")

    assert result == pytest.approx(20)
    assert all(current is original for current, original in zip(readings, original_objects))
    assert [(reading.measured_at, reading.value_mmol_l) for reading in readings] == original_values


def test_accepts_one_pass_iterable():
    readings = (reading for reading in make_readings([(3, 7), (0, 7)]))
    assert calculate_incremental_auc(
        readings, 5, below_baseline_policy="signed"
    ) == pytest.approx(6)


@pytest.mark.parametrize("mode", ["unknown", "SIGNED", None])
def test_invalid_policy_rejected(mode):
    with pytest.raises(ValueError):
        calculate_incremental_auc(
            make_readings([(0, 5), (1, 6)]), 5, below_baseline_policy=mode
        )


def test_policy_must_be_explicit():
    with pytest.raises(TypeError):
        calculate_incremental_auc(make_readings([(0, 5), (1, 6)]), 5)


def test_uses_explicit_baseline_instead_of_first_reading():
    assert calculate_incremental_auc(
        make_readings([(0, 8), (10, 10)]), 7, below_baseline_policy="signed"
    ) == pytest.approx(20)


def test_integrates_supplied_interval_without_gap_or_window_policy():
    # A long interval is a numerical example, not approval of meal-data coverage.
    assert calculate_incremental_auc(
        make_readings([(0, 7), (1440, 7)]), 5, below_baseline_policy="signed"
    ) == pytest.approx(2880)


@pytest.mark.parametrize("mode", MODES)
def test_500_readings_within_calculation_budget(mode):
    readings = make_readings([(index / 2, 7) for index in range(500)])
    durations = []
    for _ in range(7):
        started = perf_counter()
        result = calculate_incremental_auc(readings, 5, below_baseline_policy=mode)
        durations.append(perf_counter() - started)
        # 499 half-minute intervals at increment 2 = 499 (mmol/L)*min.
        assert result == pytest.approx(499)

    elapsed = median(durations)
    print(f"500 readings ({mode}): median {elapsed * 1000:.3f} ms over 7 runs")
    # A median reduces sensitivity to occasional scheduling interruptions.
    assert elapsed <= 0.5, f"500-reading calculation took {elapsed * 1000:.3f} ms"
