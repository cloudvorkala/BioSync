"""Offline REST API Gateway proxy tests of the real WSGI adapter and Flask app."""

import base64
from copy import deepcopy
import importlib
import json
from pathlib import Path
from zipfile import ZipFile

import pytest

import lambda_handler
from biosync.app import create_app
from biosync.services import analysis_service, llm_service
from biosync.services.llm_types import LLMServiceError
from deploy.smoke_event import event, fixture
from deploy.validate_package import inspect_archive


def body(response):
    assert response.get("isBase64Encoded") is False
    return json.loads(response["body"])


def test_lambda_import_and_factory_keep_identical_routes():
    imported = importlib.import_module("lambda_handler")
    assert imported.app.testing is False
    assert sorted(str(rule) for rule in imported.app.url_map.iter_rules()) == sorted(
        str(rule) for rule in create_app().url_map.iter_rules()
    ) == ["/health", "/v1/analyses"]


def test_health_local_and_lambda_do_not_require_provider(monkeypatch):
    monkeypatch.setenv("BIOSYNC_LLM_MODE", "openai")

    def forbidden(*args, **kwargs):
        pytest.fail("Health requested analysis/LLM")

    monkeypatch.setattr(analysis_service, "create_analysis", forbidden)
    assert create_app().test_client().get("/health").json == {"status": "ok"}
    result = lambda_handler.handler(event("/health"), None)
    assert result["statusCode"] == 200
    assert body(result) == {"status": "ok"}


@pytest.mark.parametrize("encoded,multi_headers", [(False, False), (True, False), (False, True)])
def test_analysis_fixture_through_real_proxy_adapter(encoded, multi_headers):
    request = event("/v1/analyses", "POST", fixture())
    if encoded:
        request["body"] = base64.b64encode(request["body"].encode()).decode()
        request["isBase64Encoded"] = True
    if multi_headers:
        request["multiValueHeaders"] = {key: [value] for key, value in request["headers"].items()}
    previous = deepcopy(request)
    result = lambda_handler.handler(request, None)
    second = lambda_handler.handler(request, None)
    assert request == previous
    assert result["statusCode"] == second["statusCode"] == 200
    output = body(result)
    assert output["meal_id"] == fixture()["meal_id"]
    assert output["iauc_mmol_l_min"] == 225
    assert output["computed_at"].endswith("Z")
    assert output["feedback"] == body(second)["feedback"]
    assert output["feedback"]["summary"].startswith("Development mock:")
    assert set(output) == {"meal_id", "computed_at", "iauc_mmol_l_min", "feedback"}


def test_deployment_fixture_matches_existing_mobile_curve():
    original = json.loads((Path(__file__).parents[2] / "mobile/src/dev/analysisFixture.json").read_text())
    current = fixture()
    for record in original["readings"]:
        record.pop("source_record_id")
    for record in current["readings"]:
        record.pop("source_record_id")
    assert original == current


@pytest.mark.parametrize("path,method,status", [("/", "GET", 404), ("/missing", "POST", 404), ("/v1/analyses", "GET", 405)])
def test_gateway_catchall_preserves_flask_routing(path, method, status):
    assert lambda_handler.handler(event(path, method), None)["statusCode"] == status


def test_invalid_transport_and_policy_errors_survive_proxy():
    invalid = event("/v1/analyses", "POST")
    invalid["body"] = "{"
    assert body(lambda_handler.handler(invalid, None))["error"]["code"] == "INVALID_REQUEST"
    request = fixture()
    request["readings"] = []
    result = lambda_handler.handler(event("/v1/analyses", "POST", request), None)
    assert result["statusCode"] == 422
    assert body(result)["error"]["code"] == "INSUFFICIENT_BASELINE_DATA"


def test_missing_key_uses_existing_error_and_safe_logging(monkeypatch, caplog):
    monkeypatch.setenv("BIOSYNC_LLM_MODE", "openai")
    monkeypatch.setenv("BIOSYNC_LLM_MODEL", "gpt-6-luna")
    result = lambda_handler.handler(event("/v1/analyses", "POST", fixture()), None)
    assert result["statusCode"] == 500
    assert body(result)["error"]["code"] == "LLM_CONFIGURATION_ERROR"
    assert body(result)["error"]["retryable"] is False
    assert "status=500 code=LLM_CONFIGURATION_ERROR" in caplog.text
    assert "source_record_id" not in caplog.text
    assert "deploy-test" not in caplog.text


@pytest.mark.parametrize("code,status", [("LLM_AUTHENTICATION_ERROR", 502), ("UPSTREAM_TIMEOUT", 504), ("LLM_RATE_LIMITED", 503)])
def test_provider_failures_are_logged_without_sensitive_data(monkeypatch, caplog, code, status):
    def fail(*args, **kwargs):
        raise LLMServiceError(code)
    monkeypatch.setattr(llm_service, "generate_feedback", fail)
    request = fixture()
    request["readings"][0]["source_record_id"] = "sensitive-health-id"
    result = lambda_handler.handler(event("/v1/analyses", "POST", request), None)
    assert result["statusCode"] == status
    assert f"status={status} code={code}" in caplog.text
    assert "sensitive-health-id" not in caplog.text


def test_unexpected_exception_message_is_neither_logged_nor_returned(monkeypatch, caplog):
    def fail(*args, **kwargs):
        raise RuntimeError("sensitive-credential-or-record-data")
    monkeypatch.setattr(llm_service, "generate_feedback", fail)
    result = lambda_handler.handler(event("/v1/analyses", "POST", fixture()), None)
    assert body(result)["error"]["code"] == "INTERNAL_ERROR"
    assert "type=RuntimeError" in caplog.text
    assert "sensitive-credential-or-record-data" not in caplog.text + result["body"]


def minimal_archive(path, *, extra=None, native_header=None):
    files = {name: b"" for name in ("lambda_handler.py", "biosync/app.py", "serverless_wsgi.py",
             "flask/__init__.py", "pydantic/__init__.py", "openai/__init__.py")}
    elf = native_header or (b"\x7fELF\x02\x01" + b"\x00" * 12 + b"\x3e\x00")
    files.update({"pydantic_core/core.so": elf, "jiter/jiter.so": elf})
    files.update(extra or {})
    with ZipFile(path, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)


@pytest.mark.parametrize("name", [".env", "biosync/.env.local", ".venv/lib/file", "tests/test_api.py", "x.pyd", "../escape", "__pycache__/x.pyc"])
def test_package_validation_rejects_secrets_dev_files_and_wrong_platform(tmp_path, name):
    path = tmp_path / "invalid.zip"
    minimal_archive(path, extra={name: b"should-not-ship"})
    with pytest.raises(ValueError, match="Forbidden"):
        inspect_archive(path)


def test_package_validation_rejects_non_linux_native_binary(tmp_path):
    path = tmp_path / "invalid.zip"
    minimal_archive(path, native_header=b"MZ-not-an-ELF-library")
    with pytest.raises(ValueError, match="Linux x86_64"):
        inspect_archive(path)


def test_package_validation_requires_root_handler(tmp_path):
    path = tmp_path / "invalid.zip"
    with ZipFile(path, "w") as archive:
        archive.writestr("package/lambda_handler.py", "")
    with pytest.raises(ValueError, match="missing required"):
        inspect_archive(path)
