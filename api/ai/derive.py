"""Find a parameter that no schema field holds, by reading passages.

For each investigation: take its top passages for the parameter, ask Gemini (in
batches) for values written in those passages, then check every value here.
A value is kept only if it cites one of that investigation's passages and the
number appears in the cited text. Anything else is "not_reported". Nothing is
estimated, and the range comparison is done in code after unit conversion.
"""

from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from pydantic import BaseModel, Field

from ai.llm import LLM
from ai.ranker import make_test_id
from ai.units import convert

PASSAGES_PER_INVESTIGATION = 3
BATCH_SIZE = 4
MAX_PARALLEL_CALLS = 4
PASSAGE_CHARS = 6000
NUMBER = re.compile(r"(?<![\w.])-?\d+(?:,\d{3})*(?:\.\d+)?")


class FoundValue(BaseModel):
    investigation_id: str
    sample: str | None = None
    value: float | None = None
    unit: str | None = None
    citation: int | None = None


class FoundValues(BaseModel):
    values: list[FoundValue] = Field(default_factory=list)


SYSTEM = """You extract one parameter from numbered passages of NASA combustion investigation documents. Return JSON only. No advice, no explanations.

For each investigation listed, report every value of the parameter that is WRITTEN in its passages:
- value: the number exactly as written. unit: the unit exactly as written. Do NOT convert units and do NOT round.
- citation: the number of the passage where that value is written. It must be a passage of the same investigation.
- sample: the test, sample, or run label the value belongs to, if the passage states one. Otherwise null.
- If a passage gives a range, report two entries: the low value and the high value.
- Report a value only if the passage clearly says it is this parameter. Never estimate, infer, calculate, or use outside knowledge.
- If an investigation's passages do not state the parameter, return ONE entry for it with value null, unit null, citation null.
Every investigation listed must appear at least once."""


def cache_key(parameter: str) -> str:
    """'Sample Thickness ' and 'sample-thickness' share one cache entry."""
    return " ".join(re.sub(r"[^a-z0-9]+", " ", parameter.lower()).split())


def investigation_ids(chunks: list[dict]) -> list[str]:
    """Every investigation that has text, in PSI number order."""
    ids = {chunk["investigation_id"] for chunk in chunks}
    return sorted(ids, key=lambda value: (int(re.search(r"(\d+)$", value).group(1)) if re.search(r"(\d+)$", value) else 0, value))


def top_passages(
    chunks: list[dict],
    embeddings: np.ndarray,
    query_vector: np.ndarray,
    ids: list[str],
    per_investigation: int = PASSAGES_PER_INVESTIGATION,
) -> dict[str, list[dict]]:
    scores = embeddings @ query_vector
    chosen: dict[str, list[dict]] = {investigation_id: [] for investigation_id in ids}
    for index in np.argsort(-scores, kind="stable"):
        chunk = chunks[int(index)]
        bucket = chosen.get(chunk["investigation_id"])
        if bucket is not None and len(bucket) < per_investigation:
            bucket.append(chunk)
    return chosen


def build_prompt(parameter: str, unit: str | None, batch: list[tuple[str, list[tuple[int, dict]]]]) -> str:
    blocks = []
    for investigation_id, passages in batch:
        lines = [f"INVESTIGATION {investigation_id}"]
        for number, chunk in passages:
            lines.append(f"[{number}] {chunk.get('title') or ''}\n{chunk['text'][:PASSAGE_CHARS]}")
        if not passages:
            lines.append("(no passages)")
        blocks.append("\n\n".join(lines))
    wanted = f"PARAMETER: {parameter}" + (f" (the user's range is in {unit})" if unit else "")
    return wanted + "\n\n" + "\n\n---\n\n".join(blocks)


def appears_in(value: float, text: str) -> bool:
    """True if the number is written in the text (1,000 and 0.50 count as 1000 and 0.5)."""
    for match in NUMBER.findall(text):
        try:
            if abs(float(match.replace(",", "")) - value) <= 1e-9 * max(1.0, abs(value)):
                return True
        except ValueError:
            continue
    return False


