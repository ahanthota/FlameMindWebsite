"""Fill missing publication titles, years, and abstracts from Crossref.

Reads data/raw/sources.csv and updates blank fields. Crossref is an open API.
Existing titles and authors from PSI are left as NASA recorded them.

Usage, from pipeline/:

    python doi_lookup.py
"""

from __future__ import annotations

import csv
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "data" / "raw" / "sources.csv"
USER_AGENT = "FlameMind/0.1 (NASA Space Apps challenge; Crossref metadata lookup)"
PAUSE_SECONDS = 0.25


def _strip_tags(value: str) -> str:
    text = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", text).strip()


def lookup_doi(doi: str) -> dict[str, str]:
    """Return title, year, and abstract when Crossref has them."""
    url = "https://api.crossref.org/works/" + urllib.parse.quote(doi)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=40) as response:
        message = json.loads(response.read())["message"]
    titles = message.get("title") or []
    issued = ((message.get("issued") or {}).get("date-parts") or [[]])[0]
    year = str(issued[0]) if issued else ""
    abstract = _strip_tags(message.get("abstract") or "")
    authors = []
    for person in message.get("author") or []:
        name = " ".join(
            part for part in (person.get("given"), person.get("family")) if part
        )
        if name:
            authors.append(name)
    return {
        "title": titles[0] if titles else "",
        "year": year,
        "abstract": abstract,
        "authors": "; ".join(authors),
    }


def fill_sources(path: Path = SOURCES) -> int:
    with path.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
        fieldnames = list(rows[0].keys()) if rows else []
    updated = 0
    cache: dict[str, dict[str, str]] = {}
    for row in rows:
        doi = (row.get("doi") or "").strip()
        if not doi:
            continue
        needs = not (row.get("abstract") or "").strip() or not (row.get("year") or "").strip()
        if row.get("record_type") == "publication" and not (row.get("title") or "").strip():
            needs = True
        if not needs:
            continue
        if doi not in cache:
            time.sleep(PAUSE_SECONDS)
            try:
                cache[doi] = lookup_doi(doi)
            except Exception as exc:  # noqa: BLE001 - keep going; one DOI must not stop the file
                cache[doi] = {}
                print(f"MISS {doi}: {exc}")
        found = cache[doi]
        if not found:
            continue
        changed = False
        if not (row.get("title") or "").strip() and found.get("title"):
            row["title"] = found["title"]
            changed = True
        if not (row.get("authors") or "").strip() and found.get("authors"):
            row["authors"] = found["authors"]
            changed = True
        if not (row.get("year") or "").strip() and found.get("year"):
            row["year"] = found["year"]
            changed = True
        if not (row.get("abstract") or "").strip() and found.get("abstract"):
            row["abstract"] = found["abstract"]
            changed = True
        if changed:
            updated += 1
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    return updated


if __name__ == "__main__":
    count = fill_sources()
    print(f"Updated {count} source rows from Crossref.")
