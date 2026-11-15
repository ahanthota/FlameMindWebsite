"""POST /filter/parse and /filter/derive with Gemini mocked."""

from __future__ import annotations

import json

import pytest

from ai.derive import appears_in, cache_key
from ai.units import convert, normalize_unit

MAPPED_KEYS = {"kind", "field", "level", "min", "max", "unit", "interpretation"}
DERIVED_KEYS = {"kind", "parameter", "min", "max", "unit", "interpretation"}
ROW_KEYS = {"investigation_id", "test_id", "value", "unit", "status", "citation"}


def parse(client, llm, **parsed):
    llm.parsed = parsed
    response = client.post("/filter/parse", json={"text": "anything"})
    assert response.status_code == 200
    return response.json()


# ---------- unit conversion ----------


@pytest.mark.parametrize(
    ("value", "source", "target", "expected"),
    [
        (101.325, "kPa", "psi", 14.696),
        (1, "atm", "psi", 14.696),
        (20, "mm/s", "cm/s", 2.0),
        (0.5, "m/s", "cm/s", 50.0),
        (0.3, "mole fraction", "%", 30.0),
        (25, "°C", "K", 298.15),
        (0.01, "inch", "mm", 0.254),
        (5, "cm per second", "cm/s", 5.0),
        (3, "widgets", "widgets", 3.0),
    ],
)
def test_convert(value, source, target, expected):
    assert convert(value, source, target) == pytest.approx(expected, abs=1e-3)


def test_convert_refuses_units_that_do_not_compare():
    assert convert(3, "psi", "mm") is None
    assert convert(3, "layers", "mm") is None
    assert normalize_unit("kW/m²") == "kw/m2"


# ---------- /filter/parse ----------


def test_mapped_pressure_is_converted_from_kpa_to_psi(client, llm):
    body = parse(client, llm, kind="mapped", field="pressure_psi", level="investigation", min=50, max=101.325, unit="kPa")
    assert set(body) == MAPPED_KEYS
    assert body["kind"] == "mapped" and body["field"] == "pressure_psi" and body["unit"] == "psi"
    assert body["min"] == pytest.approx(7.2519, abs=1e-3) and body["max"] == pytest.approx(14.696, abs=1e-3)
    assert body["interpretation"] == "Pressure between 7.2519 and 14.6959 psi"


def test_mapped_airflow_is_converted_from_mm_s_to_cm_s(client, llm):
    body = parse(client, llm, kind="mapped", field="flow_cm_s", level="test", min=None, max=50, unit="mm/s")
    assert (body["min"], body["max"], body["unit"], body["level"]) == (None, 5.0, "cm/s", "test")
    assert body["interpretation"] == "Airflow speed at most 5 cm/s"


def test_mapped_defaults_unit_level_and_orders_the_range(client, llm):
    body = parse(client, llm, kind="mapped", field="o2_percent", min=40, max=30, unit=None)
    assert (body["min"], body["max"], body["unit"], body["level"]) == (30.0, 40.0, "%", "investigation")
    # Spread rate exists only on tests, whatever level the model picked.
    body = parse(client, llm, kind="mapped", field="spread_rate_mm_s", level="investigation", min=0.2, max=None, unit="cm/s")
    assert (body["level"], body["min"], body["unit"]) == ("test", 2.0, "mm/s")


def test_derived_when_no_field_holds_the_parameter(client, llm):
    body = parse(client, llm, kind="derived", parameter="Sample  Thickness", min=0.1, max=0.5, unit="mm")
    assert set(body) == DERIVED_KEYS
    assert body == {
        "kind": "derived", "parameter": "sample thickness", "min": 0.1, "max": 0.5, "unit": "mm",
        "interpretation": "Sample thickness between 0.1 and 0.5 mm",
    }


def test_a_field_outside_the_schema_becomes_derived(client, llm):
    body = parse(client, llm, kind="mapped", field="fuel_temperature", min=300, max=None, unit="K")
    assert body["kind"] == "derived" and body["parameter"] == "fuel temperature"


def test_unclear_cases(client, llm):
    body = parse(client, llm, kind="unclear", question="Which parameter and range do you mean?")
    assert body == {"kind": "unclear", "question": "Which parameter and range do you mean?"}
    # No numbers at all, even if the model called it mapped.
    assert parse(client, llm, kind="mapped", field="o2_percent")["kind"] == "unclear"
    # A unit that cannot be converted to the field's unit.
    body = parse(client, llm, kind="mapped", field="pressure_psi", min=3, max=5, unit="mm")
    assert body["kind"] == "unclear" and "psi" in body["question"]


