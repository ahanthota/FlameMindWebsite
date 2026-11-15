"""One Gemini call that writes the answer, then validation of what it returned.

The model sees numbered sources: retrieved passages first, then the structured
record of each top-ranked investigation. Every citation is a source number.
"""

from __future__ import annotations

import json
from typing import Literal

from pydantic import BaseModel, Field

from ai.llm import LLM
from ai.ranker import Ranked, make_test_id
from ai.retrieve import Passage

RECORD_SOURCES = 3
FINDINGS_PER_KIND = 6
PASSAGE_CHARS = 6000

DEFAULT_FOLLOW_UP = (
    "What are you designing for? Tell me the habitat (for example ISS or a Moon base), "
    "the materials involved, and what you want to achieve."
)
INSUFFICIENT_SUMMARY = (
    "I could not find enough evidence in the NASA PSI combustion data to answer that. "
    "I only answer from the investigations in this dataset, so I would rather say so than guess."
)


class KeyValue(BaseModel):
    name: str
    value: str
    unit: str | None = None


class RelevantData(BaseModel):
    investigation_id: str
    test_ids: list[str] = Field(default_factory=list)
    what_it_shows: str
    key_values: list[KeyValue] = Field(default_factory=list)
    citations: list[int] = Field(default_factory=list)


class Suggestion(BaseModel):
    text: str
    based_on: list[str] = Field(default_factory=list)
    citations: list[int] = Field(default_factory=list)


class Answer(BaseModel):
    summary: str
    relevant_data: list[RelevantData] = Field(default_factory=list)
    suggestions: list[Suggestion] = Field(default_factory=list)
    follow_up_question: str | None = None
    gaps_noted: list[str] = Field(default_factory=list)
    confidence: Literal["high", "medium", "low"] = "low"


SYSTEM = """You are FlameMind. You help people working on spacecraft and habitat fire safety find and understand NASA microgravity combustion data from the Physical Sciences Informatics (PSI) system. Return JSON only.

Rules:
1. Use only the numbered SOURCES in the prompt (passages and structured records). Never use outside knowledge, never guess, never extrapolate a number that is not written in a source.
2. Cite every claim. Each relevant_data item and each suggestion must list the source numbers it relies on in "citations". Use only numbers that appear in SOURCES.
3. relevant_data: one item per investigation that actually bears on the question. investigation_id must be an id shown in SOURCES. test_ids lists only test ids written in a structured record. what_it_shows says in one or two plain sentences what that data shows. key_values holds the measured or tested values you relied on, with units, copied exactly from the sources.
4. suggestions: write them ONLY when "use_case_complete" is true. Each suggestion is practical, specific to the user's use case, and tied to findings: based_on lists the investigation ids whose findings it uses, and citations lists the sources. If use_case_complete is false, suggestions must be [] and follow_up_question must be ONE short question asking about their habitat, the materials involved, and their goal.
5. If use_case_complete is true, follow_up_question is null unless one more detail would clearly change the advice.
6. gaps_noted: say plainly where the data does not cover what the user asked about or their use case, for example an oxygen level, pressure, or material that was not tested. Always include every gap listed under KNOWN GAPS (for example that no PSI combustion test was run at Moon or Mars partial gravity). Do not add gaps about conditions the user did not ask about. Use [] when there are none.
7. Do not discuss rockets, propellants, engines, explosives, or weapons. If asked, say in the summary that FlameMind only covers fire safety for crewed spacecraft and habitats, and return no data or suggestions.
8. Plain language. Short sentences. Explain any technical term in a few words. Do not repeat the question.
9. confidence: high when sources directly test the user's conditions and material; medium when they are close or partial; low when they are only loosely related.
10. summary: two to four sentences answering the latest message directly, using only what the sources support."""


