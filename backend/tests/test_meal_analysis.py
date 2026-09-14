"""Deterministic BioSync v1 policy tests using manually verifiable curves.

Run from backend/: python -B -m pytest -p no:cacheprovider -q -s
"""

from datetime import UTC, datetime, timedelta, timezone

import pytest

from biosync.services import meal_analysis
from biosync.services.iauc_service import GlucoseReading
from biosync.services.meal_analysis import (
    GlucoseRecord,
    MealAnalysisPolicyError,
    MealAnalysisResult,
    analyze_meal,
)


MEAL_AT = datetime(2026, 9, 14, 12, tzinfo=UTC)


def record(minutes, value=5, source_record_id=None):
    return GlucoseRecord(
        measured_at=MEAL_AT + timedelta(minutes=minutes),
        value_mmol_l=value,
        source_record_id=source_record_id,
    )


def baseline_records():
    return [record(-15, 5), record(-5, 5)]


def regular_post_records(value=7):
    return [record(minutes, value) for minutes in range(15, 121, 15)]


def complete_records(value=7):
    return baseline_records() + regular_post_records(value)


def interpolation_records(after_minutes=125, after_value=11):
    return (
        baseline_records()
        + [record(minutes, 5) for minutes in range(15, 106, 15)]
        + [record(115, 7), record(after_minutes, after_value)]
    )


def assert_policy_error(code, readings, meal_at=MEAL_AT, **kwargs):
    with pytest.raises(MealAnalysisPolicyError) as caught:
        analyze_meal(readings, meal_at, **kwargs)
    assert caught.value.code == code
    assert str(caught.value)


def test_baseline_from_two_readings_and_complete_result_metadata():
    readings = [record(-15, 4), record(-5, 6)] + regular_post_records()

    result = analyze_meal(readings, MEAL_AT)

    assert isinstance(result, MealAnalysisResult)
    assert result.policy_version == "biosync-iauc-v1"
    assert result.meal_at == MEAL_AT
    assert result.baseline_window_start == MEAL_AT - timedelta(minutes=15)
    assert result.baseline_window_end == MEAL_AT
    assert result.baseline_mmol_l == pytest.approx(5)
    assert result.analysis_window_start == MEAL_AT
    assert result.analysis_window_end == MEAL_AT + timedelta(minutes=120)
    # Synthetic 0 -> increment 2 at minute 15: triangle 15, then 105 * 2.
    assert result.iauc_mmol_l_min == pytest.approx(225)
    # Eight source points plus the synthetic start; baseline records excluded.
    assert result.reading_count == 9


def test_multiple_baseline_readings_use_arithmetic_not_time_weighted_mean():
    readings = (
        [record(-15, 4), record(-14, 6), record(-3, 8)]
        + regular_post_records(8)
    )
    result = analyze_meal(readings, MEAL_AT)
    assert result.baseline_mmol_l == pytest.approx(6)
    assert result.iauc_mmol_l_min == pytest.approx(225)


def test_baseline_includes_left_boundary_and_excludes_earlier_records():
    readings = [record(-15.001, 100), record(-15, 4), record(-1, 6)]
    result = analyze_meal(readings + regular_post_records(), MEAL_AT)
    assert result.baseline_mmol_l == pytest.approx(5)


def test_meal_time_source_is_excluded_from_baseline_and_replaced_by_synthetic_start():
    readings = complete_records() + [record(0, 100, "at-meal")]
    result = analyze_meal(readings, MEAL_AT)
    assert result.baseline_mmol_l == pytest.approx(5)
    assert result.iauc_mmol_l_min == pytest.approx(225)
    assert result.reading_count == 9


@pytest.mark.parametrize("baseline", [[], [(-5, 5)], [(-16, 5), (-5, 5)]])
def test_fewer_than_two_baseline_readings_rejected(baseline):
    readings = [record(minutes, value) for minutes, value in baseline]
    assert_policy_error(
        "INSUFFICIENT_BASELINE_DATA", readings + regular_post_records()
    )


def test_exact_meal_time_does_not_supply_a_second_baseline_reading():
    readings = [record(-5, 5), record(0, 5)] + regular_post_records()
    assert_policy_error("INSUFFICIENT_BASELINE_DATA", readings)


def test_duplicate_baseline_measurement_does_not_count_twice():
    readings = [record(-5, 5, "a"), record(-5, 5, "b")]
    assert_policy_error(
        "INSUFFICIENT_BASELINE_DATA", readings + regular_post_records()
    )


