"""Select explicit real-provider mode or deterministic offline feedback."""

import os

from ..schemas import FoodInfo
from . import openai_provider
from .llm_types import AnalysisContext, LLMServiceError


# Fixed interpretation context for this prototype, not a client/profile setting.
PROTOTYPE_GOAL = "weight loss"
INTERPRETATION_LIMITATIONS = [
    "This assessment focuses on the post-meal glucose response rather than every aspect of nutrition.",
]


def generate_feedback(
    food_info: FoodInfo, iauc_mmol_l_min: float, *, analysis_context: AnalysisContext
) -> dict[str, str | list[str]]:
    mode = os.getenv("BIOSYNC_LLM_MODE", "mock").strip().lower() or "mock"
    if mode == "openai":
        # Explicit whitelist: never serialize AnalysisRequest or glucose records.
        context = {
            "goal": PROTOTYPE_GOAL,
            "food_items": [
                {"name": item.name, **({"weight_g": item.weight_g} if item.weight_g is not None else {})}
                for item in food_info.items
            ],
            "iauc_mmol_l_min": iauc_mmol_l_min,
            "iauc_unit": "(mmol/L)·min",
            "analysis_context": {
                "policy_version": analysis_context.policy_version,
                "postprandial_duration_minutes": analysis_context.analysis_duration_minutes,
                "baseline_duration_minutes": analysis_context.baseline_duration_minutes,
                "interpretation": "Incremental area above the pre-meal baseline, calculated by the backend; below-baseline area is excluded.",
            },
            "limitations": list(INTERPRETATION_LIMITATIONS),
        }
        return openai_provider.generate_feedback(context)
    if mode != "mock":
        raise LLMServiceError("LLM_CONFIGURATION_ERROR")
    return _mock_feedback(food_info, iauc_mmol_l_min)


def _mock_feedback(food_info: FoodInfo, iauc_mmol_l_min: float):
    """Illustrative text only; no provider call, credentials or fallback."""
    names = ", ".join(item.name for item in food_info.items)
    return {
        "summary": (
            f"Development mock: {names} had a postprandial glucose iAUC of "
            f"{iauc_mmol_l_min:.2f} (mmol/L)·min, a reference for the next meal comparison."
        ),
        "suggestions": [
            f"For the {PROTOTYPE_GOAL} goal, try a smaller starchy component where present, retaining vegetables and protein-rich foods.",
            "Compare the same meal under similar conditions after changing one component.",
        ],
        "limitations": [
            "Deterministic development mock; no external LLM was called.",
        ],
    }
