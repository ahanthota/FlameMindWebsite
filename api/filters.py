"""Custom filter endpoints: definitions and values only, never advice or prose."""

from __future__ import annotations

from ai import derive as deriving
from ai.filter_parse import parse_filter
from ai.llm import LLM
from data import DataStore


class UnknownInvestigation(Exception):
    """An investigation id that is not in the dataset."""


def parse(llm: LLM, text: str) -> dict:
    return parse_filter(llm, text)


def derive(
    llm: LLM,
    data: DataStore,
    parameter: str,
    low: float | None,
    high: float | None,
    unit: str | None,
    investigation_ids: list[str] | None,
) -> dict:
    known = deriving.investigation_ids(data.chunks)
    ids = list(dict.fromkeys(investigation_ids)) if investigation_ids else known
    unknown = [value for value in ids if value not in set(known)]
    if unknown:
        raise UnknownInvestigation(", ".join(unknown))
    if low is not None and high is not None and low > high:
        low, high = high, low
    unit = (unit or "").strip() or None

    key = deriving.cache_key(parameter)
    values = data.derived(key)
    missing = [value for value in ids if value not in values]
    if missing:
        fresh = deriving.extract(llm, data.chunks, data.embeddings, data.by_id, key, unit, missing)
        data.add_derived(key, fresh)
        values.update(fresh)

    results = []
    for investigation_id in ids:
        results.extend(deriving.status_rows(investigation_id, values.get(investigation_id, []), low, high, unit))
    return {"parameter": key, "min": low, "max": high, "unit": unit, "results": results}