def test_exact_end_boundary_needs_no_later_reading():
    result = analyze_meal(complete_records(), MEAL_AT)
    assert result.iauc_mmol_l_min == pytest.approx(225)
    assert result.analysis_window_end == MEAL_AT + timedelta(minutes=120)


def test_exact_end_boundary_takes_precedence_over_later_data():
    readings = complete_records() + [record(121, 100), record(500, 200)]
    result = analyze_meal(readings, MEAL_AT)
    assert result.iauc_mmol_l_min == pytest.approx(225)
    assert result.reading_count == 9


def test_end_boundary_linear_interpolation_has_manual_area_and_point_count():
    result = analyze_meal(interpolation_records(), MEAL_AT)
    # 115 at 7 and 125 at 11 -> 120 at 9. Baseline is 5.
    # 105..115: triangle 10; 115..120: trapezoid (2 + 4) / 2 * 5 = 15.
    assert result.iauc_mmol_l_min == pytest.approx(25)
    # Start + seven points 15..105 + 115 + interpolated 120 = ten points.
    # The source point at 125 used for interpolation is not counted.
    assert result.reading_count == 10
    assert result.analysis_window_end == MEAL_AT + timedelta(minutes=120)


def test_interpolation_uses_nearest_source_brackets():
    readings = interpolation_records() + [record(130, 100)]
    result = analyze_meal(list(reversed(readings)), MEAL_AT)
    assert result.iauc_mmol_l_min == pytest.approx(25)


@pytest.mark.parametrize("last_minute", [105, 119, 119.999])
def test_missing_boundary_and_later_data_returns_waiting(last_minute):
    readings = baseline_records() + [
        record(minutes) for minutes in range(15, 106, 15)
    ]
    if last_minute > 105:
        readings.append(record(last_minute))
    assert_policy_error("WAITING_FOR_GLUCOSE_DATA", readings)


def test_no_postprandial_data_returns_waiting():
    assert_policy_error("WAITING_FOR_GLUCOSE_DATA", baseline_records())


def test_boundary_without_interior_coverage_is_insufficient():
    assert_policy_error(
        "INSUFFICIENT_GLUCOSE_DATA", baseline_records() + [record(120)]
    )


def test_after_boundary_without_post_meal_bracket_cannot_fill_window():
    assert_policy_error(
        "INSUFFICIENT_GLUCOSE_DATA", baseline_records() + [record(125)]
    )


def test_unequal_fractional_sampling_intervals_use_actual_elapsed_time():
    minutes = [2.5, 6, 12, 25, 40, 54, 69, 80, 95, 108, 120]
    # A straight line g(t) = 5 + t / 60 has increment 2 at minute 120.
    # Its total positive triangle area is 120 * 2 / 2 = 120.
    readings = baseline_records() + [
        record(minute, 5 + minute / 60) for minute in minutes
    ]
    result = analyze_meal(readings, MEAL_AT)
    assert result.iauc_mmol_l_min == pytest.approx(120)


def test_gap_of_exactly_fifteen_minutes_is_accepted():
    result = analyze_meal(complete_records(), MEAL_AT)
    assert result.iauc_mmol_l_min == pytest.approx(225)


@pytest.mark.parametrize("gap_minutes", [15 + 1 / 60_000_000, 16])
def test_internal_gap_greater_than_fifteen_minutes_is_rejected(gap_minutes):
    times = [15, 15 + gap_minutes, 45, 60, 75, 90, 105, 120]
    readings = baseline_records() + [record(minute) for minute in times]
    assert_policy_error("INSUFFICIENT_GLUCOSE_DATA", readings)


@pytest.mark.parametrize("include_at_meal", [False, True])
def test_first_post_meal_reading_must_be_within_fifteen_minutes(include_at_meal):
    times = [16, 30, 45, 60, 75, 90, 105, 120]
    readings = baseline_records() + [record(minute) for minute in times]
    if include_at_meal:
        readings.append(record(0))
    assert_policy_error("INSUFFICIENT_GLUCOSE_DATA", readings)


def test_end_interpolation_rejects_excessive_real_source_gap():
    # Prepared 115..120 is only five minutes, but real 115..131 is sixteen.
    assert_policy_error(
        "INSUFFICIENT_GLUCOSE_DATA",
        interpolation_records(after_minutes=131, after_value=11),
    )


