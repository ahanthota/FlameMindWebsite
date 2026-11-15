"""Extract structured investigation records with Vertex AI Gemini.

Reads data/processed page text and publication rows in data/raw/sources.csv.
Does not download. Model name, project, and region come from config.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from pydantic import ValidationError

from config import ConfigError, Settings, load_settings
from parse import find_investigation_dir, read_table
from schema import FINDING_FIELDS, RANGE_FIELDS, Investigation, TestBatch, TestCondition

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RAW = ROOT / "data" / "raw"
DEFAULT_PROCESSED = ROOT / "data" / "processed"
DEFAULT_OUT = ROOT / "data" / "investigations.json"
DEFAULT_CACHE = ROOT / "data" / "cache" / "extract"
DEFAULT_MAX_CHARS = 100_000
DEFAULT_ROWS_PER_CALL = 40
MAX_TABLE_ROWS = 2000
TABLE_SUFFIXES = frozenset({".csv", ".xlsx"})
RETRY_STATUS = frozenset({429, 500, 503})
RETRY_DELAYS_S = (15, 30, 60, 120, 120)

KPA_PER_PSI = 6.894757
PSI_PER_KPA = 1 / KPA_PER_PSI

HARDWARE_ALIASES = {
    "cir": "CIR",
    "combustion integrated rack": "CIR",
    "mdca": "MDCA",
    "multi-user droplet combustion apparatus": "MDCA",
    "multi-user droplet combustion appartatus": "MDCA",
    "msg": "MSG",
    "microgravity science glovebox": "MSG",
    "microgravity glove box": "MSG",
    "other": "other",
}
PLATFORM_ALIASES = {
    "iss": "ISS",
    "international space station": "ISS",
    "international space station (iss)": "ISS",
    "drop tower": "drop_tower",
    "drop_tower": "drop_tower",
    "parabolic flight": "parabolic_flight",
    "parabolic_flight": "parabolic_flight",
    "sounding rocket": "sounding_rocket",
    "sounding_rocket": "sounding_rocket",
}
CATEGORY_ALIASES = {
    "prevention": "prevention",
    "detection": "detection",
    "suppression": "suppression",
    "extinguishment": "suppression",
    "extinguish": "suppression",
}
FUEL_PHASES = {"solid", "liquid", "gas"}
GRAVITY_ALIASES = {
    "microgravity": "microgravity",
    "micro-gravity": "microgravity",
    "µg": "microgravity",
    "0g": "microgravity",
    "normal": "normal",
    "normal gravity": "normal",
    "1g": "normal",
    "partial": "partial",
    "partial gravity": "partial",
    "simulated_partial": "simulated_partial",
    "simulated partial": "simulated_partial",
    "simulated partial gravity": "simulated_partial",
}
OUTCOMES = {"ignited", "no_ignition", "extinguished", "steady", "unknown"}
TEST_NUMBER_FIELDS = (
    "o2_percent",
    "pressure_kpa",
    "pressure_psi",
    "flow_cm_s",
    "spread_rate_mm_s",
)

SYSTEM_PROMPT = """You extract one NASA PSI combustion investigation as JSON.
Use only facts written in the source text. If a value is not stated, use null. Never guess, interpolate, or use outside knowledge.
Do not create a test from a table summary. Min, max, and row count are investigation ranges, not one sample.
A publication title with no abstract is not evidence for a finding.
Every finding needs evidence with file_name, title, url, doi (null if absent), and the page number from a "--- page N ---" marker.
Cite only a page number that appears as a marker under that FILE. Never cite a page number printed inside the text, a figure number, or a table number. A file with one marker is page 1.
Every test number (oxygen, pressure, flow, spread rate) needs that same page-level evidence.
Every investigation-level numeric range needs at least one source of the same shape.
When the text gives pressure in one unit, fill both pressure_kpa and pressure_psi.
Use 1 psi = 6.894757 kPa, 1 atm = 101.325 kPa = 14.6959 psi, and 1 mmHg = 0.133322 kPa.
program is a named experiment campaign the investigation belongs to, such as ACME or Saffire, when the text says so. A flight program, platform, or station is not a program. Otherwise null.
hardware is CIR, MDCA, MSG, or other. Microgravity Science Glovebox is MSG. Combustion Integrated Rack is CIR. Multi-user Droplet Combustion Apparatus is MDCA. Use other only when a different hardware name is stated. Use null when hardware is not stated.
platform values are ISS, drop_tower, parabolic_flight, sounding_rocket.
category values are prevention, detection, suppression.
fuel_phase is solid, liquid, or gas, or null.
gravity is microgravity, normal, partial, or simulated_partial, or null.
outcome is ignited, no_ignition, extinguished, steady, or unknown.
Test table rows are extracted in a separate step. In tests, list only individual samples described in documents.
A zero or negative pressure is a recording error. Never use it as a range end.
Set needs_review to false."""

TEST_PROMPT = """You turn rows of one NASA PSI experiment table into test conditions.
Return exactly one test per row, in row order. Use only the values in that row and the column names. Never guess.
sample_id: the row's test or sample identifier, as written. If there is none, use "row N".
fuel and sample_geometry: as written in the row, else null.
o2_percent: oxygen as a percent. A mole or volume fraction of 0.21 is 21.
Pressure: fill both pressure_kpa and pressure_psi. 1 psi = 6.894757 kPa, 1 atm = 101.325 kPa, 1 mmHg = 0.133322 kPa.
A zero or negative pressure is a recording error. Leave both pressures null and say so in notes.
flow_cm_s: imposed flow speed in cm/s, else null.
diluent: inert or suppressant gases with a nonzero fraction, other than oxygen, as written.
outcome: ignited, no_ignition, extinguished, steady, or unknown. Use unknown unless the row states the result. Put the row's own result wording in notes.
spread_rate_mm_s: only a flame spread rate column in mm/s. A droplet burning rate is not a spread rate. Put other measured values in notes with their units.
Leave evidence empty. It is filled in after you answer."""


@dataclass(frozen=True)
class CatalogEntry:
    id: str
    name: str
    acronym: str
    tier: str
    psi_url: str


@dataclass
class TextBlock:
    file_name: str
    title: str
    url: str
    doi: str | None
    source_type: str
    pages: list[tuple[int, str]] = field(default_factory=list)

    @property
    def is_sample(self) -> bool:
        return self.source_type == "sample_data"


@dataclass
class TableRows:
    file_name: str
    title: str
    url: str
    doi: str | None
    headers: list[str]
    rows: list[list[str]]

    def ref(self) -> dict:
        return {
            "file_name": self.file_name,
            "title": self.title,
            "url": self.url,
            "doi": self.doi,
            "page": 1,
        }


@dataclass
class Extraction:
    record: Investigation
    responses: list[str]
    from_cache: bool = False
    review_reasons: list[str] = field(default_factory=list)


class GeminiGenerator:
    """Vertex AI Gemini via google-genai. Project, region, and model come from settings."""

    def __init__(self, settings: Settings) -> None:
        from google import genai
        from google.genai import types

        self._types = types
        self._client = genai.Client(
            vertexai=True,
            project=settings.gcp_project,
            location=settings.gcp_region,
        )
        self.model = settings.gemini_model

    def generate(self, prompt: str) -> str:
        return self._generate(prompt, Investigation, SYSTEM_PROMPT)

    def generate_tests(self, prompt: str) -> str:
        return self._generate(prompt, TestBatch, TEST_PROMPT)

    def _generate(self, prompt: str, schema: type, system: str) -> str:
        from google.genai import errors

        config = self._types.GenerateContentConfig(
            temperature=0,
            max_output_tokens=32768,
            response_mime_type="application/json",
            response_schema=schema,
            system_instruction=system,
        )
        for attempt, delay in enumerate((*RETRY_DELAYS_S, None), start=1):
            try:
                response = self._client.models.generate_content(
                    model=self.model, contents=prompt, config=config
                )
            except errors.APIError as exc:
                if exc.code not in RETRY_STATUS or delay is None:
                    raise RuntimeError(f"Gemini call failed after {attempt} attempt(s): {exc}") from exc
                print(f"  Gemini {exc.code}; waiting {delay}s before retry {attempt}", flush=True)
                time.sleep(delay)
                continue
            text = response.text or ""
            if not text.strip():
                raise RuntimeError("Gemini returned an empty response")
            return text
        raise RuntimeError("Gemini call failed")


def load_catalog(raw_dir: Path, processed_dir: Path) -> list[CatalogEntry]:
    """Identity for each investigation in the local inventory."""
    inventory = raw_dir / "inventory.csv"
    entries: list[CatalogEntry] = []
    with inventory.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            investigation_id = row["investigation_id"].strip()
            acronym = _acronym_from_notes(row.get("notes", "")) or investigation_id
            overview = processed_dir / investigation_id / "overview.json"
            name = acronym
            if overview.is_file():
                payload = json.loads(overview.read_text(encoding="utf-8"))
                name = (payload.get("title") or acronym).strip()
            entries.append(
                CatalogEntry(
                    id=investigation_id,
                    name=name,
                    acronym=acronym,
                    tier=row["tier"].strip(),
                    psi_url=row["psi_url"].strip(),
                )
            )
    return entries


def select_entries(entries: list[CatalogEntry], only: str | None) -> list[CatalogEntry]:
    """Match ``--only BASS,FLEX`` against the id or an acronym token.

    ``BASS`` does not match ``BASS-II``.
    """
    if not only or not only.strip():
        return list(entries)
    wanted = {token.strip().lower() for token in only.split(",") if token.strip()}
    chosen = [entry for entry in entries if wanted & _aliases(entry)]
    missing = wanted - {alias for entry in chosen for alias in _aliases(entry)}
    if missing:
        listed = ", ".join(sorted(missing))
        known = ", ".join(sorted(alias for entry in entries for alias in _aliases(entry)))
        raise SystemExit(f"Unknown --only value: {listed}. Known names: {known}")
    return chosen


def load_blocks(entry: CatalogEntry, processed_dir: Path, sources_csv: Path) -> list[TextBlock]:
    """Overview, documents, sample summaries, and publication abstracts."""
    blocks: list[TextBlock] = []
    folder = processed_dir / entry.id
    if folder.is_dir():
        for path in sorted(folder.glob("*.json")):
            payload = json.loads(path.read_text(encoding="utf-8"))
            pages = [
                (int(page["page"]), str(page.get("text") or ""))
                for page in payload.get("pages") or []
            ]
            blocks.append(
                TextBlock(
                    file_name=str(payload.get("file_name") or path.name),
                    title=str(payload.get("title") or path.stem),
                    url=str(payload.get("url") or entry.psi_url),
                    doi=(payload.get("doi") or None),
                    source_type=str(payload.get("source_type") or "document"),
                    pages=pages or [(1, "")],
                )
            )
    if sources_csv.is_file():
        with sources_csv.open(newline="", encoding="utf-8-sig") as handle:
            for row in csv.DictReader(handle):
                if row.get("investigation_id", "").strip() != entry.id:
                    continue
                if row.get("source_type") not in {"publication", "abstract_only"}:
                    continue
                if (row.get("file_name") or "").strip():
                    continue
                abstract = (row.get("abstract") or "").strip()
                title = (row.get("title") or "").strip()
                doi = (row.get("doi") or "").strip() or None
                body = abstract or (
                    "No abstract is stored locally. Title only. "
                    "Do not extract findings from this title."
                )
                label = doi or title or "publication"
                blocks.append(
                    TextBlock(
                        file_name=f"publication:{label}",
                        title=title,
                        url=(row.get("url") or entry.psi_url).strip(),
                        doi=doi,
                        source_type="publication",
                        pages=[(1, body)],
                    )
                )
    return blocks


def load_tables(entry: CatalogEntry, raw_dir: Path, blocks: list[TextBlock]) -> tuple[list[TableRows], list[str]]:
    """Rows of each local sample table. Returns tables and reasons for any not read."""
    tables: list[TableRows] = []
    problems: list[str] = []
    investigation_dir = find_investigation_dir(raw_dir, entry.id)
    for block in blocks:
        if not block.is_sample:
            continue
        path = investigation_dir / block.file_name if investigation_dir else None
        if path is None or not path.is_file() or path.suffix.lower() not in TABLE_SUFFIXES:
            problems.append(f"{block.file_name}: table rows not found locally")
            continue
        try:
            headers, rows = read_table(path)
        except Exception as exc:  # noqa: BLE001 - report and keep going
            problems.append(f"{block.file_name}: could not read rows ({exc})")
            continue
        if len(rows) > MAX_TABLE_ROWS:
            problems.append(f"{block.file_name}: {len(rows)} rows is over {MAX_TABLE_ROWS}; tests not extracted")
            continue
        tables.append(
            TableRows(
                file_name=block.file_name,
                title=block.title,
                url=block.url,
                doi=block.doi,
                headers=headers,
                rows=rows,
            )
        )
    return tables, problems


def build_test_prompt(
    entry: CatalogEntry,
    table: TableRows,
    start: int,
    rows: list[list[str]],
    *,
    error: str | None = None,
    previous: str | None = None,
) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["row", *table.headers])
    for offset, row in enumerate(rows):
        writer.writerow([start + offset, *row])
    lines = [
        f"Investigation: {entry.id} {entry.acronym} ({entry.name})",
        f"Table: {table.file_name}",
        f"Rows {start} to {start + len(rows) - 1}. Return exactly {len(rows)} tests.",
        "",
        buffer.getvalue(),
    ]
    if error:
        lines.extend(
            [
                "The previous JSON failed validation. Fix it using only these rows.",
                error,
                "",
                "Previous JSON:",
                previous or "",
            ]
        )
    return "\n".join(lines)


def extract_table_tests(
    entry: CatalogEntry,
    table: TableRows,
    generate_tests: Callable[[str], str],
    *,
    rows_per_call: int = DEFAULT_ROWS_PER_CALL,
) -> tuple[list[TestCondition], list[str], list[str]]:
    """One model call per group of rows. Returns tests, raw responses, and problems."""
    tests: list[TestCondition] = []
    responses: list[str] = []
    problems: list[str] = []
    for index in range(0, len(table.rows), rows_per_call):
        chunk = table.rows[index : index + rows_per_call]
        start = index + 1
        prompt = build_test_prompt(entry, table, start, chunk)
        first = _call(generate_tests, prompt)
        responses.append(first)
        try:
            tests.extend(_validate_tests(first, table, len(chunk)))
            continue
        except (ValidationError, ValueError, json.JSONDecodeError) as exc:
            error = str(exc)
        retry = build_test_prompt(entry, table, start, chunk, error=error, previous=first)
        second = _call(generate_tests, retry)
        responses.append(second)
        try:
            tests.extend(_validate_tests(second, table, len(chunk)))
        except (ValidationError, ValueError, json.JSONDecodeError) as exc:
            last = start + len(chunk) - 1
            problems.append(f"{table.file_name} rows {start}-{last}: {str(exc)[:200]}")
            tests.extend(_validate_tests(second, table, None, strict=False))
    return tests, responses, problems


def fill_ranges_from_tests(record: Investigation) -> Investigation:
    """Fill a missing or impossible range end from the extracted tests. Valid values are kept."""
    data = record.model_dump()
    filled = False
    for name in ("o2_percent", "pressure_kpa", "pressure_psi", "flow_cm_s"):
        values = [
            getattr(test, name)
            for test in record.tests
            if getattr(test, name) is not None and getattr(test, name) > 0 and test.evidence
        ]
        if not values:
            continue
        for end, pick in (("min", min), ("max", max)):
            key = f"{name}_{end}"
            current = data.get(key)
            if current is None or (name.startswith("pressure") and current <= 0):
                data[key] = pick(values)
                filled = True
    if filled:
        refs = [ref.model_dump() for test in record.tests for ref in test.evidence]
        data["sources"] = _merge_sources(data.get("sources") or [], refs)
    return Investigation.model_validate(data)


def range_problems(record: Investigation) -> list[str]:
    """Values that cannot be right, or tests that fall outside the stated range."""
    problems: list[str] = []
    for name in ("o2_percent", "pressure_kpa", "pressure_psi", "flow_cm_s"):
        low = getattr(record, f"{name}_min")
        high = getattr(record, f"{name}_max")
        if low is not None and high is not None and low > high:
            problems.append(f"{name}: min {low:g} is above max {high:g}")
        if name.startswith("pressure") and low is not None and low <= 0:
            problems.append(f"{name}_min is {low:g}, which cannot support a flame")
        if name == "o2_percent":
            for value in (low, high):
                if value is not None and not 0 < value <= 100:
                    problems.append(f"o2_percent {value:g} is outside 0-100")
        if name == "flow_cm_s" and low is not None and low < 0:
            problems.append(f"flow_cm_s_min is negative ({low:g})")
        outside = [
            test.sample_id or "?"
            for test in record.tests
            if (value := getattr(test, name)) is not None
            and (
                (low is not None and value < low - _tolerance(low))
                or (high is not None and value > high + _tolerance(high))
            )
        ]
        if outside:
            listed = ", ".join(outside[:5])
            problems.append(f"{len(outside)} test(s) outside the stated {name} range ({listed})")
    for test in record.tests:
        for name in ("pressure_kpa", "pressure_psi"):
            value = getattr(test, name)
            if value is not None and value <= 0:
                problems.append(f"test {test.sample_id or '?'}: {name} is {value:g}")
        if test.o2_percent is not None and not 0 < test.o2_percent <= 100:
            problems.append(f"test {test.sample_id or '?'}: o2_percent {test.o2_percent:g} is outside 0-100")
        if test.spread_rate_mm_s is not None and test.spread_rate_mm_s < 0:
            problems.append(f"test {test.sample_id or '?'}: negative spread rate")
    return problems


def _tolerance(value: float) -> float:
    """Rounding slack for unit conversions."""
    return max(abs(value) * 0.001, 1e-6)


def _validate_tests(
    text: str,
    table: TableRows,
    expected: int | None,
    *,
    strict: bool = True,
) -> list[TestCondition]:
    try:
        payload = parse_model_json(text)
    except (ValueError, json.JSONDecodeError):
        if strict:
            raise
        return []
    items = payload.get("tests") if isinstance(payload.get("tests"), list) else []
    tests: list[TestCondition] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        prepared, _ = _prepare_test({**item, "evidence": [table.ref()]})
        try:
            tests.append(TestCondition.model_validate(prepared))
        except ValidationError:
            if strict:
                raise
    if strict and expected is not None and len(tests) != expected:
        raise ValueError(f"expected {expected} tests, one per row, got {len(tests)}")
    return tests


def render_block(block: TextBlock) -> str:
    lines = [
        f"FILE: {block.file_name}",
        f"TITLE: {block.title}",
        f"URL: {block.url}",
        f"DOI: {block.doi or ''}",
        f"SOURCE_TYPE: {block.source_type}",
    ]
    for page, text in block.pages:
        lines.append(f"--- page {page} ---")
        lines.append(text)
    return "\n".join(lines)


def pack_blocks(blocks: list[TextBlock], max_chars: int) -> list[list[TextBlock]]:
    """One batch when the text fits. Otherwise one file, or page groups, per batch."""
    batches: list[list[TextBlock]] = []
    current: list[TextBlock] = []
    size = 0
    for block in blocks:
        text = render_block(block)
        if len(text) > max_chars:
            if current:
                batches.append(current)
                current, size = [], 0
            batches.extend([part] for part in _split_block(block, max_chars))
            continue
        if current and size + len(text) > max_chars:
            batches.append(current)
            current, size = [], 0
        current.append(block)
        size += len(text)
    if current:
        batches.append(current)
    return batches or [[]]


def build_prompt(
    entry: CatalogEntry,
    blocks: list[TextBlock],
    *,
    error: str | None = None,
    previous: str | None = None,
) -> str:
    sources = "\n\n".join(render_block(block) for block in blocks)
    kind = "partial file" if len(blocks) == 1 else "investigation"
    lines = [
        "Catalog values to copy exactly:",
        f"id: {entry.id}",
        f"name: {entry.name}",
        f"acronym: {entry.acronym}",
        f"tier: {entry.tier}",
        f"psi_url: {entry.psi_url}",
        "",
        f"Extract the {kind} from the source text.",
        "Return one JSON object matching the schema.",
        "",
        sources,
    ]
    if error:
        lines.extend(
            [
                "",
                "The previous JSON failed validation. Fix it using only the source text.",
                error,
                "",
                "Previous JSON:",
                previous or "",
            ]
        )
    return "\n".join(lines)


def parse_model_json(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.IGNORECASE)
    payload = json.loads(cleaned)
    if not isinstance(payload, dict):
        raise ValueError("model response was not a JSON object")
    if set(payload) == {"error"}:
        raise ValueError(str(payload["error"]))
    return payload


def prepare_payload(payload: dict, entry: CatalogEntry) -> tuple[dict, bool]:
    """Normalize labels and fill the missing pressure unit. Returns needs_review."""
    data = dict(payload)
    review = bool(data.get("needs_review"))
    data["id"] = entry.id
    data["name"] = entry.name
    data["acronym"] = entry.acronym
    data["tier"] = entry.tier
    data["psi_url"] = entry.psi_url
    data["hardware"] = _hardware(data.get("hardware"))
    data["platform"] = _mapped_list(data.get("platform"), PLATFORM_ALIASES)
    data["category"] = _mapped_list(data.get("category"), CATEGORY_ALIASES)
    data["fuel_phase"] = _choice(data.get("fuel_phase"), FUEL_PHASES)
    data["gravity"] = _choice(data.get("gravity"), set(GRAVITY_ALIASES), GRAVITY_ALIASES)
    data["program"] = _blank_to_none(data.get("program"))
    data["years"] = _blank_to_none(data.get("years"))
    data["approach"] = _blank_to_none(data.get("approach"))
    data["sample_geometry"] = _blank_to_none(data.get("sample_geometry"))
    data["sample_size"] = _blank_to_none(data.get("sample_size"))
    data["fire_safety_relevance"] = _blank_to_none(data.get("fire_safety_relevance")) or ""
    for name in ("objectives", "fuels", "diluents", "variables_varied", "variables_fixed", "sensors"):
        data[name] = _string_list(data.get(name))
    for name in RANGE_FIELDS:
        number, dropped = _as_float(data.get(name))
        data[name] = number
        review = review or dropped
    data["pressure_kpa_min"], data["pressure_psi_min"], conflict_min = _pressure_pair(
        data.get("pressure_kpa_min"), data.get("pressure_psi_min")
    )
    data["pressure_kpa_max"], data["pressure_psi_max"], conflict_max = _pressure_pair(
        data.get("pressure_kpa_max"), data.get("pressure_psi_max")
    )
    review = review or conflict_min or conflict_max
    data["sources"] = _source_list(data.get("sources"))
    for name in FINDING_FIELDS:
        data[name] = _finding_list(data.get(name))
    tests: list[dict] = []
    for item in data.get("tests") or []:
        if isinstance(item, dict):
            prepared, test_review = _prepare_test(item)
            tests.append(prepared)
            review = review or test_review
    data["tests"] = tests
    data["needs_review"] = review
    data["reviewed"] = False
    data["reviewed_by"] = None
    return data, review


def validate_record(
    payload: dict,
    entry: CatalogEntry,
    valid_pages: dict[str, set[int]] | None = None,
) -> Investigation:
    prepared, _ = prepare_payload(payload, entry)
    record = Investigation.model_validate(prepared)
    if valid_pages is not None:
        errors = citation_errors(record, valid_pages)
        if errors:
            raise ValueError("invalid citations: " + "; ".join(errors[:20]))
    return record


def valid_pages_for(blocks: list[TextBlock]) -> dict[str, set[int]]:
    pages: dict[str, set[int]] = {}
    for block in blocks:
        pages.setdefault(block.file_name, set()).update(page for page, _ in block.pages)
    return pages


def citation_errors(record: Investigation, valid_pages: dict[str, set[int]]) -> list[str]:
    """Citations to a file that was not supplied, or to a page that file does not have."""
    errors: list[str] = []
    for ref in _all_refs(record.model_dump()):
        file_name = ref.get("file_name")
        page = ref.get("page")
        if file_name not in valid_pages:
            errors.append(f"{file_name} was not in the source text")
        elif page not in valid_pages[file_name]:
            listed = ", ".join(str(number) for number in sorted(valid_pages[file_name]))
            errors.append(f"{file_name} has no page {page} (pages: {listed})")
    return errors


def drop_invalid_citations(payload: dict, valid_pages: dict[str, set[int]]) -> dict:
    """Remove citations that point nowhere, then anything left without evidence."""

    def keep(ref: dict) -> bool:
        return ref.get("page") in valid_pages.get(str(ref.get("file_name")), set())

    data = dict(payload)
    data["sources"] = [ref for ref in data.get("sources") or [] if keep(ref)]
    for name in FINDING_FIELDS:
        findings = []
        for item in data.get(name) or []:
            evidence = [ref for ref in item.get("evidence") or [] if keep(ref)]
            if evidence:
                findings.append({**item, "evidence": evidence})
        data[name] = findings
    tests = []
    for item in data.get("tests") or []:
        evidence = [ref for ref in item.get("evidence") or [] if keep(ref)]
        test = {**item, "evidence": evidence}
        if not evidence:
            for number in TEST_NUMBER_FIELDS:
                test[number] = None
        tests.append(test)
    data["tests"] = tests
    if not data["sources"]:
        for name in RANGE_FIELDS:
            data[name] = None
    return data


def _all_refs(record: dict) -> list[dict]:
    refs = list(record.get("sources") or [])
    for name in FINDING_FIELDS:
        for item in record.get(name) or []:
            refs.extend(item.get("evidence") or [])
    for item in record.get("tests") or []:
        refs.extend(item.get("evidence") or [])
    return refs


def merge_records(records: list[Investigation]) -> Investigation:
    """Union list fields. Conflicting scalars are kept from the first record and flagged."""
    if not records:
        raise ValueError("no records to merge")
    merged = records[0].model_dump()
    review = any(record.needs_review for record in records)
    for record in records[1:]:
        incoming = record.model_dump()
        for name, value in incoming.items():
            if name in {"id", "name", "acronym", "tier", "psi_url", "needs_review"}:
                continue
            current = merged.get(name)
            if isinstance(value, list):
                merged[name] = _merge_list(name, current or [], value)
            elif current in (None, "") and value not in (None, ""):
                merged[name] = value
            elif (
                value not in (None, "")
                and current not in (None, "")
                and value != current
            ):
                review = True
        review = review or _range_conflict(merged, incoming)
    merged["needs_review"] = review
    return Investigation.model_validate(merged)


def extract_investigation(
    entry: CatalogEntry,
    blocks: list[TextBlock],
    generate: Callable[[str], str],
    *,
    tables: list[TableRows] | None = None,
    generate_tests: Callable[[str], str] | None = None,
    max_chars: int = DEFAULT_MAX_CHARS,
    rows_per_call: int = DEFAULT_ROWS_PER_CALL,
    table_problems: list[str] | None = None,
) -> Extraction:
    """Documents first, then table rows. Validate, retry once, then mark needs_review."""
    batches = pack_blocks(blocks, max_chars)
    parts: list[Investigation] = []
    responses: list[str] = []
    reasons: list[str] = list(table_problems or [])
    for batch in batches:
        record, raw = _extract_batch(entry, batch, generate)
        parts.append(record)
        responses.extend(raw)
    record = parts[0] if len(parts) == 1 else merge_records(parts)
    if record.needs_review:
        reasons.append(
            "document extraction was flagged: failed validation twice, "
            "a kPa/psi mismatch, or conflicting values between files"
        )
    if generate_tests is not None:
        for table in tables or []:
            tests, raw, problems = extract_table_tests(
                entry, table, generate_tests, rows_per_call=rows_per_call
            )
            responses.extend(raw)
            reasons.extend(problems)
            data = record.model_dump()
            data["tests"] = _merge_tests(data["tests"], [test.model_dump() for test in tests])
            record = Investigation.model_validate(data)
        record = fill_ranges_from_tests(record)
    reasons.extend(range_problems(record))
    if reasons:
        record = record.model_copy(update={"needs_review": True})
    return Extraction(record=record, responses=responses, review_reasons=reasons)


def blank_investigation(entry: CatalogEntry) -> Investigation:
    return Investigation(
        id=entry.id,
        name=entry.name,
        acronym=entry.acronym,
        tier=entry.tier,  # type: ignore[arg-type]
        psi_url=entry.psi_url,
        needs_review=True,
    )


def read_cache(path: Path, entry: CatalogEntry) -> Extraction | None:
    if not path.is_file():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    reasons = [str(item) for item in payload.get("review_reasons") or []]
    record = payload.get("record")
    try:
        parsed = Investigation.model_validate(record) if isinstance(record, dict) else None
    except ValidationError:
        parsed = None
    if parsed is None:
        return Extraction(
            record=blank_investigation(entry),
            responses=[],
            from_cache=True,
            review_reasons=reasons or ["cached record could not be read"],
        )
    return Extraction(record=parsed, responses=[], from_cache=True, review_reasons=reasons)


def write_cache(path: Path, entry: CatalogEntry, extraction: Extraction, model: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "investigation_id": entry.id,
        "model": model,
        "responses": extraction.responses,
        "review_reasons": extraction.review_reasons,
        "record": extraction.record.model_dump(mode="json"),
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load_investigations(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    return []


def write_investigations(path: Path, records: list[Investigation]) -> list[str]:
    """Merge records into the file. Human-reviewed records are kept; returns their ids."""
    existing = {
        item.get("id"): item
        for item in load_investigations(path)
        if item.get("id")
    }
    kept: list[str] = []
    for record in records:
        if (existing.get(record.id) or {}).get("reviewed"):
            kept.append(record.id)
            continue
        existing[record.id] = record.model_dump(mode="json")
    ordered = sorted(existing.values(), key=_id_key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(ordered, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return kept


def field_counts(record: Investigation) -> tuple[int, int]:
    """Filled values, then null or empty values, across top-level fields."""
    filled = nulls = 0
    for value in record.model_dump().values():
        if value is None or value == [] or value == "":
            nulls += 1
        else:
            filled += 1
    return filled, nulls


def format_summary(extractions: list[Extraction]) -> str:
    header = f"{'id':<10} {'filled':>7} {'null':>7} {'tests':>7}  review"
    lines = ["Extraction summary", header]
    ordered = sorted(extractions, key=lambda item: _id_key(item.record.model_dump()))
    for extraction in ordered:
        record = extraction.record
        filled, nulls = field_counts(record)
        review = "yes" if record.needs_review else "no"
        cached = "  (cached)" if extraction.from_cache else ""
        lines.append(
            f"{record.id:<10} {filled:7d} {nulls:7d} {len(record.tests):7d}  {review}{cached}"
        )
    flagged = [item for item in ordered if item.review_reasons]
    if flagged:
        lines.extend(["", "Review reasons"])
        for extraction in flagged:
            for reason in extraction.review_reasons:
                lines.append(f"  {extraction.record.id}: {reason}")
    return "\n".join(lines)


def run(
    entries: list[CatalogEntry],
    *,
    processed_dir: Path,
    sources_csv: Path,
    out_path: Path,
    cache_dir: Path,
    generate: Callable[[str], str],
    model_name: str,
    raw_dir: Path = DEFAULT_RAW,
    generate_tests: Callable[[str], str] | None = None,
    force: bool = False,
    max_chars: int = DEFAULT_MAX_CHARS,
    rows_per_call: int = DEFAULT_ROWS_PER_CALL,
) -> list[Extraction]:
    extractions: list[Extraction] = []
    for entry in entries:
        cache_path = cache_dir / f"{entry.id}.json"
        if cache_path.is_file() and not force:
            cached = read_cache(cache_path, entry)
            if cached is not None:
                extractions.append(cached)
                write_investigations(out_path, [item.record for item in extractions])
                continue
        blocks = load_blocks(entry, processed_dir, sources_csv)
        tables, table_problems = (
            load_tables(entry, raw_dir, blocks) if generate_tests is not None else ([], [])
        )
        extraction = extract_investigation(
            entry,
            blocks,
            generate,
            tables=tables,
            generate_tests=generate_tests,
            max_chars=max_chars,
            rows_per_call=rows_per_call,
            table_problems=table_problems,
        )
        write_cache(cache_path, entry, extraction, model_name)
        extractions.append(extraction)
        write_investigations(out_path, [item.record for item in extractions])
    return extractions


def _extract_batch(
    entry: CatalogEntry,
    blocks: list[TextBlock],
    generate: Callable[[str], str],
) -> tuple[Investigation, list[str]]:
    valid_pages = valid_pages_for(blocks)
    prompt = build_prompt(entry, blocks)
    first = _call(generate, prompt)
    try:
        return validate_record(parse_model_json(first), entry, valid_pages), [first]
    except (ValidationError, ValueError, json.JSONDecodeError) as exc:
        error = str(exc)
    retry_prompt = build_prompt(entry, blocks, error=error, previous=first)
    second = _call(generate, retry_prompt)
    try:
        return validate_record(parse_model_json(second), entry, valid_pages), [first, second]
    except (ValidationError, ValueError, json.JSONDecodeError):
        try:
            payload = parse_model_json(second)
        except (ValueError, json.JSONDecodeError):
            return blank_investigation(entry), [first, second]
        return _salvage(payload, entry, valid_pages), [first, second]


def _call(generate: Callable[[str], str], prompt: str) -> str:
    try:
        return generate(prompt)
    except RuntimeError as exc:
        return json.dumps({"error": str(exc)})


def _salvage(
    payload: dict,
    entry: CatalogEntry,
    valid_pages: dict[str, set[int]] | None = None,
) -> Investigation:
    prepared, _ = prepare_payload(payload, entry)
    if valid_pages is not None:
        prepared = drop_invalid_citations(prepared, valid_pages)
    prepared["needs_review"] = True
    for name in FINDING_FIELDS:
        prepared[name] = [
            item
            for item in prepared.get(name) or []
            if isinstance(item, dict) and item.get("text") and item.get("evidence")
        ]
    tests = []
    for item in prepared.get("tests") or []:
        if not item.get("evidence"):
            for number in TEST_NUMBER_FIELDS:
                item[number] = None
        tests.append(item)
    prepared["tests"] = tests
    if not prepared.get("sources"):
        for name in RANGE_FIELDS:
            prepared[name] = None
    try:
        return Investigation.model_validate(prepared)
    except ValidationError:
        return blank_investigation(entry)


def _prepare_test(item: dict) -> tuple[dict, bool]:
    review = False
    prepared = dict(item)
    for name in ("sample_id", "fuel", "sample_geometry", "diluent", "notes"):
        prepared[name] = _blank_to_none(prepared.get(name))
    outcome = str(prepared.get("outcome") or "unknown").strip().lower().replace(" ", "_")
    prepared["outcome"] = outcome if outcome in OUTCOMES else "unknown"
    for name in TEST_NUMBER_FIELDS:
        number, dropped = _as_float(prepared.get(name))
        prepared[name] = number
        review = review or dropped
    kpa, psi, conflict = _pressure_pair(prepared.get("pressure_kpa"), prepared.get("pressure_psi"))
    prepared["pressure_kpa"] = kpa
    prepared["pressure_psi"] = psi
    prepared["evidence"] = _source_list(prepared.get("evidence"))
    prepared["reviewed"] = False
    prepared["reviewed_by"] = None
    return prepared, review or conflict


def _pressure_pair(kpa: float | None, psi: float | None) -> tuple[float | None, float | None, bool]:
    if kpa is None and psi is None:
        return None, None, False
    if kpa is None and psi is not None:
        return round(psi * KPA_PER_PSI, 4), psi, False
    if psi is None and kpa is not None:
        return kpa, round(kpa * PSI_PER_KPA, 4), False
    assert kpa is not None and psi is not None
    expected = kpa * PSI_PER_KPA
    conflict = abs(expected - psi) > max(0.2, abs(expected) * 0.02)
    return kpa, psi, conflict


def _as_float(value: object) -> tuple[float | None, bool]:
    if value is None or value == "":
        return None, False
    if isinstance(value, bool):
        return None, True
    if isinstance(value, (int, float)):
        return float(value), False
    if isinstance(value, str):
        try:
            return float(value.strip()), False
        except ValueError:
            return None, True
    return None, True


def _blank_to_none(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"null", "none", "unknown", "n/a"}:
        return None
    return text


def _choice(value: object, allowed: set[str], aliases: dict[str, str] | None = None) -> str | None:
    text = _blank_to_none(value)
    if text is None:
        return None
    key = text.lower()
    if aliases and key in aliases:
        return aliases[key]
    if key in allowed:
        return key
    return None


def _hardware(value: object) -> str | None:
    text = _blank_to_none(value)
    if text is None:
        return None
    key = text.lower()
    if key in HARDWARE_ALIASES:
        return HARDWARE_ALIASES[key]
    for alias, name in HARDWARE_ALIASES.items():
        if alias in key:
            return name
    return "other"


def _mapped_list(value: object, aliases: dict[str, str]) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    chosen: list[str] = []
    for item in value:
        text = _blank_to_none(item)
        if text is None:
            continue
        mapped = aliases.get(text.lower())
        if mapped and mapped not in chosen:
            chosen.append(mapped)
    return chosen


def _string_list(value: object) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    chosen: list[str] = []
    for item in value:
        text = _blank_to_none(item)
        if text and text not in chosen:
            chosen.append(text)
    return chosen


def _source_list(value: object) -> list[dict]:
    if not isinstance(value, list):
        return []
    sources: list[dict] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        page, dropped = _as_float(item.get("page"))
        if dropped or page is None or page < 1:
            continue
        sources.append(
            {
                "file_name": str(item.get("file_name") or ""),
                "title": str(item.get("title") or ""),
                "url": str(item.get("url") or ""),
                "doi": _blank_to_none(item.get("doi")),
                "page": int(page),
            }
        )
    return sources


def _finding_list(value: object) -> list[dict]:
    if not isinstance(value, list):
        return []
    findings = []
    for item in value:
        if not isinstance(item, dict):
            continue
        findings.append(
            {
                "text": str(item.get("text") or "").strip(),
                "evidence": _source_list(item.get("evidence")),
            }
        )
    return findings


def _merge_list(name: str, current: list, incoming: list) -> list:
    if name in FINDING_FIELDS:
        return _merge_findings(current, incoming)
    if name == "tests":
        return _merge_tests(current, incoming)
    if name == "sources":
        return _merge_sources(current, incoming)
    merged = list(current)
    for item in incoming:
        if item not in merged:
            merged.append(item)
    return merged


def _merge_findings(current: list, incoming: list) -> list:
    merged = [dict(item) for item in current]
    index = {_finding_key(item): item for item in merged}
    for item in incoming:
        key = _finding_key(item)
        if key in index:
            index[key]["evidence"] = _merge_sources(index[key].get("evidence") or [], item.get("evidence") or [])
        else:
            copied = dict(item)
            merged.append(copied)
            index[key] = copied
    return merged


def _merge_tests(current: list, incoming: list) -> list:
    merged = [dict(item) for item in current]
    index = {_test_key(item): item for item in merged}
    for item in incoming:
        key = _test_key(item)
        if key in index:
            index[key]["evidence"] = _merge_sources(index[key].get("evidence") or [], item.get("evidence") or [])
        else:
            copied = dict(item)
            merged.append(copied)
            index[key] = copied
    return merged


def _merge_sources(current: list, incoming: list) -> list:
    merged = list(current)
    seen = {_source_key(item) for item in merged}
    for item in incoming:
        key = _source_key(item)
        if key not in seen:
            merged.append(item)
            seen.add(key)
    return merged


def _finding_key(item: dict) -> str:
    return re.sub(r"\s+", " ", str(item.get("text") or "").strip().lower())


def _test_key(item: dict) -> tuple:
    return (
        item.get("sample_id"),
        item.get("fuel"),
        item.get("o2_percent"),
        item.get("pressure_kpa"),
        item.get("flow_cm_s"),
        item.get("outcome"),
        item.get("notes"),
    )


def _source_key(item: dict) -> tuple:
    return (item.get("file_name"), item.get("page"), item.get("doi"))


def _range_conflict(current: dict, incoming: dict) -> bool:
    for name in RANGE_FIELDS:
        left = current.get(name)
        right = incoming.get(name)
        if left is not None and right is not None and left != right:
            return True
    return False


def _split_block(block: TextBlock, max_chars: int) -> list[TextBlock]:
    parts: list[TextBlock] = []
    pages: list[tuple[int, str]] = []
    size = 0
    for page, text in block.pages:
        if pages and size + len(text) > max_chars:
            parts.append(_copy_block(block, pages))
            pages, size = [], 0
        pages.append((page, text))
        size += len(text)
    if pages:
        parts.append(_copy_block(block, pages))
    return parts or [_copy_block(block, block.pages)]


def _copy_block(block: TextBlock, pages: list[tuple[int, str]]) -> TextBlock:
    return TextBlock(
        file_name=block.file_name,
        title=block.title,
        url=block.url,
        doi=block.doi,
        source_type=block.source_type,
        pages=pages,
    )


def _acronym_from_notes(notes: str) -> str:
    match = re.search(r"acronym=([^;]+)", notes)
    if not match:
        return ""
    acronym = match.group(1).strip()
    return "" if acronym.lower() == "none" else acronym


def _aliases(entry: CatalogEntry) -> set[str]:
    names = {entry.id, entry.acronym, entry.name}
    names.update(part.strip() for part in re.split(r"[/,]", entry.acronym) if part.strip())
    return {name.lower() for name in names if name}


def _id_key(record: dict) -> tuple[int, str]:
    match = re.search(r"(\d+)$", str(record.get("id") or ""))
    number = int(match.group(1)) if match else 0
    return number, str(record.get("id") or "")


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract PSI investigations with Vertex Gemini.")
    parser.add_argument("--raw", type=Path, default=DEFAULT_RAW)
    parser.add_argument("--processed", type=Path, default=DEFAULT_PROCESSED)
    parser.add_argument("--sources", type=Path, default=DEFAULT_RAW / "sources.csv")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--only", default="", help="Comma-separated ids or acronyms, e.g. BASS,FLEX")
    parser.add_argument("--force", action="store_true", help="Ignore cached responses")
    parser.add_argument("--max-chars", type=int, default=DEFAULT_MAX_CHARS)
    parser.add_argument("--rows-per-call", type=int, default=DEFAULT_ROWS_PER_CALL)
    parser.add_argument("--no-tables", action="store_true", help="Skip per-row test extraction")
    args = parser.parse_args()
    try:
        settings = load_settings()
    except ConfigError as exc:
        raise SystemExit(str(exc)) from exc
    entries = select_entries(load_catalog(args.raw, args.processed), args.only)
    generator = GeminiGenerator(settings)
    extractions = run(
        entries,
        processed_dir=args.processed,
        sources_csv=args.sources,
        out_path=args.out,
        cache_dir=args.cache,
        generate=generator.generate,
        model_name=generator.model,
        raw_dir=args.raw,
        generate_tests=None if args.no_tables else generator.generate_tests,
        force=args.force,
        max_chars=args.max_chars,
        rows_per_call=args.rows_per_call,
    )
    print(format_summary(extractions))
    kept = [
        item["id"]
        for item in load_investigations(args.out)
        if item.get("reviewed") and item.get("id") in {entry.id for entry in entries}
    ]
    if kept:
        print()
        print("Kept human-reviewed records in", args.out.name, "(set reviewed to false to replace):")
        print("  " + ", ".join(kept))
    for extraction in extractions:
        print()
        print(f"RECORD {extraction.record.id}")
        print(json.dumps(extraction.record.model_dump(mode="json"), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
