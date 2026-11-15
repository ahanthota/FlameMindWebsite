"""Find the passages that best support an answer.

Embed the query, score every chunk by cosine similarity, lift chunks from the
top-ranked investigations, and report whether the evidence is strong enough.
The threshold is checked against the raw similarity, never the boosted one.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ai.llm import LLM
from ai.ranker import Ranked

EVIDENCE_THRESHOLD = 0.55
TOP_PASSAGES = 8
BOOSTED_INVESTIGATIONS = 3
MAX_BOOST = 0.05
MAX_PER_FILE = 3


@dataclass(frozen=True)
class Passage:
    chunk: dict
    similarity: float  # raw cosine
    score: float  # similarity plus boost


@dataclass(frozen=True)
class Retrieval:
    passages: list[Passage]
    best_similarity: float
    sufficient: bool


def query_text(message: str, conditions: dict) -> str:
    """The message plus the conditions in words, so implied values are searchable."""
    extra = []
    if conditions.get("o2_percent") is not None:
        extra.append(f"{conditions['o2_percent']:g}% oxygen")
    if conditions.get("pressure_psi") is not None:
        extra.append(f"{conditions['pressure_psi']:g} psi")
    if conditions.get("flow_cm_s") is not None:
        extra.append(f"airflow {conditions['flow_cm_s']:g} cm/s")
    if conditions.get("gravity"):
        extra.append(f"{conditions['gravity']} gravity")
    extra.extend(conditions.get("materials") or [])
    return message if not extra else f"{message}\n({', '.join(extra)})"


def boosts(ranked: list[Ranked]) -> dict[str, float]:
    """Up to MAX_BOOST for the top investigations, scaled by their rank score."""
    return {
        item.investigation_id: MAX_BOOST * item.score
        for item in ranked[:BOOSTED_INVESTIGATIONS]
        if item.score > 0
    }


def select(
    chunks: list[dict],
    embeddings: np.ndarray,
    query_vector: np.ndarray,
    ranked: list[Ranked],
    k: int = TOP_PASSAGES,
    threshold: float = EVIDENCE_THRESHOLD,
) -> Retrieval:
    if len(chunks) == 0:
        return Retrieval([], 0.0, False)
    similarity = embeddings @ query_vector
    boost = boosts(ranked)
    scores = similarity + np.asarray(
        [boost.get(chunk["investigation_id"], 0.0) for chunk in chunks], dtype=np.float32
    )
    best = float(similarity.max())
    passages: list[Passage] = []
    per_file: dict[tuple[str, str], int] = {}
    for index in np.argsort(-scores, kind="stable"):
        if len(passages) == k:
            break
        if similarity[index] < threshold:
            continue
        chunk = chunks[int(index)]
        key = (chunk["investigation_id"], chunk["file_name"])
        if per_file.get(key, 0) >= MAX_PER_FILE:
            continue
        per_file[key] = per_file.get(key, 0) + 1
        passages.append(Passage(chunk, float(similarity[index]), float(scores[index])))
    return Retrieval(passages, best, bool(passages))


def retrieve(
    llm: LLM,
    chunks: list[dict],
    embeddings: np.ndarray,
    message: str,
    conditions: dict,
    ranked: list[Ranked],
    k: int = TOP_PASSAGES,
    threshold: float = EVIDENCE_THRESHOLD,
) -> Retrieval:
    vector = llm.embed_query(query_text(message, conditions))
    return select(chunks, embeddings, vector, ranked, k, threshold)
