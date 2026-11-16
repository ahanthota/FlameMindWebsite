import { describe, expect, it } from "vitest";
import { fromResponse, fromStored, pageLabel, toAnswer, toHistory, toSources, type UiMessage } from "./chat";

const ANSWER = {
  summary: "Fabric burns faster with more oxygen.",
  relevant_data: [
    {
      investigation_id: "PSI-25",
      test_ids: ["PSI-25-T1"],
      what_it_shows: "Spread rate rises with oxygen.",
      key_values: [{ name: "Oxygen", value: "21", unit: "%" }, { name: "Outcome", value: "ignited", unit: null }],
      citations: [1, 3],
    },
  ],
  suggestions: [{ text: "Keep airflow low.", based_on: ["PSI-25"], citations: [1] }],
  follow_up_question: null,
  gaps_noted: ["No partial-gravity tests."],
  confidence: "medium",
};
const SOURCES = [
  { n: 1, kind: "passage", investigation_id: "PSI-25", title: "BASS-II report", url: "https://psi.example/25", doi: "10.1/x", page_start: 3, page_end: 4, snippet: "text", similarity: 0.8 },
  { n: 3, kind: "record", investigation_id: "PSI-25", title: "BASS-II structured record", url: "https://psi.example/25", doi: null, page_start: null, page_end: null, snippet: "record" },
];

describe("toHistory", () => {
  it("sends only the last 8 messages as role and content", () => {
    const messages: UiMessage[] = Array.from({ length: 11 }, (_, index) =>
      index % 2 === 0
        ? { id: String(index), role: "user", text: `question ${index}` }
        : { id: String(index), role: "assistant", text: `answer ${index}`, answer: null, sources: [] },
    );
    const history = toHistory(messages);
    expect(history).toHaveLength(8);
    expect(history[0]).toEqual({ role: "assistant", content: "answer 3" });
    expect(history[7]).toEqual({ role: "user", content: "question 10" });
    expect(toHistory([])).toEqual([]);
  });
});

describe("reading answers", () => {
  it("reads a full API message", () => {
    const message = fromResponse("m1", { role: "assistant", content: ANSWER.summary, answer: ANSWER, sources: SOURCES });
    expect(message).toMatchObject({ id: "m1", role: "assistant", text: ANSWER.summary });
    if (message.role !== "assistant") throw new Error("expected assistant");
    expect(message.answer?.relevant_data[0].key_values[1]).toEqual({ name: "Outcome", value: "ignited", unit: null });
    expect(message.answer?.suggestions[0].based_on).toEqual(["PSI-25"]);
    expect(message.sources.map((source) => source.n)).toEqual([1, 3]);
    expect(message.sources[0]).not.toHaveProperty("similarity");
  });

  it("repairs missing or malformed fields instead of throwing", () => {
    expect(toAnswer(null)).toBeNull();
    expect(toAnswer({ relevant_data: [] })).toBeNull();
    expect(toAnswer({ summary: "Only a summary.", confidence: "certain", follow_up_question: "  " })).toEqual({
      summary: "Only a summary.",
      relevant_data: [],
      suggestions: [],
      follow_up_question: null,
      gaps_noted: [],
      confidence: "low",
    });
    expect(toSources([{ title: "no number" }, "junk", { n: 2 }])).toEqual([
      { n: 2, kind: "passage", investigation_id: "", title: "", url: "", doi: null, page_start: null, page_end: null, snippet: "" },
    ]);
  });

  it("reads stored Firestore messages for both roles", () => {
    expect(fromStored("u", { role: "user", text: "How?", structured: null })).toEqual({ id: "u", role: "user", text: "How?" });
    const stored = fromStored("a", { role: "assistant", text: "Fabric burns.", structured: { answer: ANSWER, sources: SOURCES } });
    expect(stored).toMatchObject({ role: "assistant", text: "Fabric burns." });
    if (stored.role !== "assistant") throw new Error("expected assistant");
    expect(stored.answer?.confidence).toBe("medium");
    expect(stored.sources).toHaveLength(2);
    // An assistant message saved without structure still shows its text.
    expect(fromStored("b", { role: "assistant", text: "Plain." })).toEqual({
      id: "b",
      role: "assistant",
      text: "Plain.",
      answer: null,
      sources: [],
      asked: null,
    });
  });
});

describe("pageLabel", () => {
  it("formats one page, a span, and records", () => {
    expect(pageLabel({ page_start: 3, page_end: 3 })).toBe("p. 3");
    expect(pageLabel({ page_start: 3, page_end: 4 })).toBe("pp. 3-4");
    expect(pageLabel({ page_start: null, page_end: null })).toBe("");
  });
});
