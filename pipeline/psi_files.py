"""Decide which PSI files are safe to keep locally.

Raw video, images, and sensor logs stay on PSI. A file is eligible only when
it is a small document, report, publication file, metadata bundle, or test table.
"""

from __future__ import annotations

from pathlib import Path

MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_METADATA_ZIP_BYTES = 5 * 1024 * 1024

KEEP_CATEGORIES = frozenset(
    {
        "Science Documents",
        "Reports",
        "Experimental table",
        "metadata",
        "Publications",
    }
)
DOCUMENT_EXTENSIONS = frozenset(
    {".pdf", ".csv", ".xlsx", ".xls", ".docx", ".doc", ".txt", ".rtf"}
)

# Named in the project brief as the deep tier. Saffire is three PSI records.
# DAFT and DAFT-2 share one record (PSI-47) and stay in the light tier.
TIER_A_ACCESSIONS = frozenset(
    {
        "PSI-20",  # ACME BRE
        "PSI-25",  # BASS-II
        "PSI-26",  # BASS
        "PSI-68",  # FLEX-2
        "PSI-69",  # FLEX
        "PSI-98",  # SAFFIRE-I
        "PSI-99",  # SAFFIRE-II
        "PSI-100",  # SAFFIRE-III
        "PSI-101",  # SAME-R
        "PSI-102",  # SAME
        "PSI-159",  # ACME CFI-G
        "PSI-22",  # ACME E-FIELD Flames
        "PSI-39",  # CFI
        "PSI-47",  # DAFT / DAFT-2
        "PSI-107",  # SPICE
        "PSI-106",  # SLICE
    }
)


def tier_for(accession: str) -> str:
    return "A" if accession in TIER_A_ACCESSIONS else "B"


def category_from_path(remote_path: str) -> str:
    """Return the PSI folder name, such as ``Science Documents``."""
    parts = [part for part in remote_path.split("/") if part]
    if "psi-data" not in parts:
        return ""
    index = parts.index("psi-data")
    if len(parts) <= index + 2:
        return ""
    return parts[index + 2]


def should_download(remote_path: str, file_name: str, size_bytes: int) -> bool:
    """True when a catalogued file is a small document or test table."""
    if size_bytes <= 0 or size_bytes > MAX_FILE_BYTES:
        return False
    category = category_from_path(remote_path)
    if category not in KEEP_CATEGORIES:
        return False
    extension = Path(file_name).suffix.lower()
    if extension == ".zip":
        return category == "metadata" and size_bytes <= MAX_METADATA_ZIP_BYTES
    return extension in DOCUMENT_EXTENSIONS


def local_subdir(remote_path: str) -> str:
    """Map a PSI folder onto the local layout."""
    category = category_from_path(remote_path)
    if category == "Experimental table":
        return "tables"
    if category == "Publications":
        return "publications"
    if category == "metadata":
        return "overview"
    return "documents"
