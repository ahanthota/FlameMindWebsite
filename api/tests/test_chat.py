"""POST /chat with Gemini and Firestore mocked."""

from __future__ import annotations

import numpy as np

from ai.answer import DEFAULT_FOLLOW_UP, INSUFFICIENT_SUMMARY
from chat import cache_key
from tests.conftest import USE_CASE

AUTH = {"Authorization": "Bearer good-token"}

DATA_ITEM = {
    "investigation_id": "PSI-25",
    "test_ids": ["PSI-25-T1", "PSI-25-T99"],
    "what_it_shows": "Fabric flames spread faster with more oxygen.",
    "key_values": [{"name": "oxygen", "value": "21", "unit": "%"}],
    "citations": [1, 42],
}
SUGGESTION = {"text": "Keep airflow low near fabric storage.", "based_on": ["PSI-25"], "citations": [2]}


def test_no_use_case_gives_follow_up_question_and_no_suggestions(client, llm):
    llm.understanding = {"intent": "find_data", "conditions": {"o2_percent": 21, "materials": ["fabric"]}}
    llm.answer = {
        "summary": "BASS-II burned fabric at 21% oxygen.",
        "relevant_data": [DATA_ITEM],
        "suggestions": [SUGGESTION],  # the model ignored the rule; validation must remove it
        "follow_up_question": None,
        "confidence": "medium",
    }
    response = client.post("/chat", json={"message": "How does fabric burn at 21% oxygen?"})
    assert response.status_code == 200
    message = response.json()["message"]
    answer = message["answer"]
    assert answer["suggestions"] == []
    assert answer["follow_up_question"] == DEFAULT_FOLLOW_UP
    assert message["use_case_complete"] is False
    assert answer["relevant_data"][0]["citations"] == [1]  # 42 does not exist
    assert answer["relevant_data"][0]["test_ids"] == ["PSI-25-T1"]  # T99 does not exist
    assert message["sources"][0]["investigation_id"] == "PSI-25"
    assert "text" not in message["sources"][0] and message["sources"][0]["snippet"]


def test_use_case_gives_suggestions_with_based_on(client, llm):
    llm.understanding = {
        "intent": "use_case_update",
        "conditions": {"materials": ["cotton fabric"]},
        "use_case": USE_CASE,
        "use_case_complete": True,
    }
    llm.answer = {
        "summary": "Fabric flames respond strongly to oxygen and airflow.",
        "relevant_data": [DATA_ITEM],
        "suggestions": [
            SUGGESTION,
            {"text": "No citation, must be dropped.", "based_on": ["PSI-25"], "citations": []},
            {"text": "Unknown investigation, must be dropped.", "based_on": ["PSI-999"], "citations": [1]},
        ],
        "follow_up_question": None,
        "gaps_noted": [],
        "confidence": "medium",
    }
    response = client.post("/chat", json={"message": "I am choosing fabrics for Moon base crew quarters."})
    message = response.json()["message"]
    answer = message["answer"]
    assert answer["suggestions"] == [SUGGESTION]
    assert answer["follow_up_question"] is None
    assert message["use_case"] == USE_CASE and message["use_case_complete"] is True
    # The Moon base preset filled the atmosphere and gravity, and the partial-gravity gap is noted.
    assert message["understanding"]["conditions"]["o2_percent"] == 34.0
    assert message["understanding"]["conditions"]["gravity"] == "partial"
    assert any("Moon or Mars gravity" in gap for gap in answer["gaps_noted"])


def test_low_similarity_gives_insufficient_evidence(client, llm):
    llm.query_vector = np.asarray([0.0, 0.0, 0.5], dtype=np.float32)  # best cosine 0.357 < 0.55
    response = client.post("/chat", json={"message": "What is the best pizza topping?"})
    message = response.json()["message"]
    assert message["insufficient_evidence"] is True
    assert message["content"] == INSUFFICIENT_SUMMARY
    assert message["answer"]["relevant_data"] == [] and message["answer"]["suggestions"] == []
    assert message["answer"]["confidence"] == "low"
    assert message["sources"] == []
    assert llm.count("Answer") == 0  # no answer call is made without evidence


def test_data_items_without_valid_citations_are_rejected(client, llm):
    llm.answer = {
        "summary": "Something.",
        "relevant_data": [{**DATA_ITEM, "citations": [77]}, {**DATA_ITEM, "investigation_id": "PSI-404"}],
        "confidence": "high",
    }
    answer = client.post("/chat", json={"message": "fabric flames"}).json()["message"]["answer"]
    assert answer["relevant_data"] == []
    assert answer["confidence"] == "low"


