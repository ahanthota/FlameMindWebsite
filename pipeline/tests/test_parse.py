"""Tests for local PSI document parsing."""

from __future__ import annotations

import json
from pathlib import Path

from parse import (
    clean_text,
    extract_pages,
    format_report,
    parse_sources,
    strip_repeated_edges,
    summarize_table,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _write_pdf(path: Path, text: str) -> None:
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
    objects = [
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n",
        b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n",
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n",
        b"4 0 obj<</Length %d>>stream\n" % len(stream) + stream + b"\nendstream\nendobj\n",
        b"5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n",
    ]
    header = b"%PDF-1.4\n"
    body = b""
    offsets = [0]
    cursor = len(header)
    for obj in objects:
        offsets.append(cursor)
        body += obj
        cursor += len(obj)
    xref = b"xref\n0 6\n0000000000 65535 f \n"
    for offset in offsets[1:]:
        xref += f"{offset:010d} 00000 n \n".encode()
    trailer = (
        b"trailer<</Size 6/Root 1 0 R>>\nstartxref\n"
        + str(len(header) + len(body)).encode()
        + b"\n%%EOF\n"
    )
    path.write_bytes(header + body + xref + trailer)


def test_clean_text_joins_hyphenated_breaks() -> None:
    cleaned = clean_text("Flame spread in micro-\n gravity  over   thin\n\n\nfuel.")
    assert cleaned == "Flame spread in microgravity over thin\n\nfuel."


def test_repeated_header_is_removed_and_page_numbers_stay() -> None:
    pages = strip_repeated_edges(
        [
            "NASA PSI\nObjectives for BASS\n1",
            "NASA PSI\nApproach for BASS\n2",
        ]
    )
    assert pages == ["Objectives for BASS\n1", "Approach for BASS\n2"]


def test_table_summary_reports_units_and_minmax() -> None:
    summary = summarize_table(
        ["oxygen_pct", "pressure (psi)", "material"],
        [["34", "8", "Nomex"], ["21", "14.7", "cotton"]],
    )
    assert "columns: oxygen_pct, pressure (psi), material" in summary
    assert "units: pressure (psi)=psi" in summary
    assert "rows: 2" in summary
    assert "oxygen_pct: min=21 max=34" in summary
    assert "pressure (psi): min=8 max=14.7" in summary


def test_fixture_pdf_and_csv_are_parsed(tmp_path: Path) -> None:
    raw = tmp_path / "raw" / "PSI-1"
    (raw / "overview").mkdir(parents=True)
    (raw / "tables").mkdir()
    (raw / "overview" / "sample_overview.pdf").write_bytes(
        (FIXTURES / "sample_overview.pdf").read_bytes()
    )
    (raw / "tables" / "sample_table.csv").write_text(
        (FIXTURES / "sample_table.csv").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    sources = tmp_path / "sources.csv"
    sources.write_text(
        "investigation_id,sample_id,file_name,title,url,doi,source_type,size_mb\n"
        "PSI-1,,overview/sample_overview.pdf,Overview,https://psi.example/PSI-1,10.1000/example,psi_overview,0.001\n"
        "PSI-1,S1,tables/sample_table.csv,Test table,https://psi.example/PSI-1,,sample_data,0.001\n"
        "PSI-1,,," "A paper,https://doi.org/10.1000/paper,10.1000/paper,abstract_only,\n",
        encoding="utf-8",
    )
    out = tmp_path / "processed"
    reports = parse_sources(tmp_path / "raw", sources, out, max_bytes=50 * 1024 * 1024)
    assert reports[0].files_parsed == 2
    assert reports[0].samples_found == 1
    assert reports[0].sample_ids == ["S1"]
    assert reports[0].publications_with_doi == 1
    overview = json.loads((out / "PSI-1" / "sample_overview.json").read_text(encoding="utf-8"))
    assert overview["source_type"] == "psi_overview"
    assert overview["pages"][0]["page"] == 1
    assert "microgravity" in overview["pages"][0]["text"]
    table = json.loads((out / "PSI-1" / "sample_table.json").read_text(encoding="utf-8"))
    assert table["sample_id"] == "S1"
    assert "rows: 2" in table["pages"][0]["text"]
    assert "skipped: none" in format_report(reports)


def test_large_file_is_skipped_without_parsing(tmp_path: Path) -> None:
    raw = tmp_path / "raw" / "PSI-9"
    (raw / "documents").mkdir(parents=True)
    target = raw / "documents" / "big.pdf"
    target.write_bytes(b"%PDF-1.4\n" + b"x" * 100)
    sources = tmp_path / "sources.csv"
    sources.write_text(
        "investigation_id,sample_id,file_name,title,url,doi,source_type,size_mb\n"
        "PSI-9,,documents/big.pdf,Big,, ,document,1\n",
        encoding="utf-8",
    )
    reports = parse_sources(tmp_path / "raw", sources, tmp_path / "out", max_bytes=50)
    assert reports[0].files_parsed == 0
    assert reports[0].skipped[0].reason.startswith("skipped_large")
    assert not (tmp_path / "out").exists()


def test_csv_windows_bytes_are_readable(tmp_path: Path) -> None:
    path = tmp_path / "flex.csv"
    path.write_bytes(b"fuel,note\ncotton,en\x96dash\n")
    pages = extract_pages(path)
    assert pages[0].startswith("columns: fuel, note\n")
    assert "rows: 1" in pages[0]


def test_flex_gas_headers_get_their_subscripts_back(tmp_path: Path) -> None:
    path = tmp_path / "flex.csv"
    path.write_text(
        "Fuel,O initial ambient composition; mole fraction,"
        "CO initial ambient composition; mole fraction,Initial CO (ppm)\n"
        "Heptane,0.21,0.7,5\n",
        encoding="utf-8",
    )
    pages = extract_pages(path)
    assert "O2 initial ambient composition" in pages[0]
    assert "CO2 initial ambient composition" in pages[0]
    assert "Initial CO (ppm)" in pages[0]


def test_csv_fixture_extracts_a_summary() -> None:
    pages = extract_pages(FIXTURES / "sample_table.csv")
    assert pages == [
        "columns: oxygen_pct, pressure (psi), material\n"
        "units: pressure (psi)=psi\n"
        "rows: 2\n"
        "oxygen_pct: min=21 max=34\n"
        "pressure (psi): min=8 max=14.7"
    ]
