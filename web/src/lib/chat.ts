/**
 * Chat message types and pure helpers. The response shape is defined by the
 * API (api/ai/answer.py and api/chat.py).
 */

export interface KeyValue {
  name: string;
  value: string;
  unit: string | null;
}

export interface RelevantData {
  investigation_id: string;
  test_ids: string[];
  what_it_shows: string;
  key_values: KeyValue[];
  /** Source numbers, matching ChatSource.n. */
  citations: number[];
}

export interface Suggestion {
  text: string;
  /** Investigation ids whose findings the suggestion builds on. */
  based_on: string[];
  citations: number[];
}

export type Confidence = "high" | "medium" | "low";

export interface Answer {
  summary: string;
  relevant_data: RelevantData[];
  suggestions: Suggestion[];
  follow_up_question: string | null;
  gaps_noted: string[];
  confidence: Confidence;
}

export interface ChatSource {
  n: number;
  kind: "passage" | "record";
  investigation_id: string;
  title: string;
  url: string;
  doi: string | null;
  page_start: number | null;
  page_end: number | null;
  snippet: string;
}

/** The assistant message returned by POST /chat. */
export interface AssistantPayload {
  role: "assistant";
  content: string;
  answer: Answer;
  sources: ChatSource[];
  insufficient_evidence: boolean;
}

export interface ChatResponse {
  chat_id: string;
  message: AssistantPayload;
}

export interface HistoryItem {
  role: "user" | "assistant";
  content: string;
}

/** One message as shown in the conversation. */
export type UiMessage =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      text: string;
      answer: Answer | null;
      sources: ChatSource[];
      /** The oxygen and pressure the API read from the question, when it reports them. */
      asked?: AskedConditions | null;
    };

export interface AskedConditions {
  o2: number | null;
  psi: number | null;
}

/** The conditions the API understood, from `understanding.conditions` in its response. */
export function toAsked(value: unknown): AskedConditions | null {
  const conditions = isRecord(value) && isRecord(value.conditions) ? value.conditions : null;
  if (!conditions) return null;
  const number = (item: unknown) => (typeof item === "number" && Number.isFinite(item) ? item : null);
  const asked = { o2: number(conditions.o2_percent), psi: number(conditions.pressure_psi) };
  return asked.o2 === null && asked.psi === null ? null : asked;
}

export const HISTORY_LIMIT = 8;

export const DISCLAIMER = "Research summary, not certified safety guidance. Check the cited sources before relying on a value.";

/** Moon-base crew quarters, the worked example used on Home and Scenario. */
export const STARTER_PROMPTS: readonly string[] = [
  "We're designing crew quarters for a Moon base at 34% oxygen and 8 psi. Which fabrics have been tested near those conditions?",
  "For a Moon base at 34% oxygen and 8 psi, how does flame spread over fabric change with airflow?",
  "At Moon-base oxygen, what happens to a fabric flame when the airflow drops very low?",
  "I am choosing bedding and clothing for Moon base crew quarters at 34% oxygen and 8 psi. What should I look at?",
];

/** The last 8 messages, as the API expects them. Guests send this; nothing is stored. */
export function toHistory(messages: UiMessage[]): HistoryItem[] {
  return messages.slice(-HISTORY_LIMIT).map((message) => ({ role: message.role, content: message.text }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numbers(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : [];
}

/** Read an answer defensively: it may come from Firestore, written by an older API. */
export function toAnswer(value: unknown): Answer | null {
  if (!isRecord(value) || typeof value.summary !== "string") return null;
  const confidence = value.confidence === "high" || value.confidence === "medium" ? value.confidence : "low";
  return {
    summary: value.summary,
    relevant_data: (Array.isArray(value.relevant_data) ? value.relevant_data : []).filter(isRecord).map((item) => ({
      investigation_id: String(item.investigation_id ?? ""),
      test_ids: strings(item.test_ids),
      what_it_shows: String(item.what_it_shows ?? ""),
      key_values: (Array.isArray(item.key_values) ? item.key_values : []).filter(isRecord).map((entry) => ({
        name: String(entry.name ?? ""),
        value: String(entry.value ?? ""),
        unit: typeof entry.unit === "string" && entry.unit ? entry.unit : null,
      })),
      citations: numbers(item.citations),
    })),
    suggestions: (Array.isArray(value.suggestions) ? value.suggestions : []).filter(isRecord).map((item) => ({
      text: String(item.text ?? ""),
      based_on: strings(item.based_on),
      citations: numbers(item.citations),
    })),
    follow_up_question: typeof value.follow_up_question === "string" && value.follow_up_question.trim() ? value.follow_up_question : null,
    gaps_noted: strings(value.gaps_noted),
    confidence,
  };
}

export function toSources(value: unknown): ChatSource[] {
  return (Array.isArray(value) ? value : [])
    .filter(isRecord)
    .filter((item) => typeof item.n === "number")
    .map((item) => ({
      n: item.n as number,
      kind: item.kind === "record" ? "record" : "passage",
      investigation_id: String(item.investigation_id ?? ""),
      title: String(item.title ?? ""),
      url: String(item.url ?? ""),
      doi: typeof item.doi === "string" && item.doi ? item.doi : null,
      page_start: typeof item.page_start === "number" ? item.page_start : null,
      page_end: typeof item.page_end === "number" ? item.page_end : null,
      snippet: String(item.snippet ?? ""),
    }));
}

/** A message from POST /chat as a conversation message. */
export function fromResponse(id: string, payload: unknown): UiMessage {
  const data = isRecord(payload) ? payload : {};
  const answer = toAnswer(data.answer);
  return {
    id,
    role: "assistant",
    text: typeof data.content === "string" && data.content ? data.content : (answer?.summary ?? ""),
    answer,
    sources: toSources(data.sources),
    asked: toAsked(data.understanding),
  };
}

/** A stored message ({role, text, structured}) as a conversation message. */
export function fromStored(id: string, document: unknown): UiMessage {
  const data = isRecord(document) ? document : {};
  const text = typeof data.text === "string" ? data.text : "";
  if (data.role !== "assistant") return { id, role: "user", text };
  const structured = isRecord(data.structured) ? data.structured : {};
  return {
    id,
    role: "assistant",
    text,
    answer: toAnswer(structured.answer),
    sources: toSources(structured.sources),
    asked: toAsked(structured.understanding),
  };
}

/** "p. 3", "pp. 3-4", or "" for a structured record. */
export function pageLabel(source: Pick<ChatSource, "page_start" | "page_end">): string {
  if (source.page_start === null) return "";
  if (source.page_end === null || source.page_end === source.page_start) return `p. ${source.page_start}`;
  return `pp. ${source.page_start}-${source.page_end}`;
}
