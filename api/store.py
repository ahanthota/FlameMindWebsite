"""Saved chats for signed-in users. User data only, never science data.

Firestore layout (firestore.rules allows the owner to read, rename, and delete;
only this API, through its service account, creates chats and messages):
    users/{uid}                              displayName, email, createdAt, useCaseProfile?
    users/{uid}/chats/{chat_id}              title, createdAt, updatedAt, useCase
    users/{uid}/chats/{chat_id}/messages/*   role, text, structured, createdAt, seq
``structured`` is the full assistant message (answer, sources, ...); null for the user.
Guests never reach this module.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Protocol


class ChatStore(Protocol):
    def profile_use_case(self, uid: str) -> dict | None: ...

    def get_chat(self, uid: str, chat_id: str) -> dict | None: ...

    def create_chat(self, uid: str, title: str, use_case: dict | None) -> str: ...

    def recent_messages(self, uid: str, chat_id: str, limit: int) -> list[dict]: ...

    def save_turn(
        self,
        uid: str,
        chat_id: str,
        messages: list[dict],
        use_case: dict | None,
        use_case_complete: bool,
    ) -> None: ...


class FirestoreStore:
    def __init__(self, client_factory) -> None:
        """``client_factory`` is called on first use, so guests never need Firestore credentials."""
        self._factory = client_factory
        self._client = None

    @property
    def _db(self):
        if self._client is None:
            self._client = self._factory()
        return self._client

    def _chat(self, uid: str, chat_id: str):
        return self._db.collection("users").document(uid).collection("chats").document(chat_id)

    def profile_use_case(self, uid: str) -> dict | None:
        snapshot = self._db.collection("users").document(uid).get()
        profile = (snapshot.to_dict() or {}).get("useCaseProfile") if snapshot.exists else None
        return profile if isinstance(profile, dict) and profile else None

    def get_chat(self, uid: str, chat_id: str) -> dict | None:
        snapshot = self._chat(uid, chat_id).get()
        return snapshot.to_dict() if snapshot.exists else None

    def create_chat(self, uid: str, title: str, use_case: dict | None) -> str:
        from firebase_admin import firestore

        ref = self._db.collection("users").document(uid).collection("chats").document()
        ref.set(
            {
                "title": title,
                "useCase": use_case,
                "createdAt": firestore.SERVER_TIMESTAMP,
                "updatedAt": firestore.SERVER_TIMESTAMP,
            }
        )
        return ref.id

    def recent_messages(self, uid: str, chat_id: str, limit: int) -> list[dict]:
        from firebase_admin import firestore

        query = (
            self._chat(uid, chat_id)
            .collection("messages")
            .order_by("seq", direction=firestore.Query.DESCENDING)
            .limit(limit)
        )
        return [from_document(snapshot.to_dict()) for snapshot in query.stream()][::-1]

    def save_turn(self, uid, chat_id, messages, use_case, use_case_complete) -> None:
        from firebase_admin import firestore

        chat = self._chat(uid, chat_id)
        batch = self._db.batch()
        base = _sequence()
        for offset, message in enumerate(messages):
            batch.set(
                chat.collection("messages").document(),
                {**to_document(message), "seq": base + offset, "createdAt": firestore.SERVER_TIMESTAMP},
            )
        batch.update(
            chat,
            {
                "useCase": use_case,
                "updatedAt": firestore.SERVER_TIMESTAMP,
            },
        )
        batch.commit()


def to_document(message: dict) -> dict:
    """A chat message as stored: {role, text, structured}."""
    structured = {key: value for key, value in message.items() if key not in ("role", "content")}
    return {"role": message["role"], "text": message.get("content", ""), "structured": structured or None}


def from_document(document: dict) -> dict:
    """A stored message as the chat pipeline reads it: {role, content}."""
    return {"role": document.get("role", "user"), "content": document.get("text", "")}


def _sequence() -> int:
    """Microseconds since the epoch. Orders the two messages of one turn, which share a server timestamp."""
    return int(datetime.now(timezone.utc).timestamp() * 1_000_000)


class MemoryStore:
    """In-process store for tests and local runs without Firestore."""

    def __init__(self) -> None:
        self.profiles: dict[str, dict] = {}
        self.chats: dict[tuple[str, str], dict] = {}
        self.messages: dict[tuple[str, str], list[dict]] = {}

    def profile_use_case(self, uid: str) -> dict | None:
        return self.profiles.get(uid)

    def get_chat(self, uid: str, chat_id: str) -> dict | None:
        return self.chats.get((uid, chat_id))

    def create_chat(self, uid: str, title: str, use_case: dict | None) -> str:
        chat_id = uuid.uuid4().hex
        self.chats[(uid, chat_id)] = {"title": title, "useCase": use_case}
        self.messages[(uid, chat_id)] = []
        return chat_id

    def recent_messages(self, uid: str, chat_id: str, limit: int) -> list[dict]:
        return [from_document(item) for item in self.messages.get((uid, chat_id), [])[-limit:]]

    def save_turn(self, uid, chat_id, messages, use_case, use_case_complete) -> None:
        self.messages[(uid, chat_id)].extend(to_document(message) for message in messages)
        self.chats[(uid, chat_id)].update(useCase=use_case)