def build_sources(
    passages: list[Passage], ranked: list[Ranked], by_id: dict[str, dict]
) -> list[dict]:
    """Numbered sources. ``text`` goes to the model; the rest is for the client."""
    sources = []
    for passage in passages:
        chunk = passage.chunk
        sources.append(
            {
                "n": len(sources) + 1,
                "kind": "passage",
                "investigation_id": chunk["investigation_id"],
                "title": chunk.get("title") or "",
                "url": chunk.get("url") or "",
                "doi": chunk.get("doi"),
                "page_start": chunk.get("page_start"),
                "page_end": chunk.get("page_end"),
                "similarity": round(passage.similarity, 3),
                "text": chunk["text"][:PASSAGE_CHARS],
            }
        )
    for item in [entry for entry in ranked if entry.score > 0][:RECORD_SOURCES]:
        record = by_id.get(item.investigation_id)
        if record is None:
            continue
        sources.append(
            {
                "n": len(sources) + 1,
                "kind": "record",
                "investigation_id": record["id"],
                "title": f"{record.get('acronym') or record['id']} structured record",
                "url": record.get("psi_url") or "",
                "doi": None,
                "page_start": None,
                "page_end": None,
                "similarity": None,
                "text": record_text(record, item),
            }
        )
    return sources


def record_text(record: dict, ranked: Ranked) -> str:
    lines = [f"{record.get('name')} ({record.get('acronym')}), investigation {record['id']}."]
    for label, key in (("Gravity", "gravity"), ("Fuel phase", "fuel_phase"), ("Sample geometry", "sample_geometry")):
        if record.get(key):
            lines.append(f"{label}: {record[key]}.")
    if record.get("fuels"):
        lines.append("Fuels: " + ", ".join(record["fuels"]) + ".")
    for label, key, unit in (
        ("Oxygen", "o2_percent", "%"),
        ("Pressure", "pressure_psi", " psi"),
        ("Pressure", "pressure_kpa", " kPa"),
        ("Airflow", "flow_cm_s", " cm/s"),
    ):
        low, high = record.get(f"{key}_min"), record.get(f"{key}_max")
        if low is not None or high is not None:
            shown = f"{low:g} to {high:g}" if None not in (low, high) and low != high else f"{(low if low is not None else high):g}"
            lines.append(f"{label} tested: {shown}{unit}.")
    lines.append("Why it ranked: " + " ".join(ranked.reasons))
    for label, key in (
        ("Key findings", "key_findings"),
        ("Ignition findings", "ignition_findings"),
        ("Flame spread findings", "flame_spread_findings"),
        ("Extinction findings", "extinction_findings"),
    ):
        texts = [str(item.get("text", "")).strip() for item in record.get(key) or []][:FINDINGS_PER_KIND]
        if texts:
            lines.append(f"{label}: " + " ".join(f"- {text}" for text in texts))
    tests = record.get("tests") or []
    if ranked.tests:
        lines.append("Closest tests:")
        for match in ranked.tests:
            test = tests[int(match.test_id.rsplit("-T", 1)[1]) - 1]
            fields = {
                key: test.get(key)
                for key in ("fuel", "sample_geometry", "o2_percent", "pressure_psi", "pressure_kpa", "flow_cm_s", "diluent", "outcome", "spread_rate_mm_s", "notes")
                if test.get(key) not in (None, "", "unknown")
            }
            lines.append(f"  {match.test_id}: {json.dumps(fields, ensure_ascii=False)}")
    if record.get("fire_safety_relevance"):
        lines.append(f"Fire safety relevance: {record['fire_safety_relevance']}")
    return "\n".join(lines)


def relevant_gaps(gaps: dict, gravity: str | None, habitat_id: str | None) -> list[dict]:
    chosen = []
    for gap in gaps.get("gaps") or []:
        if gap["id"] == "no_partial_gravity" and gravity == "partial":
            chosen.append(gap)
        elif habitat_id and gap.get("habitat_id") == habitat_id:
            if gravity is None or gap.get("gravity") == gravity:
                chosen.append(gap)
    return chosen