def test_end_interpolation_accepts_real_source_gap_of_exactly_fifteen_minutes():
    # 115 at 7 and 130 at 13 still interpolate to 9 at minute 120.
    result = analyze_meal(
        interpolation_records(after_minutes=130, after_value=13), MEAL_AT
    )
    assert result.iauc_mmol_l_min == pytest.approx(25)


def test_same_time_same_value_deduplicated_before_baseline_mean():
    readings = [record(-15, 4, "b"), record(-5, 6), record(-15, 4, "a")]
    result = analyze_meal(readings + regular_post_records(), MEAL_AT)
    assert result.baseline_mmol_l == pytest.approx(5)
    assert result.iauc_mmol_l_min == pytest.approx(225)


@pytest.mark.parametrize("ids", [(None, None), ("same", "same"), ("a", "b")])
def test_identical_post_measurements_deduplicated_regardless_of_source_id(ids):
    readings = complete_records() + [record(30, 7, ids[0]), record(30, 7, ids[1])]
    forward = analyze_meal(readings, MEAL_AT)
    backward = analyze_meal(reversed(readings), MEAL_AT)
    assert forward == backward
    assert forward.iauc_mmol_l_min == pytest.approx(225)
    assert forward.reading_count == 9


def test_reused_source_id_at_distinct_times_does_not_discard_measurements():
    readings = [
        GlucoseRecord(item.measured_at, item.value_mmol_l, "reused-id")
        for item in complete_records()
    ]
    result = analyze_meal(readings, MEAL_AT)
    assert result.reading_count == 9
    assert result.iauc_mmol_l_min == pytest.approx(225)


@pytest.mark.parametrize("minute", [-15, 0, 30, 120])
def test_same_timestamp_different_glucose_is_rejected(minute):
    readings = complete_records() + [record(minute, 5), record(minute, 6)]
    assert_policy_error("CONFLICTING_GLUCOSE_READINGS", readings)


def test_same_source_id_does_not_hide_conflicting_glucose():
    readings = complete_records() + [record(30, 7, "id"), record(30, 8, "id")]
    assert_policy_error("CONFLICTING_GLUCOSE_READINGS", readings)


def test_float_rounding_does_not_hide_conflicting_integer_values():
    # These distinct valid numbers round to the same float; compare first.
    readings = complete_records() + [record(1, 2**53), record(1, 2**53 + 1)]
    assert_policy_error("CONFLICTING_GLUCOSE_READINGS", readings)


@pytest.mark.parametrize(
    "value", [float("nan"), float("inf"), -float("inf"), "5", None, True, 5j]
)
def test_invalid_glucose_values_are_rejected(value):
    assert_policy_error("INVALID_GLUCOSE_DATA", complete_records() + [record(1, value)])


def test_invalid_baseline_value_is_rejected_instead_of_silently_skipped():
    readings = [record(-15, 5), record(-10, float("nan")), record(-5, 5)]
    assert_policy_error("INVALID_GLUCOSE_DATA", readings + regular_post_records())


def test_invalid_out_of_window_data_is_rejected_during_normalization():
    readings = complete_records() + [record(200, float("inf"))]
    assert_policy_error("INVALID_GLUCOSE_DATA", readings)


@pytest.mark.parametrize(
    "timestamp",
    [
        datetime(2026, 9, 14, 12),
        datetime(2026, 9, 14, 12, tzinfo=timezone(timedelta(hours=12))),
        "2026-09-14T12:00:00Z",
        None,
    ],
)
@pytest.mark.parametrize("location", ["reading", "meal", "other_meal"])
def test_all_timestamp_inputs_require_aware_utc_datetimes(timestamp, location):
    readings = complete_records()
    meal_at = MEAL_AT
    other_meals = []
    if location == "reading":
        readings.append(GlucoseRecord(timestamp, 5))
    elif location == "meal":
        meal_at = timestamp
    else:
        other_meals.append(timestamp)
    assert_policy_error(
        "INVALID_GLUCOSE_DATA", readings, meal_at, other_meal_times=other_meals
    )


@pytest.mark.parametrize("offset", [0.001, 70, 119.999])
def test_other_meal_strictly_inside_window_is_rejected(offset):
    assert_policy_error(
        "OVERLAPPING_MEAL",
        complete_records(),
        other_meal_times=[MEAL_AT + timedelta(minutes=offset)],
    )


@pytest.mark.parametrize("offset", [-1, 0, 120, 121])
def test_other_meal_outside_open_interval_does_not_overlap(offset):
    result = analyze_meal(
        complete_records(),
        MEAL_AT,
        other_meal_times=[MEAL_AT + timedelta(minutes=offset)],
    )
    assert result.iauc_mmol_l_min == pytest.approx(225)


