"""Spreadsheet review of data/investigations.json.

    python review.py export [--tier A]
    python review.py import --initials KT [--dry-run]
    python review.py status [--tier A]

Export writes data/review/investigations.csv and data/review/tests.csv.
Import merges edited values back. Only columns that are still present and
editable are applied; nothing else in the record is touched or dropped.
A changed row gets reviewed=true and reviewed_by=<initials>.
"""

from __future__ import annotations

import argparse
import copy
import csv
import json
import math
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from parse import read_table
from schema import Investigation

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA = ROOT / "data" / "investigations.json"
DEFAULT_REVIEW = ROOT / "data" / "review"
DEFAULT_CACHE = ROOT / "data" / "cache" / "extract"
INVESTIGATIONS_CSV = "investigations.csv"
TESTS_CSV = "tests.csv"

KPA_PER_PSI = 6.894757
PRESSURE_PAIR_TOLERANCE = 0.005
LIST_SEPARATOR = "; "


@dataclass(frozen=True)
class Column:
    name: str
    kind: str  # "str", "float", "bool", "list"
    editable: bool = True


INVESTIGATION_COLUMNS: tuple[Column, ...] = (
    Column("id", "str", editable=False),
    Column("acronym", "str", editable=False),
    Column("name", "str", editable=False),
    Column("tier", "str", editable=False),
    Column("needs_review", "bool"),
    Column("reviewed", "bool"),
    Column("reviewed_by", "str", editable=False),
    Column("o2_percent_min", "float"),
    Column("o2_percent_max", "float"),
    Column("pressure_kpa_min", "float"),
    Column("pressure_kpa_max", "float"),
    Column("pressure_psi_min", "float"),
    Column("pressure_psi_max", "float"),
    Column("flow_cm_s_min", "float"),
    Column("flow_cm_s_max", "float"),
    Column("gravity", "str"),
    Column("fuel_phase", "str"),
    Column("hardware", "str"),
    Column("program", "str"),
    Column("years", "str"),
    Column("platform", "list"),
    Column("category", "list"),
    Column("fuels", "list"),
    Column("diluents", "list"),
    Column("test_count", "str", editable=False),
    Column("review_reasons", "str", editable=False),
    Column("psi_url", "str", editable=False),
    Column("source_links", "str", editable=False),
)

TEST_COLUMNS: tuple[Column, ...] = (
    Column("investigation_id", "str", editable=False),
    Column("test_index", "str", editable=False),
    Column("acronym", "str", editable=False),
    Column("sample_id", "str"),
    Column("fuel", "str"),
    Column("sample_geometry", "str"),
    Column("o2_percent", "float"),
    Column("pressure_kpa", "float"),
    Column("pressure_psi", "float"),
    Column("flow_cm_s", "float"),
    Column("diluent", "str"),
    Column("outcome", "str"),
    Column("spread_rate_mm_s", "float"),
    Column("notes", "str"),
    Column("reviewed", "bool"),
    Column("reviewed_by", "str", editable=False),
    Column("evidence", "str", editable=False),
)

PRESSURE_PAIRS: tuple[tuple[str, str], ...] = (
    ("pressure_kpa_min", "pressure_psi_min"),
    ("pressure_kpa_max", "pressure_psi_max"),
    ("pressure_kpa", "pressure_psi"),
)
LOWERCASE_FIELDS = frozenset({"gravity", "fuel_phase", "outcome"})


@dataclass
class Change:
    where: str
    field: str
    old: Any
    new: Any

    def describe(self) -> str:
        return f"{self.where} {self.field}: {_show(self.old)} -> {_show(self.new)}"


@dataclass
class ImportResult:
    records: list[dict]
    changes: list[Change]
    errors: list[str]
    reviewed_investigations: list[str]
    reviewed_tests: int


# ---------- export ----------


def investigation_rows(records: list[dict], cache_dir: Path | None = None) -> list[dict[str, str]]:
    rows = []
    for record in records:
        derived = {
            "test_count": str(len(record.get("tests") or [])),
            "review_reasons": " | ".join(_review_reasons(cache_dir, record.get("id"))),
            "source_links": " | ".join(source_links(record)),
        }
        row = {}
        for column in INVESTIGATION_COLUMNS:
            if column.name in derived:
                row[column.name] = derived[column.name]
            else:
                row[column.name] = format_cell(record.get(column.name), column.kind)
        rows.append(row)
    return rows