def build_prompt(
    message: str,
    history: list[dict],
    understanding: dict,
    sources: list[dict],
    gaps: list[dict],
) -> str:
    recent = "\n".join(f"{item.get('role')}: {str(item.get('content', ''))[:1500]}" for item in history[-8:])
    source_text = "\n\n".join(
        f"[{source['n']}] {source['investigation_id']} | {source['title']}"
        + (f" | pages {source['page_start']}-{source['page_end']}" if source["page_start"] else "")
        + f"\n{source['text']}"
        for source in sources
    )
    gap_text = "\n".join(f"- {gap['title']}: {gap['text']}" for gap in gaps) or "none"
    return "\n\n".join(
        [
            f"use_case_complete: {json.dumps(understanding.get('use_case_complete', False))}",
            "USE CASE:\n" + json.dumps(understanding.get("use_case"), ensure_ascii=False),
            "CONDITIONS ASKED ABOUT:\n" + json.dumps(understanding.get("conditions"), ensure_ascii=False),
            f"INTENT: {understanding.get('intent')}",
            "KNOWN GAPS:\n" + gap_text,
            "EARLIER MESSAGES:\n" + (recent or "none"),
            "SOURCES:\n" + source_text,
            "LATEST MESSAGE:\n" + message,
        ]
    )


def write_answer(
    llm: LLM,
    message: str,
    history: list[dict],
    understanding: dict,
    sources: list[dict],
    gaps: list[dict],
) -> Answer:
    prompt = build_prompt(message, history, understanding, sources, gaps)
    return llm.generate_json(SYSTEM, prompt, Answer, temperature=0.2)


# ---------- validation ----------


def validate(
    answer: Answer,
    sources: list[dict],
    by_id: dict[str, dict],
    use_case_complete: bool,
    gaps: list[dict],
) -> Answer:
    """Drop anything the sources cannot back up."""
    numbers = {source["n"] for source in sources}

    def real(citations: list[int]) -> list[int]:
        return sorted({n for n in citations if n in numbers})

    data = []
    for item in answer.relevant_data:
        record = by_id.get(item.investigation_id)
        citations = real(item.citations)
        if record is None or not citations:
            continue
        valid_tests = {make_test_id(record["id"], index) for index in range(len(record.get("tests") or []))}
        data.append(
            item.model_copy(
                update={"citations": citations, "test_ids": [t for t in item.test_ids if t in valid_tests]}
            )
        )

    suggestions = []
    if use_case_complete:
        for item in answer.suggestions:
            based_on = [inv for inv in dict.fromkeys(item.based_on) if inv in by_id]
            citations = real(item.citations)
            if based_on and citations:
                suggestions.append(item.model_copy(update={"based_on": based_on, "citations": citations}))

    follow_up = (answer.follow_up_question or "").strip() or None
    if not use_case_complete and follow_up is None:
        follow_up = DEFAULT_FOLLOW_UP

    gaps_noted = [text.strip() for text in answer.gaps_noted if text and text.strip()]
    noted = " ".join(gaps_noted).lower()
    for gap in gaps:
        if gap["id"] == "no_partial_gravity" and "partial" not in noted and "gravity" not in noted:
            gaps_noted.append(gap["text"])

    confidence = answer.confidence if data else "low"
    return Answer(
        summary=answer.summary.strip(),
        relevant_data=data,
        suggestions=suggestions,
        follow_up_question=follow_up,
        gaps_noted=gaps_noted,
        confidence=confidence,
    )


def insufficient_evidence(use_case_complete: bool, gaps: list[dict]) -> Answer:
    return Answer(
        summary=INSUFFICIENT_SUMMARY,
        relevant_data=[],
        suggestions=[],
        follow_up_question=None if use_case_complete else DEFAULT_FOLLOW_UP,
        gaps_noted=[gap["text"] for gap in gaps],
        confidence="low",
    )
