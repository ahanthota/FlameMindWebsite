"use client";

import type { User } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { buttonClass, EmptyState, ErrorState, linkClass, LoadingState, PageHeader } from "@/components/States";
import { errorMessage, useAuth } from "@/lib/auth";
import { activeChips } from "@/lib/filters";
import { getFirebase } from "@/lib/firebase";
import { label } from "@/lib/format";
import {
  deleteChat,
  deleteSavedFilter,
  getProfile,
  listChats,
  listSavedFilters,
  NAME_MAX_LENGTH,
  renameChat,
  saveUseCase,
  USE_CASE_MAX_LENGTH,
  type SavedChat,
  type SavedFilter,
  type UserProfile,
} from "@/lib/userdata";

const inputClass =
  "w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm placeholder:text-muted/70 focus:border-accent";
const secondaryButton =
  "inline-flex items-center rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50";
const dangerButton =
  "inline-flex items-center rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50";

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6 rounded-lg border border-line bg-surface p-5">
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function formatDate(date: Date | null): string {
  return date ? date.toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" }) : "–";
}

type Loaded<T> = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: T };

/** Load once per key, with a reload function. */
function useLoad<T>(key: string, load: () => Promise<T>): [Loaded<T>, () => void] {
  const [state, setState] = useState<Loaded<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    load().then(
      (data) => current && setState({ status: "ready", data }),
      (error) => current && setState({ status: "error", error: errorMessage(error) }),
    );
    return () => {
      current = false;
    };
    // `load` is recreated each render; the key and attempt decide when to run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  const reload = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);
  return [state, reload];
}

export function Account() {
  const { user, loading, configured } = useAuth();
  const db = getFirebase()?.db ?? null;

  return (
    <>
      <PageHeader title="Account">
        An account is optional. It saves your chats, filters, and a description of what you are designing.
      </PageHeader>
      {loading ? (
        <LoadingState label="Checking sign-in" />
      ) : !configured || !db ? (
        <EmptyState title="Sign-in is not set up for this build">
          Every page works without an account. Saving chats and filters needs the Firebase settings in web/.env.local.
        </EmptyState>
      ) : user ? (
        <SignedIn key={user.uid} user={user} db={db} />
      ) : (
        <SignedOut />
      )}
      <div className="mt-6">
        <PrivacyNote />
      </div>
    </>
  );
}

// ---------- guests ----------

function SignedOut() {
  return (
    <EmptyState
      title="You are not signed in"
      action={
        <Link href="/login/" className={buttonClass}>
          Sign in or create an account
        </Link>
      }
    >
      You can use every page as a guest. Sign in to save chats and filters, and to store a use case so the assistant
      does not need to ask what you are designing.
    </EmptyState>
  );
}

// ---------- signed in ----------

function SignedIn({ user, db }: { user: User; db: Firestore }) {
  const { signOut } = useAuth();
  const [profile, reloadProfile] = useLoad<UserProfile>(`profile:${user.uid}`, () => getProfile(db, user));
  const [signOutError, setSignOutError] = useState("");

  return (
    <>
      <Card title="Profile">
        {profile.status === "loading" ? (
          <LoadingState label="Loading profile" />
        ) : profile.status === "error" ? (
          <ErrorState title="Your profile could not be loaded" action={<button type="button" className={secondaryButton} onClick={reloadProfile}>Try again</button>}>
            {profile.error}
          </ErrorState>
        ) : (
          <dl className="grid max-w-xl grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted">Name</dt>
            <dd>{profile.data.displayName || "–"}</dd>
            <dt className="text-muted">Email</dt>
            <dd>{profile.data.email || "–"}</dd>
            <dt className="text-muted">Member since</dt>
            <dd>{formatDate(profile.data.createdAt)}</dd>
          </dl>
        )}
        <div className="mt-4 flex items-center gap-3">
          <button type="button" className={secondaryButton} onClick={() => signOut().catch((reason) => setSignOutError(errorMessage(reason)))}>
            Sign out
          </button>
          {signOutError ? <span role="alert" className="text-sm text-red-800">{signOutError}</span> : null}
        </div>
      </Card>

      {profile.status === "ready" ? <UseCaseCard db={db} uid={user.uid} initial={profile.data.useCaseDescription} /> : null}
      <ChatsCard db={db} uid={user.uid} />
      <FiltersCard db={db} uid={user.uid} />
      <DeleteAccountCard />
    </>
  );
}

