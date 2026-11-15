import json

import pytest

from gaps import (
    GRAVITY_CLASSES,
    PARTIAL_GRAVITY_GAP,
    bins_touched,
    build_gaps,
    main,
    make_grid,
    place,
)


def investigation(id_, gravity="microgravity", tests=None, **ranges):
    record = {
        "id": id_,
        "acronym": id_.replace("PSI-", "X"),
        "gravity": gravity,
        "o2_percent_min": None,
        "o2_percent_max": None,
        "pressure_kpa_min": None,
        "pressure_kpa_max": None,
        "pressure_psi_min": None,
        "pressure_psi_max": None,
        "tests": tests or [],
    }
    record.update(ranges)
    return record


def row(o2=None, psi=None, kpa=None):
    return {"o2_percent": o2, "pressure_psi": psi, "pressure_kpa": kpa}


HABITATS = [
    {"id": "iss", "name": "ISS", "o2_percent": 21.0, "pressure_psi": 14.7, "pressure_kpa": 101.35,
     "gravity_classes": ["microgravity"], "assumed": False},
    {"id": "moon", "name": "Moon base", "o2_percent": 34.0, "pressure_psi": 8.0, "pressure_kpa": 55.16,
     "gravity_classes": ["partial"], "assumed": False},
    {"id": "mars", "name": "Mars", "o2_percent": 34.0, "pressure_psi": 8.0, "pressure_kpa": 55.16,
     "gravity_classes": ["partial"], "assumed": True},
]


def fake_dataset():
    return [
        # Range box only: 20-30% O2 at 10-15 psi, microgravity.
        investigation("PSI-1", o2_percent_min=20.0, o2_percent_max=30.0,
                      pressure_psi_min=10.0, pressure_psi_max=15.0),
        # Tests win over the much wider range.
        investigation("PSI-2", gravity="normal", tests=[row(o2=40.0, psi=8.0), row(o2=40.0, psi=8.0)],
                      o2_percent_min=15.0, o2_percent_max=100.0,
                      pressure_psi_min=2.0, pressure_psi_max=16.0),
        # No ranges and no tests: cannot be placed.
        investigation("PSI-3"),
        # A proxy, never partial-gravity coverage.
        investigation("PSI-4", gravity="simulated_partial", o2_percent_min=21.0, o2_percent_max=21.0,
                      pressure_psi_min=14.7, pressure_psi_max=14.7),
    ]


def cell(result, gravity, o2, psi):
    return next(
        item for item in result["grid"]["cells"]
        if item["gravity"] == gravity and item["o2_min"] <= o2 < item["o2_max"] and item["psi_min"] <= psi < item["psi_max"]
    )


def test_grid_spans_requested_limits():
    grid = make_grid()
    assert grid.o2_edges[0] == 15 and grid.o2_edges[-1] == 100
    assert grid.psi_edges[0] == 2 and grid.psi_edges[-1] == 16
    assert len(grid.o2_edges) - 1 == 17
    assert len(grid.psi_edges) - 1 == 14


def test_grid_edges_end_at_limit_when_step_does_not_divide():
    grid = make_grid(o2_step=40, psi_step=5)
    assert grid.o2_edges == (15, 55, 95, 100)
    assert grid.psi_edges == (2, 7, 12, 16)


def test_point_on_edge_falls_in_upper_bin_and_top_edge_in_last_bin():
    edges = (15.0, 20.0, 25.0)
    assert bins_touched((20.0, 20.0), edges) == [1]
    assert bins_touched((25.0, 25.0), edges) == [1]
    assert bins_touched((10.0, 12.0), edges) == []
    assert bins_touched((18.0, 22.0), edges) == [0, 1]


def test_cells_cover_every_gravity_class():
    result = build_gaps(fake_dataset(), HABITATS)
    assert {item["gravity"] for item in result["grid"]["cells"]} == set(GRAVITY_CLASSES)
    assert len(result["grid"]["cells"]) == 17 * 14 * 3


def test_range_box_covers_cells():
    result = build_gaps(fake_dataset(), HABITATS)
    assert cell(result, "microgravity", 21.0, 14.7)["investigation_ids"] == ["PSI-1"]
    assert cell(result, "microgravity", 29.0, 10.5)["covered"]
    assert not cell(result, "microgravity", 36.0, 14.7)["covered"]
    assert not cell(result, "normal", 21.0, 14.7)["covered"]


def test_tests_are_used_instead_of_ranges():
    result = build_gaps(fake_dataset(), HABITATS)
    placement = next(item for item in result["placements"] if item["investigation_id"] == "PSI-2")
    assert placement["basis"] == "tests"
    assert placement["points"] == 1
    assert cell(result, "normal", 40.0, 8.0)["investigation_ids"] == ["PSI-2"]
    assert not cell(result, "normal", 80.0, 3.0)["covered"]


def test_test_missing_an_axis_uses_investigation_range():
    record = investigation("PSI-9", tests=[row(o2=25.0)], pressure_psi_min=14.7, pressure_psi_max=14.7)
    placement, _ = place(record)
    assert placement.basis == "tests"
    assert placement.boxes[0].o2 == (25.0, 25.0)
    assert placement.boxes[0].psi == (14.7, 14.7)


