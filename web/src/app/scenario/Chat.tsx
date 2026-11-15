"use client";

import type { User } from "firebase/auth";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ErrorState, linkClass, LoadingState } from "@/components/States";
import { sendChat } from "@/lib/api";
import { errorMessage, useAuth } from "@/lib/auth";
import { fromResponse, STARTER_PROMPTS, toHistory, type ChatSource, type UiMessage } from "@/lib/chat";
import { getFirebase } from "@/lib/firebase";
import { deleteChat, listChats, listMessages, NAME_MAX_LENGTH, renameChat, type SavedChat } from "@/lib/userdata";
import { AssistantMessage, SourceDrawer, type InvestigationNames } from "./AssistantMessage";

const MESSAGE_MAX_LENGTH = 2000;

type ChatList = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; chats: SavedChat[] };

function formatDate(date: Date | null): string {
  return date ? date.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" }) : "";
}

function setChatInUrl(chatId: string | null) {
  window.history.replaceState(null, "", chatId ? `/scenario/?chat=${encodeURIComponent(chatId)}` : "/scenario/");
}

let nextId = 0;
const newId = () => `local-${++nextId}`;

export function Chat({ investigations }: { investigations: InvestigationNames }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <LoadingState label="Checking sign-in" />;
  }
  // A new key resets the conversation when someone signs in or out.
  return <ChatSession key={user?.uid ?? "guest"} user={user} names={investigations} />;
}

