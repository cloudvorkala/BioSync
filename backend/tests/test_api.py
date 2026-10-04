"""Analysis HTTP contract tests; Flask test client only, no external services.

Run from backend/: python -B -m pytest -p no:cacheprovider -q -s
"""

from copy import deepcopy
from datetime import UTC, datetime, timedelta
import json

import pytest

from biosync.app import create_app
from biosync.schemas import FoodInfo
from biosync.services import analysis_service, llm_service, meal_analysis


MEAL_AT = datetime(2026, 9, 23, 12, tzinfo=UTC)
COMPUTED_AT = datetime(2026, 9, 23, 15, 0, 0, 123456, tzinfo=UTC)
MEAL_ID = "53243736-8e46-441c-90ba-d1a922e7b8ad"
ENDPOINT = "/v1/analyses"


def timestamp(minutes=0):
    return (MEAL_AT + timedelta(minutes=minutes)).isoformat().replace("+00:00", "Z")


def reading(minutes, value):
    return {
        "source": "health_connect",
        "source_record_id": f"reading-{minutes}",
        "measured_at": timestamp(minutes),
        "value_mmol_l": value,
    }


@pytest.fixture
def payload():
    return {
        "meal_id": MEAL_ID,
        "meal_at": timestamp(),
        "food_info": {
            "recognized_at": timestamp(1),
            "items": [{"name": "Rice", "confidence": 0.9}, {"name": "Broccoli"}],
        },
        "readings": [reading(-15, 4), reading(-5, 6)]
        + [reading(minute, 7) for minute in range(15, 121, 15)],
    }


@pytest.fixture
def client(monkeypatch):
    class FixedClock:
        @staticmethod
        def now(tz):
            assert tz is UTC
            return COMPUTED_AT

    monkeypatch.setattr(analysis_service, "datetime", FixedClock)
    app = create_app()
    app.config.update(TESTING=True)
    return app.test_client()


def assert_error(response, status, code, retryable=False):
    assert response.status_code == status
    assert response.mimetype == "application/json"
    body = response.get_json()
    assert set(body) == {"error"}
    error = body["error"]
    assert set(error) == {"code", "message", "retryable"}
    assert error["code"] == code
    assert isinstance(error["message"], str) and error["message"]
    assert error["retryable"] is retryable
    return body


def at_path(body, path):
    for part in path:
        body = body[part]
    return body


def test_valid_request_returns_complete_contract_and_deterministic_mock(client, payload):
    response = client.post(ENDPOINT, json=payload)
    assert response.status_code == 200
    assert response.mimetype == "application/json"
    body = response.get_json()
    assert set(body) == {"meal_id", "computed_at", "iauc_mmol_l_min", "feedback"}
    assert body["meal_id"] == MEAL_ID
    # Baseline mean (4+6)/2 = 5. Start triangle 15 + 105 minutes * 2 = 225.
    assert body["iauc_mmol_l_min"] == pytest.approx(225)
    assert body["computed_at"] == "2026-09-23T15:00:00.123456Z"
    assert datetime.fromisoformat(body["computed_at"]).utcoffset() == timedelta(0)
    assert body["feedback"] == {
        "summary": (
            "Development mock: recorded foods: Rice, Broccoli. "
            "Calculated iAUC: 225.00 (mmol/L)·min."
        ),
        "suggestions": [],
        "limitations": [
            "Deterministic development mock; no external LLM was called.",
            "This feedback is non-diagnostic and does not establish food causation.",
        ],
    }
    assert client.post(ENDPOINT, json=payload).get_json() == body


@pytest.mark.parametrize("body", ["{", "", '{"meal_id": }', "null", "[]", "42"])
def test_malformed_json_or_nonobject_request(client, body):
    assert_error(
        client.post(ENDPOINT, data=body, content_type="application/json"),
        400, "INVALID_REQUEST",
    )


@pytest.mark.parametrize("content_type", [None, "text/plain", "application/problem+json"])
def test_wrong_content_type_returns_documented_media_error(client, payload, content_type):
    assert_error(
        client.post(ENDPOINT, data=json.dumps(payload), content_type=content_type),
        415, "UNSUPPORTED_MEDIA_TYPE",
    )