def test_guest_requests_save_nothing_and_use_client_history(client, llm, store):
    history = [{"role": "user", "content": f"old message {index}"} for index in range(12)]
    response = client.post("/chat", json={"message": "fabric flames", "history": history, "chat_id": "local-1"})
    assert response.status_code == 200
    assert response.json()["chat_id"] == "local-1"
    assert store.touched == [] and store.chats == {} and store.messages == {}
    prompt = next(prompt for name, prompt in llm.calls if name == "Understanding")
    assert "old message 11" in prompt and "old message 4" in prompt
    assert "old message 3" not in prompt  # only the last 8


def test_signed_in_creates_chat_with_title_and_saves_structured_messages(client, llm, store):
    store.profiles["user-1"] = USE_CASE
    llm.understanding = {"intent": "find_data", "use_case": USE_CASE, "use_case_complete": True}
    llm.answer = {"summary": "Fabric burns.", "relevant_data": [DATA_ITEM], "suggestions": [SUGGESTION], "confidence": "medium"}
    first = client.post("/chat", json={"message": "How does cotton burn?"}, headers=AUTH).json()
    chat_id = first["chat_id"]
    chat = store.chats[("user-1", chat_id)]
    assert chat["title"] == "Fabric flames on the Moon"
    assert chat == {"title": "Fabric flames on the Moon", "useCase": USE_CASE}
    saved = store.messages[("user-1", chat_id)]
    assert [item["role"] for item in saved] == ["user", "assistant"]
    assert saved[0] == {"role": "user", "text": "How does cotton burn?", "structured": None}
    assert set(saved[1]) == {"role", "text", "structured"} and saved[1]["text"] == "Fabric burns."
    assert saved[1]["structured"]["answer"]["suggestions"] == [SUGGESTION]  # structured JSON, not just text
    # The saved profile was the starting use case.
    assert '"habitat": "Moon base"' in next(prompt for name, prompt in llm.calls if name == "Understanding")

    llm.calls.clear()
    second = client.post("/chat", json={"chat_id": chat_id, "message": "And at low airflow?"}, headers=AUTH).json()
    assert second["chat_id"] == chat_id
    assert len(store.messages[("user-1", chat_id)]) == 4
    assert llm.count("Title") == 0
    assert "user: How does cotton burn?" in next(prompt for name, prompt in llm.calls if name == "Understanding")


def test_bad_token_and_unknown_chat(client):
    assert client.post("/chat", json={"message": "hi"}, headers={"Authorization": "Bearer nope"}).status_code == 401
    assert client.post("/chat", json={"message": "hi"}, headers={"Authorization": "Basic abc"}).status_code == 401
    assert client.post("/chat", json={"message": "hi", "chat_id": "missing"}, headers=AUTH).status_code == 404
    assert client.post("/chat", json={"message": ""}).status_code == 422


def test_rate_limits_guests_at_10_and_users_at_30(client):
    guest = [client.post("/chat", json={"message": "fabric"}).status_code for _ in range(11)]
    assert guest == [200] * 10 + [429]
    user = [client.post("/chat", json={"message": "fabric"}, headers=AUTH).status_code for _ in range(31)]
    assert user == [200] * 30 + [429]


def test_cors_allows_only_the_web_origin(client):
    allowed = client.options("/chat", headers={"Origin": "https://flamemind.example", "Access-Control-Request-Method": "POST"})
    assert allowed.headers["access-control-allow-origin"] == "https://flamemind.example"
    other = client.options("/chat", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in other.headers


def test_cached_answer_skips_the_model(client, llm, data):
    cached = {"role": "assistant", "content": "From the cache.", "answer": {"summary": "From the cache."}}
    data.answer_cache[cache_key("Fabric   flames?", None)] = {"message": cached, "use_case": None, "use_case_complete": False}
    message = client.post("/chat", json={"message": "fabric flames"}).json()["message"]
    assert message["content"] == "From the cache." and message["cached"] is True
    assert llm.calls == []
    # With history the question may mean something else, so the cache is skipped.
    client.post("/chat", json={"message": "fabric flames", "history": [{"role": "user", "content": "x"}]})
    assert llm.count("Understanding") == 1


def test_me_reports_the_verified_user(client):
    assert client.get("/me").json() == {"signed_in": False, "uid": None}
    assert client.get("/me", headers=AUTH).json() == {"signed_in": True, "uid": "user-1"}
    assert client.get("/me", headers={"Authorization": "Bearer nope"}).status_code == 401
    # /me does not use up the chat rate limit.
    assert [client.get("/me").status_code for _ in range(15)] == [200] * 15


def test_every_route_that_carries_a_token_verifies_it(client):
    bad = {"Authorization": "Bearer nope"}
    assert client.post("/chat", json={"message": "hi"}, headers=bad).status_code == 401
    assert client.post("/filter/parse", json={"text": "oxygen above 30"}, headers=bad).status_code == 401
    assert client.post("/filter/derive", json={"parameter": "thickness"}, headers=bad).status_code == 401
    assert client.get("/me", headers=bad).status_code == 401
