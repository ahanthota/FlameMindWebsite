"""Chunk processed PSI text and embed it with Vertex AI.

Writes data/chunks.json, data/embeddings.npy (float32, row i = chunks[i]),
and data/embeddings_meta.json. Chunks whose text hash and model are unchanged
since the last run reuse their previous vector.

Token counts are estimated without a tokenizer: each digit and punctuation
mark is one token, and a run of letters is one token per 6 letters. Against
the embedding model's own counts this is within about 30% for this corpus.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from config import ConfigError, Settings, load_settings

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PROCESSED = ROOT / "data" / "processed"
DEFAULT_INVESTIGATIONS = ROOT / "data" / "investigations.json"
DEFAULT_CHUNKS = ROOT / "data" / "chunks.json"
DEFAULT_EMBEDDINGS = ROOT / "data" / "embeddings.npy"
DEFAULT_META = ROOT / "data" / "embeddings_meta.json"

LETTERS_PER_TOKEN = 6
TOKEN_PIECES = re.compile(r"[A-Za-z]+|\d|[^\w\s]|\w+")
DEFAULT_CHUNK_TOKENS = 800
DEFAULT_OVERLAP_TOKENS = 120
DEFAULT_BATCH_SIZE = 16
RETRY_STATUS = frozenset({429, 500, 503})
RETRY_DELAYS_S = (10, 20, 40, 80, 120)
SIZE_WARNING_MB = 50
SUMMARY_FILE = "investigations.json"
# gemini-embedding-001 reads at most 2048 tokens; the estimate can be ~30% low.
SUMMARY_MAX_TOKENS = 1500
FINDING_FIELDS = ("key_findings", "ignition_findings", "flame_spread_findings", "extinction_findings")

Embed = Callable[[list[str]], np.ndarray]


@dataclass(frozen=True)
class Word:
    page: int
    start: int
    end: int
    tokens: int


# ---------- chunking ----------


def estimate_tokens(text: str) -> int:
    count = 0
    for piece in TOKEN_PIECES.findall(text):
        if piece[0].isalpha() and len(piece) > 1:
            count += -(-len(piece) // LETTERS_PER_TOKEN)
        else:
            count += 1
    return count


def chunk_document(
    doc: dict,
    chunk_tokens: int = DEFAULT_CHUNK_TOKENS,
    overlap_tokens: int = DEFAULT_OVERLAP_TOKENS,
) -> list[dict]:
    """Overlapping word windows over a processed file. A window may span pages; both are recorded."""
    pages = {
        int(page["page"]): str(page.get("text") or "")
        for page in doc.get("pages") or []
        if isinstance(page, dict) and page.get("page") is not None
    }
    words = [
        Word(number, match.start(), match.end(), estimate_tokens(match.group()))
        for number in sorted(pages)
        for match in re.finditer(r"\S+", pages[number])
    ]
    chunks: list[dict] = []
    start = 0
    while start < len(words):
        end = start
        tokens = 0
        while end < len(words) and (end == start or tokens + words[end].tokens <= chunk_tokens):
            tokens += words[end].tokens
            end += 1
        window = words[start:end]
        chunks.append(
            {
                "chunk_id": f"{doc['investigation_id']}:{_file_key(doc['file_name'])}:{len(chunks)}",
                "investigation_id": doc["investigation_id"],
                "file_name": doc["file_name"],
                "title": doc.get("title") or "",
                "url": doc.get("url") or "",
                "doi": doc.get("doi") or None,
                "page_start": window[0].page,
                "page_end": window[-1].page,
                "text": _window_text(window, pages),
            }
        )
        if end == len(words):
            break
        back = end
        carried = 0
        while back - 1 > start and carried + words[back - 1].tokens <= overlap_tokens:
            back -= 1
            carried += words[back].tokens
        start = back
    return chunks


def _window_text(window: list[Word], pages: dict[int, str]) -> str:
    parts = []
    index = 0
    while index < len(window):
        page = window[index].page
        first = window[index]
        while index + 1 < len(window) and window[index + 1].page == page:
            index += 1
        parts.append(pages[page][first.start : window[index].end])
        index += 1
    return "\n\n".join(parts)


def _file_key(file_name: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", Path(file_name).stem).strip("_").lower()


def summary_text(record: dict) -> str:
    """Structured facts from investigations.json as searchable prose."""
    lines = [f"{record.get('name')} ({record.get('acronym')}), NASA PSI investigation {record.get('id')}."]
    _add(lines, "Program", record.get("program"))
    _add(lines, "Hardware", record.get("hardware"))
    _add(lines, "Platform", ", ".join(record.get("platform") or []))
    _add(lines, "Years", record.get("years"))
    _add(lines, "Gravity", record.get("gravity"))
    objectives = record.get("objectives") or []
    if objectives:
        lines.append("Objectives: " + " ".join(f"- {item}" for item in objectives))
    conditions = [
        _range("Oxygen", record.get("o2_percent_min"), record.get("o2_percent_max"), "%"),
        _range("Pressure", record.get("pressure_psi_min"), record.get("pressure_psi_max"), " psi"),
        _range("Pressure", record.get("pressure_kpa_min"), record.get("pressure_kpa_max"), " kPa"),
        _range("Flow", record.get("flow_cm_s_min"), record.get("flow_cm_s_max"), " cm/s"),
    ]
    conditions = [item for item in conditions if item]
    _add(lines, "Fuel phase", record.get("fuel_phase"))
    _add(lines, "Fuels", ", ".join(record.get("fuels") or []))
    _add(lines, "Sample geometry", record.get("sample_geometry"))
    _add(lines, "Diluents", ", ".join(record.get("diluents") or []))
    if conditions:
        lines.append("Tested conditions: " + "; ".join(conditions) + ".")
    _add(lines, "Variables varied", ", ".join(record.get("variables_varied") or []))
    _add(lines, "Tests recorded", len(record.get("tests") or []) or None)
    for name, label in (
        ("key_findings", "Key findings"),
        ("ignition_findings", "Ignition findings"),
        ("flame_spread_findings", "Flame spread findings"),
        ("extinction_findings", "Extinction findings"),
    ):
        texts = [str(item.get("text")).strip() for item in record.get(name) or [] if item.get("text")]
        if texts:
            lines.append(f"{label}: " + " ".join(f"- {text}" for text in texts))
    _add(lines, "Fire safety relevance", record.get("fire_safety_relevance"))
    return "\n".join(lines)


def summary_chunks(record: dict, max_tokens: int = SUMMARY_MAX_TOKENS) -> list[dict]:
    """Exactly one summary chunk per investigation.

    If the summary is longer than ``max_tokens``, findings are dropped from the
    end of the longest findings list until it fits, so the embedding model never
    truncates it. The full lists stay in investigations.json.
    """
    trimmed = {name: list(record.get(name) or []) for name in FINDING_FIELDS}
    dropped = 0
    text = summary_text({**record, **trimmed})
    while estimate_tokens(text) > max_tokens and any(trimmed.values()):
        longest = max(FINDING_FIELDS, key=lambda name: len(trimmed[name]))
        trimmed[longest].pop()
        dropped += 1
        text = summary_text({**record, **trimmed})
        text += f"\n({dropped} more finding(s) are listed in investigations.json.)"
    return [
        {
            "chunk_id": f"{record.get('id')}:summary",
            "investigation_id": record.get("id"),
            "file_name": SUMMARY_FILE,
            "title": f"{record.get('acronym') or record.get('id')} structured summary",
            "url": record.get("psi_url") or "",
            "doi": None,
            "page_start": None,
            "page_end": None,
            "text": text,
        }
    ]


def _add(lines: list[str], label: str, value) -> None:
    if value not in (None, "", []):
        lines.append(f"{label}: {value}.")


def _range(label: str, low, high, unit: str) -> str | None:
    if low is None and high is None:
        return None
    if low is not None and high is not None and low != high:
        return f"{label} {low:g} to {high:g}{unit}"
    value = low if low is not None else high
    return f"{label} {value:g}{unit}"


def build_chunks(
    processed_dir: Path,
    investigations_path: Path | None,
    chunk_tokens: int = DEFAULT_CHUNK_TOKENS,
    overlap_tokens: int = DEFAULT_OVERLAP_TOKENS,
) -> list[dict]:
    chunks: list[dict] = []
    for path in sorted(processed_dir.glob("*/*.json"), key=lambda item: (_id_key(item.parent.name), item.name)):
        doc = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(doc, dict) or not doc.get("investigation_id"):
            continue
        chunks.extend(chunk_document(doc, chunk_tokens, overlap_tokens))
    if investigations_path is not None and investigations_path.is_file():
        records = json.loads(investigations_path.read_text(encoding="utf-8"))
        for record in sorted(records, key=lambda item: _id_key(item.get("id"))):
            chunks.extend(summary_chunks(record))
    for chunk in chunks:
        chunk["text_hash"] = text_hash(chunk["text"])
    return chunks


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _id_key(value) -> tuple[int, str]:
    match = re.search(r"(\d+)$", str(value or ""))
    return (int(match.group(1)) if match else 0, str(value or ""))


# ---------- embeddings ----------


class VertexEmbedder:
    """Vertex AI embeddings via google-genai. Project, region, and model come from settings."""

    def __init__(self, settings: Settings, sleep: Callable[[float], None] = time.sleep) -> None:
        from google import genai

        self._client = genai.Client(
            vertexai=True,
            project=settings.gcp_project,
            location=settings.gcp_region,
        )
        self.model = settings.embed_model
        self._sleep = sleep
        self.truncated: list[str] = []

    def documents(self, texts: list[str]) -> np.ndarray:
        return self._embed(texts, "RETRIEVAL_DOCUMENT")

    def query(self, text: str) -> np.ndarray:
        return self._embed([text], "RETRIEVAL_QUERY")[0]

    def _embed(self, texts: list[str], task_type: str) -> np.ndarray:
        from google.genai import errors, types

        config = types.EmbedContentConfig(task_type=task_type)
        for attempt, delay in enumerate((*RETRY_DELAYS_S, None), start=1):
            try:
                response = self._client.models.embed_content(
                    model=self.model, contents=texts, config=config
                )
            except errors.APIError as exc:
                if exc.code not in RETRY_STATUS or delay is None:
                    raise RuntimeError(f"Embedding call failed after {attempt} attempt(s): {exc}") from exc
                print(f"  Embedding {exc.code}; waiting {delay}s before retry {attempt}", flush=True)
                self._sleep(delay)
                continue
            embeddings = response.embeddings or []
            if len(embeddings) != len(texts):
                raise RuntimeError(f"expected {len(texts)} embeddings, got {len(embeddings)}")
            self.truncated.extend(
                text
                for text, item in zip(texts, embeddings, strict=True)
                if item.statistics is not None and item.statistics.truncated
            )
            return np.asarray([item.values for item in embeddings], dtype=np.float32)
        raise RuntimeError("Embedding call failed")


def normalize(vectors: np.ndarray) -> np.ndarray:
    vectors = np.asarray(vectors, dtype=np.float32)
    norms = np.linalg.norm(vectors, axis=-1, keepdims=True)
    return (vectors / np.where(norms == 0, 1, norms)).astype(np.float32)


def load_previous(chunks_path: Path, embeddings_path: Path, meta_path: Path, model: str) -> dict[str, np.ndarray]:
    """Vectors from the last run, by text hash. Empty if the model changed or files are missing."""
    if not (chunks_path.is_file() and embeddings_path.is_file() and meta_path.is_file()):
        return {}
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        chunks = json.loads(chunks_path.read_text(encoding="utf-8"))
        vectors = np.load(embeddings_path)
    except (OSError, ValueError):
        return {}
    if meta.get("model") != model or not isinstance(chunks, list) or len(chunks) != len(vectors):
        return {}
    return {
        chunk["text_hash"]: vectors[index]
        for index, chunk in enumerate(chunks)
        if isinstance(chunk, dict) and chunk.get("text_hash")
    }


def embed_chunks(
    chunks: list[dict],
    embed: Embed,
    previous: dict[str, np.ndarray],
    batch_size: int = DEFAULT_BATCH_SIZE,
    progress: Callable[[int, int], None] | None = None,
) -> tuple[np.ndarray, int]:
    """Matrix of unit vectors, row i = chunks[i]. Returns (matrix, number newly embedded)."""
    rows: list[np.ndarray | None] = [previous.get(chunk["text_hash"]) for chunk in chunks]
    todo = [index for index, row in enumerate(rows) if row is None]
    for done, batch in enumerate(_batches(todo, batch_size), start=1):
        vectors = normalize(embed([chunks[index]["text"] for index in batch]))
        for index, vector in zip(batch, vectors, strict=True):
            rows[index] = vector
        if progress:
            progress(min(done * batch_size, len(todo)), len(todo))
    if not rows:
        return np.zeros((0, 0), dtype=np.float32), 0
    dimensions = {len(row) for row in rows if row is not None}
    if len(dimensions) != 1:
        raise RuntimeError(f"embedding dimensions differ: {sorted(dimensions)}")
    return normalize(np.vstack(rows)), len(todo)


def _batches(items: list[int], size: int) -> Iterable[list[int]]:
    for start in range(0, len(items), size):
        yield items[start : start + size]


def write_outputs(
    chunks: list[dict],
    matrix: np.ndarray,
    model: str,
    chunks_path: Path,
    embeddings_path: Path,
    meta_path: Path,
) -> dict:
    chunks_path.parent.mkdir(parents=True, exist_ok=True)
    chunks_path.write_text(json.dumps(chunks, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    np.save(embeddings_path, matrix.astype(np.float32))
    meta = {
        "model": model,
        "dimension": int(matrix.shape[1]) if matrix.ndim == 2 and len(matrix) else 0,
        "count": int(len(matrix)),
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return meta


def main() -> None:
    parser = argparse.ArgumentParser(description="Chunk data/processed and embed with Vertex AI.")
    parser.add_argument("--processed", type=Path, default=DEFAULT_PROCESSED)
    parser.add_argument("--investigations", type=Path, default=DEFAULT_INVESTIGATIONS)
    parser.add_argument("--chunks", type=Path, default=DEFAULT_CHUNKS)
    parser.add_argument("--embeddings", type=Path, default=DEFAULT_EMBEDDINGS)
    parser.add_argument("--meta", type=Path, default=DEFAULT_META)
    parser.add_argument("--chunk-tokens", type=int, default=DEFAULT_CHUNK_TOKENS)
    parser.add_argument("--overlap-tokens", type=int, default=DEFAULT_OVERLAP_TOKENS)
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    args = parser.parse_args()
    try:
        settings = load_settings()
    except ConfigError as exc:
        raise SystemExit(str(exc)) from exc

    chunks = build_chunks(args.processed, args.investigations, args.chunk_tokens, args.overlap_tokens)
    summaries = sum(1 for chunk in chunks if chunk["file_name"] == SUMMARY_FILE)
    spanning = sum(1 for chunk in chunks if chunk["page_start"] != chunk["page_end"])
    print(f"{len(chunks)} chunks ({len(chunks) - summaries} from documents, {summaries} summary); {spanning} span two or more pages")

    previous = load_previous(args.chunks, args.embeddings, args.meta, settings.embed_model)
    embedder = VertexEmbedder(settings)
    matrix, embedded = embed_chunks(
        chunks,
        embedder.documents,
        previous,
        args.batch_size,
        progress=lambda done, total: print(f"  embedded {done}/{total}", flush=True),
    )
    meta = write_outputs(chunks, matrix, settings.embed_model, args.chunks, args.embeddings, args.meta)
    print(f"Embedded {embedded} new chunk(s); reused {len(chunks) - embedded} unchanged.")
    if embedder.truncated:
        cut = set(embedder.truncated)
        ids = [chunk["chunk_id"] for chunk in chunks if chunk["text"] in cut]
        print(f"Warning: the model truncated {len(ids)} chunk(s); lower --chunk-tokens: {', '.join(ids)}")
    size_mb = args.embeddings.stat().st_size / 1_000_000
    print(f"Wrote {args.chunks.name}, {args.embeddings.name} ({size_mb:.1f} MB), {args.meta.name}: {meta}")
    if size_mb > SIZE_WARNING_MB:
        print(f"Warning: {args.embeddings.name} is over {SIZE_WARNING_MB} MB.")


if __name__ == "__main__":
    main()
