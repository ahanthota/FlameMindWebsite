"""Ranker scoring against fixture investigations."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ai.ranker import WEIGHTS, axis_closeness, rank, score_investigation, make_test_id

RECORDS = json.loads((Path(__file__).parent / "fixtures" / "investigations.json").read_text())
BY_ID = {record["id"]: record for record in RECORDS}


def conditions(**values):
    return {"materials": [], "other_parameters": [], **values}


def test_weights_sum_to_one():
    assert sum(WEIGHTS.values()) == pytest.approx(1.0)
    assert WEIGHTS == {"conditions": 0.50, "materials": 0.25, "intent": 0.15, "airflow": 0.10}


def test_axis_closeness_is_one_inside_and_falls_to_zero():
    assert axis_closeness("o2_percent", 21, 16, 21) == 1.0
    assert axis_closeness("o2_percent", 34, 21) == pytest.approx(1 - (13 / 85) / 0.35)
    assert axis_closeness("o2_percent", 100, 21) == 0.0


def test_exact_test_match_scores_full_marks_and_names_the_test():
    result = score_investigation(
        BY_ID["PSI-25"],
        conditions(o2_percent=21, pressure_psi=14.7, flow_cm_s=10, materials=["cotton fabric"]),
        "find_data",
    )
    assert result.score == pytest.approx(1.0)
    assert result.parts == {"conditions": 1.0, "airflow": 1.0, "materials": 1.0, "intent": 1.0}
    assert result.tests[0].test_id == make_test_id("PSI-25", 0) == "PSI-25-T1"
    assert "PSI-25-T1" in result.reasons[0]


def test_tests_are_used_before_ranges_and_kpa_is_converted():
    result = score_investigation(BY_ID["PSI-25"], conditions(o2_percent=16, pressure_psi=14.7), "find_data")
    assert result.parts["conditions"] == pytest.approx(1.0, abs=0.01)
    assert result.tests[0].test_id == "PSI-25-T2"
    assert result.tests[0].values["pressure_psi"] == pytest.approx(14.69, abs=0.01)


def test_ranges_are_used_when_there_are_no_tests():
    result = score_investigation(BY_ID["PSI-68"], conditions(o2_percent=34, pressure_psi=8), "find_data")
    assert result.parts["conditions"] == 1.0  # 50 kPa = 7.25 psi, 304 kPa = 44 psi
    assert result.tests == []
    assert "covers" in result.reasons[0]


def test_moon_base_conditions_rank_the_covering_investigation_first():
    ranked = rank(RECORDS, conditions(o2_percent=34, pressure_psi=8), "find_data")
    assert [item.investigation_id for item in ranked] == ["PSI-68", "PSI-25", "PSI-101"]
    assert ranked[0].score > ranked[1].score > ranked[2].score


def test_material_groups_and_phase():
    exact = score_investigation(BY_ID["PSI-25"], conditions(materials=["PMMA"]), "other")
    similar = score_investigation(BY_ID["PSI-25"], conditions(materials=["acrylic panels"]), "other")
    phase = score_investigation(BY_ID["PSI-101"], conditions(materials=["wood"], fuel_phase="solid"), "other")
    miss = score_investigation(BY_ID["PSI-68"], conditions(materials=["wood"], fuel_phase="solid"), "other")
    assert (exact.parts["materials"], similar.parts["materials"]) == (1.0, 0.8)
    assert (phase.parts["materials"], miss.parts["materials"]) == (0.5, 0.0)
    assert "does not match wood" in miss.reasons[0]


def test_missing_values_score_zero_with_a_plain_reason():
    result = score_investigation(BY_ID["PSI-101"], conditions(o2_percent=21, pressure_psi=14.7), "find_data")
    assert result.parts["conditions"] == 0.0
    assert "no oxygen values recorded" in result.reasons[0]
    assert result.parts["intent"] == 0.2


def test_parts_without_a_question_are_left_out_and_reweighted():
    result = score_investigation(BY_ID["PSI-25"], conditions(), "explain")
    assert result.parts == {"intent": 1.0}
    assert result.score == 1.0
    nothing = score_investigation(BY_ID["PSI-25"], conditions(), "other")
    assert nothing.parts == {} and nothing.score == 0.0


def test_weighted_sum_matches_the_stated_weights():
    result = score_investigation(
        BY_ID["PSI-68"], conditions(o2_percent=34, pressure_psi=8, flow_cm_s=10, materials=["cotton"]), "find_data"
    )
    # conditions 1.0, materials 0.0, intent 0.6 (ranges only), airflow 0.0 (none recorded)
    assert result.score == pytest.approx(0.5 * 1.0 + 0.25 * 0.0 + 0.15 * 0.6 + 0.10 * 0.0)


def test_gravity_mismatch_is_explained():
    result = score_investigation(BY_ID["PSI-25"], conditions(o2_percent=21, gravity="partial"), "find_data")
    assert "Run in microgravity, not partial gravity." in result.reasons