@pytest.mark.parametrize("path", [
    ("meal_id",), ("meal_at",), ("food_info",), ("readings",),
    ("food_info", "recognized_at"), ("food_info", "items"),
    ("food_info", "items", 0, "name"),
    ("readings", 0, "source"), ("readings", 0, "source_record_id"),
    ("readings", 0, "measured_at"), ("readings", 0, "value_mmol_l"),
])
def test_required_transport_fields(client, payload, path):
    del at_path(payload, path[:-1])[path[-1]]
    assert_error(client.post(ENDPOINT, json=payload), 400, "INVALID_REQUEST")


@pytest.mark.parametrize("value", ["not-a-uuid", "", 42, True, None])
def test_invalid_meal_id(client, payload, value):
    payload["meal_id"] = value
    assert_error(client.post(ENDPOINT, json=payload), 400, "INVALID_REQUEST")


@pytest.mark.parametrize("path", [
    ("meal_at",), ("food_info", "recognized_at"),
    ("readings", 0, "measured_at"), ("other_meal_times", 0),
])
@pytest.mark.parametrize("value", [
    "2026-09-23T12:00:00+12:00", "2026-09-23T12:00:00", 1790164800,
    "2026-09-23T12:00:00+00:00", "2026-02-30T12:00:00Z", None,
])
def test_timestamps_require_valid_utc_z_strings(client, payload, path, value):
    payload["other_meal_times"] = [timestamp(120)]
    at_path(payload, path[:-1])[path[-1]] = value
    assert_error(client.post(ENDPOINT, json=payload), 400, "INVALID_REQUEST")


def test_fractional_seconds_and_json_charset_are_accepted(client, payload):
    payload["food_info"]["recognized_at"] = "2026-09-23T12:01:00.123456Z"
    response = client.post(
        ENDPOINT, data=json.dumps(payload), content_type="application/json; charset=utf-8"
    )
    assert response.status_code == 200


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -float("inf"), "7", True, None, {}])
def test_invalid_glucose_values(client, payload, value):
    payload["readings"][0]["value_mmol_l"] = value
    assert_error(client.post(ENDPOINT, json=payload), 400, "INVALID_REQUEST")


@pytest.mark.parametrize("field", ["readings", "other_meal_times"])
@pytest.mark.parametrize("value", [None, {}, "not-an-array", 42])
def test_array_types_are_required(client, payload, field, value):
    payload[field] = value
    assert_error(client.post(ENDPOINT, json=payload), 400, "INVALID_REQUEST")


@pytest.mark.parametrize("field", ["source", "source_record_id"])
@pytest.mark.parametrize("value", [None, 123, True])
def test_source_fields_are_required_strings(client, payload, field, value):
    payload["readings"][0][field] = value
    assert_error(client.post(ENDPOINT, json=payload), 400, "INVALID_REQUEST")


def test_wrong_glucose_unit_field_is_rejected(client, payload):
    item = payload["readings"][0]
    item["value_mg_dl"] = item.pop("value_mmol_l")
    assert_error(client.post(ENDPOINT, json=payload), 400, "INVALID_REQUEST")


@pytest.mark.parametrize("value", [-0.1, 1.1, "0.9", True, None, float("nan")])
def test_confidence_must_be_numeric_in_range_when_supplied(client, payload, value):
    payload["food_info"]["items"][0]["confidence"] = value
    assert_error(client.post(ENDPOINT, json=payload), 400, "INVALID_REQUEST")


@pytest.mark.parametrize("weight", [0.1, 350, 350.5, 1000000])
def test_optional_weight_is_accepted_and_never_changes_iauc(client, payload, weight):
    without_weight = client.post(ENDPOINT, json=payload)
    payload["food_info"]["items"][0]["weight_g"] = weight
    with_weight = client.post(ENDPOINT, json=payload)
    assert without_weight.status_code == with_weight.status_code == 200
    assert without_weight.json["iauc_mmol_l_min"] == with_weight.json["iauc_mmol_l_min"] == 225
    # Mock output and the public result contract remain backward compatible.
    assert with_weight.json == without_weight.json


