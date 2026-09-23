"""Stateless orchestration: validated input -> meal policy -> mock feedback."""

from datetime import UTC, datetime

from ..schemas import AnalysisRequest, AnalysisResult
from . import llm_service, meal_analysis


def create_analysis(data: AnalysisRequest) -> AnalysisResult:
    readings = [
        meal_analysis.GlucoseRecord(
            measured_at=reading.measured_at,
            value_mmol_l=reading.value_mmol_l,
            source_record_id=reading.source_record_id,
        )
        for reading in data.readings
    ]
    # Baseline, boundaries, coverage, and calculation metadata remain entirely
    # owned by the meal policy. Failed policy checks must not invoke the LLM.
    calculation = meal_analysis.analyze_meal(
        readings, data.meal_at, other_meal_times=data.other_meal_times
    )
    feedback = llm_service.generate_feedback(
        data.food_info, calculation.iauc_mmol_l_min
    )
    # Validate the outgoing result, including the provider-neutral feedback.
    # Do not add internal policy metadata to the public response contract.
    return AnalysisResult(
        meal_id=data.meal_id,
        computed_at=datetime.now(UTC),
        iauc_mmol_l_min=calculation.iauc_mmol_l_min,
        feedback=feedback,
    )
