"""Tested-condition coverage and gaps for habitat presets.

Builds a grid over O2 % x pressure (psi) x gravity class from
data/investigations.json, checks each preset in data/habitats.json against it,
and writes data/gaps.json.

An investigation is placed by its tests when tests give O2 or pressure; a
missing axis on a test falls back to the investigation range. Without usable
tests, the investigation's range box is used. A range with one known end is
treated as that single value. Simulated partial gravity is a proxy and is not
counted as partial-gravity coverage.
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA = ROOT / "data" / "investigations.json"
DEFAULT_HABITATS = ROOT / "data" / "habitats.json"
DEFAULT_OUT = ROOT / "data" / "gaps.json"

O2_LIMITS = (15.0, 100.0)
PSI_LIMITS = (2.0, 16.0)
DEFAULT_O2_STEP = 5.0
DEFAULT_PSI_STEP = 1.0
GRAVITY_CLASSES: tuple[str, ...] = ("microgravity", "partial", "normal")
KPA_PER_PSI = 6.894757
NEAREST_COUNT = 3

PARTIAL_GRAVITY_GAP = {
    "id": "no_partial_gravity",
    "title": "No partial-gravity combustion data in PSI",
    "text": (
        "No PSI combustion investigation was run at Moon or Mars gravity. "
        "Habitat presets at partial gravity can only be compared with microgravity and 1 g results."
    ),
    "notes": [
        "Upcoming LUCI and FM2 experiments will add partial-gravity data.",
        "E-FIELD Flames uses an electric field to mimic some gravity effects. "
        "It is a partial proxy, not real partial gravity.",
        "Microgravity and 1 g results bound the expected behavior in between.",
    ],
    "related_investigation_ids": ["PSI-22"],
}

Interval = tuple[float, float]


@dataclass(frozen=True)
class Box:
    o2: Interval
    psi: Interval


@dataclass
class Placement:
    investigation_id: str
    acronym: str
    gravity: str
    basis: str  # "tests" or "ranges"
    boxes: list[Box] = field(default_factory=list)


@dataclass(frozen=True)
class Grid:
    o2_edges: tuple[float, ...]
    psi_edges: tuple[float, ...]


def make_grid(o2_step: float = DEFAULT_O2_STEP, psi_step: float = DEFAULT_PSI_STEP) -> Grid:
    return Grid(_edges(*O2_LIMITS, o2_step), _edges(*PSI_LIMITS, psi_step))


def _edges(low: float, high: float, step: float) -> tuple[float, ...]:
    if step <= 0:
        raise ValueError("grid step must be positive")
    count = math.ceil((high - low) / step - 1e-9)
    return tuple(round(min(low + index * step, high), 6) for index in range(count)) + (high,)


def bins_touched(interval: Interval, edges: tuple[float, ...]) -> list[int]:
    """Bin indexes an interval overlaps. Bins are [left, right), the last one closed."""
    low, high = interval
    last = len(edges) - 2
    touched = []
    for index in range(len(edges) - 1):
        left, right = edges[index], edges[index + 1]
        starts_before_right = low < right or (index == last and low <= right)
        if starts_before_right and high >= left:
            touched.append(index)
    return touched


# ---------- placement ----------


def place(record: dict) -> tuple[Placement | None, str | None]:
    """Where an investigation sits on the grid, or why it cannot be placed."""
    gravity = record.get("gravity")
    if gravity == "simulated_partial":
        return None, "simulated partial gravity is a proxy and is not counted as partial-gravity coverage"
    if gravity not in GRAVITY_CLASSES:
        return None, "gravity not recorded"
    o2_range = _interval(record.get("o2_percent_min"), record.get("o2_percent_max"), _valid_o2)
    psi_range = _interval(_psi(record, "min"), _psi(record, "max"), _valid_pressure)

    test_boxes: set[Box] = set()
    for test in record.get("tests") or []:
        o2 = test.get("o2_percent")
        psi = _test_psi(test)
        o2_own = o2 is not None and _valid_o2(o2)
        psi_own = psi is not None and _valid_pressure(psi)
        if not (o2_own or psi_own):
            continue
        o2_interval = (float(o2), float(o2)) if o2_own else o2_range
        psi_interval = (psi, psi) if psi_own else psi_range
        if o2_interval and psi_interval:
            test_boxes.add(Box(o2_interval, psi_interval))

    placement = Placement(
        investigation_id=str(record.get("id")),
        acronym=str(record.get("acronym") or ""),
        gravity=gravity,
        basis="tests",
    )
    if test_boxes:
        placement.boxes = sorted(test_boxes, key=lambda box: (box.o2, box.psi))
        return placement, None
    if o2_range and psi_range:
        placement.basis = "ranges"
        placement.boxes = [Box(o2_range, psi_range)]
        return placement, None
    missing = [name for name, value in (("oxygen", o2_range), ("pressure", psi_range)) if not value]
    return None, f"no {' or '.join(missing)} values in tests or ranges"


def _psi(record: dict, end: str) -> float | None:
    psi = record.get(f"pressure_psi_{end}")
    if psi is not None:
        return float(psi)
    kpa = record.get(f"pressure_kpa_{end}")
    return None if kpa is None else float(kpa) / KPA_PER_PSI


def _test_psi(test: dict) -> float | None:
    if test.get("pressure_psi") is not None:
        return float(test["pressure_psi"])
    if test.get("pressure_kpa") is not None:
        return float(test["pressure_kpa"]) / KPA_PER_PSI
    return None


def _interval(low: float | None, high: float | None, valid) -> Interval | None:
    values = [float(value) for value in (low, high) if value is not None and valid(value)]
    if not values:
        return None
    return min(values), max(values)


def _valid_o2(value: float) -> bool:
    return 0 < float(value) <= 100


def _valid_pressure(value: float) -> bool:
    return float(value) > 0


# ---------- grid coverage ----------


def build_cells(grid: Grid, placements: list[Placement]) -> list[dict]:
    covered: dict[tuple[str, int, int], set[str]] = {}
    for placement in placements:
        for box in placement.boxes:
            for o2_index in bins_touched(box.o2, grid.o2_edges):
                for psi_index in bins_touched(box.psi, grid.psi_edges):
                    key = (placement.gravity, o2_index, psi_index)
                    covered.setdefault(key, set()).add(placement.investigation_id)
    cells = []
    for gravity in GRAVITY_CLASSES:
        for o2_index in range(len(grid.o2_edges) - 1):
            for psi_index in range(len(grid.psi_edges) - 1):
                ids = sorted(covered.get((gravity, o2_index, psi_index), set()), key=_id_key)
                cells.append(
                    {
                        "gravity": gravity,
                        "o2_min": grid.o2_edges[o2_index],
                        "o2_max": grid.o2_edges[o2_index + 1],
                        "psi_min": grid.psi_edges[psi_index],
                        "psi_max": grid.psi_edges[psi_index + 1],
                        "covered": bool(ids),
                        "investigation_ids": ids,
                    }
                )
    return cells


def coverage_summary(cells: list[dict]) -> dict[str, dict[str, int]]:
    summary = {}
    for gravity in GRAVITY_CLASSES:
        selected = [cell for cell in cells if cell["gravity"] == gravity]
        summary[gravity] = {
            "covered_cells": sum(1 for cell in selected if cell["covered"]),
            "total_cells": len(selected),
        }
    return summary


def find_cell(cells: list[dict], grid: Grid, gravity: str, o2: float, psi: float) -> dict | None:
    o2_bins = bins_touched((o2, o2), grid.o2_edges)
    psi_bins = bins_touched((psi, psi), grid.psi_edges)
    if not o2_bins or not psi_bins:
        return None
    lookup = {
        (cell["gravity"], cell["o2_min"], cell["psi_min"]): cell
        for cell in cells
    }
    return lookup.get((gravity, grid.o2_edges[o2_bins[0]], grid.psi_edges[psi_bins[0]]))


# ---------- habitats ----------


def distance_to(placement: Placement, o2: float, psi: float) -> dict:
    """Nearest tested point of an investigation, scaled by the grid span on each axis."""
    o2_span = O2_LIMITS[1] - O2_LIMITS[0]
    psi_span = PSI_LIMITS[1] - PSI_LIMITS[0]
    best = None
    for box in placement.boxes:
        nearest_o2 = _clamp(o2, box.o2)
        nearest_psi = _clamp(psi, box.psi)
        score = math.hypot((nearest_o2 - o2) / o2_span, (nearest_psi - psi) / psi_span)
        if best is None or score < best[0]:
            best = (score, nearest_o2, nearest_psi)
    assert best is not None
    score, nearest_o2, nearest_psi = best
    return {
        "investigation_id": placement.investigation_id,
        "acronym": placement.acronym,
        "gravity": placement.gravity,
        "basis": placement.basis,
        "nearest_o2_percent": round(nearest_o2, 3),
        "nearest_pressure_psi": round(nearest_psi, 3),
        "delta_o2_percent": round(nearest_o2 - o2, 3),
        "delta_pressure_psi": round(nearest_psi - psi, 3),
        "distance": round(score, 4),
    }


def _clamp(value: float, interval: Interval) -> float:
    return min(max(value, interval[0]), interval[1])


def habitat_report(
    habitat: dict,
    placements: list[Placement],
    cells: list[dict],
    grid: Grid,
) -> list[dict]:
    o2 = float(habitat["o2_percent"])
    psi = float(habitat["pressure_psi"])
    reports = []
    for gravity in habitat.get("gravity_classes") or []:
        cell = find_cell(cells, grid, gravity, o2, psi)
        distances = sorted(
            (distance_to(placement, o2, psi) for placement in placements),
            key=lambda item: (item["distance"], _id_key(item["investigation_id"])),
        )
        same = [item for item in distances if item["gravity"] == gravity]
        reports.append(
            {
                "habitat_id": habitat["id"],
                "name": habitat["name"],
                "o2_percent": o2,
                "pressure_psi": psi,
                "pressure_kpa": habitat.get("pressure_kpa"),
                "gravity": gravity,
                "assumed": bool(habitat.get("assumed")),
                "on_grid": cell is not None,
                "inside_tested": bool(cell and cell["covered"]),
                "covering_investigation_ids": list(cell["investigation_ids"]) if cell else [],
                "nearest_same_gravity": same[:NEAREST_COUNT],
                "nearest_any_gravity": distances[:NEAREST_COUNT],
            }
        )
    return reports


def habitat_gaps(reports: list[dict]) -> list[dict]:
    gaps = []
    for report in reports:
        if report["inside_tested"]:
            continue
        nearest = report["nearest_same_gravity"] or report["nearest_any_gravity"]
        if nearest:
            first = nearest[0]
            closest = (
                f"Closest tested: {first['acronym'] or first['investigation_id']} "
                f"({first['gravity']}) at {first['nearest_o2_percent']:g}% O2, "
                f"{first['nearest_pressure_psi']:g} psi."
            )
        else:
            closest = "No investigation could be placed on the grid."
        assumed = " This preset is assumed." if report["assumed"] else ""
        gaps.append(
            {
                "id": f"habitat_{report['habitat_id']}_{report['gravity']}",
                "title": f"{report['name']}: not tested in {report['gravity']}",
                "text": (
                    f"No PSI investigation in this dataset covers {report['o2_percent']:g}% O2 "
                    f"at {report['pressure_psi']:g} psi in {report['gravity']}. {closest}{assumed}"
                ),
                "habitat_id": report["habitat_id"],
                "gravity": report["gravity"],
                "related_investigation_ids": [item["investigation_id"] for item in nearest],
            }
        )
    return gaps


# ---------- build ----------


def build_gaps(
    records: list[dict],
    habitats: list[dict],
    grid: Grid | None = None,
) -> dict:
    grid = grid or make_grid()
    placements: list[Placement] = []
    unplaced: list[dict] = []
    for record in sorted(records, key=lambda item: _id_key(item.get("id"))):
        placement, reason = place(record)
        if placement is None:
            unplaced.append(
                {
                    "investigation_id": record.get("id"),
                    "acronym": record.get("acronym"),
                    "gravity": record.get("gravity"),
                    "reason": reason,
                }
            )
        else:
            placements.append(placement)
    cells = build_cells(grid, placements)
    reports = [item for habitat in habitats for item in habitat_report(habitat, placements, cells, grid)]
    partial_gap = dict(PARTIAL_GRAVITY_GAP)
    partial_gap["partial_gravity_investigations_found"] = [
        placement.investigation_id for placement in placements if placement.gravity == "partial"
    ]
    return {
        "source": "data/investigations.json",
        "investigation_count": len(records),
        "grid": {
            "o2_percent_edges": list(grid.o2_edges),
            "pressure_psi_edges": list(grid.psi_edges),
            "gravity_classes": list(GRAVITY_CLASSES),
            "distance_note": (
                "distance is sqrt((dO2/85)^2 + (dpsi/14)^2), the gap scaled by the grid span on each axis. "
                "0 means inside a tested range or at a tested point."
            ),
            "coverage": coverage_summary(cells),
            "cells": cells,
        },
        "placements": [
            {
                "investigation_id": placement.investigation_id,
                "acronym": placement.acronym,
                "gravity": placement.gravity,
                "basis": placement.basis,
                "points": len(placement.boxes),
            }
            for placement in placements
        ],
        "unplaced": unplaced,
        "habitats": reports,
        "gaps": [partial_gap, *habitat_gaps(reports)],
    }


def format_summary(result: dict) -> str:
    lines = ["Coverage (cells with any tested condition)"]
    for gravity, counts in result["grid"]["coverage"].items():
        lines.append(f"  {gravity:<13} {counts['covered_cells']:4d} / {counts['total_cells']}")
    lines.append("")
    lines.append("Placed investigations")
    for item in result["placements"]:
        lines.append(f"  {item['investigation_id']:<8} {item['acronym']:<14} {item['gravity']:<13} by {item['basis']} ({item['points']})")
    for item in result["unplaced"]:
        lines.append(f"  {item['investigation_id']:<8} {str(item['acronym']):<14} not placed: {item['reason']}")
    lines.append("")
    lines.append(f"{'habitat':<26} {'gravity':<13} {'inside':<7} nearest same gravity")
    for report in result["habitats"]:
        nearest = report["nearest_same_gravity"][:1]
        text = (
            f"{nearest[0]['acronym'] or nearest[0]['investigation_id']} "
            f"(dO2 {nearest[0]['delta_o2_percent']:+g}, dpsi {nearest[0]['delta_pressure_psi']:+g}, "
            f"distance {nearest[0]['distance']:g})"
            if nearest
            else "none"
        )
        lines.append(
            f"{report['name'][:26]:<26} {report['gravity']:<13} "
            f"{'yes' if report['inside_tested'] else 'no':<7} {text}"
        )
    lines.append("")
    lines.append("Gaps")
    for gap in result["gaps"]:
        lines.append(f"  - {gap['title']}")
    return "\n".join(lines)


def _id_key(value) -> tuple[int, str]:
    text = str(value or "")
    digits = "".join(character for character in text.rsplit("-", 1)[-1] if character.isdigit())
    return (int(digits) if digits else 0, text)


def _load_list(path: Path) -> list[dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise SystemExit(f"{path} must hold a JSON list")
    return [item for item in payload if isinstance(item, dict)]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build data/gaps.json from tested conditions.")
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--habitats", type=Path, default=DEFAULT_HABITATS)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--o2-step", type=float, default=DEFAULT_O2_STEP)
    parser.add_argument("--psi-step", type=float, default=DEFAULT_PSI_STEP)
    args = parser.parse_args(argv)
    result = build_gaps(
        _load_list(args.data),
        _load_list(args.habitats),
        make_grid(args.o2_step, args.psi_step),
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(format_summary(result))
    print()
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
