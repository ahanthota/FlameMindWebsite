/**
 * Calls to the FlameMind API. The base URL comes from NEXT_PUBLIC_API_URL.
 * When someone is signed in, their Firebase ID token is sent so the API can
 * save the chat; guests send no token and nothing is saved.
 */

import type { ChatResponse, HistoryItem } from "./chat";
import { normalizeCustomFilters, type CustomFilter, type DerivedFilter, type DerivedValue } from "./filters";
import { getFirebase } from "./firebase";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
export const CHAT_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 when the request never got a response. */
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface SendChatInput {
  /** The chat to continue. Omit to start a new one. */
  chat_id?: string | null;
  message: string;
  /** Guests only: the last 8 messages. Signed-in history is loaded by the API. */
  history?: HistoryItem[];
}

async function authHeader(): Promise<Record<string, string>> {
  const user = getFirebase()?.auth.currentUser;
  return user ? { Authorization: `Bearer ${await user.getIdToken()}` } : {};
}

function failureMessage(status: number, detail: unknown): string {
  if (status === 429) return "You have sent a lot of messages. Wait a minute and try again.";
  if (status === 401) return "Your sign-in has expired. Sign in again, then retry.";
  if (status === 404) return "That chat no longer exists. Start a new chat.";
  if (status === 503) return "The AI service is busy or unavailable. Try again in a moment.";
  return typeof detail === "string" && detail ? detail : "The request failed. Try again.";
}

const NOT_SET = "The FlameMind service address is not set. Set NEXT_PUBLIC_API_URL for this site, then rebuild it.";

/** POST a JSON body. Rejects with ApiError on a timeout, a network failure, or an error response. */
async function post<T>(path: string, body: unknown, timeoutMs: number, slow: string): Promise<T> {
  if (!API_URL) throw new ApiError(NOT_SET, 0);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = typeof data === "object" && data !== null && "detail" in data ? data.detail : null;
      throw new ApiError(failureMessage(response.status, detail), response.status);
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw new ApiError(slow, 0);
    throw new ApiError("Could not reach the FlameMind service. Check that it is running, then try again.", 0);
  } finally {
    clearTimeout(timer);
  }
}

/** POST /chat. Rejects with ApiError after 30 s, on a network failure, or on an error response. */
export function sendChat(input: SendChatInput, timeoutMs: number = CHAT_TIMEOUT_MS): Promise<ChatResponse> {
  return post<ChatResponse>(
    "/chat",
    { ...(input.chat_id ? { chat_id: input.chat_id } : {}), message: input.message, history: input.history ?? [] },
    timeoutMs,
    "The answer took longer than 30 seconds. Try again.",
  );
}

// ---------- custom filters ----------

export const DERIVE_TIMEOUT_MS = 120_000;
/** Investigations per /filter/derive call, so progress can be shown between calls. */
export const DERIVE_BATCH = 4;

/** What the typed text means: a filter to confirm, or a question to ask back. */
export type ParsedFilter = { kind: "filter"; filter: CustomFilter } | { kind: "unclear"; question: string };

const UNCLEAR = "Which parameter do you want to filter on, and over what range?";

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** POST /filter/parse. */
export async function parseFilter(text: string): Promise<ParsedFilter> {
  const body = await post<Record<string, unknown>>(
    "/filter/parse",
    { text },
    CHAT_TIMEOUT_MS,
    "Reading the filter took longer than 30 seconds. Try again.",
  );
  const [filter] = normalizeCustomFilters([body]);
  if (filter) return { kind: "filter", filter };
  return { kind: "unclear", question: typeof body.question === "string" && body.question ? body.question : UNCLEAR };
}

interface DeriveResponse {
  results?: {
    investigation_id?: unknown;
    test_id?: unknown;
    value?: unknown;
    unit?: unknown;
    status?: unknown;
    citation?: { title?: unknown; url?: unknown; page_start?: unknown; page_end?: unknown } | null;
  }[];
}

/**
 * POST /filter/derive for the given investigations, a few at a time.
 * `onProgress` is called with the number of investigations finished so far.
 */
export async function deriveFilter(
  filter: DerivedFilter,
  investigationIds: string[],
  onProgress?: (done: number) => void,
): Promise<DerivedValue[]> {
  const values: DerivedValue[] = [];
  for (let start = 0; start < investigationIds.length; start += DERIVE_BATCH) {
    const ids = investigationIds.slice(start, start + DERIVE_BATCH);
    const body = await post<DeriveResponse>(
      "/filter/derive",
      { parameter: filter.parameter, min: filter.min, max: filter.max, unit: filter.unit, investigation_ids: ids },
      DERIVE_TIMEOUT_MS,
      "Reading the source documents took too long. Try again.",
    );
    for (const item of body.results ?? []) {
      const value = finite(item.value);
      if (value === null || typeof item.investigation_id !== "string" || item.status === "not_reported") continue;
      values.push({
        investigationId: item.investigation_id,
        testId: typeof item.test_id === "string" ? item.test_id : null,
        value,
        unit: typeof item.unit === "string" && item.unit ? item.unit : null,
        inRange: item.status === "match",
        citation: item.citation
          ? {
              title: typeof item.citation.title === "string" ? item.citation.title : "",
              url: typeof item.citation.url === "string" ? item.citation.url : "",
              pageStart: finite(item.citation.page_start),
              pageEnd: finite(item.citation.page_end),
            }
          : null,
      });
    }
    onProgress?.(Math.min(start + ids.length, investigationIds.length));
  }
  return values;
}
