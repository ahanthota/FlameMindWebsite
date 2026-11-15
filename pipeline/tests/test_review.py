import json

import pytest

from review import export, load_table, main, merge_review, normalize_initials

SOURCE = {"file_name": "doc.pdf", "title": "Doc", "url": "https://psi.example/1", "doi": "10.1/abc", "page": 2}


def record():
    return {
        "id": "PSI-1",
        "name": "Example",
        "acronym": "EX",
        "tier": "A",
        "psi_url": "https://psi.example/PSI-1",
        "o2_percent_min": 21.0,
        "o2_percent_max": 30.0,
        "pressure_kpa_min": 101.325,
        "pressure_kpa_max": None,
        "pressure_psi_min": 14.6959,
        "pressure_psi_max": None,
        "gravity": "microgravity",
        "fuels": ["PMMA", "cotton"],
        "diluents": [],
        "sources": [SOURCE],
        "tests": [
            {"sample_id": "1", "o2_percent": 21.0, "pressure_kpa": None, "pressure_psi": None,
             "outcome": "ignited", "evidence": [SOURCE]},
            {"sample_id": "2", "o2_percent": None, "outcome": "unknown", "evidence": []},
        ],
        "needs_review": True,
        "custom_field": "kept",
    }


def exported(tmp_path, records):
    inv_path, tests_path = export(records, tmp_path)
    return load_table(inv_path), load_table(tests_path)


def test_export_has_one_row_per_investigation_and_test(tmp_path):
    inv, tests = exported(tmp_path, [record()])
    assert len(inv) == 1 and len(tests) == 2
    assert inv[0]["fuels"] == "PMMA; cotton"
    assert inv[0]["source_links"] == "https://doi.org/10.1/abc"
    assert inv[0]["needs_review"] == "true"
    assert tests[1]["test_index"] == "2"
    assert tests[0]["evidence"] == "doc.pdf p.2"


def test_unchanged_import_changes_nothing(tmp_path):
    inv, tests = exported(tmp_path, [record()])
    result = merge_review([record()], inv, tests, "kt")
    assert result.errors == []
    assert result.changes == []
    assert "reviewed" not in result.records[0]


def test_edit_marks_row_reviewed_and_keeps_other_fields(tmp_path):
    inv, tests = exported(tmp_path, [record()])
    inv[0]["o2_percent_max"] = "35"
    inv[0]["needs_review"] = "FALSE"
    tests[1]["outcome"] = "Extinguished"
    result = merge_review([record()], inv, tests, "kt")
    assert result.errors == []
    merged = result.records[0]
    assert merged["o2_percent_max"] == 35.0
    assert merged["needs_review"] is False
    assert merged["reviewed"] is True and merged["reviewed_by"] == "KT"
    assert merged["custom_field"] == "kept"
    assert merged["sources"] == [SOURCE]
    assert merged["tests"][1]["outcome"] == "extinguished"
    assert merged["tests"][1]["reviewed_by"] == "KT"
    assert "reviewed" not in merged["tests"][0]


def test_sign_off_without_edits_by_setting_reviewed(tmp_path):
    inv, tests = exported(tmp_path, [record()])
    inv[0]["reviewed"] = "yes"
    result = merge_review([record()], inv, tests, "AB")
    assert result.records[0]["reviewed"] is True
    assert result.records[0]["reviewed_by"] == "AB"


def test_editing_one_pressure_unit_fills_the_other(tmp_path):
    inv, tests = exported(tmp_path, [record()])
    inv[0]["pressure_psi_max"] = "10.2"
    result = merge_review([record()], inv, tests, "KT")
    assert result.errors == []
    assert result.records[0]["pressure_kpa_max"] == pytest.approx(70.3265, abs=1e-3)


def test_conflicting_pressure_pair_is_rejected(tmp_path):
    inv, tests = exported(tmp_path, [record()])
    inv[0]["pressure_psi_max"] = "10.2"
    inv[0]["pressure_kpa_max"] = "50"
    result = merge_review([record()], inv, tests, "KT")
    assert any("disagree" in error for error in result.errors)
    assert result.records[0]["pressure_psi_max"] is None


def test_invalid_values_reject_the_whole_import(tmp_path):
    inv, tests = exported(tmp_path, [record()])
    inv[0]["gravity"] = "lunar"
    tests[0]["o2_percent"] = "abc"
    tests[1]["o2_percent"] = "21"
    result = merge_review([record()], inv, tests, "KT")
    assert any("o2_percent: not a number" in error for error in result.errors)
    assert any("gravity" in error for error in result.errors)
    assert any("tests.1" in error for error in result.errors)
    assert result.records[0]["gravity"] == "microgravity"


def test_unknown_rows_are_errors(tmp_path):
    inv, tests = exported(tmp_path, [record()])
    inv[0]["id"] = "PSI-999"
    tests[0]["test_index"] = "7"
    result = merge_review([record()], inv, tests, "KT")
    assert any("unknown id" in error for error in result.errors)
    assert any("no test 7" in error for error in result.errors)


def test_deleted_columns_are_left_alone(tmp_path):
    inv, tests = exported(tmp_path, [record()])
    for row in inv:
        del row["fuels"]
    result = merge_review([record()], inv, tests, "KT")
    assert result.records[0]["fuels"] == ["PMMA", "cotton"]


def test_initials_are_checked():
    assert normalize_initials(" kt ") == "KT"
    with pytest.raises(ValueError):
        normalize_initials("K")
    with pytest.raises(ValueError):
        normalize_initials("K.T.")


def test_main_round_trip(tmp_path, capsys):
    data = tmp_path / "investigations.json"
    review_dir = tmp_path / "review"
    data.write_text(json.dumps([record()]))
    assert main(["--data", str(data), "--review-dir", str(review_dir), "export"]) == 0
    text = (review_dir / "investigations.csv").read_text(encoding="utf-8-sig")
    (review_dir / "investigations.csv").write_text(text.replace("21.0,30.0", "21.0,34.0"), encoding="utf-8")
    assert main(["--data", str(data), "--review-dir", str(review_dir), "import", "--initials", "KT", "--dry-run"]) == 0
    assert json.loads(data.read_text())[0]["o2_percent_max"] == 30.0
    assert main(["--data", str(data), "--review-dir", str(review_dir), "import", "--initials", "KT"]) == 0
    saved = json.loads(data.read_text())[0]
    assert saved["o2_percent_max"] == 34.0 and saved["reviewed_by"] == "KT"
    assert "o2_percent_max: 30.0 -> 34.0" in capsys.readouterr().out