function UseCaseCard({ db, uid, initial }: { db: Firestore; uid: string; initial: string }) {
  const [saved, setSaved] = useState(initial);
  const [text, setText] = useState(initial);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error"; message?: string }>({ kind: "idle" });

  const save = async (value: string) => {
    setStatus({ kind: "saving" });
    try {
      await saveUseCase(db, uid, value);
      setSaved(value.trim());
      setText(value.trim());
      setStatus({ kind: "saved", message: value.trim() ? "Saved." : "Cleared." });
    } catch (reason) {
      setStatus({ kind: "error", message: errorMessage(reason) });
    }
  };

  return (
    <Card title="Saved use case (optional)">
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Describe what you are designing</span>
        <span className="mb-2 block max-w-2xl text-muted">
          For example the habitat, its atmosphere, the materials involved, and your goal. New chats start from this, so
          the assistant does not need to ask.
        </span>
        <textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setStatus({ kind: "idle" });
          }}
          rows={4}
          maxLength={USE_CASE_MAX_LENGTH}
          placeholder="Crew quarters for a Moon base at 34% oxygen and 8 psi. Choosing fabrics for bedding and clothing. Goal: limit flame spread."
          className={`${inputClass} max-w-2xl`}
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" className={`${buttonClass} disabled:opacity-50`} disabled={status.kind === "saving" || text.trim() === saved} onClick={() => void save(text)}>
          {status.kind === "saving" ? "Saving…" : "Save use case"}
        </button>
        {saved ? (
          <button type="button" className={secondaryButton} disabled={status.kind === "saving"} onClick={() => void save("")}>
            Clear
          </button>
        ) : null}
        <span className="text-xs text-muted">
          {text.length} of {USE_CASE_MAX_LENGTH} characters
        </span>
        {status.message ? (
          <span role={status.kind === "error" ? "alert" : "status"} className={`text-sm ${status.kind === "error" ? "text-red-800" : "text-muted"}`}>
            {status.message}
          </span>
        ) : null}
      </div>
    </Card>
  );
}

