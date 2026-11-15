/**
 * Calls to the FlameMind API. The base URL comes from NEXT_PUBLIC_API_URL.
 * When someone is signed in, their Firebase ID token is sent so the API can
 * save the chat; guests send no token and nothing is saved.
 */

import type { ChatResponse, HistoryItem } from "./chat";
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

/** POST /chat. Rejects with ApiError after 30 s, on a network failure, or on an error response. */
export async function sendChat(input: SendChatInput, timeoutMs: number = CHAT_TIMEOUT_MS): Promise<ChatResponse> {
  if (!API_URL) {
    throw new ApiError("The chat service address is not set. Add NEXT_PUBLIC_API_URL to web/.env.local.", 0);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: JSON.stringify({
        ...(input.chat_id ? { chat_id: input.chat_id } : {}),
        message: input.message,
        history: input.history ?? [],
      }),
      signal: controller.signal,
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = typeof body === "object" && body !== null && "detail" in body ? body.detail : null;
      throw new ApiError(failureMessage(response.status, detail), response.status);
    }
    return body as ChatResponse;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("The answer took longer than 30 seconds. Try again.", 0);
    }
    throw new ApiError("Could not reach the chat service. Check that it is running, then try again.", 0);
  } finally {
    clearTimeout(timer);
  }
}
