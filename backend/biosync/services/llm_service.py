"""Deterministic development mock, not a real LLM integration.

This provider-neutral function performs no network access. Replace its
implementation when real LLM integration is authorized; keep the feedback
structure stable. Its text is illustrative, not individualized advice.
"""

from ..schemas import FoodInfo


def generate_feedback(
    food_info: FoodInfo, iauc_mmol_l_min: float
) -> dict[str, str | list[str]]:
    names = ", ".join(item.name for item in food_info.items)
    return {
        "summary": (
            f"Development mock: recorded foods: {names}. "
            f"Calculated iAUC: {iauc_mmol_l_min:.2f} (mmol/L)·min."
        ),
        "suggestions": [],
        "limitations": [
            "Deterministic development mock; no external LLM was called.",
            "This feedback is non-diagnostic and does not establish food causation.",
        ],
    }