function ChatsCard({ db, uid }: { db: Firestore; uid: string }) {
  const [chats, reload] = useLoad<SavedChat[]>(`chats:${uid}`, () => listChats(db, uid));
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [error, setError] = useState("");

  const act = async (action: () => Promise<void>) => {
    setError("");
    try {
      await action();
      setEditing(null);
      reload();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <Card title="Saved chats">
      {error ? <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      {chats.status === "loading" ? (
        <LoadingState label="Loading saved chats" />
      ) : chats.status === "error" ? (
        <ErrorState title="Your chats could not be loaded" action={<button type="button" className={secondaryButton} onClick={reload}>Try again</button>}>
          {chats.error}
        </ErrorState>
      ) : chats.data.length === 0 ? (
        <EmptyState title="No saved chats yet">Chats you have while signed in are saved here automatically.</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {chats.data.map((chat) => (
            <li key={chat.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              {editing?.id === chat.id ? (
                <form
                  className="flex flex-1 flex-wrap items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (editing.title.trim()) void act(() => renameChat(db, uid, chat.id, editing.title));
                  }}
                >
                  <input
                    aria-label="Chat title"
                    autoFocus
                    required
                    maxLength={NAME_MAX_LENGTH}
                    value={editing.title}
                    onChange={(event) => setEditing({ id: chat.id, title: event.target.value })}
                    className={`${inputClass} max-w-md flex-1`}
                  />
                  <button type="submit" className={secondaryButton}>Save</button>
                  <button type="button" className={secondaryButton} onClick={() => setEditing(null)}>Cancel</button>
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{chat.title}</span>
                    <span className="text-xs text-muted">Updated {formatDate(chat.updatedAt)}</span>
                  </span>
                  <button type="button" className={secondaryButton} onClick={() => setEditing({ id: chat.id, title: chat.title })}>
                    Rename
                  </button>
                  <button
                    type="button"
                    className={secondaryButton}
                    onClick={() => {
                      if (window.confirm(`Delete the chat "${chat.title}" and all its messages? This cannot be undone.`)) {
                        void act(() => deleteChat(db, uid, chat.id));
                      }
                    }}
                  >
                    Delete
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function FiltersCard({ db, uid }: { db: Firestore; uid: string }) {
  const [filters, reload] = useLoad<SavedFilter[]>(`filters:${uid}`, () => listSavedFilters(db, uid));
  const [error, setError] = useState("");

  const remove = async (filter: SavedFilter) => {
    setError("");
    try {
      await deleteSavedFilter(db, uid, filter.id);
      reload();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <Card title="Saved filters">
      {error ? <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      {filters.status === "loading" ? (
        <LoadingState label="Loading saved filters" />
      ) : filters.status === "error" ? (
        <ErrorState title="Your filters could not be loaded" action={<button type="button" className={secondaryButton} onClick={reload}>Try again</button>}>
          {filters.error}
        </ErrorState>
      ) : filters.data.length === 0 ? (
        <EmptyState title="No saved filters yet">
          Set filters in{" "}
          <Link href="/explore/" className={linkClass}>
            Explore
          </Link>{" "}
          and choose &quot;Save filter&quot;.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {filters.data.map((filter) => (
            <li key={filter.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{filter.name}</span>
                <span className="text-xs text-muted">
                  {activeChips(filter.manualFilters, label).map((chip) => chip.label).join(" · ") || "No filters set"}
                </span>
              </span>
              <Link href={`/explore/?filter=${encodeURIComponent(filter.id)}`} className={secondaryButton}>
                Open in Explore
              </Link>
              <button type="button" className={secondaryButton} onClick={() => void remove(filter)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DeleteAccountCard() {
  const { deleteAccount, usesPassword } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await deleteAccount(password);
      // The auth listener now shows the signed-out page.
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  };

  return (
    <section className="mb-6 rounded-lg border border-red-200 bg-surface p-5">
      <h2 className="mb-2 text-base font-semibold text-red-900">Delete my account and data</h2>
      <p className="max-w-2xl text-sm text-muted">
        Permanently deletes your profile, saved use case, every saved chat and message, and every saved filter, and
        then the account itself. This cannot be undone.
      </p>
      {!confirming ? (
        <button type="button" className={`${dangerButton} mt-4`} onClick={() => setConfirming(true)}>
          Delete my account and data
        </button>
      ) : (
        <form onSubmit={run} className="mt-4 max-w-sm space-y-3">
          {usesPassword ? (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Enter your password to confirm</span>
              <input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} />
            </label>
          ) : (
            <p className="text-sm">You will be asked to sign in with Google once more to confirm.</p>
          )}
          {error ? <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={dangerButton}>
              {busy ? "Deleting…" : "Yes, delete everything"}
            </button>
            <button type="button" disabled={busy} className={secondaryButton} onClick={() => { setConfirming(false); setError(""); }}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

// ---------- privacy ----------

function PrivacyNote() {
  return (
    <Card title="Privacy">
      <div className="max-w-3xl space-y-3 text-sm leading-6">
        <p>
          <span className="font-medium">Guests:</span> nothing is stored. A guest chat lives only in your browser tab and
          is gone when you close it.
        </p>
        <p className="font-medium">With an account, FlameMind stores only:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>your name and email address, from the sign-in you chose;</li>
          <li>the use case you describe on this page, if you save one;</li>
          <li>your chats: the title, your messages, the assistant&apos;s answers, and the use case for that chat;</li>
          <li>the filters you save in Explore.</li>
        </ul>
        <p>
          <span className="font-medium">Your chats are private to you.</span> Only your signed-in account can read your
          profile, chats, and filters. Other users cannot, and they are never shown publicly. The people who run this
          FlameMind deployment can access its database. Your messages are sent to the FlameMind API and Google&apos;s
          Gemini models to write the answer.
        </p>
        <p>
          <span className="font-medium">Deleting:</span> delete a single chat or filter from the lists above. &quot;Delete
          my account and data&quot; removes everything listed here and then the account. Deleted data cannot be
          recovered.
        </p>
      </div>
    </Card>
  );
}