def test_rows(records: list[dict]) -> list[dict[str, str]]:
    rows = []
    for record in records:
        for index, test in enumerate(record.get("tests") or [], start=1):
            row = {
                "investigation_id": str(record.get("id") or ""),
                "test_index": str(index),
                "acronym": str(record.get("acronym") or ""),
                "evidence": " | ".join(_evidence_label(item) for item in test.get("evidence") or []),
            }
            for column in TEST_COLUMNS:
                if column.name not in row:
                    row[column.name] = format_cell(test.get(column.name), column.kind)
            rows.append(row)
    return rows


def source_links(record: dict) -> list[str]:
    """Unique DOI links or URLs from sources, finding evidence, and test evidence."""
    links: list[str] = []
    for ref in _all_refs(record):
        doi = str(ref.get("doi") or "").strip()
        link = f"https://doi.org/{doi}" if doi else str(ref.get("url") or "").strip()
        if link and link not in links:
            links.append(link)
    return links


def write_csv(path: Path, columns: tuple[Column, ...], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=[column.name for column in columns])
        writer.writeheader()
        writer.writerows(rows)


def export(records: list[dict], review_dir: Path, cache_dir: Path | None = None) -> tuple[Path, Path]:
    inv_path = review_dir / INVESTIGATIONS_CSV
    tests_path = review_dir / TESTS_CSV
    write_csv(inv_path, INVESTIGATION_COLUMNS, investigation_rows(records, cache_dir))
    write_csv(tests_path, TEST_COLUMNS, test_rows(records))
    return inv_path, tests_path


# ---------- import ----------


def merge_review(
    records: list[dict],
    investigation_table: list[dict[str, str]],
    test_table: list[dict[str, str]],
    initials: str,
) -> ImportResult:
    """Apply edited cells to copies of ``records``. Records are only replaced if all validate."""
    initials = normalize_initials(initials)
    updated = copy.deepcopy(records)
    by_id = {str(record.get("id")): record for record in updated}
    changes: list[Change] = []
    errors: list[str] = []
    reviewed_ids: list[str] = []
    reviewed_tests = 0

    for row_number, row in enumerate(investigation_table, start=2):
        record_id = (row.get("id") or "").strip()
        record = by_id.get(record_id)
        if record is None:
            errors.append(f"{INVESTIGATIONS_CSV} row {row_number}: unknown id {record_id!r}")
            continue
        row_changes, row_errors = _apply_row(record, row, INVESTIGATION_COLUMNS, record_id)
        errors.extend(f"{INVESTIGATIONS_CSV} row {row_number}: {item}" for item in row_errors)
        if row_changes:
            changes.extend(row_changes)
            _mark_reviewed(record, row_changes, initials)
            reviewed_ids.append(record_id)

    for row_number, row in enumerate(test_table, start=2):
        record_id = (row.get("investigation_id") or "").strip()
        record = by_id.get(record_id)
        if record is None:
            errors.append(f"{TESTS_CSV} row {row_number}: unknown investigation_id {record_id!r}")
            continue
        tests = record.get("tests") or []
        try:
            index = int(str(row.get("test_index") or "").strip())
        except ValueError:
            errors.append(f"{TESTS_CSV} row {row_number}: test_index must be a number")
            continue
        if not 1 <= index <= len(tests):
            errors.append(
                f"{TESTS_CSV} row {row_number}: {record_id} has no test {index} "
                "(adding tests is not supported)"
            )
            continue
        where = f"{record_id} test {index}"
        row_changes, row_errors = _apply_row(tests[index - 1], row, TEST_COLUMNS, where)
        errors.extend(f"{TESTS_CSV} row {row_number}: {item}" for item in row_errors)
        if row_changes:
            changes.extend(row_changes)
            _mark_reviewed(tests[index - 1], row_changes, initials)
            reviewed_tests += 1

    for record in updated:
        try:
            Investigation.model_validate(record)
        except ValidationError as exc:
            for item in exc.errors():
                location = ".".join(str(part) for part in item["loc"])
                errors.append(f"{record.get('id')}: {location}: {item['msg']}")

    return ImportResult(
        records=updated if not errors else records,
        changes=changes,
        errors=errors,
        reviewed_investigations=reviewed_ids,
        reviewed_tests=reviewed_tests,
    )


def normalize_initials(value: str) -> str:
    cleaned = value.strip().upper()
    if not re.fullmatch(r"[A-Z]{2,4}", cleaned):
        raise ValueError("initials must be 2 to 4 letters, for example KT")
    return cleaned


