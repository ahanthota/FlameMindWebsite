"""Turn local PSI files into page-level JSON. This step never downloads.

It reads data/raw/sources.csv and opens only the files named there. Files larger
than the size limit are logged as skipped_large and are not opened.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import zipfile
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RAW = ROOT / "data" / "raw"
DEFAULT_OUT = ROOT / "data" / "processed"
DEFAULT_MAX_MB = 50

SOURCE_TYPES = frozenset(
    {"psi_overview", "document", "sample_data", "publication", "abstract_only"}
)
TEXT_SUFFIXES = frozenset({".md", ".txt"})
TABLE_SUFFIXES = frozenset({".csv", ".xlsx"})
WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
SHEET_NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

# The PSI FLEX table (PSI-69) lost the subscript 2 from its gas columns.
# Exact header names only, so other tables are never touched.
HEADER_FIXES = {
    "O initial ambient composition; mole fraction": "O2 initial ambient composition; mole fraction",
    "N initial ambient composition; mole fraction": "N2 initial ambient composition; mole fraction",
    "CO initial ambient composition; mole fraction": "CO2 initial ambient composition; mole fraction",
}


@dataclass
class Skip:
    file_name: str
    reason: str


@dataclass
class InvestigationReport:
    investigation_id: str
    files_parsed: int = 0
    pages: int = 0
    samples_found: int = 0
    sample_ids: list[str] = field(default_factory=list)
    publications_with_doi: int = 0
    skipped: list[Skip] = field(default_factory=list)


def clean_text(text: str) -> str:
    """Join hyphenated line breaks and collapse ragged whitespace."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"-\s*\n\s*([a-z])", r"\1", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def strip_repeated_edges(pages: list[str]) -> list[str]:
    """Drop a header or footer line that is identical on every page.

    Page numbers stay, because those lines differ from page to page.
    """
    if len(pages) < 2:
        return pages
    split = [[line.strip() for line in page.splitlines() if line.strip()] for page in pages]
    usable = [lines for lines in split if lines]
    if len(usable) < 2:
        return pages
    head = usable[0][0]
    foot = usable[0][-1]
    drop_head = all(lines and lines[0] == head for lines in usable) and len(head) > 2
    drop_foot = (
        all(lines and lines[-1] == foot for lines in usable)
        and len(foot) > 2
        and foot != head
    )
    cleaned: list[str] = []
    for lines in split:
        body = list(lines)
        if drop_head and body and body[0] == head:
            body = body[1:]
        if drop_foot and body and body[-1] == foot:
            body = body[:-1]
        cleaned.append("\n".join(body))
    return cleaned


def _column_unit(name: str) -> str:
    match = re.search(r"\(([^)]+)\)\s*$", name.strip())
    if match:
        return match.group(1).strip()
    match = re.search(r"\[([^\]]+)\]\s*$", name.strip())
    if match:
        return match.group(1).strip()
    return ""


def _as_float(value: str) -> float | None:
    token = value.strip().replace(",", "").rstrip("%")
    if not token:
        return None
    try:
        return float(token)
    except ValueError:
        return None


def summarize_table(headers: list[str], rows: list[list[str]]) -> str:
    """Column names, units, row count, and min/max of numeric columns."""
    headers = [header.strip() for header in headers]
    width = len(headers)
    normalized = [row + [""] * (width - len(row)) for row in rows]
    lines = [
        "columns: " + ", ".join(headers),
    ]
    units = [f"{name}={_column_unit(name)}" for name in headers if _column_unit(name)]
    lines.append("units: " + (", ".join(units) if units else "none stated"))
    lines.append(f"rows: {len(normalized)}")
    for index, name in enumerate(headers):
        numbers = [
            value
            for row in normalized
            if (value := _as_float(row[index] if index < len(row) else "")) is not None
        ]
        if numbers and len(numbers) >= max(1, int(0.6 * max(len(normalized), 1))):
            lines.append(f"{name}: min={min(numbers):g} max={max(numbers):g}")
    return "\n".join(lines)


def _read_csv_table(path: Path) -> tuple[list[str], list[list[str]]]:
    raw = path.read_bytes()
    text = ""
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        text = raw.decode("utf-8-sig")
    rows = [
        row
        for row in csv.reader(io.StringIO(text, newline=""))
        if any(cell.strip() for cell in row)
    ]
    if not rows:
        return [], []
    headers = [HEADER_FIXES.get(name.strip(), name) for name in rows[0]]
    return headers, rows[1:]


def _excel_column_index(cell_ref: str) -> int:
    letters = "".join(character for character in cell_ref if character.isalpha())
    index = 0
    for character in letters:
        index = index * 26 + (ord(character.upper()) - 64)
    return index - 1


