"""FirestoreStore against the Firestore emulator. Skipped unless the emulator is running:

    firebase emulators:exec --only firestore --project demo-flamemind \
        "cd api && python -m pytest tests/test_store_emulator.py"
"""

from __future__ import annotations

import os
import uuid

import pytest

from store import FirestoreStore

pytestmark = pytest.mark.skipif(
    not os.environ.get("FIRESTORE_EMULATOR_HOST"), reason="Firestore emulator is not running"
)

USE_CASE = {"description": "Moon base galley", "habitat": "Moon base", "goal": None, "materials": [], "constraints": []}


@pytest.fixture
def client():
    from google.cloud import firestore

    return firestore.Client(project="demo-flamemind")


@pytest.fixture
def uid() -> str:
    return f"user-{uuid.uuid4().hex[:8]}"


def test_profile_use_case(client, uid):
    store = FirestoreStore(lambda: client)
    assert store.profile_use_case(uid) is None
    client.collection("users").document(uid).set({"displayName": "A", "useCaseProfile": {"description": "A galley"}})
    assert store.profile_use_case(uid) == {"description": "A galley"}


def test_chat_round_trip_matches_the_data_model(client, uid):
    store = FirestoreStore(lambda: client)
    assert store.get_chat(uid, "missing") is None

    chat_id = store.create_chat(uid, "Fabric flames", None)
    chat = store.get_chat(uid, chat_id)
    assert set(chat) == {"title", "createdAt", "updatedAt", "useCase"}
    assert chat["title"] == "Fabric flames" and chat["useCase"] is None

    assistant = {"role": "assistant", "content": "Fabric burns.", "answer": {"summary": "Fabric burns."}, "sources": []}
    store.save_turn(uid, chat_id, [{"role": "user", "content": "How?"}, assistant], USE_CASE, True)
    store.save_turn(uid, chat_id, [{"role": "user", "content": "And then?"}, assistant], USE_CASE, True)

    assert store.get_chat(uid, chat_id)["useCase"] == USE_CASE
    documents = [
        snapshot.to_dict()
        for snapshot in client.collection("users").document(uid).collection("chats").document(chat_id)
        .collection("messages").order_by("seq").stream()
    ]
    assert [(item["role"], item["text"]) for item in documents] == [
        ("user", "How?"), ("assistant", "Fabric burns."), ("user", "And then?"), ("assistant", "Fabric burns."),
    ]
    assert all(set(item) == {"role", "text", "structured", "createdAt", "seq"} for item in documents)
    assert documents[0]["structured"] is None
    assert documents[1]["structured"] == {"answer": {"summary": "Fabric burns."}, "sources": []}

    # History comes back oldest first, limited to the most recent messages.
    assert store.recent_messages(uid, chat_id, 3) == [
        {"role": "assistant", "content": "Fabric burns."},
        {"role": "user", "content": "And then?"},
        {"role": "assistant", "content": "Fabric burns."},
    ]