@pytest.mark.parametrize("weight", [
    0, -0.0, -1, float("nan"), float("inf"), -float("inf"),
    "350", "", True, False, None, [], {}, 10**400,
])
def test_invalid_weight_is_rejected_before_analysis(client, payload, monkeypatch, weight):
    def forbidden(*args, **kwargs):
        pytest.fail("Invalid weight reached the analysis service")

    monkeypatch.setattr(analysis_service, "create_analysis", forbidden)
    payload["food_info"]["items"][0]["weight_g"] = weight
    assert_error(client.post(ENDPOINT, json=payload), 400, "INVALID_REQUEST")


@pytest.mark.parametrize("items", [[], [{"name": ""}], [{"name": 7}], "Rice"])
def test_food_info_requires_nonempty_food_labels(client, payload, items):
    payload["food_info"]["items"] = items
    assert_error(client.post(ENDPOINT, json=payload), 400, "INVALID_REQUEST")


@pytest.mark.parametrize("field", [
    "iauc_mmol_l_min", "iauc", "baseline_mmol_l", "image_uri", "cv_response",
    "feedback", "llm_output",
])
def test_client_cannot_submit_calculations_or_provider_outputs(client, payload, field):
    payload[field] = "untrusted-client-value"
    assert_error(client.post(ENDPOINT, json=payload), 400, "INVALID_REQUEST")


@pytest.mark.parametrize("path", [("food_info",), ("food_info", "items", 0), ("readings", 0)])
def test_unknown_nested_fields_are_rejected(client, payload, path):
    at_path(payload, path)["provider_payload"] = {"raw": "private"}
    assert_error(client.post(ENDPOINT, json=payload), 400, "INVALID_REQUEST")


def test_insufficient_baseline_is_policy_error_not_schema_error(client, payload):
    payload["readings"].pop(0)
    assert_error(client.post(ENDPOINT, json=payload), 422, "INSUFFICIENT_BASELINE_DATA")


def test_empty_readings_reach_policy_layer(client, payload):
    payload["readings"] = []
    assert_error(client.post(ENDPOINT, json=payload), 422, "INSUFFICIENT_BASELINE_DATA")


def test_missing_endpoint_is_waiting_and_retryable(client, payload):
    payload["readings"].pop()
    assert_error(client.post(ENDPOINT, json=payload), 422, "WAITING_FOR_GLUCOSE_DATA", True)


def test_endpoint_without_postprandial_coverage_is_insufficient(client, payload):
    payload["readings"] = payload["readings"][:2] + payload["readings"][-1:]
    assert_error(client.post(ENDPOINT, json=payload), 422, "INSUFFICIENT_GLUCOSE_DATA")


def test_gap_over_fifteen_minutes_is_policy_error(client, payload):
    payload["readings"] = [r for r in payload["readings"] if r["measured_at"] != timestamp(30)]
    assert_error(client.post(ENDPOINT, json=payload), 422, "INSUFFICIENT_GLUCOSE_DATA")


def test_conflicting_readings_are_policy_error(client, payload):
    payload["readings"].append(reading(15, 8))
    assert_error(client.post(ENDPOINT, json=payload), 422, "CONFLICTING_GLUCOSE_READINGS")


def test_schema_preserves_distinct_integer_measurements_for_conflict_detection(client, payload):
    payload["readings"] += [reading(1, 2**53), reading(1, 2**53 + 1)]
    assert_error(client.post(ENDPOINT, json=payload), 422, "CONFLICTING_GLUCOSE_READINGS")


def test_policy_invalid_data_error_is_mapped_without_internal_details(client, payload):
    # Valid UTC transport timestamp, but the required policy window underflows.
    payload["meal_at"] = "0001-01-01T00:00:00Z"
    response = client.post(ENDPOINT, json=payload)
    assert_error(response, 422, "INVALID_GLUCOSE_DATA")
    assert "OverflowError" not in response.get_data(as_text=True)


def test_overlapping_meal_is_policy_error(client, payload):
    payload["other_meal_times"] = [timestamp(70)]
    assert_error(client.post(ENDPOINT, json=payload), 422, "OVERLAPPING_MEAL")


def test_meal_at_exact_endpoint_is_valid(client, payload):
    payload["other_meal_times"] = [timestamp(120)]
    response = client.post(ENDPOINT, json=payload)
    assert response.status_code == 200
    assert response.get_json()["iauc_mmol_l_min"] == pytest.approx(225)


