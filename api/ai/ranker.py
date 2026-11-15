"""Score investigations and their tests against the conditions a user asks about.

Pure functions, no I/O. Weights:
    conditions (O2 and pressure closeness)  0.50
    material relevance                      0.25
    intent match                            0.15
    airflow closeness                       0.10
A part is left out, and the rest re-weighted, when the question gives it
nothing to compare (for example no materials named). Closeness on each axis
is 1 inside a tested range or at a tested value, falling linearly to 0 at
CLOSE_AT of the axis span. Spans match data/gaps.json.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

WEIGHTS = {"conditions": 0.50, "materials": 0.25, "intent": 0.15, "airflow": 0.10}
SPANS = {"o2_percent": 85.0, "pressure_psi": 14.0, "flow_cm_s": 50.0}
CLOSE_AT = 0.35
KPA_TO_PSI = 0.1450377
TOP_TESTS = 5

AXIS_LABEL = {"o2_percent": "oxygen", "pressure_psi": "pressure", "flow_cm_s": "airflow"}
AXIS_UNIT = {"o2_percent": "% O2", "pressure_psi": " psi", "flow_cm_s": " cm/s"}

# Words that mean the same kind of material in PSI fuel descriptions.
MATERIAL_GROUPS: dict[str, frozenset[str]] = {
    "fabric": frozenset({"fabric", "fabrics", "cloth", "textile", "textiles", "cotton", "nomex", "fiberglass", "clothing", "garment", "garments", "towel"}),
    "plastic": frozenset({"plastic", "plastics", "pmma", "acrylic", "polymer", "polymers", "plexiglas", "plexiglass", "polyethylene", "delrin", "polycarbonate", "ultem", "silicone", "polyoxymethylene"}),
    "paper": frozenset({"paper", "cardboard", "kimwipe", "kimwipes", "cellulose", "tissue"}),
    "wire": frozenset({"wire", "wires", "insulation", "cable", "cables", "electrical", "ptfe", "teflon"}),
    "liquid": frozenset({"heptane", "ethanol", "methanol", "decane", "droplet", "droplets", "alcohol", "octane", "dodecane"}),
    "gas": frozenset({"methane", "ethylene", "propane", "hydrogen", "ethane"}),
}
STOPWORDS = frozenset({"and", "the", "with", "for", "sample", "samples", "material", "materials", "fuel", "fuels", "flat", "sheet", "sheets", "thin", "thick"})


@dataclass(frozen=True)
class TestMatch:
    test_id: str
    sample_id: str | None
    closeness: float
    values: dict[str, float]


@dataclass
class Ranked:
    investigation_id: str
    score: float
    parts: dict[str, float]
    reasons: list[str] = field(default_factory=list)
    tests: list[TestMatch] = field(default_factory=list)


def make_test_id(investigation_id: str, index: int) -> str:
    """Stable id for the index-th test of an investigation, e.g. PSI-25-T12."""
    return f"{investigation_id}-T{index + 1}"


def rank(investigations: list[dict], conditions: dict, intent: str) -> list[Ranked]:
    """Best first. ``conditions`` is the understand.Conditions shape as a dict."""
    ranked = [score_investigation(record, conditions, intent) for record in investigations]
    return sorted(ranked, key=lambda item: (-item.score, item.investigation_id))


def score_investigation(record: dict, conditions: dict, intent: str) -> Ranked:
    query = {axis: conditions.get(axis) for axis in SPANS if conditions.get(axis) is not None}
    parts: dict[str, float] = {}
    reasons: list[str] = []

    tests = _scored_tests(record, query)
    condition_axes = [axis for axis in ("o2_percent", "pressure_psi") if axis in query]
    if condition_axes:
        parts["conditions"], text = _closeness_part(record, query, condition_axes, tests)
        reasons.append(text)
    if "flow_cm_s" in query:
        parts["airflow"], text = _closeness_part(record, query, ["flow_cm_s"], tests)
        reasons.append(text)

    materials = [m for m in conditions.get("materials") or [] if m and m.strip()]
    if materials or conditions.get("fuel_phase"):
        parts["materials"], text = _material_part(record, materials, conditions.get("fuel_phase"))
        reasons.append(text)

    intent_score = _intent_part(record, intent)
    if intent_score is not None:
        parts["intent"], text = intent_score
        reasons.append(text)

    gravity = conditions.get("gravity")
    if gravity and record.get("gravity") and record["gravity"] != gravity:
        reasons.append(f"Run in {record['gravity']}, not {gravity} gravity.")

    weight = sum(WEIGHTS[name] for name in parts)
    score = sum(WEIGHTS[name] * value for name, value in parts.items()) / weight if weight else 0.0
    return Ranked(
        investigation_id=record["id"],
        score=round(score, 4),
        parts={name: round(value, 4) for name, value in parts.items()},
        reasons=reasons,
        tests=[test for test in tests if test.closeness > 0][:TOP_TESTS],
    )


# ---------- conditions ----------


def _test_values(test: dict) -> dict[str, float]:
    values = {}
    if test.get("o2_percent") is not None:
        values["o2_percent"] = float(test["o2_percent"])
    if test.get("pressure_psi") is not None:
        values["pressure_psi"] = float(test["pressure_psi"])
    elif test.get("pressure_kpa") is not None:
        values["pressure_psi"] = float(test["pressure_kpa"]) * KPA_TO_PSI
    if test.get("flow_cm_s") is not None:
        values["flow_cm_s"] = float(test["flow_cm_s"])
    return values


def _record_range(record: dict, axis: str) -> tuple[float, float] | None:
    low, high = record.get(f"{axis}_min"), record.get(f"{axis}_max")
    if axis == "pressure_psi" and low is None and high is None:
        kpa_low, kpa_high = record.get("pressure_kpa_min"), record.get("pressure_kpa_max")
        low = kpa_low * KPA_TO_PSI if kpa_low is not None else None
        high = kpa_high * KPA_TO_PSI if kpa_high is not None else None
    if low is None and high is None:
        return None
    low = high if low is None else low
    high = low if high is None else high
    return (min(low, high), max(low, high))


def axis_closeness(axis: str, wanted: float, low: float, high: float | None = None) -> float:
    high = low if high is None else high
    gap = 0.0 if low <= wanted <= high else min(abs(wanted - low), abs(wanted - high))
    return max(0.0, 1.0 - (gap / SPANS[axis]) / CLOSE_AT)


def _scored_tests(record: dict, query: dict[str, float]) -> list[TestMatch]:
    """Tests with a value on at least one queried axis, closest first."""
    matches = []
    for index, test in enumerate(record.get("tests") or []):
        values = _test_values(test)
        axes = [axis for axis in query if axis in values]
        if not axes:
            continue
        closeness = sum(axis_closeness(a, query[a], values[a]) for a in query if a in values) / len(query)
        matches.append(TestMatch(make_test_id(record["id"], index), test.get("sample_id"), round(closeness, 4), values))
    return sorted(matches, key=lambda item: -item.closeness)


def _closeness_part(record: dict, query: dict, axes: list[str], tests: list[TestMatch]) -> tuple[float, str]:
    """Best closeness over tests (with missing axes taken from the record's ranges), else ranges."""
    ranges = {axis: _record_range(record, axis) for axis in axes}
    best, best_test = 0.0, None
    for test in tests:
        per_axis = []
        for axis in axes:
            if axis in test.values:
                per_axis.append(axis_closeness(axis, query[axis], test.values[axis]))
            elif ranges[axis]:
                per_axis.append(axis_closeness(axis, query[axis], *ranges[axis]))
            else:
                per_axis.append(0.0)
        value = sum(per_axis) / len(axes)
        if value > best:
            best, best_test = value, test
    from_ranges = [
        axis_closeness(axis, query[axis], *ranges[axis]) if ranges[axis] else 0.0 for axis in axes
    ]
    range_value = sum(from_ranges) / len(axes)
    if best_test is not None and best >= range_value:
        return best, _describe_test(best_test, query, axes, ranges)
    return range_value, _describe_ranges(ranges, query, axes)


def _fmt(value: float) -> str:
    return f"{value:.3g}" if abs(value) < 100 else f"{value:.0f}"


def _describe_test(test: TestMatch, query: dict, axes: list[str], ranges: dict) -> str:
    bits = []
    for axis in axes:
        if axis in test.values:
            bits.append(f"{_fmt(test.values[axis])}{AXIS_UNIT[axis]}")
        elif ranges[axis]:
            bits.append(_range_text(axis, ranges[axis]) + " (investigation range)")
    asked = ", ".join(f"{_fmt(query[axis])}{AXIS_UNIT[axis]}" for axis in axes)
    return f"Closest test {test.test_id} ran at {' and '.join(bits)}; you asked about {asked}."


def _range_text(axis: str, span: tuple[float, float]) -> str:
    low, high = span
    return f"{_fmt(low)}{AXIS_UNIT[axis]}" if math.isclose(low, high) else f"{_fmt(low)}-{_fmt(high)}{AXIS_UNIT[axis]}"


def _describe_ranges(ranges: dict, query: dict, axes: list[str]) -> str:
    bits = []
    for axis in axes:
        span = ranges[axis]
        if span is None:
            bits.append(f"no {AXIS_LABEL[axis]} values recorded")
        elif span[0] <= query[axis] <= span[1]:
            bits.append(f"{AXIS_LABEL[axis]} {_range_text(axis, span)} covers {_fmt(query[axis])}{AXIS_UNIT[axis]}")
        else:
            bits.append(f"{AXIS_LABEL[axis]} tested at {_range_text(axis, span)}, you asked about {_fmt(query[axis])}{AXIS_UNIT[axis]}")
    return "Ranges: " + "; ".join(bits) + "."


# ---------- materials ----------


def _tokens(text: str) -> set[str]:
    return {word for word in re.findall(r"[a-z0-9]+", text.lower()) if len(word) > 2 and word not in STOPWORDS}


def _groups(tokens: set[str]) -> set[str]:
    return {name for name, words in MATERIAL_GROUPS.items() if tokens & words}


def _material_part(record: dict, materials: list[str], fuel_phase: str | None) -> tuple[float, str]:
    described = " ".join(
        [*(record.get("fuels") or []), record.get("sample_geometry") or "", record.get("name") or ""]
        + [str(test.get("fuel") or "") for test in record.get("tests") or []]
    )
    have = _tokens(described)
    have_groups = _groups(have)
    fuels = ", ".join(record.get("fuels") or []) or "unstated fuels"
    best, matched = 0.0, None
    for material in materials:
        wanted = _tokens(material)
        if wanted & have:
            score = 1.0
        elif _groups(wanted) & have_groups:
            score = 0.8
        else:
            continue
        if score > best:
            best, matched = score, material
    if matched:
        kind = "names" if best == 1.0 else "uses a similar material to"
        return best, f"Fuel ({fuels}) {kind} {matched}."
    if fuel_phase and record.get("fuel_phase") == fuel_phase:
        return 0.5, f"Burned a {fuel_phase} fuel ({fuels}), like you asked about."
    asked = ", ".join(materials) or f"{fuel_phase} fuels"
    return 0.0, f"Fuel ({fuels}) does not match {asked}."


# ---------- intent ----------


def _intent_part(record: dict, intent: str) -> tuple[float, str] | None:
    tests = record.get("tests") or []
    with_values = sum(1 for test in tests if _test_values(test))
    findings = sum(
        len(record.get(name) or [])
        for name in ("key_findings", "ignition_findings", "flame_spread_findings", "extinction_findings")
    )
    if intent in ("find_data", "use_case_update"):
        if with_values:
            return 1.0, f"Has {with_values} test(s) with recorded conditions."
        if any(_record_range(record, axis) for axis in SPANS):
            return 0.6, "Has tested ranges but no per-test values."
        return 0.2, "No recorded test conditions."
    if intent == "explain":
        return min(1.0, findings / 3), f"Has {findings} recorded finding(s) to explain from."
    if intent == "compare":
        varied = record.get("variables_varied") or []
        distinct = {tuple(sorted(_test_values(test).items())) for test in tests if _test_values(test)}
        if len(distinct) > 1 or varied:
            return 1.0, "Varied conditions across tests, so results can be compared."
        return 0.4, "Few varied conditions to compare."
    return None
