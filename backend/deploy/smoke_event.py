"""Synthetic offline deployment data only; never included in the Lambda ZIP."""

from datetime import UTC, datetime, timedelta
import json


def fixture():
    meal = datetime(2026, 9, 23, 12, tzinfo=UTC)
    def timestamp(minute):
        return (meal + timedelta(minutes=minute)).isoformat().replace("+00:00", "Z")
    values = [(-15, 4), (-5, 6)] + [(minute, 7) for minute in range(15, 121, 15)]
    return {
        "meal_id": "53243736-8e46-441c-90ba-d1a922e7b8ad",
        "meal_at": timestamp(0),
        "food_info": {"recognized_at": timestamp(1), "items": [{"name": "Rice"}, {"name": "Broccoli"}]},
        "readings": [{"source": "development_fixture", "source_record_id": f"deploy-test-{minute}",
                      "measured_at": timestamp(minute), "value_mmol_l": value} for minute, value in values],
        "other_meal_times": [],
    }


def event(path, method="GET", body=None):
    """API Gateway REST proxy payload v1; event.path excludes the stage."""
    return {
        "resource": "/" if path == "/" else "/{proxy+}", "path": path,
        "httpMethod": method,
        "headers": {"Host": "example.execute-api.ap-southeast-2.amazonaws.com", "Content-Type": "application/json", "X-Forwarded-Proto": "https"},
        "multiValueHeaders": None, "queryStringParameters": None,
        "multiValueQueryStringParameters": None,
        "pathParameters": {"proxy": path.lstrip("/")} if path != "/" else None,
        "requestContext": {"stage": "demo", "identity": {"sourceIp": "127.0.0.1"}},
        "body": json.dumps(body) if body is not None else None, "isBase64Encoded": False,
    }