def test_genuine_zero_is_success(client, payload):
    for item in payload["readings"]:
        item["value_mmol_l"] = 5
    response = client.post(ENDPOINT, json=payload)
    assert response.status_code == 200
    assert response.get_json()["iauc_mmol_l_min"] == 0
    assert "feedback" in response.get_json()


def test_same_meal_id_uses_supplied_data_without_backend_state(client, payload):
    assert client.post(ENDPOINT, json=payload).get_json()["iauc_mmol_l_min"] == 225
    for item in payload["readings"]:
        item["value_mmol_l"] = 5
    payload["food_info"]["items"] = [{"name": "Lentils"}]
    response = client.post(ENDPOINT, json=payload)
    assert response.status_code == 200
    assert response.get_json()["iauc_mmol_l_min"] == 0
    assert "Lentils" in response.get_json()["feedback"]["summary"]


def test_policy_runs_before_feedback_with_converted_inputs(client, payload, monkeypatch):
    events = []
    original_policy = meal_analysis.analyze_meal
    original_feedback = llm_service.generate_feedback
    before = deepcopy(payload)

    def policy(readings, meal_at, *, other_meal_times):
        assert all(isinstance(item, meal_analysis.GlucoseRecord) for item in readings)
        assert readings[0].measured_at == MEAL_AT - timedelta(minutes=15)
        assert readings[0].source_record_id == "reading--15"
        assert meal_at == MEAL_AT
        assert other_meal_times == []
        result = original_policy(readings, meal_at, other_meal_times=other_meal_times)
        events.append(("policy", result.baseline_mmol_l, result.policy_version))
        return result

    def feedback(food_info, iauc, **kwargs):
        assert isinstance(food_info, FoodInfo)
        assert [item.name for item in food_info.items] == ["Rice", "Broccoli"]
        assert events == [("policy", 5, "biosync-iauc-v1")]
        events.append(("mock", iauc))
        return original_feedback(food_info, iauc, **kwargs)

    monkeypatch.setattr(meal_analysis, "analyze_meal", policy)
    monkeypatch.setattr(llm_service, "generate_feedback", feedback)
    assert client.post(ENDPOINT, json=payload).status_code == 200
    assert events[-1] == ("mock", 225)
    assert payload == before


@pytest.mark.parametrize("failure", ["schema", "policy"])
def test_feedback_is_not_called_for_invalid_requests(client, payload, monkeypatch, failure):
    calls = []
    monkeypatch.setattr(llm_service, "generate_feedback", lambda *args, **kwargs: calls.append(args))
    if failure == "schema":
        del payload["meal_id"]
        status, code = 400, "INVALID_REQUEST"
    else:
        payload["readings"] = []
        status, code = 422, "INSUFFICIENT_BASELINE_DATA"
    assert_error(client.post(ENDPOINT, json=payload), status, code)
    assert calls == []


@pytest.mark.parametrize("feedback", [
    {"summary": "missing arrays"},
    {"summary": 42, "suggestions": [], "limitations": []},
    {"summary": "text", "suggestions": [], "limitations": [], "raw_provider": "private"},
])
def test_invalid_mock_response_is_internal_error_not_bad_client_request(client, payload, monkeypatch, feedback):
    monkeypatch.setattr(llm_service, "generate_feedback", lambda *args, **kwargs: feedback)
    response = client.post(ENDPOINT, json=payload)
    body = assert_error(response, 500, "INTERNAL_ERROR")
    assert body["error"]["message"] == "The analysis could not be completed."
    assert "private" not in response.get_data(as_text=True)


def test_unexpected_error_is_sanitized(client, payload, monkeypatch):
    def fail(*args, **kwargs):
        raise RuntimeError("private-internal-details")

    monkeypatch.setattr(llm_service, "generate_feedback", fail)
    response = client.post(ENDPOINT, json=payload)
    assert_error(response, 500, "INTERNAL_ERROR")
    assert "private-internal-details" not in response.get_data(as_text=True)
    assert "Traceback" not in response.get_data(as_text=True)


def test_invalid_server_timestamp_is_rejected_by_response_schema(client, payload, monkeypatch):
    class NaiveClock:
        @staticmethod
        def now(tz):
            return datetime(2026, 9, 23, 15)

    monkeypatch.setattr(analysis_service, "datetime", NaiveClock)
    assert_error(client.post(ENDPOINT, json=payload), 500, "INTERNAL_ERROR")