function ChatSession({ user, names }: { user: User | null; names: InvestigationNames }) {
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ text: string; message: string } | null>(null);
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState("");
  const [input, setInput] = useState("");
  const [chats, setChats] = useState<ChatList>({ status: "loading" });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [source, setSource] = useState<ChatSource | null>(null);

  // The latest values, for callbacks that outlive a render.
  const messagesRef = useRef<UiMessage[]>([]);
  const chatIdRef = useRef<string | null>(null);
  /** Bumped whenever the conversation is replaced, so a late reply is dropped. */
  const session = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const replaceMessages = useCallback((next: UiMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);
  const replaceChatId = useCallback((next: string | null) => {
    chatIdRef.current = next;
    setChatId(next);
  }, []);

  const refreshChats = useCallback(async () => {
    const db = getFirebase()?.db;
    if (!user || !db) return;
    try {
      setChats({ status: "ready", chats: await listChats(db, user.uid) });
    } catch (reason) {
      setChats({ status: "error", error: errorMessage(reason) });
    }
  }, [user]);

  const send = useCallback(
    async (text: string, retry = false) => {
      const message = text.trim().slice(0, MESSAGE_MAX_LENGTH);
      if (!message) return;
      const current = session.current;
      // Guests carry their own history (the last 8 messages before this one). Signed-in history is loaded by the API.
      const earlier = retry ? messagesRef.current.slice(0, -1) : messagesRef.current;
      if (!retry) replaceMessages([...messagesRef.current, { id: newId(), role: "user", text: message }]);
      setPending(true);
      setFailure(null);
      setNotice("");
      try {
        const response = await sendChat({
          chat_id: chatIdRef.current,
          message,
          history: user ? [] : toHistory(earlier),
        });
        if (current !== session.current) return;
        replaceMessages([...messagesRef.current, fromResponse(newId(), response.message)]);
        replaceChatId(response.chat_id);
        if (user) {
          setChatInUrl(response.chat_id);
          void refreshChats();
        }
      } catch (reason) {
        if (current !== session.current) return;
        setFailure({ text: errorMessage(reason), message });
      } finally {
        if (current === session.current) setPending(false);
      }
    },
    [user, refreshChats, replaceMessages, replaceChatId],
  );

  const newChat = useCallback(() => {
    session.current += 1;
    replaceMessages([]);
    replaceChatId(null);
    setPending(false);
    setFailure(null);
    setOpening(false);
    setNotice("");
    setSidebarOpen(false);
    setChatInUrl(null);
  }, [replaceMessages, replaceChatId]);

  const openChat = useCallback(
    async (id: string) => {
      const db = getFirebase()?.db;
      if (!user || !db) return;
      const current = ++session.current;
      replaceMessages([]);
      replaceChatId(id);
      setPending(false);
      setFailure(null);
      setNotice("");
      setOpening(true);
      setSidebarOpen(false);
      setChatInUrl(id);
      try {
        const loaded = await listMessages(db, user.uid, id);
        if (current !== session.current) return;
        replaceMessages(loaded);
      } catch (reason) {
        if (current !== session.current) return;
        replaceChatId(null);
        setChatInUrl(null);
        setNotice(errorMessage(reason));
      } finally {
        if (current === session.current) setOpening(false);
      }
    },
    [user, replaceMessages, replaceChatId],
  );

  // On load: list saved chats, then follow a deep link (?chat=<id> or ?ask=<text>).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const ask = params.get("ask");
    const chat = params.get("chat");
    Promise.resolve().then(() => {
      void refreshChats();
      if (ask?.trim()) {
        setChatInUrl(null); // so a refresh does not ask again
        void send(ask);
      } else if (chat) {
        if (user) void openChat(chat);
        else setNotice("Sign in to open a saved chat.");
      }
    });
  }, [user, refreshChats, send, openChat]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, pending, failure]);

  const submit = (event: FormEvent | KeyboardEvent) => {
    event.preventDefault();
    if (pending || opening || !input.trim()) return;
    void send(input);
    setInput("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends. Shift+Enter adds a line. Enter while composing (IME) is left alone.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      submit(event);
    }
  };

  const empty = messages.length === 0 && !opening && !pending;

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100dvh-6.85rem)] sm:-mx-6 md:h-[calc(100dvh-3.5rem)] lg:-mx-8">
      <Sidebar
        user={user}
        chats={chats}
        activeId={chatId}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNew={newChat}
        onOpen={(id) => void openChat(id)}
        onChanged={(deletedId) => {
          if (deletedId && deletedId === chatIdRef.current) newChat();
          void refreshChats();
        }}
        onRetry={() => {
          setChats({ status: "loading" });
          void refreshChats();
        }}
      />

      <section aria-label="Conversation" className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2 lg:hidden">
          <button type="button" onClick={() => setSidebarOpen(true)} className="rounded-md border border-line px-3 py-1.5 text-sm font-medium">
            Chats
          </button>
          <button type="button" onClick={newChat} className="rounded-md border border-line px-3 py-1.5 text-sm font-medium">
            New chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
            {notice ? (
              <p role="status" className="mb-4 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">
                {notice}{" "}
                {!user ? (
                  <Link href="/login/" className="font-medium underline">
                    Sign in
                  </Link>
                ) : null}
              </p>
            ) : null}

            {opening ? <LoadingState label="Opening chat" /> : null}

            {empty ? (
              <div className="pt-[8vh] text-center">
                <h1 className="text-2xl font-semibold tracking-tight">What are you working on?</h1>
                <p className="mx-auto mt-2 max-w-xl text-muted">
                  Describe what you are designing or what you need to know. Answers come from NASA microgravity
                  combustion data, with sources.
                </p>
                <ul className="mx-auto mt-8 grid max-w-3xl gap-3 text-left sm:grid-cols-2">
                  {STARTER_PROMPTS.map((prompt) => (
                    <li key={prompt}>
                      <button
                        type="button"
                        onClick={() => void send(prompt)}
                        className="h-full w-full rounded-lg border border-line bg-surface p-4 text-left text-sm leading-6 hover:border-accent"
                      >
                        {prompt}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <ol className="space-y-6">
              {messages.map((message) =>
                message.role === "user" ? (
                  <li key={message.id} className="flex justify-end">
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm leading-6 text-white">
                      {message.text}
                    </p>
                  </li>
                ) : (
                  <li key={message.id} className="rounded-xl border border-line bg-canvas/60 p-4 sm:p-5">
                    <AssistantMessage text={message.text} answer={message.answer} sources={message.sources} names={names} onCite={setSource} />
                  </li>
                ),
              )}

              {pending ? (
                <li role="status" className="flex items-center gap-3 rounded-xl border border-line bg-canvas/60 p-4 text-sm text-muted">
                  <span className="flex gap-1" aria-hidden="true">
                    <span className="size-2 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
                    <span className="size-2 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
                    <span className="size-2 animate-bounce rounded-full bg-accent" />
                  </span>
                  Reading the data. This can take up to 30 seconds.
                </li>
              ) : null}

              {failure ? (
                <li>
                  <ErrorState
                    title="That message did not get an answer"
                    action={
                      <button
                        type="button"
                        onClick={() => void send(failure.message, true)}
                        className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800"
                      >
                        Try again
                      </button>
                    }
                  >
                    {failure.text}
                  </ErrorState>
                </li>
              ) : null}
            </ol>
            <div ref={bottom} />
          </div>
        </div>

        <form onSubmit={submit} className="border-t border-line bg-surface px-4 py-3 sm:px-6">
          <div className="mx-auto flex w-full max-w-4xl items-end gap-2">
            <label className="sr-only" htmlFor="chat-message">
              Message
            </label>
            <textarea
              id="chat-message"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onKeyDown}
              rows={Math.min(6, Math.max(1, input.split("\n").length))}
              maxLength={MESSAGE_MAX_LENGTH}
              placeholder="Describe what you are designing or what you need to know"
              className="max-h-40 min-h-11 flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2.5 text-sm leading-6 placeholder:text-muted/70 focus:border-accent"
            />
            <button
              type="submit"
              disabled={pending || opening || !input.trim()}
              className="h-11 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-40"
            >
              Send
            </button>
          </div>
          <p className="mx-auto mt-1.5 w-full max-w-4xl text-xs text-muted">
            Enter to send, Shift+Enter for a new line.{" "}
            {user ? "This chat is saved to your account." : "Guest chats are not saved."}
          </p>
        </form>
      </section>

      {source ? <SourceDrawer source={source} names={names} onClose={() => setSource(null)} /> : null}
    </div>
  );
}

function Sidebar({
  user,
  chats,
  activeId,
  open,
  onClose,
  onNew,
  onOpen,
  onChanged,
  onRetry,
}: {
  user: User | null;
  chats: ChatList;
  activeId: string | null;
  open: boolean;
  onClose: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  /** Called after a rename or delete. `deletedId` is set for a delete. */
  onChanged: (deletedId?: string) => void;
  onRetry: () => void;
}) {
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [error, setError] = useState("");

  const act = async (action: (db: NonNullable<ReturnType<typeof getFirebase>>["db"], uid: string) => Promise<void>, deletedId?: string) => {
    const db = getFirebase()?.db;
    if (!user || !db) return;
    setError("");
    try {
      await action(db, user.uid);
      setEditing(null);
      onChanged(deletedId);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <>
      {open ? <button type="button" aria-label="Close chat list" onClick={onClose} className="fixed inset-0 z-20 bg-ink/30 lg:hidden" /> : null}
      <aside
        aria-label="Chats"
        className={`${
          open ? "fixed inset-y-0 left-0 z-30 flex shadow-xl" : "hidden"
        } w-72 shrink-0 flex-col border-r border-line bg-surface lg:static lg:z-auto lg:flex lg:w-64 lg:shadow-none`}
      >
        <div className="p-3">
          <button
            type="button"
            onClick={onNew}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-strong"
          >
            <span aria-hidden="true">+</span> New chat
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {!user ? (
            <p className="rounded-md border border-dashed border-line p-3 text-sm text-muted">
              <Link href="/login/" className={linkClass}>
                Sign in to save your chats
              </Link>
              . As a guest, this conversation is gone when you leave the page.
            </p>
          ) : chats.status === "loading" ? (
            <p role="status" className="p-2 text-sm text-muted">
              Loading your chats…
            </p>
          ) : chats.status === "error" ? (
            <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">
              Your chats could not be loaded. {chats.error}{" "}
              <button type="button" onClick={onRetry} className="font-medium underline">
                Try again
              </button>
            </div>
          ) : chats.chats.length === 0 ? (
            <p className="p-2 text-sm text-muted">No saved chats yet. Your chats appear here after the first answer.</p>
          ) : (
            <>
              <h2 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">Saved chats</h2>
              {error ? (
                <p role="alert" className="mb-2 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-800">
                  {error}
                </p>
              ) : null}
              <ul className="space-y-0.5">
                {chats.chats.map((chat) => (
                  <li key={chat.id} className={`group rounded-md ${chat.id === activeId ? "bg-accent-soft" : "hover:bg-canvas"}`}>
                    {editing?.id === chat.id ? (
                      <form
                        className="space-y-1.5 p-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (editing.title.trim()) void act((db, uid) => renameChat(db, uid, chat.id, editing.title));
                        }}
                      >
                        <input
                          aria-label="Chat title"
                          autoFocus
                          required
                          maxLength={NAME_MAX_LENGTH}
                          value={editing.title}
                          onChange={(event) => setEditing({ id: chat.id, title: event.target.value })}
                          className="w-full rounded border border-line bg-surface px-2 py-1 text-sm focus:border-accent"
                        />
                        <span className="flex gap-3 text-xs">
                          <button type="submit" className={linkClass}>
                            Save
                          </button>
                          <button type="button" onClick={() => setEditing(null)} className={linkClass}>
                            Cancel
                          </button>
                        </span>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => onOpen(chat.id)}
                          aria-current={chat.id === activeId ? "true" : undefined}
                          className="block w-full px-2 pt-1.5 text-left"
                        >
                          <span className={`block truncate text-sm ${chat.id === activeId ? "font-medium text-accent" : ""}`}>{chat.title}</span>
                          <span className="block text-xs text-muted">{formatDate(chat.updatedAt)}</span>
                        </button>
                        <span className="flex gap-3 px-2 pb-1.5 text-xs">
                          <button type="button" onClick={() => setEditing({ id: chat.id, title: chat.title })} className="text-muted hover:text-accent" aria-label={`Rename chat ${chat.title}`}>
                            Rename
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete chat ${chat.title}`}
                            onClick={() => {
                              if (window.confirm(`Delete the chat "${chat.title}" and all its messages? This cannot be undone.`)) {
                                void act((db, uid) => deleteChat(db, uid, chat.id), chat.id);
                              }
                            }}
                            className="text-muted hover:text-red-700"
                          >
                            Delete
                          </button>
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
