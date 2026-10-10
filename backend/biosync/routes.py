"""Thin HTTP adapter for analysis; no scientific or numerical logic."""

from flask import Blueprint, current_app, jsonify, request
from pydantic import ValidationError
from werkzeug.exceptions import BadRequest

from .schemas import AnalysisRequest
from .services import analysis_service
from .services.meal_analysis import MealAnalysisPolicyError
from .services.llm_types import LLMServiceError


analyses = Blueprint("analyses", __name__)

_POLICY_MESSAGES = {
    "INSUFFICIENT_BASELINE_DATA": "There are not enough baseline readings.",
    "WAITING_FOR_GLUCOSE_DATA": "Glucose data do not yet cover the analysis endpoint.",
    "INSUFFICIENT_GLUCOSE_DATA": "Glucose coverage does not meet the analysis policy.",
    "CONFLICTING_GLUCOSE_READINGS": "Conflicting glucose readings were supplied.",
    "OVERLAPPING_MEAL": "Another meal overlaps the analysis window.",
    "INVALID_GLUCOSE_DATA": "Glucose data cannot be used for this analysis.",
}


def _error(status: int, code: str, message: str, *, retryable: bool = False):
    return jsonify(error={"code": code, "message": message, "retryable": retryable}), status


def _internal_error():
    return _error(500, "INTERNAL_ERROR", "The analysis could not be completed.")


@analyses.post("/v1/analyses")
def post_analysis():
    if request.mimetype != "application/json":
        return _error(415, "UNSUPPORTED_MEDIA_TYPE", "Use Content-Type: application/json.")
    try:
        data = AnalysisRequest.model_validate(request.get_json())
    except (BadRequest, ValidationError):
        return _error(400, "INVALID_REQUEST", "The request does not match the analysis contract.")

    try:
        result = analysis_service.create_analysis(data)
        return jsonify(result.model_dump(mode="json")), 200
    except MealAnalysisPolicyError as exc:
        if exc.code not in _POLICY_MESSAGES:
            return _internal_error()
        return _error(
            422,
            exc.code,
            _POLICY_MESSAGES[exc.code],
            retryable=exc.code == "WAITING_FOR_GLUCOSE_DATA",
        )
    except LLMServiceError as exc:
        return _error(exc.status, exc.code, str(exc), retryable=exc.retryable)
    except Exception as exc:
        # Validation of server-produced feedback/results also belongs here,
        # not in the 400 request-validation branch. Never return exception text.
        # Exception messages/tracebacks can contain request or provider data.
        current_app.logger.error("analysis_internal_failure type=%s", type(exc).__name__)
        return _internal_error()
