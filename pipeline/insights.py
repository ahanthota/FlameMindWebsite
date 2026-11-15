"""Check hand-written data/insights.json.

    python insights.py

Every insight must name known investigations and habitats and cite at least
one source. Each cited source must appear in one of its investigations in
data/investigations.json, matched by DOI or by file name and page.
Ids starting with "example-" are template entries to replace.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INSIGHTS = ROOT / "data" / "insights.json"
DEFAULT_DATA = ROOT / "data" / "investigations.json"
DEFAULT_HABITATS = ROOT / "data" / "habitats.json"
EXAMPLE_PREFIX = "example-"

InsightCategory = Literal["prevention", "detection", "suppression", "material_screening", "earth"]


class InsightSource(BaseModel):
    model_config = ConfigDict(extra="ignore")

    file_name: str | None = None
    title: str | None = None
    url: str | None = None
    doi: str | None = None
    page: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def locatable(self) -> InsightSource:
        if not (self.doi or (self.file_name and self.page)):
            raise ValueError("a source needs a doi, or a file_name with a page")
        return self


class Insight(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    text: str = Field(min_length=1)
    category: InsightCategory
    habitats: list[str] = Field(default_factory=list)
    investigation_ids: list[str] = Field(min_length=1)
    sources: list[InsightSource] = Field(min_length=1)


def source_index(records: list[dict]) -> dict[str, set[tuple]]:
    """Per investigation: ("doi", doi) and ("file", file_name, page) keys of every citation."""
    index: dict[str, set[tuple]] = {}
    for record in records:
        keys: set[tuple] = set()
        for ref in _all_refs(record):
            doi = str(ref.get("doi") or "").strip().lower()
            if doi:
                keys.add(("doi", doi))
            if ref.get("file_name") and ref.get("page"):
                keys.add(("file", str(ref["file_name"]).strip(), int(ref["page"])))
        index[str(record.get("id"))] = keys
    return index


def validate_insights(
    insights: list,
    records: list[dict],
    habitat_ids: set[str],
) -> tuple[list[str], list[str]]:
    """Returns (errors, warnings)."""
    errors: list[str] = []
    warnings: list[str] = []
    index = source_index(records)
    seen: set[str] = set()
    for position, raw in enumerate(insights, start=1):
        label = f"insight {position}"
        if isinstance(raw, dict) and raw.get("id"):
            label = f"insight {raw['id']!r}"
        try:
            insight = Insight.model_validate(raw)
        except ValidationError as exc:
            for item in exc.errors():
                location = ".".join(str(part) for part in item["loc"]) or "entry"
                errors.append(f"{label}: {location}: {item['msg']}")
            continue
        if insight.id in seen:
            errors.append(f"{label}: duplicate id")
        seen.add(insight.id)
        if insight.id.startswith(EXAMPLE_PREFIX):
            warnings.append(f"{label}: template example; replace or delete it before publishing")
        for habitat in insight.habitats:
            if habitat not in habitat_ids:
                errors.append(f"{label}: unknown habitat {habitat!r}")
        known = [item for item in insight.investigation_ids if item in index]
        for investigation_id in insight.investigation_ids:
            if investigation_id not in index:
                errors.append(f"{label}: {investigation_id} is not in investigations.json")
        cited_keys = set().union(*(index[item] for item in known)) if known else set()
        for number, source in enumerate(insight.sources, start=1):
            if not _source_keys(source) & cited_keys:
                where = source.doi or f"{source.file_name} p.{source.page}"
                errors.append(
                    f"{label}: source {number} ({where}) is not cited by "
                    f"{', '.join(insight.investigation_ids)} in investigations.json"
                )
    return errors, warnings


def _source_keys(source: InsightSource) -> set[tuple]:
    keys: set[tuple] = set()
    if source.doi:
        keys.add(("doi", source.doi.strip().lower()))
    if source.file_name and source.page:
        keys.add(("file", source.file_name.strip(), source.page))
    return keys


def _all_refs(record: dict) -> list[dict]:
    refs = list(record.get("sources") or [])
    for name in ("ignition_findings", "flame_spread_findings", "extinction_findings", "key_findings"):
        for finding in record.get(name) or []:
            refs.extend(finding.get("evidence") or [])
    for test in record.get("tests") or []:
        refs.extend(test.get("evidence") or [])
    return [ref for ref in refs if isinstance(ref, dict)]


def _load_list(path: Path) -> list:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise SystemExit(f"{path} must hold a JSON list")
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate data/insights.json.")
    parser.add_argument("--insights", type=Path, default=DEFAULT_INSIGHTS)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--habitats", type=Path, default=DEFAULT_HABITATS)
    args = parser.parse_args(argv)
    insights = _load_list(args.insights)
    records = [item for item in _load_list(args.data) if isinstance(item, dict)]
    habitat_ids = {str(item.get("id")) for item in _load_list(args.habitats) if isinstance(item, dict)}
    errors, warnings = validate_insights(insights, records, habitat_ids)
    for warning in warnings:
        print(f"warning: {warning}")
    if errors:
        print(f"{len(errors)} problem(s) in {args.insights.name}:")
        for error in errors:
            print(f"  {error}")
        return 1
    print(f"{len(insights)} insight(s) OK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