# ---------- /filter/derive ----------

# Passages are numbered per batch: PSI-25 gets [1] (21% oxygen text) and [2] (2 cm/s text), PSI-68 gets [3].
FOUND = [
    {"investigation_id": "PSI-25", "sample": "A2", "value": 2, "unit": "cm/s", "citation": 2},
    {"investigation_id": "PSI-25", "value": 7, "unit": "cm/s", "citation": 1},  # 7 is not written in passage 1
    {"investigation_id": "PSI-68", "value": 2, "unit": "cm/s", "citation": 2},  # cites another investigation's passage
    {"investigation_id": "PSI-999", "value": 2, "unit": "cm/s", "citation": 1},  # not asked about
]


def derive(client, **body):
    response = client.post("/filter/derive", json={"parameter": "Airflow speed", **body})
    assert response.status_code == 200
    return response.json()


def test_derive_normalizes_units_checks_citations_and_reports_missing_values(client, llm):
    llm.found = FOUND
    body = derive(client, min=10, max=30, unit="mm/s")
    assert set(body) == {"parameter", "min", "max", "unit", "results"}
    assert body["parameter"] == "airflow speed"
    rows = {row["investigation_id"]: row for row in body["results"]}
    assert all(set(row) == ROW_KEYS for row in body["results"])
    assert len(body["results"]) == 2  # the estimated and mis-cited values were dropped

    match = rows["PSI-25"]
    assert (match["status"], match["value"], match["unit"]) == ("match", 20.0, "mm/s")  # 2 cm/s = 20 mm/s
    assert match["test_id"] == "PSI-25-T2"  # sample A2 is the second test in the record
    assert match["citation"]["page_start"] == 2 and match["citation"]["title"] == "PSI-25 report"

    assert rows["PSI-68"] == {
        "investigation_id": "PSI-68", "test_id": None, "value": None, "unit": None,
        "status": "not_reported", "citation": None,
    }


def test_derive_not_reported_when_the_model_finds_nothing(client, llm):
    llm.found = [{"investigation_id": "PSI-25", "value": None, "unit": None, "citation": None}]
    body = derive(client, min=1, max=2, unit="mm")
    assert [row["status"] for row in body["results"]] == ["not_reported", "not_reported"]
    assert all(row["value"] is None for row in body["results"])


def test_derive_value_in_an_incomparable_unit_is_not_reported(client, llm):
    llm.found = [FOUND[0]]
    body = derive(client, min=1, max=5, unit="kPa", investigation_ids=["PSI-25"])
    assert [row["status"] for row in body["results"]] == ["not_reported"]


def test_derive_cache_makes_a_repeat_instant_and_is_persisted(client, llm, data, tmp_path):
    data.derived_cache_path = tmp_path / "derived_cache.json"
    llm.found = FOUND
    derive(client, min=10, max=30, unit="mm/s")
    assert llm.count("FoundValues") == 1 and llm.count("embed") == 1

    llm.calls.clear()
    again = derive(client, parameter="  airflow-SPEED ", min=0, max=1, unit="cm/s")  # same key, new range and unit
    assert llm.calls == []
    assert [row["status"] for row in again["results"]] == ["no_match", "not_reported"]
    assert again["results"][0]["value"] == 2.0

    saved = json.loads((tmp_path / "derived_cache.json").read_text())
    assert list(saved) == ["airflow speed"]
    assert saved["airflow speed"]["PSI-68"] == [] and saved["airflow speed"]["PSI-25"][0]["value"] == 2


def test_derive_only_asks_about_investigations_not_yet_cached(client, llm):
    llm.found = FOUND
    derive(client, investigation_ids=["PSI-25"])
    assert "INVESTIGATION PSI-68" not in next(prompt for name, prompt in llm.calls if name == "FoundValues")
    llm.calls.clear()
    derive(client)  # all investigations: only PSI-68 is new
    prompt = next(prompt for name, prompt in llm.calls if name == "FoundValues")
    assert "INVESTIGATION PSI-68" in prompt and "INVESTIGATION PSI-25" not in prompt


def test_derive_rejects_unknown_investigations(client):
    response = client.post("/filter/derive", json={"parameter": "thickness", "investigation_ids": ["PSI-404"]})
    assert response.status_code == 422


def test_helpers():
    assert cache_key(" Sample-Thickness (mm) ") == "sample thickness mm"
    assert appears_in(0.5, "thickness of 0.50 mm") and appears_in(1000, "1,000 K")
    assert not appears_in(5, "sample 15 and 0.5")
