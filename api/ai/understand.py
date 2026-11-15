"""One Gemini call that reads the conversation and returns what the user wants."""

from __future__ import annotations

import json
from typing import Literal

from pydantic import BaseModel, Field

from ai.llm import LLM

HISTORY_LIMIT = 8

Intent = Literal["find_data", "explain", "compare", "use_case_update", "other"]


class OtherParameter(BaseModel):
    name: str
    min: float | None = None
    max: float | None = None
    unit: str | None = None


class Conditions(BaseModel):
    o2_percent: float | None = None
    pressure_psi: float | None = None
    flow_cm_s: float | None = None
    gravity: Literal["microgravity", "partial", "normal"] | None = None
    fuel_phase: Literal["solid", "liquid", "gas"] | None = None
    materials: list[str] = Field(default_factory=list)
    other_parameters: list[OtherParameter] = Field(default_factory=list)


class UseCase(BaseModel):
    description: str | None = None
    habitat: str | None = None
    goal: str | None = None
    materials: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)


class Understanding(BaseModel):
    intent: Intent = "other"
    conditions: Conditions = Field(default_factory=Conditions)
    use_case: UseCase | None = None
    use_case_complete: bool = False


SYSTEM = """You read a conversation with FlameMind, a tool that finds NASA microgravity combustion data (PSI investigations) for spacecraft and habitat fire safety. Return JSON only.

intent:
- find_data: the user wants test data or results for some conditions or materials.
- explain: the user asks why or how something burns, ignites, spreads, or goes out.
- compare: the user compares conditions, habitats, materials, or investigations.
- use_case_update: the message mainly describes or changes their own project (habitat, materials, goal, constraints).
- other: anything else, including greetings and off-topic requests.

conditions: the physical conditions the latest message asks about, using earlier messages and the stored use case to fill gaps the user clearly implies. Convert units: pressure to psi (1 atm = 14.7 psi, 1 kPa = 0.145 psi), oxygen to percent by volume, airflow to cm/s. gravity is microgravity (space station, orbit), partial (Moon, Mars), or normal (Earth). Put any other quantity (temperature, sample thickness, heat flux, ...) in other_parameters. Use null or [] when not stated. Never guess numbers.

use_case: the user's own project, merged with the stored use case. Keep stored fields unless the user changes them. habitat names a place or preset such as "ISS", "Moon base", "Mars habitat", "spacesuit", or a description. goal is what they want to achieve (choose materials, set ventilation, plan suppression, ...). Return null if the user has never described a project.

use_case_complete: true only when the use case states a habitat or its atmosphere, at least one material, and a goal."""


def build_prompt(message: str, history: list[dict], stored_use_case: dict | None) -> str:
    recent = history[-HISTORY_LIMIT:]
    lines = [f"{item.get('role', 'user')}: {str(item.get('content', ''))[:2000]}" for item in recent]
    return "\n\n".join(
        [
            "Stored use case:\n" + (json.dumps(stored_use_case, ensure_ascii=False) if stored_use_case else "none"),
            "Earlier messages (oldest first):\n" + ("\n".join(lines) if lines else "none"),
            "Latest message:\n" + message,
        ]
    )


def understand(llm: LLM, message: str, history: list[dict], stored_use_case: dict | None) -> Understanding:
    result = llm.generate_json(SYSTEM, build_prompt(message, history, stored_use_case), Understanding)
    result.use_case = merge_use_case(stored_use_case, result.use_case)
    result.use_case_complete = result.use_case_complete and is_complete(result.use_case)
    return result


def merge_use_case(stored: dict | None, new: UseCase | None) -> UseCase | None:
    """New fields win; fields the model left empty keep their stored value."""
    if stored is None and new is None:
        return None
    base = UseCase.model_validate(stored or {})
    if new is None:
        return base
    merged = base.model_dump()
    for key, value in new.model_dump().items():
        if value not in (None, "", []):
            merged[key] = value
    return UseCase.model_validate(merged)


def is_complete(use_case: UseCase | None) -> bool:
    """A guard on the model's flag: habitat, materials, and goal must all be present."""
    return bool(use_case and use_case.habitat and use_case.materials and use_case.goal)
