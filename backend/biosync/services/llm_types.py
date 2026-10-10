"""Provider-neutral feedback context and sanitized service errors."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class AnalysisContext:
    """Derived metadata only; no meal identifiers or glucose records."""

    policy_version: str
    analysis_duration_minutes: float
    baseline_duration_minutes: float


# Status, safe public message, whether an unchanged retry may succeed.
_ERRORS = {
    "LLM_CONFIGURATION_ERROR": (500, "Dietary feedback is not configured correctly on the backend.", False),
    "LLM_AUTHENTICATION_ERROR": (502, "The dietary feedback provider rejected backend credentials or access.", False),
    "UPSTREAM_TIMEOUT": (504, "The dietary feedback provider did not respond in time.", True),
    "LLM_NETWORK_ERROR": (502, "The backend could not connect to the dietary feedback provider.", True),
    "LLM_RATE_LIMITED": (503, "The dietary feedback provider is temporarily rate limited. Try again later.", True),
    "LLM_INVALID_RESPONSE": (502, "The dietary feedback provider did not return valid feedback.", False),
    "UPSTREAM_FAILURE": (502, "The dietary feedback provider is temporarily unavailable.", True),
}


class LLMServiceError(Exception):
    """Only fixed messages reach HTTP; never include provider exception text."""

    def __init__(self, code: str) -> None:
        self.code = code
        self.status, message, self.retryable = _ERRORS[code]
        super().__init__(message)