def _apply_row(
    target: dict,
    row: dict[str, str],
    columns: tuple[Column, ...],
    where: str,
) -> tuple[list[Change], list[str]]:
    changes: list[Change] = []
    errors: list[str] = []
    changed_fields: set[str] = set()
    for column in columns:
        if not column.editable or column.name not in row:
            continue
        try:
            new = parse_cell(row[column.name], column.kind)
        except ValueError as exc:
            errors.append(f"{column.name}: {exc}")
            continue
        if isinstance(new, str) and column.name in LOWERCASE_FIELDS:
            new = new.lower()
        old = target.get(column.name)
        if _same(old, new, column.kind):
            continue
        target[column.name] = new
        changed_fields.add(column.name)
        changes.append(Change(where, column.name, old, new))

    for kpa_name, psi_name in PRESSURE_PAIRS:
        if kpa_name not in target and psi_name not in target:
            continue
        kpa_changed = kpa_name in changed_fields
        psi_changed = psi_name in changed_fields
        if kpa_changed and not psi_changed:
            old = target.get(psi_name)
            target[psi_name] = _convert(target.get(kpa_name), 1 / KPA_PER_PSI)
            changes.append(Change(where, psi_name, old, target[psi_name]))
        elif psi_changed and not kpa_changed:
            old = target.get(kpa_name)
            target[kpa_name] = _convert(target.get(psi_name), KPA_PER_PSI)
            changes.append(Change(where, kpa_name, old, target[kpa_name]))
        elif kpa_changed and psi_changed and not _pressures_agree(
            target.get(kpa_name), target.get(psi_name)
        ):
            errors.append(
                f"{kpa_name}={_show(target.get(kpa_name))} and {psi_name}="
                f"{_show(target.get(psi_name))} disagree; edit only one of them"
            )
    return changes, errors


def _mark_reviewed(target: dict, changes: list[Change], initials: str) -> None:
    explicit = next((item for item in changes if item.field == "reviewed"), None)
    if explicit is not None and explicit.new is False:
        target["reviewed"] = False
        target["reviewed_by"] = None
        return
    target["reviewed"] = True
    target["reviewed_by"] = initials


def load_table(path: Path) -> list[dict[str, str]]:
    headers, rows = read_table(path)
    names = [header.strip() for header in headers]
    return [
        {name: (row[index] if index < len(row) else "") for index, name in enumerate(names) if name}
        for row in rows
    ]


def find_table(review_dir: Path, stem: str) -> Path:
    for suffix in (".csv", ".xlsx"):
        path = review_dir / f"{stem}{suffix}"
        if path.is_file():
            return path
    raise FileNotFoundError(f"missing {review_dir / (stem + '.csv')}; run `python review.py export` first")


# ---------- status ----------


def format_status(records: list[dict]) -> str:
    header = f"{'id':<9} {'acronym':<14} {'reviewed':<9} {'by':<5} {'needs_review':<13} tests reviewed"
    lines = [header]
    for record in records:
        tests = record.get("tests") or []
        done = sum(1 for test in tests if test.get("reviewed"))
        lines.append(
            f"{str(record.get('id')):<9} {str(record.get('acronym'))[:14]:<14} "
            f"{'yes' if record.get('reviewed') else 'no':<9} {str(record.get('reviewed_by') or '-'):<5} "
            f"{'yes' if record.get('needs_review') else 'no':<13} {done}/{len(tests)}"
        )
    remaining = [str(record.get("id")) for record in records if not record.get("reviewed")]
    lines.append("")
    lines.append(
        "All listed investigations are reviewed."
        if not remaining
        else f"Not reviewed yet: {', '.join(remaining)}"
    )
    return "\n".join(lines)


# ---------- cells ----------


def format_cell(value: Any, kind: str) -> str:
    if value is None:
        return ""
    if kind == "bool":
        return "true" if value else "false"
    if kind == "list":
        return LIST_SEPARATOR.join(str(item) for item in value or [])
    if kind == "float":
        return repr(float(value))
    return str(value)


def parse_cell(text: str | None, kind: str) -> Any:
    cleaned = (text or "").strip()
    if kind == "float":
        if not cleaned:
            return None
        try:
            number = float(cleaned.replace(",", ""))
        except ValueError as exc:
            raise ValueError(f"not a number: {cleaned!r}") from exc
        if not math.isfinite(number):
            raise ValueError(f"not a finite number: {cleaned!r}")
        return number
    if kind == "bool":
        lowered = cleaned.lower()
        if lowered in {"true", "yes", "y", "1"}:
            return True
        if lowered in {"false", "no", "n", "0", ""}:
            return False
        raise ValueError(f"use true or false, not {cleaned!r}")
    if kind == "list":
        return [part.strip() for part in cleaned.split(";") if part.strip()]
    return cleaned or None