def test_kpa_only_values_are_converted_and_bad_pressures_ignored():
    record = investigation("PSI-9", tests=[row(o2=21.0, kpa=101.325), row(o2=30.0, psi=0.0)],
                           pressure_kpa_min=0.0, pressure_kpa_max=101.325)
    placement, _ = place(record)
    assert placement.boxes[0].psi == pytest.approx((14.6959, 14.6959), abs=1e-3)
    assert placement.boxes[1].psi == pytest.approx((14.6959, 14.6959), abs=1e-3)


def test_single_known_range_end_is_one_value():
    placement, _ = place(investigation("PSI-9", o2_percent_min=21.0, pressure_psi_max=14.7))
    assert placement.basis == "ranges"
    assert placement.boxes[0].o2 == (21.0, 21.0)
    assert placement.boxes[0].psi == (14.7, 14.7)


def test_unplaced_investigations_say_why():
    result = build_gaps(fake_dataset(), HABITATS)
    reasons = {item["investigation_id"]: item["reason"] for item in result["unplaced"]}
    assert "pressure" in reasons["PSI-3"] and "oxygen" in reasons["PSI-3"]
    assert "proxy" in reasons["PSI-4"]
    assert result["grid"]["coverage"]["partial"]["covered_cells"] == 0


def test_habitat_inside_tested_conditions():
    result = build_gaps(fake_dataset(), HABITATS)
    iss = next(item for item in result["habitats"] if item["habitat_id"] == "iss")
    assert iss["inside_tested"] is True
    assert iss["covering_investigation_ids"] == ["PSI-1"]
    assert iss["nearest_same_gravity"][0]["investigation_id"] == "PSI-1"
    assert iss["nearest_same_gravity"][0]["distance"] == 0


def test_habitat_outside_reports_nearest_and_distance():
    result = build_gaps(fake_dataset(), HABITATS)
    moon = next(item for item in result["habitats"] if item["habitat_id"] == "moon")
    assert moon["inside_tested"] is False
    assert moon["nearest_same_gravity"] == []
    nearest = moon["nearest_any_gravity"][0]
    assert nearest["investigation_id"] == "PSI-2"
    assert nearest["delta_o2_percent"] == pytest.approx(6.0)
    assert nearest["delta_pressure_psi"] == pytest.approx(0.0)
    assert nearest["distance"] == pytest.approx(round(6 / 85, 4))
    second = moon["nearest_any_gravity"][1]
    assert second["investigation_id"] == "PSI-1"
    assert second["nearest_o2_percent"] == 30.0 and second["nearest_pressure_psi"] == 10.0


def test_partial_gravity_gap_is_always_present_with_three_notes():
    for records in (fake_dataset(), []):
        gaps = build_gaps(records, HABITATS)["gaps"]
        partial = gaps[0]
        assert partial["title"] == "No partial-gravity combustion data in PSI"
        assert partial["notes"] == PARTIAL_GRAVITY_GAP["notes"]
        assert len(partial["notes"]) == 3
        assert any("LUCI" in note and "FM2" in note for note in partial["notes"])
        assert any("E-FIELD" in note and "proxy" in note for note in partial["notes"])
        assert any("bound" in note for note in partial["notes"])


def test_partial_gap_lists_real_partial_data_if_it_ever_appears():
    records = [investigation("PSI-7", gravity="partial", o2_percent_min=34.0, pressure_psi_min=8.0)]
    result = build_gaps(records, HABITATS)
    assert result["gaps"][0]["partial_gravity_investigations_found"] == ["PSI-7"]
    moon = next(item for item in result["habitats"] if item["habitat_id"] == "moon")
    assert moon["inside_tested"] is True


def test_habitat_gaps_only_for_untested_presets():
    gaps = build_gaps(fake_dataset(), HABITATS)["gaps"]
    ids = [gap["id"] for gap in gaps]
    assert "habitat_moon_partial" in ids
    assert "habitat_iss_microgravity" not in ids
    mars = next(gap for gap in gaps if gap["id"] == "habitat_mars_partial")
    assert "assumed" in mars["text"]


def test_habitat_with_two_gravity_classes_gets_two_reports():
    suit = {"id": "suit", "name": "Spacesuit", "o2_percent": 100.0, "pressure_psi": 4.3,
            "gravity_classes": ["microgravity", "partial"]}
    reports = build_gaps(fake_dataset(), [suit])["habitats"]
    assert [item["gravity"] for item in reports] == ["microgravity", "partial"]


def test_main_writes_gaps_json(tmp_path, capsys):
    data = tmp_path / "investigations.json"
    habitats = tmp_path / "habitats.json"
    out = tmp_path / "gaps.json"
    data.write_text(json.dumps(fake_dataset()))
    habitats.write_text(json.dumps(HABITATS))
    assert main(["--data", str(data), "--habitats", str(habitats), "--out", str(out)]) == 0
    written = json.loads(out.read_text())
    assert written["gaps"][0]["id"] == "no_partial_gravity"
    assert "Coverage" in capsys.readouterr().out
