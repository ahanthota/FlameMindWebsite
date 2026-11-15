"""One chat turn: understand, rank, retrieve, answer, validate. Then save if signed in."""

from __future__ import annotations

import hashlib
import json
import logging
import re
import uuid
from dataclasses import dataclass

from pydantic import BaseModel

from ai import answer as answering
from ai.llm import LLM, LLMError
from ai.ranker import rank
from ai.retrieve import EVIDENCE_THRESHOLD, retrieve
from ai.understand import HISTORY_LIMIT, Understanding, understand
from data import DataStore
from store import ChatStore

log = logging.getLogger("flamemind.chat")

SNIPPET_CHARS = 300
TITLE_WORDS = 6


class ChatNotFound(Exception):
    """The chat id does not belong to this user."""


@dataclass
class Turn:
    message: dict  # the assistant message returned to the client and saved
    use_case: dict | None
    use_case_complete: bool


# ---------- answer cache ----------


def cache_key(message: str, use_case: dict | None) -> str:
    normalized = re.sub(r"[^a-z0-9]+", " ", message.lower()).strip()
    payload = normalized + "|" + json.dumps(use_case or None, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ---------- the turn ----------


def apply_habitat(understanding: Understanding, data: DataStore) -> str | None:
    """If the user gave no atmosphere, use their habitat preset's. Returns the preset id."""
    habitat = data.habitat(understanding.use_case.habitat) if understanding.use_case else None
    if habitat is None:
        return None
    conditions = understanding.conditions
    if conditions.o2_percent is None and conditions.pressure_psi is None:
        conditions.o2_percent = habitat.get("o2_percent")
        conditions.pressure_psi = habitat.get("pressure_psi")
    if conditions.gravity is None and len(habitat.get("gravity_classes") or []) == 1:
        conditions.gravity = habitat["gravity_classes"][0]
    return habitat["id"]


def run_turn(
    llm: LLM,
    data: DataStore,
    message: str,
    history: list[dict],
    stored_use_case: dict | None,
    threshold: float = EVIDENCE_THRESHOLD,
) -> Turn:
    history = history[-HISTORY_LIMIT:]
    key = cache_key(message, stored_use_case)
    if not history and key in data.answer_cache:
        cached = data.answer_cache[key]
        return Turn({**cached["message"], "cached": True}, cached["use_case"], cached["use_case_complete"])

    understanding = understand(llm, message, history, stored_use_case)
    habitat_id = apply_habitat(understanding, data)
    conditions = understanding.conditions.model_dump()
    use_case = understanding.use_case.model_dump() if understanding.use_case else None
    complete = understanding.use_case_complete

    ranked = rank(data.investigations, conditions, understanding.intent)
    retrieval = retrieve(llm, data.chunks, data.embeddings, message, conditions, ranked, threshold=threshold)
    gaps = answering.relevant_gaps(data.gaps, conditions.get("gravity"), habitat_id)

    if retrieval.sufficient:
        sources = answering.build_sources(retrieval.passages, ranked, data.by_id)
        draft = answering.write_answer(
            llm, message, history, understanding.model_dump(), sources, gaps
        )
        final = answering.validate(draft, sources, data.by_id, complete, gaps)
    else:
        sources = []
        final = answering.insufficient_evidence(complete, gaps)

    return Turn(
        message={
            "role": "assistant",
            "content": final.summary,
            "answer": final.model_dump(),
            "sources": [_public_source(source) for source in sources],
            "ranking": [
                {
                    "investigation_id": item.investigation_id,
                    "acronym": data.acronym(item.investigation_id),
                    "score": item.score,
                    "reasons": item.reasons,
                }
                for item in ranked[:5]
                if item.score > 0
            ],
            "understanding": {"intent": understanding.intent, "conditions": conditions},
            "use_case": use_case,
            "use_case_complete": complete,
            "insufficient_evidence": not retrieval.sufficient,
            "cached": False,
        },
        use_case=use_case,
        use_case_complete=complete,
    )


def _public_source(source: dict) -> dict:
    text = " ".join(source["text"].split())
    snippet = text if len(text) <= SNIPPET_CHARS else text[:SNIPPET_CHARS].rsplit(" ", 1)[0] + " ..."
    return {**{key: value for key, value in source.items() if key != "text"}, "snippet": snippet}


# ---------- titles ----------


class Title(BaseModel):
    title: str


def make_title(llm: LLM, message: str) -> str:
    fallback = " ".join(message.split()[:TITLE_WORDS])[:60] or "New chat"
    try:
        result = llm.generate_json(
            "Write a title of at most six words for a chat that starts with this message. "
            "Plain words, no quotes, no trailing punctuation. Return JSON only.",
            message[:1000],
            Title,
        )
    except LLMError:
        return fallback
    title = " ".join(result.title.split()).strip(" .\"'")
    return title[:60] or fallback


# ---------- guests and signed-in users ----------


def guest_chat(llm: LLM, data: DataStore, chat_id: str | None, message: str, history: list[dict]) -> dict:
    """Uses only what the client sent. Nothing is stored."""
    turn = run_turn(llm, data, message, [_plain(item) for item in history], None)
    return {"chat_id": chat_id or uuid.uuid4().hex, "message": turn.message}


def user_chat(
    llm: LLM, data: DataStore, store: ChatStore, uid: str, chat_id: str | None, message: str
) -> dict:
    if chat_id:
        chat = store.get_chat(uid, chat_id)
        if chat is None:
            raise ChatNotFound(chat_id)
        stored_use_case = chat.get("useCase")
        history = [_plain(item) for item in store.recent_messages(uid, chat_id, HISTORY_LIMIT)]
    else:
        stored_use_case = store.profile_use_case(uid)
        history = []

    turn = run_turn(llm, data, message, history, stored_use_case)

    if not chat_id:
        chat_id = store.create_chat(uid, make_title(llm, message), stored_use_case)
    store.save_turn(
        uid,
        chat_id,
        [{"role": "user", "content": message}, turn.message],
        turn.use_case,
        turn.use_case_complete,
    )
    return {"chat_id": chat_id, "message": turn.message}


def _plain(item: dict) -> dict:
    return {"role": item.get("role", "user"), "content": str(item.get("content", ""))}
