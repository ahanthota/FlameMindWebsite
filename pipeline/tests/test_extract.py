"""Tests for extraction helpers. No network and no Vertex calls."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from extract import (
    CatalogEntry,
    TableRows,
    TextBlock,
    build_prompt,
    build_test_prompt,
    extract_investigation,
    extract_table_tests,
    fill_ranges_from_tests,
    merge_records,
    pack_blocks,
    prepare_payload,
    range_problems,
    run,
    select_entries,
    validate_record,
    write_investigations,
)
from schema import Investigation

ENTRY = CatalogEntry(
    id="PSI-26",
    name="Burning and Suppression of Solids",
    acronym="BASS",
    tier="A",
    psi_url="https://psi.example/PSI-26",
)
FLEX = CatalogEntry(
    id="PSI-69",
    name="Flame Extinguishment Experiment",
    acronym="FLEX",
    tier="A",
    psi_url="https://psi.example/PSI-69",
)
BASS_II = CatalogEntry(
    id="PSI-25",
    name="BASS-II",
    acronym="BASS-II",
    tier="A",
    psi_url="https://psi.example/PSI-25",
)


def _source() -> dict:
    return {
        "file_name": "overview/overview.md",
        "title": "BASS",
        "url": ENTRY.psi_url,
        "doi": "10.1000/bass",
        "page": 1,
    }


def _overview_block() -> TextBlock:
    return TextBlock(
        "overview/overview.md",
        "BASS",
        ENTRY.psi_url,
        "10.1000/bass",
        "psi_overview",
        [(1, "Nitrogen was used as a suppressant.")],
    )


def _payload() -> dict:
    return {
        "id": "wrong",
        "name": "wrong",
        "acronym": "wrong",
        "tier": "B",
        "psi_url": "https://example.invalid",
        "hardware": "Microgravity Science Glovebox",
        "platform": ["International Space Station"],
        "years": "2009-2013",
        "objectives": ["Assess gaseous extinguishment."],
        "approach": "Samples burned in the MSG.",
        "category": ["suppression"],
        "fuel_phase": "solid",
        "fuels": ["cotton"],
        "gravity": "microgravity",
        "pressure_psi_min": 14.7,
        "sources": [_source()],
        "key_findings": [
            {"text": "Nitrogen was used as a suppressant.", "evidence": [_source()]}
        ],
        "needs_review": False,
    }


def test_catalog_identity_and_pressure_conversion() -> None:
    record = validate_record(_payload(), ENTRY)
    assert record.id == "PSI-26"
    assert record.acronym == "BASS"
    assert record.tier == "A"
    assert record.hardware == "MSG"
    assert record.platform == ["ISS"]
    assert record.pressure_psi_min == 14.7
    assert record.pressure_kpa_min == pytest.approx(14.7 * 6.894757)


def test_conflicting_pressure_units_need_review() -> None:
    payload = _payload()
    payload["pressure_kpa_min"] = 50
    prepared, review = prepare_payload(payload, ENTRY)
    assert review is True
    assert prepared["pressure_kpa_min"] == 50
    assert prepared["pressure_psi_min"] == 14.7


def test_only_matches_acronym_tokens() -> None:
    chosen = select_entries([ENTRY, FLEX, BASS_II], "BASS,FLEX")
    assert [entry.id for entry in chosen] == ["PSI-26", "PSI-69"]


def test_unknown_only_name_exits() -> None:
    with pytest.raises(SystemExit):
        select_entries([ENTRY], "NOPE")


def test_long_text_is_split_by_file() -> None:
    blocks = [
        TextBlock("a.md", "A", "https://psi.example/a", None, "document", [(1, "x" * 40)]),
        TextBlock("b.md", "B", "https://psi.example/b", None, "document", [(1, "y" * 40)]),
    ]
    batches = pack_blocks(blocks, max_chars=80)
    assert len(batches) == 2
    assert batches[0][0].file_name == "a.md"


def test_retry_uses_the_validation_error_then_accepts(tmp_path: Path) -> None:
    bad = json.dumps(
        {
            "key_findings": [{"text": "A claim with no page.", "evidence": []}],
        }
    )
    good = json.dumps(_payload())
    prompts: list[str] = []

    def generate(prompt: str) -> str:
        prompts.append(prompt)
        return bad if len(prompts) == 1 else good

    extraction = extract_investigation(ENTRY, [_overview_block()], generate, max_chars=1000)
    assert len(prompts) == 2
    assert "failed validation" in prompts[1]
    assert extraction.record.hardware == "MSG"
    assert extraction.record.needs_review is False


def test_citation_to_a_missing_page_is_retried_then_dropped() -> None:
    payload = _payload()
    bad_ref = {**_source(), "page": 4}
    payload["key_findings"] = [
        {"text": "Real page.", "evidence": [_source()]},
        {"text": "Invented page.", "evidence": [bad_ref]},
    ]
    payload["tests"] = [{"sample_id": "7", "flow_cm_s": 10, "evidence": [bad_ref]}]
    prompts: list[str] = []

    def generate(prompt: str) -> str:
        prompts.append(prompt)
        return json.dumps(payload)

    extraction = extract_investigation(ENTRY, [_overview_block()], generate, max_chars=10_000)
    assert len(prompts) == 2
    assert "has no page 4" in prompts[1]
    record = extraction.record
    assert record.needs_review is True
    assert [finding.text for finding in record.key_findings] == ["Real page."]
    assert record.tests[0].flow_cm_s is None
    assert record.tests[0].evidence == []


def test_failed_model_calls_do_not_become_an_empty_valid_record() -> None:
    def generate(_prompt: str) -> str:
        raise RuntimeError("Gemini call failed after 6 attempt(s): 429")

    extraction = extract_investigation(ENTRY, [_overview_block()], generate, max_chars=1000)
    assert extraction.record.needs_review is True
    assert extraction.review_reasons


def test_second_failure_marks_needs_review() -> None:
    bad = "this is not json"

    extraction = extract_investigation(ENTRY, [], lambda _prompt: bad, max_chars=1000)
    assert extraction.record.needs_review is True
    assert extraction.record.id == "PSI-26"
    assert extraction.record.objectives == []


def test_merge_flags_conflicting_ranges() -> None:
    left = validate_record(_payload(), ENTRY)
    other = _payload()
    other["pressure_psi_min"] = 10
    other["pressure_kpa_min"] = None
    right = validate_record(other, ENTRY)
    merged = merge_records([left, right])
    assert merged.needs_review is True
    assert merged.pressure_psi_min == 14.7


def test_cache_skips_the_model(tmp_path: Path) -> None:
    record = validate_record(_payload(), ENTRY)
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "PSI-26.json").write_text(
        json.dumps({"record": record.model_dump(mode="json")}),
        encoding="utf-8",
    )
    calls: list[str] = []
    out = tmp_path / "investigations.json"
    records = run(
        [ENTRY],
        processed_dir=tmp_path / "processed",
        sources_csv=tmp_path / "sources.csv",
        out_path=out,
        cache_dir=cache,
        generate=lambda prompt: calls.append(prompt) or "{}",
        model_name="example",
    )
    assert calls == []
    assert records[0].record.id == "PSI-26"
    assert records[0].from_cache is True
    saved = json.loads(out.read_text(encoding="utf-8"))
    assert saved[0]["acronym"] == "BASS"


def test_response_schema_accepts_the_investigation_model() -> None:
    from google.genai import types

    config = types.GenerateContentConfig(
        temperature=0,
        response_mime_type="application/json",
        response_schema=Investigation,
    )
    assert config.response_mime_type == "application/json"
    assert config.response_schema is not None


def test_finding_without_evidence_is_rejected() -> None:
    payload = _payload()
    payload["key_findings"] = [{"text": "No page.", "evidence": []}]
    with pytest.raises(ValidationError):
        validate_record(payload, ENTRY)


def test_prompt_names_the_catalog_and_page_marker() -> None:
    block = TextBlock(
        "overview/overview.md",
        "BASS",
        ENTRY.psi_url,
        "10.1000/bass",
        "psi_overview",
        [(1, "Airflow reached 40 cm/s.")],
    )
    prompt = build_prompt(ENTRY, [block])
    assert "id: PSI-26" in prompt
    assert "tier: A" in prompt
    assert "--- page 1 ---" in prompt
    assert "40 cm/s" in prompt


def _flex_table() -> TableRows:
    return TableRows(
        file_name="tables/flex.csv",
        title="FLEX table",
        url=FLEX.psi_url,
        doi=None,
        headers=["FLEX Test #", "Fuel", "Ambient pressure; mmHg", "O2; mole fraction"],
        rows=[
            ["1", "Heptane", "760", "0.21"],
            ["2", "Heptane", "1520", "0.18"],
            ["3", "Methanol", "0", "0.20"],
        ],
    )


def _row_tests(rows: list[tuple[str, float | None, float]]) -> str:
    tests = []
    for sample_id, kpa, o2 in rows:
        tests.append({"sample_id": sample_id, "fuel": "Heptane", "pressure_kpa": kpa, "o2_percent": o2})
    return json.dumps({"tests": tests})


def test_table_prompt_numbers_rows_and_asks_for_one_test_each() -> None:
    table = _flex_table()
    prompt = build_test_prompt(FLEX, table, 3, table.rows[2:])
    assert "Rows 3 to 3. Return exactly 1 tests." in prompt
    assert "row,FLEX Test #,Fuel" in prompt
    assert "3,3,Methanol,0,0.20" in prompt


def test_table_tests_get_table_evidence_and_both_pressure_units() -> None:
    table = _flex_table()
    reply = _row_tests([("1", 101.325, 21), ("2", 202.65, 18), ("3", None, 20)])
    tests, responses, problems = extract_table_tests(FLEX, table, lambda _p: reply, rows_per_call=10)
    assert problems == []
    assert len(responses) == 1
    assert [test.sample_id for test in tests] == ["1", "2", "3"]
    assert tests[0].pressure_psi == pytest.approx(14.6959, rel=1e-4)
    assert tests[0].evidence[0].file_name == "tables/flex.csv"
    assert tests[0].evidence[0].page == 1


def test_wrong_test_count_is_retried_then_reported() -> None:
    table = _flex_table()
    short = _row_tests([("1", 101.325, 21)])
    prompts: list[str] = []

    def generate(prompt: str) -> str:
        prompts.append(prompt)
        return short

    tests, _responses, problems = extract_table_tests(FLEX, table, generate, rows_per_call=10)
    assert len(prompts) == 2
    assert "expected 3 tests" in prompts[1]
    assert len(tests) == 1
    assert problems and "rows 1-3" in problems[0]


def test_rows_are_sent_in_groups() -> None:
    table = _flex_table()
    replies = iter([_row_tests([("1", 101.3, 21), ("2", 202.6, 18)]), _row_tests([("3", None, 20)])])
    tests, responses, problems = extract_table_tests(
        FLEX, table, lambda _p: next(replies), rows_per_call=2
    )
    assert problems == []
    assert len(responses) == 2
    assert len(tests) == 3


def _flex_record(**ranges: float | None) -> Investigation:
    return Investigation.model_validate(
        {
            "id": FLEX.id,
            "name": FLEX.name,
            "acronym": FLEX.acronym,
            "tier": "A",
            "psi_url": FLEX.psi_url,
            "sources": [_source()],
            **ranges,
        }
    )


def test_zero_pressure_is_replaced_from_tests_and_valid_ends_are_kept() -> None:
    table = _flex_table()
    reply = _row_tests([("1", 101.325, 21), ("2", 202.65, 18), ("3", None, 20)])
    tests, _, _ = extract_table_tests(FLEX, table, lambda _p: reply, rows_per_call=10)
    record = _flex_record(pressure_kpa_min=0.0, pressure_kpa_max=309.29, o2_percent_min=12.0)
    record = record.model_copy(update={"tests": tests})
    filled = fill_ranges_from_tests(record)
    assert filled.pressure_kpa_min == pytest.approx(101.325)
    assert filled.pressure_kpa_max == pytest.approx(309.29)
    assert filled.o2_percent_min == 12.0
    assert filled.o2_percent_max == 21
    assert any(ref.file_name == "tables/flex.csv" for ref in filled.sources)


def test_rounding_differences_are_not_flagged() -> None:
    table = _flex_table()
    reply = _row_tests([("1", 309.2937, 21), ("2", 202.65, 18), ("3", None, 20)])
    tests, _, _ = extract_table_tests(FLEX, table, lambda _p: reply, rows_per_call=10)
    record = _flex_record(pressure_kpa_min=50.66, pressure_kpa_max=309.29, pressure_psi_max=44.8592)
    record = record.model_copy(update={"tests": tests})
    assert range_problems(record) == []


def test_range_problems_catch_impossible_values() -> None:
    record = _flex_record(pressure_kpa_min=0.0, pressure_kpa_max=300.0, o2_percent_min=40.0, o2_percent_max=30.0)
    problems = range_problems(record)
    assert any("pressure_kpa_min is 0" in problem for problem in problems)
    assert any("o2_percent: min 40 is above max 30" in problem for problem in problems)


def test_table_problems_mark_the_record_for_review() -> None:
    table = _flex_table()
    payload = _payload()
    payload["sources"] = [_source()]

    extraction = extract_investigation(
        ENTRY,
        [_overview_block()],
        lambda _p: json.dumps(payload),
        tables=[table],
        generate_tests=lambda _p: _row_tests([("1", 101.325, 21)]),
    )
    assert extraction.record.needs_review is True
    assert any("rows 1-3" in reason for reason in extraction.review_reasons)


def test_rewrite_keeps_human_reviewed_records(tmp_path: Path) -> None:
    out = tmp_path / "investigations.json"
    reviewed = {
        "id": "PSI-26", "name": "x", "acronym": "BASS", "tier": "A", "psi_url": "u",
        "o2_percent_max": 99.0, "reviewed": True, "reviewed_by": "KT",
    }
    out.write_text(json.dumps([reviewed]))
    fresh = Investigation(id="PSI-26", name="x", acronym="BASS", tier="A", psi_url="u")
    other = Investigation(id="PSI-69", name="y", acronym="FLEX", tier="A", psi_url="u")
    kept = write_investigations(out, [fresh, other])
    saved = {item["id"]: item for item in json.loads(out.read_text())}
    assert kept == ["PSI-26"]
    assert saved["PSI-26"]["o2_percent_max"] == 99.0
    assert saved["PSI-69"]["reviewed"] is False


def test_model_cannot_mark_its_own_output_reviewed() -> None:
    payload = {"reviewed": True, "reviewed_by": "AI", "tests": [{"reviewed": True, "reviewed_by": "AI"}]}
    prepared, _ = prepare_payload(payload, ENTRY)
    assert prepared["reviewed"] is False and prepared["reviewed_by"] is None
    assert prepared["tests"][0]["reviewed"] is False and prepared["tests"][0]["reviewed_by"] is None