def check_values(
    found: list[FoundValue],
    batch: list[tuple[str, list[tuple[int, dict]]]],
    by_id: dict[str, dict],
) -> dict[str, list[dict]]:
    """Verified raw values per investigation in the batch. An empty list means not reported."""
    numbered = {investigation_id: dict(passages) for investigation_id, passages in batch}
    verified: dict[str, list[dict]] = {investigation_id: [] for investigation_id in numbered}
    for item in found:
        passages = numbered.get(item.investigation_id)
        if passages is None or item.value is None or item.citation not in passages:
            continue
        chunk = passages[item.citation]
        if not appears_in(item.value, chunk["text"]):
            continue
        row = {
            "test_id": _test_id(by_id.get(item.investigation_id), item.sample),
            "value": item.value,
            "unit": (item.unit or "").strip() or None,
            "citation": {
                "file_name": chunk.get("file_name"),
                "title": chunk.get("title") or "",
                "url": chunk.get("url") or "",
                "doi": chunk.get("doi"),
                "page_start": chunk.get("page_start"),
                "page_end": chunk.get("page_end"),
            },
        }
        if row not in verified[item.investigation_id]:
            verified[item.investigation_id].append(row)
    return verified


def _test_id(record: dict | None, sample: str | None) -> str | None:
    """Our test id when the stated sample label is a known sample_id of the investigation."""
    if not record or not sample:
        return None
    wanted = sample.strip().lower()
    for index, test in enumerate(record.get("tests") or []):
        if str(test.get("sample_id") or "").strip().lower() == wanted:
            return make_test_id(record["id"], index)
    return None


def extract(
    llm: LLM,
    chunks: list[dict],
    embeddings: np.ndarray,
    by_id: dict[str, dict],
    parameter: str,
    unit: str | None,
    ids: list[str],
) -> dict[str, list[dict]]:
    """Verified raw values for each id, read from passages. One embedding call, then batched Gemini calls."""
    if not ids:
        return {}
    vector = llm.embed_query(f"{parameter} {unit or ''}".strip())
    passages = top_passages(chunks, embeddings, vector, ids)
    batches: list[list[tuple[str, list[tuple[int, dict]]]]] = []
    for start in range(0, len(ids), BATCH_SIZE):
        number = 0
        batch = []
        for investigation_id in ids[start : start + BATCH_SIZE]:
            numbered = []
            for chunk in passages[investigation_id]:
                number += 1
                numbered.append((number, chunk))
            batch.append((investigation_id, numbered))
        batches.append(batch)

    def run(batch):
        found = llm.generate_json(SYSTEM, build_prompt(parameter, unit, batch), FoundValues)
        return check_values(found.values, batch, by_id)

    results: dict[str, list[dict]] = {}
    with ThreadPoolExecutor(max_workers=MAX_PARALLEL_CALLS) as pool:
        for verified in pool.map(run, batches):
            results.update(verified)
    return results


def status_rows(
    investigation_id: str, raw: list[dict], low: float | None, high: float | None, unit: str | None
) -> list[dict]:
    """Response rows for one investigation: each value compared with the range in the requested unit."""
    rows = []
    for item in raw:
        value = item["value"] if not unit else convert(item["value"], item["unit"], unit)
        if value is None:  # written in a unit that cannot be compared with the range
            continue
        inside = (low is None or value >= low - 1e-9) and (high is None or value <= high + 1e-9)
        rows.append(
            {
                "investigation_id": investigation_id,
                "test_id": item.get("test_id"),
                "value": round(value, 6),
                "unit": unit or item["unit"],
                "status": "match" if inside else "no_match",
                "citation": item["citation"],
            }
        )
    if not rows:
        rows.append(
            {
                "investigation_id": investigation_id,
                "test_id": None,
                "value": None,
                "unit": None,
                "status": "not_reported",
                "citation": None,
            }
        )
    return rows
