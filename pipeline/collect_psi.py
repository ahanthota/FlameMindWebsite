"""Save PSI combustion overviews, and small Tier A documents.

PSI is public CC0 data. This script reads investigation metadata, writes an
overview for every Combustion Science investigation, and downloads only small
documents and test tables for the deep tier. It does not request folder zips
or raw video, images, or sensor logs.

Usage, from pipeline/ with the virtual environment active:

    python collect_psi.py
"""

from __future__ import annotations

import csv
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from psi_files import category_from_path, local_subdir, should_download, tier_for

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
SEARCH_URL = (
    "https://psi.nasa.gov/geode-py/ws/repo/search"
    "?term=combustion&source=psi&type=investigation&from=0&size=100"
)
PSI_PAGE = "https://psi.nasa.gov/physci/repo/data/investigations/{accession}"
USER_AGENT = "FlameMind/0.1 (NASA Space Apps; public CC0 PSI metadata and small documents)"
PAUSE_SECONDS = 0.6


def _request(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json,text/plain,*/*"},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def _get_json(url: str) -> dict:
    time.sleep(PAUSE_SECONDS)
    return json.loads(_request(url))


def _slug(acronym: str, accession: str) -> str:
    label = acronym.strip() if acronym.strip() else accession
    label = re.sub(r"[^A-Za-z0-9]+", "-", label).strip("-")
    return f"{label}_{accession}"


def _write_overview(folder: Path, record: dict) -> None:
    overview = folder / "overview"
    overview.mkdir(parents=True, exist_ok=True)
    accession = record["accession"]
    lines = [
        f"# {record.get('title') or accession}",
        "",
        f"- Accession: {accession}",
        f"- Acronym: {record.get('investigationAcronym') or ''}",
        f"- PSI page: {PSI_PAGE.format(accession=accession)}",
        f"- DOI: {record.get('doi') or ''}",
        f"- License: {record.get('licenseIdentifier') or ''} ({record.get('licenseName') or ''})",
        f"- Research area: {record.get('researchArea') or ''}",
        f"- Sub-area: {record.get('subResearchArea') or ''}",
        f"- Project type: {record.get('projectType') or ''}",
        f"- Flight program: {record.get('flightProgram') or ''}",
        f"- Hardware: {record.get('experimentHardware') or ''}",
        f"- Start: {record.get('investigationStartDate') or ''}",
        f"- End: {record.get('investigationEndDate') or ''}",
        f"- NASA center: {record.get('managingNasaCenter') or ''}",
        "",
        "## Objectives",
        "",
        (record.get("objective") or "").strip() or "Not stated on the PSI overview.",
        "",
        "## Approach",
        "",
        (record.get("approach") or "").strip() or "Not stated on the PSI overview.",
        "",
        "## Hypothesis",
        "",
        (record.get("hypothesis") or "").strip() or "Not stated on the PSI overview.",
        "",
        "## Research impacts",
        "",
        (record.get("researchImpacts") or "").strip() or "Not stated on the PSI overview.",
        "",
        "Excerpted from the NASA Physical Sciences Informatics repository. "
        f"License: {record.get('licenseIdentifier') or 'see the PSI page'}. "
        "Cite the investigation DOI when one is listed.",
        "",
    ]
    (overview / "overview.md").write_text("\n".join(lines), encoding="utf-8")


def _catalog_files(record: dict) -> list[dict]:
    files = list(record.get("added") or [])
    seen = {item.get("file_name") for item in files}
    for table in record.get("experimentalTable") or []:
        if table.get("file_name") not in seen:
            files.append(table)
    return files


def _download_file(accession: str, file_name: str, destination: Path) -> None:
    query = urllib.parse.urlencode({"file": file_name, "redirect": "false"})
    presign_url = (
        f"https://psi.nasa.gov/geode-py/ws/studies/{accession}/download?{query}"
    )
    time.sleep(PAUSE_SECONDS)
    signed = _request(presign_url).decode("utf-8", "replace").strip().strip('"')
    if not signed.startswith("https://"):
        raise RuntimeError(f"No download URL for {file_name}: {signed[:180]}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(signed, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=180) as response:
        length = response.headers.get("Content-Length")
        if length and int(length) > 50 * 1024 * 1024:
            raise RuntimeError(f"{file_name} exceeds 50 MB")
        data = response.read()
    if len(data) > 50 * 1024 * 1024:
        raise RuntimeError(f"{file_name} exceeds 50 MB")
    destination.write_bytes(data)


def collect() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    search = _get_json(SEARCH_URL)
    hits = []
    for hit in search["hits"]["hits"]:
        source = hit["_source"]
        if source.get("Research Area") == "Combustion Science":
            hits.append(source)
    hits.sort(key=lambda item: item["Accession"])

    inventory_rows: list[dict[str, str]] = []
    source_rows: list[dict[str, str]] = []
    log_lines = [
        "PSI collection log",
        "Address confirmed: "
        "https://psi.nasa.gov/physci/repo/search?q=combustion&data_source=psi&data_type=investigation",
        "License on investigation records: CC0-1.0. Public pages, no login.",
        "Files over 50 MB, raw data, video, and images were not requested.",
        "",
    ]

    for source in hits:
        accession = source["Accession"]
        record = _get_json(
            f"https://psi.nasa.gov/geode-py/ws/repo/investigations/{accession}"
        )
        acronym = record.get("investigationAcronym") or source.get("Acronym") or ""
        tier = tier_for(accession)
        folder = RAW / _slug(acronym, accession)
        _write_overview(folder, record)
        files = _catalog_files(record)
        saved_bytes = 0
        saved_count = 0
        document_count = 0
        for item in files:
            path = item.get("remote_path") or ""
            name = item.get("file_name") or ""
            size = int(item.get("file_size") or 0)
            if should_download(path, name, size):
                document_count += 1
        table_available = any(
            category_from_path(item.get("remote_path") or "") == "Experimental table"
            for item in files
        )
        publications = record.get("publications") or []
        doi_count = sum(1 for pub in publications if (pub.get("doi") or "").strip())
        psi_url = PSI_PAGE.format(accession=accession)
        source_rows.append(
            {
                "investigation_id": accession,
                "tier": tier,
                "record_type": "investigation",
                "doi": record.get("doi") or "",
                "title": record.get("title") or "",
                "authors": "",
                "year": "",
                "abstract": "",
                "psi_url": psi_url,
            }
        )
        for pub in publications:
            source_rows.append(
                {
                    "investigation_id": accession,
                    "tier": tier,
                    "record_type": "publication",
                    "doi": (pub.get("doi") or "").strip(),
                    "title": pub.get("title") or "",
                    "authors": pub.get("authorList") or "",
                    "year": "",
                    "abstract": "",
                    "psi_url": psi_url,
                }
            )

        notes = [
            f"acronym={acronym or 'none'}",
            f"psi_catalog_gb={((record.get('totalFileSize') or 0) / 1e9):.1f}",
            f"catalogued_files={len(record.get('added') or [])}",
            f"eligible_small_documents={document_count}",
        ]
        if tier == "A":
            for item in files:
                path = item.get("remote_path") or ""
                name = item.get("file_name") or ""
                size = int(item.get("file_size") or 0)
                if not should_download(path, name, size):
                    continue
                destination = folder / local_subdir(path) / name.replace("/", "_")
                try:
                    _download_file(accession, name, destination)
                except (urllib.error.URLError, RuntimeError, TimeoutError) as exc:
                    log_lines.append(f"SKIP {accession} {name}: {exc}")
                    continue
                saved_count += 1
                saved_bytes += destination.stat().st_size
            notes.append(f"saved_files={saved_count}")
        else:
            notes.append("tier B: overview and publication list only; documents not downloaded")
        if not record.get("added"):
            notes.append("PSI file catalog empty except any experimental table; bulk files remain on PSI")

        inventory_rows.append(
            {
                "investigation_id": accession,
                "tier": tier,
                "psi_url": psi_url,
                "overview_saved": "yes",
                "documents_count": str(saved_count),
                "publications_with_doi": str(doi_count),
                "test_table_available": "yes" if table_available else "no",
                "approx_size_mb": f"{saved_bytes / 1e6:.1f}",
                "notes": "; ".join(notes),
            }
        )
        print(f"{tier} {accession} {acronym} saved_files={saved_count}")

    _write_csv(
        RAW / "inventory.csv",
        inventory_rows,
        [
            "investigation_id",
            "tier",
            "psi_url",
            "overview_saved",
            "documents_count",
            "publications_with_doi",
            "test_table_available",
            "approx_size_mb",
            "notes",
        ],
    )
    _write_csv(
        RAW / "sources.csv",
        source_rows,
        [
            "investigation_id",
            "tier",
            "record_type",
            "doi",
            "title",
            "authors",
            "year",
            "abstract",
            "psi_url",
        ],
    )
    (RAW / "collection_log.txt").write_text("\n".join(log_lines) + "\n", encoding="utf-8")


def _write_csv(path: Path, rows: list[dict[str, str]], fieldnames: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    collect()