def _same(old: Any, new: Any, kind: str) -> bool:
    if kind == "float":
        if old is None or new is None:
            return old is None and new is None
        return math.isclose(float(old), float(new), rel_tol=1e-9, abs_tol=1e-12)
    if kind == "bool":
        return bool(old) == bool(new)
    if kind == "list":
        return list(old or []) == list(new or [])
    if kind == "str":
        cleaned = str(old).strip() or None if old is not None else None
        return cleaned == new
    return old == new


def _convert(value: float | None, factor: float) -> float | None:
    return None if value is None else round(value * factor, 4)


def _pressures_agree(kpa: float | None, psi: float | None) -> bool:
    if kpa is None or psi is None:
        return kpa is None and psi is None
    expected = psi * KPA_PER_PSI
    return abs(kpa - expected) <= PRESSURE_PAIR_TOLERANCE * max(abs(expected), 1e-9)


def _show(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, list):
        return "[" + LIST_SEPARATOR.join(str(item) for item in value) + "]"
    return repr(value) if isinstance(value, str) else str(value)


def _all_refs(record: dict) -> list[dict]:
    refs = list(record.get("sources") or [])
    for name in ("ignition_findings", "flame_spread_findings", "extinction_findings", "key_findings"):
        for finding in record.get(name) or []:
            refs.extend(finding.get("evidence") or [])
    for test in record.get("tests") or []:
        refs.extend(test.get("evidence") or [])
    return [ref for ref in refs if isinstance(ref, dict)]


def _evidence_label(ref: dict) -> str:
    name = Path(str(ref.get("file_name") or "")).name
    return f"{name} p.{ref.get('page')}"


def _review_reasons(cache_dir: Path | None, record_id: Any) -> list[str]:
    if cache_dir is None or not record_id:
        return []
    path = cache_dir / f"{record_id}.json"
    if not path.is_file():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return [str(item) for item in payload.get("review_reasons") or []]


def load_records(path: Path) -> list[dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise SystemExit(f"{path} must hold a JSON list")
    return [item for item in payload if isinstance(item, dict)]


def _filter_tier(records: list[dict], tier: str | None) -> list[dict]:
    return [record for record in records if not tier or record.get("tier") == tier]


def main(argv: list[str] | None = None, echo: Callable[[str], None] = print) -> int:
    parser = argparse.ArgumentParser(description="Spreadsheet review of investigations.json.")
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--review-dir", type=Path, default=DEFAULT_REVIEW)
    commands = parser.add_subparsers(dest="command", required=True)
    export_parser = commands.add_parser("export", help="Write the review CSVs")
    export_parser.add_argument("--tier", choices=["A", "B"])
    export_parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    import_parser = commands.add_parser("import", help="Merge edited CSVs into investigations.json")
    import_parser.add_argument("--initials", required=True)
    import_parser.add_argument("--dry-run", action="store_true")
    status_parser = commands.add_parser("status", help="Show review progress")
    status_parser.add_argument("--tier", choices=["A", "B"])
    args = parser.parse_args(argv)

    records = load_records(args.data)
    if args.command == "export":
        selected = _filter_tier(records, args.tier)
        inv_path, tests_path = export(selected, args.review_dir, args.cache)
        test_total = sum(len(record.get("tests") or []) for record in selected)
        echo(f"Wrote {inv_path} ({len(selected)} investigations)")
        echo(f"Wrote {tests_path} ({test_total} tests)")
        return 0

    if args.command == "status":
        echo(format_status(_filter_tier(records, args.tier)))
        return 0

    try:
        initials = normalize_initials(args.initials)
    except ValueError as exc:
        echo(str(exc))
        return 2
    try:
        inv_table = load_table(find_table(args.review_dir, Path(INVESTIGATIONS_CSV).stem))
    except FileNotFoundError as exc:
        echo(str(exc))
        return 2
    try:
        test_table = load_table(find_table(args.review_dir, Path(TESTS_CSV).stem))
    except FileNotFoundError:
        test_table = []
    result = merge_review(records, inv_table, test_table, initials)
    for change in result.changes:
        echo(f"  {change.describe()}")
    if result.errors:
        echo(f"Not saved. {len(result.errors)} problem(s):")
        for error in result.errors:
            echo(f"  {error}")
        return 1
    echo(
        f"{len(result.changes)} change(s); reviewed {len(result.reviewed_investigations)} "
        f"investigation(s) and {result.reviewed_tests} test(s) as {initials}."
    )
    if args.dry_run:
        echo("Dry run: investigations.json not changed.")
        return 0
    args.data.write_text(json.dumps(result.records, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    echo(f"Saved {args.data}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