def test_below_baseline_portions_do_not_subtract_from_positive_area():
    readings = baseline_records() + [record(10, 7), record(20, 5)]
    readings += [record(minute, 3) for minute in range(30, 121, 10)]
    result = analyze_meal(readings, MEAL_AT)
    # 0..10 and 10..20 form two triangles, each 10 * 2 / 2 = 10.
    # Everything from 20 onward contributes zero, not negative area.
    assert result.iauc_mmol_l_min == pytest.approx(20)


def test_asymmetric_baseline_crossing_uses_positive_portion_only():
    readings = baseline_records() + [record(9, 3), record(18, 9), record(27, 5)]
    readings += [record(minute, 5) for minute in [42, 57, 72, 87, 102, 117, 120]]
    result = analyze_meal(readings, MEAL_AT)
    # 9..18 crosses from increment -2 to +4. Positive triangle: 6 * 4 / 2 = 12.
    # 18..27 declines from +4 to 0: 9 * 4 / 2 = 18. Total 30.
    # Clamping the crossing's negative endpoint would incorrectly produce 36.
    assert result.iauc_mmol_l_min == pytest.approx(30)


@pytest.mark.parametrize("post_value", [3, 5])
def test_genuine_zero_succeeds_and_is_distinct_from_missing_data(post_value):
    result = analyze_meal(complete_records(post_value), MEAL_AT)
    assert isinstance(result, MealAnalysisResult)
    assert result.iauc_mmol_l_min == pytest.approx(0)
    assert_policy_error("WAITING_FOR_GLUCOSE_DATA", baseline_records())


def test_unsorted_input_records_and_meal_timestamps_are_not_mutated():
    readings = list(reversed(complete_records() + [record(30, 7, "duplicate")]))
    other_meals = [MEAL_AT + timedelta(minutes=180), MEAL_AT - timedelta(minutes=5)]
    original_records = tuple(readings)
    original_values = [
        (item.measured_at, item.value_mmol_l, item.source_record_id) for item in readings
    ]
    original_meals = tuple(other_meals)

    result = analyze_meal(readings, MEAL_AT, other_meal_times=other_meals)

    assert result.iauc_mmol_l_min == pytest.approx(225)
    assert tuple(readings) == original_records
    assert all(current is original for current, original in zip(readings, original_records))
    assert [
        (item.measured_at, item.value_mmol_l, item.source_record_id) for item in readings
    ] == original_values
    assert tuple(other_meals) == original_meals
    assert all(current is original for current, original in zip(other_meals, original_meals))


def test_accepts_one_pass_iterables_for_records_and_other_meals():
    result = analyze_meal(
        (item for item in reversed(complete_records())),
        MEAL_AT,
        other_meal_times=(MEAL_AT + timedelta(minutes=minute) for minute in [120, 180]),
    )
    assert result.iauc_mmol_l_min == pytest.approx(225)


def test_delegates_prepared_points_to_existing_numerical_service(monkeypatch):
    original_calculate = meal_analysis.calculate_incremental_auc
    calls = []

    def capture_calculation(readings, baseline_mmol_l, *, below_baseline_policy):
        points = tuple(readings)
        calls.append((points, baseline_mmol_l, below_baseline_policy))
        return original_calculate(
            points, baseline_mmol_l, below_baseline_policy=below_baseline_policy
        )

    monkeypatch.setattr(meal_analysis, "calculate_incremental_auc", capture_calculation)
    result = analyze_meal(interpolation_records() + [record(0, 100, "real-start")], MEAL_AT)

    assert result.iauc_mmol_l_min == pytest.approx(25)
    assert len(calls) == 1
    points, baseline, mode = calls[0]
    assert mode == "positive_only"
    assert baseline == pytest.approx(5)
    assert all(isinstance(point, GlucoseReading) for point in points)
    assert points[0] == GlucoseReading(MEAL_AT, 5)
    assert points[-1] == GlucoseReading(MEAL_AT + timedelta(minutes=120), 9)
    assert [point.measured_at for point in points] == sorted(
        {point.measured_at for point in points}
    )
    assert all(MEAL_AT <= point.measured_at <= MEAL_AT + timedelta(minutes=120) for point in points)
    assert not hasattr(points[0], "source_record_id")
    assert not hasattr(points[-1], "source_record_id")
    assert result.reading_count == len(points) == 10
