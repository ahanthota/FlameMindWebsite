"""Semantic search over data/chunks.json.

    python search.py "flame spread over fabric at high oxygen" --k 5
"""

from __future__ import annotations

import argparse
import json
import textwrap
from pathlib import Path

import numpy as np

from config import ConfigError, load_settings
from embed import DEFAULT_CHUNKS, DEFAULT_EMBEDDINGS, DEFAULT_META, VertexEmbedder, normalize

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INVESTIGATIONS = ROOT / "data" / "investigations.json"
DEFAULT_INVENTORY = ROOT / "data" / "raw" / "inventory.csv"
SNIPPET_CHARS = 320


def top_k(matrix: np.ndarray, query: np.ndarray, k: int) -> list[tuple[int, float]]:
    """Row indexes and cosine scores, best first. Rows and query are unit vectors."""
    if len(matrix) == 0 or k <= 0:
        return []
    scores = matrix @ normalize(query)
    k = min(k, len(scores))
    best = np.argpartition(-scores, k - 1)[:k]
    best = best[np.argsort(-scores[best], kind="stable")]
    return [(int(index), float(scores[index])) for index in best]


def page_label(chunk: dict) -> str:
    start, end = chunk.get("page_start"), chunk.get("page_end")
    if start is None:
        return "structured record"
    return f"p.{start}" if start == end else f"pp.{start}-{end}"


def acronyms(investigations_path: Path, inventory_path: Path) -> dict[str, str]:
    names: dict[str, str] = {}
    if inventory_path.is_file():
        import csv

        with inventory_path.open(encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                for part in (row.get("notes") or "").split(";"):
                    key, _, value = part.strip().partition("=")
                    if key == "acronym" and value and value.lower() != "none":
                        names[row["investigation_id"]] = value
    if investigations_path.is_file():
        for record in json.loads(investigations_path.read_text(encoding="utf-8")):
            if record.get("acronym"):
                names[record["id"]] = record["acronym"]
    return names


def format_results(results: list[tuple[int, float]], chunks: list[dict], names: dict[str, str]) -> str:
    lines = []
    for rank, (index, score) in enumerate(results, start=1):
        chunk = chunks[index]
        investigation = chunk["investigation_id"]
        label = f"{investigation} {names.get(investigation, '')}".strip()
        snippet = " ".join(chunk["text"].split())
        if len(snippet) > SNIPPET_CHARS:
            snippet = snippet[:SNIPPET_CHARS].rsplit(" ", 1)[0] + " ..."
        lines.append(f"{rank}. [{score:.3f}] {label} | {chunk['title']} | {page_label(chunk)}")
        if chunk.get("doi"):
            lines.append(f"   doi: {chunk['doi']}")
        lines.append(textwrap.indent(textwrap.fill(snippet, 96), "   "))
        lines.append("")
    return "\n".join(lines).rstrip()


def main() -> None:
    parser = argparse.ArgumentParser(description="Search embedded PSI chunks.")
    parser.add_argument("query")
    parser.add_argument("--k", type=int, default=5)
    parser.add_argument("--chunks", type=Path, default=DEFAULT_CHUNKS)
    parser.add_argument("--embeddings", type=Path, default=DEFAULT_EMBEDDINGS)
    parser.add_argument("--meta", type=Path, default=DEFAULT_META)
    args = parser.parse_args()
    try:
        settings = load_settings()
    except ConfigError as exc:
        raise SystemExit(str(exc)) from exc
    if not args.embeddings.is_file():
        raise SystemExit("No embeddings yet. Run `python embed.py` first.")
    meta = json.loads(args.meta.read_text(encoding="utf-8"))
    if meta.get("model") != settings.embed_model:
        raise SystemExit(
            f"Embeddings were made with {meta.get('model')} but EMBED_MODEL is {settings.embed_model}. "
            "Run `python embed.py` again."
        )
    chunks = json.loads(args.chunks.read_text(encoding="utf-8"))
    matrix = np.load(args.embeddings)
    if len(chunks) != len(matrix):
        raise SystemExit("chunks.json and embeddings.npy have different lengths. Run `python embed.py` again.")
    query = VertexEmbedder(settings).query(args.query)
    results = top_k(matrix, query, args.k)
    print(f'Top {len(results)} for "{args.query}"\n')
    print(format_results(results, chunks, acronyms(DEFAULT_INVESTIGATIONS, DEFAULT_INVENTORY)))


if __name__ == "__main__":
    main()