def _read_xlsx_table(path: Path) -> tuple[list[str], list[list[str]]]:
    with zipfile.ZipFile(path) as workbook:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in workbook.namelist():
            root = ElementTree.fromstring(workbook.read("xl/sharedStrings.xml"))
            for item in root.findall("m:si", SHEET_NS):
                shared.append(
                    "".join(
                        node.text or ""
                        for node in item.iter(f"{SHEET_NS['m']}t")
                    )
                )
        sheet_name = next(
            name
            for name in workbook.namelist()
            if name.startswith("xl/worksheets/sheet")
        )
        root = ElementTree.fromstring(workbook.read(sheet_name))
        table: list[list[str]] = []
        for row in root.findall("m:sheetData/m:row", SHEET_NS):
            values: list[str] = []
            for cell in row.findall("m:c", SHEET_NS):
                index = _excel_column_index(cell.attrib.get("r", "A1"))
                while len(values) < index:
                    values.append("")
                node = cell.find("m:v", SHEET_NS)
                raw = "" if node is None or node.text is None else node.text
                if cell.attrib.get("t") == "s" and raw.isdigit():
                    raw = shared[int(raw)]
                values.append(raw)
            table.append(values)
    if not table:
        return [], []
    width = max(len(row) for row in table)
    table = [row + [""] * (width - len(row)) for row in table]
    return table[0], table[1:]


def _read_docx(path: Path) -> str:
    with zipfile.ZipFile(path) as document:
        root = ElementTree.fromstring(document.read("word/document.xml"))
    paragraphs: list[str] = []
    for paragraph in root.iter(f"{WORD_NS}p"):
        text = "".join(node.text or "" for node in paragraph.iter(f"{WORD_NS}t")).strip()
        if text:
            paragraphs.append(text)
    return "\n".join(paragraphs)


def _extract_pdf(path: Path) -> list[str]:
    plumber_pages: list[str] = []
    try:
        import pdfplumber

        with pdfplumber.open(path) as pdf:
            plumber_pages = [page.extract_text() or "" for page in pdf.pages]
    except Exception:
        plumber_pages = []
    if any(page.strip() for page in plumber_pages):
        return plumber_pages
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    return [page.extract_text() or "" for page in reader.pages]


def read_table(path: Path) -> tuple[list[str], list[list[str]]]:
    """Header and non-empty rows of a CSV or XLSX file."""
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return _read_csv_table(path)
    if suffix == ".xlsx":
        return _read_xlsx_table(path)
    raise ValueError(f"not a table: {suffix or 'none'}")


def extract_pages(path: Path) -> list[str]:
    """Return cleaned page texts. CSV and spreadsheets become one summary page."""
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        pages = _extract_pdf(path)
    elif suffix in TEXT_SUFFIXES:
        pages = [path.read_text(encoding="utf-8", errors="replace")]
    elif suffix == ".csv":
        headers, rows = _read_csv_table(path)
        pages = [summarize_table(headers, rows)]
    elif suffix == ".xlsx":
        headers, rows = _read_xlsx_table(path)
        pages = [summarize_table(headers, rows)]
    elif suffix == ".docx":
        pages = [_read_docx(path)]
    else:
        raise ValueError(f"unsupported type {suffix or 'none'}")
    pages = [clean_text(page) for page in pages]
    return [clean_text(page) for page in strip_repeated_edges(pages)]


def find_investigation_dir(raw_dir: Path, investigation_id: str) -> Path | None:
    direct = raw_dir / investigation_id
    if direct.is_dir():
        return direct
    matches = [
        path
        for path in raw_dir.iterdir()
        if path.is_dir() and path.name.endswith("_" + investigation_id)
    ]
    if len(matches) == 1:
        return matches[0]
    return None


def resolve_file(investigation_dir: Path, file_name: str, source_type: str, sample_id: str) -> Path | None:
    """Find a listed file under the investigation folder. Does not download."""
    relative = investigation_dir / file_name
    if relative.is_file():
        return relative
    if source_type == "psi_overview":
        candidates = [investigation_dir / "overview" / file_name]
    elif source_type == "document":
        candidates = [investigation_dir / "documents" / file_name]
    elif source_type == "sample_data":
        candidates = []
        if sample_id:
            candidates.append(investigation_dir / "samples" / sample_id / file_name)
        candidates.extend(
            [
                investigation_dir / "samples" / file_name,
                investigation_dir / "tables" / file_name,
            ]
        )
    elif source_type == "publication":
        candidates = [investigation_dir / "publications" / file_name]
    else:
        candidates = []
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return None


