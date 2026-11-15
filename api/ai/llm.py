"""Gemini and embedding calls on Vertex AI.

Everything else in ``ai/`` talks to the ``LLM`` protocol, so tests pass a fake.
"""

from __future__ import annotations

import time
from typing import Protocol, TypeVar

import numpy as np
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)

RETRY_STATUS = frozenset({429, 500, 503})
# A chat request should fail in seconds, not minutes.
RETRY_DELAYS_S = (1, 2, 4)


class LLM(Protocol):
    def generate_json(self, system: str, prompt: str, schema: type[T], temperature: float = 0.0) -> T: ...

    def embed_query(self, text: str) -> np.ndarray: ...


class LLMError(RuntimeError):
    """The model could not be reached or returned unusable output."""


class VertexLLM:
    def __init__(self, project: str, region: str, gemini_model: str, embed_model: str) -> None:
        from google import genai

        self._client = genai.Client(vertexai=True, project=project, location=region)
        self.gemini_model = gemini_model
        self.embed_model = embed_model

    def generate_json(self, system: str, prompt: str, schema: type[T], temperature: float = 0.0) -> T:
        from google.genai import types

        config = types.GenerateContentConfig(
            temperature=temperature,
            response_mime_type="application/json",
            response_json_schema=schema.model_json_schema(),
            system_instruction=system,
        )
        last_error: Exception | None = None
        for attempt in range(2):  # one repair attempt for malformed JSON
            response = self._call(
                lambda: self._client.models.generate_content(
                    model=self.gemini_model, contents=prompt, config=config
                )
            )
            try:
                return schema.model_validate_json(response.text or "")
            except ValueError as exc:
                last_error = exc
        raise LLMError(f"Gemini returned JSON that does not match {schema.__name__}: {last_error}")

    def embed_query(self, text: str) -> np.ndarray:
        from google.genai import types

        response = self._call(
            lambda: self._client.models.embed_content(
                model=self.embed_model,
                contents=[text],
                config=types.EmbedContentConfig(task_type="RETRIEVAL_QUERY"),
            )
        )
        if not response.embeddings:
            raise LLMError("embedding call returned nothing")
        vector = np.asarray(response.embeddings[0].values, dtype=np.float32)
        norm = float(np.linalg.norm(vector))
        return vector / norm if norm else vector

    @staticmethod
    def _call(fn):
        from google.genai import errors

        for delay in (*RETRY_DELAYS_S, None):
            try:
                return fn()
            except errors.APIError as exc:
                if exc.code not in RETRY_STATUS or delay is None:
                    raise LLMError(f"Vertex AI call failed: {exc}") from exc
                time.sleep(delay)
        raise LLMError("Vertex AI call failed")
