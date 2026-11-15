"""Shared fakes: a scripted Gemini, a tiny data set, and an in-memory chat store."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from ai.answer import Answer
from ai.derive import FoundValues
from ai.filter_parse import ParsedFilter
from ai.understand import Understanding
from auth import AuthError
from chat import Title
from data import DataStore
from main import Services, create_app
from ratelimit import RateLimiter
from store import MemoryStore

RECORDS = json.loads((Path(__file__).parent / "fixtures" / "investigations.json").read_text())

USE_CASE = {
    "description": "Crew quarters for a Moon base",
    "habitat": "Moon base",
    "goal": "choose safe fabrics",
    "materials": ["cotton fabric"],
    "constraints": [],
}


def chunk(investigation_id: str, text: str, index: int) -> dict:
    return {
        "chunk_id": f"{investigation_id}:report:{index}",
        "investigation_id": investigation_id,
        "file_name": f"{investigation_id}_report.pdf",
        "title": f"{investigation_id} report",
        "url": f"https://psi.example/{investigation_id}",
        "doi": None,
        "page_start": index + 1,
        "page_end": index + 1,
        "text": text,
    }


class FakeLLM:
    """Returns scripted JSON by schema and a fixed query vector. Records every call."""

    def __init__(self) -> None:
        self.understanding: dict = {"intent": "find_data"}
        self.answer: dict = {"summary": "Fabric burns.", "confidence": "medium"}
        self.parsed: dict = {"kind": "unclear"}
        self.found: list[dict] = []
        self.query_vector = np.asarray([1.0, 0.0, 0.0], dtype=np.float32)
        self.calls: list[tuple[str, str]] = []

    def generate_json(self, system, prompt, schema, temperature=0.0):
        self.calls.append((schema.__name__, prompt))
        if schema is Understanding:
            return Understanding.model_validate(self.understanding)
        if schema is Answer:
            return Answer.model_validate(self.answer)
        if schema is ParsedFilter:
            return ParsedFilter.model_validate(self.parsed)
        if schema is FoundValues:
            return FoundValues.model_validate({"values": self.found})
        if schema is Title:
            return Title(title="Fabric flames on the Moon.")
        raise AssertionError(f"unexpected schema {schema}")

    def embed_query(self, text):
        self.calls.append(("embed", text))
        return self.query_vector

    def count(self, name: str) -> int:
        return sum(1 for call in self.calls if call[0] == name)


class FakeVerifier:
    def verify(self, token: str) -> str:
        if token != "good-token":
            raise AuthError("Invalid or expired sign-in token.")
        return "user-1"


class SpyStore(MemoryStore):
    """MemoryStore that counts every call, so tests can prove guests touch nothing."""

    def __init__(self) -> None:
        super().__init__()
        self.touched: list[str] = []

    def __getattribute__(self, name):
        value = super().__getattribute__(name)
        if name in ("profile_use_case", "get_chat", "create_chat", "recent_messages", "save_turn"):
            super().__getattribute__("touched").append(name)
        return value


@pytest.fixture
def data() -> DataStore:
    return DataStore(
        chunks=[
            chunk("PSI-25", "Cotton fabric flames spread faster at 21% oxygen than at 16%.", 0),
            chunk("PSI-25", "At 2 cm/s airflow the fabric flame went out.", 1),
            chunk("PSI-68", "Heptane droplets burned at 34% oxygen and 8 psi.", 0),
        ],
        embeddings=np.asarray([[0.9, 0.436, 0.0], [0.8, 0.6, 0.0], [0.7, 0.0, 0.714]], dtype=np.float32),
        embed_model="fake-embed",
        investigations=RECORDS,
        habitats=[
            {"id": "moon_base", "name": "Moon base / pressurized rover", "o2_percent": 34.0, "pressure_psi": 8.0, "gravity_classes": ["partial"]},
            {"id": "iss", "name": "International Space Station", "o2_percent": 21.0, "pressure_psi": 14.7, "gravity_classes": ["microgravity"]},
        ],
        gaps={
            "gaps": [
                {"id": "no_partial_gravity", "title": "No partial-gravity combustion data in PSI", "text": "No PSI combustion investigation was run at Moon or Mars gravity."},
                {"id": "habitat_moon_base_partial", "title": "Moon base: not tested in partial", "text": "No PSI investigation covers 34% O2 at 8 psi in partial.", "habitat_id": "moon_base", "gravity": "partial"},
            ]
        },
        insights=[],
    )


@pytest.fixture
def llm() -> FakeLLM:
    return FakeLLM()


@pytest.fixture
def store() -> SpyStore:
    return SpyStore()


@pytest.fixture
def client(data, llm, store) -> TestClient:
    services = Services(data=data, llm=llm, store=store, verifier=FakeVerifier(), limiter=RateLimiter())
    return TestClient(create_app(services, web_origin="https://flamemind.example"))
