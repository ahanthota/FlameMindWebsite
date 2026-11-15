"""Turn free text into a filter definition: mapped, derived, or unclear.

Gemini only reads the text: it names the parameter and copies the numbers and
unit as written. Matching to a schema field is checked here, and unit
conversion and the interpretation line are done in code, so they are exact.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from ai.llm import LLM
from ai.units import convert

# Numeric fields a filter can map to. ``levels`` lists where the value is stored:
# investigations hold a tested range (<field>_min / <field>_max), tests one value.
FIELDS: dict[str, dict] = {
    "o2_percent": {
        "label": "Oxygen concentration",
        "unit": "%",
        "levels": ("investigation", "test"),
        "description": "Oxygen in the test atmosphere, percent by volume. Also given as mole fraction.",
    },
    "pressure_psi": {
        "label": "Pressure",
        "unit": "psi",
        "levels": ("investigation", "test"),
        "description": "Total ambient pressure of the test atmosphere. Sources may state kPa, atm, bar, or torr.",
    },
    "flow_cm_s": {
        "label": "Airflow speed",
        "unit": "cm/s",
        "levels": ("investigation", "test"),
        "description": "Speed of the forced gas flow over the sample (ventilation, concurrent or opposed flow).",
    },
    "spread_rate_mm_s": {
        "label": "Flame spread rate",
        "unit": "mm/s",
        "levels": ("test",),
        "description": "Measured speed of the flame front along a solid sample. Not a droplet burning rate.",
    },
}

DEFAULT_QUESTION = "Which parameter do you want to filter on, and over what range? For example: oxygen between 30 and 40 percent."


class ParsedFilter(BaseModel):
    """What the model returns. Numbers and unit are exactly as the user wrote them."""

    kind: Literal["mapped", "derived", "unclear"]
    field: str | None = None
    level: Literal["investigation", "test"] | None = None
    parameter: str | None = None
    min: float | None = None
    max: float | None = None
    unit: str | None = None
    question: str | None = None


def system_prompt() -> str:
    fields = "\n".join(
        f"- {name}: {spec['label']}. Stored in {spec['unit']}. Levels: {', '.join(spec['levels'])}. {spec['description']}"
        for name, spec in FIELDS.items()
    )
    return f"""You turn one line of text into a numeric filter over NASA microgravity combustion investigations. Return JSON only. No advice, no explanations.

Schema fields:
{fields}

Choose kind:
- "mapped": the text names a quantity that one of the schema fields holds. Set field to that field name. Set level to "test" if the text is about individual tests, samples, or runs, or the field exists only for tests; otherwise "investigation".
- "derived": the text names a measurable quantity with a range, but no schema field holds it (for example sample thickness, fuel temperature, igniter power, droplet diameter). Set parameter to a short lowercase name for it.
- "unclear": the text is not a parameter with a range (no quantity, no number, or more than one quantity). Set question to ONE short question that would resolve it.

For mapped and derived:
- min and max are the range bounds exactly as written, in the user's unit. Do NOT convert units. "above 30" is min 30 and max null. "under 5" is min null and max 5. "at 21" or "21" is min 21 and max 21. "about 8" is min 8 and max 8.
- unit is the unit exactly as the user wrote it (for example "kPa", "mm/s", "percent"), or null if none was given.
- At least one of min and max must be a number. If there is none, the kind is "unclear"."""


def parse_filter(llm: LLM, text: str) -> dict:
    """The response body for POST /filter/parse."""
    return finalize(llm.generate_json(system_prompt(), text.strip(), ParsedFilter))


def finalize(parsed: ParsedFilter) -> dict:
    low, high = parsed.min, parsed.max
    if parsed.kind == "unclear" or (low is None and high is None):
        return _unclear(parsed.question)
    if low is not None and high is not None and low > high:
        low, high = high, low

    spec = FIELDS.get(parsed.field or "") if parsed.kind == "mapped" else None
    if spec is not None:
        source_unit = parsed.unit or spec["unit"]
        converted = [None if value is None else convert(value, source_unit, spec["unit"]) for value in (low, high)]
        if any(value is not None and new is None for value, new in zip((low, high), converted)):
            return _unclear(f"{spec['label']} is stored in {spec['unit']}. What unit is your range in?")
        low, high = (None if value is None else round(value, 4) for value in converted)
        level = parsed.level if parsed.level in spec["levels"] else spec["levels"][0]
        return {
            "kind": "mapped",
            "field": parsed.field,
            "level": level,
            "min": low,
            "max": high,
            "unit": spec["unit"],
            "interpretation": interpretation(spec["label"], low, high, spec["unit"]),
        }

    # Derived, or the model named a field that is not in the schema.
    parameter = " ".join((parsed.parameter or parsed.field or "").replace("_", " ").lower().split())
    if not parameter:
        return _unclear(parsed.question)
    unit = (parsed.unit or "").strip() or None
    return {
        "kind": "derived",
        "parameter": parameter,
        "min": low,
        "max": high,
        "unit": unit,
        "interpretation": interpretation(parameter.capitalize(), low, high, unit),
    }


def _unclear(question: str | None) -> dict:
    return {"kind": "unclear", "question": (question or "").strip() or DEFAULT_QUESTION}


def interpretation(label: str, low: float | None, high: float | None, unit: str | None) -> str:
    """A fixed-format restatement of the filter, e.g. 'Pressure between 7.25 and 14.7 psi'."""
    suffix = "" if not unit else (unit if unit == "%" else f" {unit}")
    if low is not None and high is not None:
        if low == high:
            return f"{label} equal to {low:g}{suffix}"
        return f"{label} between {low:g} and {high:g}{suffix}"
    if low is not None:
        return f"{label} at least {low:g}{suffix}"
    return f"{label} at most {high:g}{suffix}"