def _load_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def parse_sources(
    raw_dir: Path,
    sources_csv: Path,
    out_dir: Path,
    max_bytes: int = DEFAULT_MAX_MB * 1024 * 1024,
) -> list[InvestigationReport]:
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in _load_rows(sources_csv):
        grouped[row.get("investigation_id", "").strip()].append(row)

    reports: list[InvestigationReport] = []
    claimed_stems: dict[str, set[str]] = {}
    for investigation_id in sorted(grouped):
        report = InvestigationReport(investigation_id=investigation_id)
        investigation_dir = find_investigation_dir(raw_dir, investigation_id)
        doi_seen: set[str] = set()
        sample_ids: set[str] = set()
        for row in grouped[investigation_id]:
            source_type = (row.get("source_type") or "").strip()
            doi = (row.get("doi") or "").strip()
            if source_type in {"publication", "abstract_only"} and doi:
                doi_seen.add(doi)
            file_name = (row.get("file_name") or "").strip()
            sample_id = (row.get("sample_id") or "").strip()
            if not file_name:
                continue
            if investigation_dir is None:
                report.skipped.append(Skip(file_name, "failed: investigation folder not found"))
                continue
            file_path = resolve_file(investigation_dir, file_name, source_type, sample_id)
            if file_path is None:
                report.skipped.append(Skip(file_name, "failed: file not found"))
                continue
            size = file_path.stat().st_size
            if size > max_bytes:
                report.skipped.append(
                    Skip(file_name, f"skipped_large ({size / 1e6:.1f} MB)")
                )
                continue
            try:
                pages = extract_pages(file_path)
            except Exception as exc:  # noqa: BLE001 - one bad file must not stop the run
                report.skipped.append(Skip(file_name, f"failed: {exc}"))
                continue
            stem = Path(file_name).stem
            used = claimed_stems.setdefault(investigation_id, set())
            output_name = f"{stem}.json"
            if output_name in used:
                output_name = f"{stem}-{source_type}.json"
            if output_name in used:
                output_name = f"{stem}-{source_type}-{len(used)}.json"
            used.add(output_name)
            destination = out_dir / investigation_id / output_name
            destination.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "investigation_id": investigation_id,
                "sample_id": sample_id or None,
                "file_name": file_name,
                "title": (row.get("title") or "").strip(),
                "url": (row.get("url") or "").strip(),
                "doi": doi or None,
                "source_type": source_type,
                "pages": [{"page": index, "text": text} for index, text in enumerate(pages, 1)],
            }
            destination.write_text(
                json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            report.files_parsed += 1
            report.pages += len(pages)
            if source_type == "sample_data":
                report.samples_found += 1
                if sample_id:
                    sample_ids.add(sample_id)
        report.sample_ids = sorted(sample_ids)
        report.publications_with_doi = len(doi_seen)
        reports.append(report)
    return reports


def format_report(reports: list[InvestigationReport], max_mb: float = DEFAULT_MAX_MB) -> str:
    lines = [f"Parse report (files over {max_mb:g} MB are skipped_large)", ""]
    parsed = pages = samples = publications = skipped = 0
    for report in reports:
        lines.append(report.investigation_id)
        lines.append(f"  files parsed: {report.files_parsed}")
        lines.append(f"  pages: {report.pages}")
        sample_note = f"  samples found: {report.samples_found}"
        if report.sample_ids:
            sample_note += " (" + ", ".join(report.sample_ids) + ")"
        lines.append(sample_note)
        lines.append(f"  publications with DOIs: {report.publications_with_doi}")
        if report.skipped:
            lines.append("  skipped:")
            for item in report.skipped:
                lines.append(f"    - {item.file_name}: {item.reason}")
        else:
            lines.append("  skipped: none")
        lines.append("")
        parsed += report.files_parsed
        pages += report.pages
        samples += report.samples_found
        publications += report.publications_with_doi
        skipped += len(report.skipped)
    lines.append(
        "Total: "
        f"{parsed} files parsed, {pages} pages, {samples} samples, "
        f"{publications} publications with DOIs, {skipped} skipped"
    )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Parse local PSI files into JSON.")
    parser.add_argument("--raw", type=Path, default=DEFAULT_RAW)
    parser.add_argument("--sources", type=Path, default=DEFAULT_RAW / "sources.csv")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--max-mb", type=float, default=DEFAULT_MAX_MB)
    args = parser.parse_args()
    reports = parse_sources(
        args.raw,
        args.sources,
        args.out,
        max_bytes=int(args.max_mb * 1024 * 1024),
    )
    print(format_report(reports, args.max_mb))


if __name__ == "__main__":
    main()
