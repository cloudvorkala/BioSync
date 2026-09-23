"""Provider-neutral API transport schemas, without meal-science rules."""

from datetime import datetime, timedelta
from math import isfinite
import re
from typing import Annotated
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    field_validator,
)


def _parse_utc_timestamp(value: object) -> datetime:
    # API_CONTRACTS.md requires the Z suffix; do not accept epoch numbers,
    # naive times, offsets, or implicitly convert local times to UTC.
    if not isinstance(value, str) or not re.fullmatch(
        r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z",
        value,
    ):
        raise ValueError("Expected a UTC ISO 8601 timestamp ending in Z")
    return datetime.fromisoformat(value)


def _parse_uuid(value: object) -> UUID:
    if not isinstance(value, str):
        raise ValueError("Expected a UUID string")
    return UUID(value)


def _finite_number(value: object) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("Expected a finite JSON number")
    try:
        finite = isfinite(value)
    except OverflowError as exc:
        raise ValueError("Number exceeds the supported numeric range") from exc
    if not finite:
        raise ValueError("Expected a finite JSON number")
    # Retain integer precision so schema coercion cannot hide conflicting
    # same-time readings before policy-layer duplicate normalization.
    return value


def _require_utc(value: datetime) -> datetime:
    if value.utcoffset() != timedelta(0):
        raise ValueError("Expected a timezone-aware UTC datetime")
    return value


RequestTimestamp = Annotated[datetime, BeforeValidator(_parse_utc_timestamp)]
FiniteNumber = Annotated[int | float, BeforeValidator(_finite_number)]


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class FoodItem(ContractModel):
    name: Annotated[str, Field(min_length=1)]
    confidence: Annotated[FiniteNumber, Field(ge=0, le=1)] | None = None

    @field_validator("confidence", mode="before")
    @classmethod
    def confidence_if_present(cls, value: object) -> int | float:
        # Omission is allowed; an explicitly supplied null is not a number.
        return _finite_number(value)


class FoodInfo(ContractModel):
    recognized_at: RequestTimestamp
    items: Annotated[list[FoodItem], Field(min_length=1)]


class GlucoseReading(ContractModel):
    """Full transport record, separate from the internal numerical dataclass."""

    source: str
    source_record_id: str
    measured_at: RequestTimestamp
    value_mmol_l: FiniteNumber


class AnalysisRequest(ContractModel):
    meal_id: Annotated[UUID, BeforeValidator(_parse_uuid)]
    meal_at: RequestTimestamp
    food_info: FoodInfo
    # Includes baseline data and postprandial coverage. Sufficiency is policy.
    readings: list[GlucoseReading]
    other_meal_times: list[RequestTimestamp] = Field(default_factory=list)


class Feedback(ContractModel):
    summary: str
    suggestions: list[str]
    limitations: list[str]


class AnalysisResult(ContractModel):
    meal_id: UUID
    computed_at: Annotated[datetime, AfterValidator(_require_utc)]
    iauc_mmol_l_min: FiniteNumber
    feedback: Feedback
