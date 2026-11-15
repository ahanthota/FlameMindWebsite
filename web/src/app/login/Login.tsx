"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { buttonClass, EmptyState, linkClass, LoadingState } from "@/components/States";
import { errorMessage, useAuth } from "@/lib/auth";

const inputClass =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted/70 focus:border-accent";

type Mode = "signin" | "create";

/** Sign in with email and password, or sign in / sign up with a Google account. */
export function Login() {
  const { user, loading, configured, signInWithGoogle, signInWithEmail, createAccount } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Signed in (just now, or already): go to the account page.
  useEffect(() => {
    if (user) router.replace("/account/");
  }, [user, router]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(() => (mode === "signin" ? signInWithEmail(email, password) : createAccount(email, password, name)));
  };

  if (loading || user) {
    return (
      <div className="mx-auto max-w-md">
        <LoadingState label={user ? "Signed in. Opening your account" : "Checking sign-in"} />
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="mx-auto max-w-md">
        <EmptyState title="Sign-in is not set up for this build">
          Every page works without an account. Saving chats and filters needs the Firebase settings in web/.env.local.
        </EmptyState>
      </div>
    );
  }

  const creating = mode === "create";
  return (
    <div className="mx-auto max-w-md">
      <section className="rounded-lg border border-line bg-surface p-6 sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight">{creating ? "Create your account" : "Sign in to FlameMind"}</h1>
        <p className="mt-1 text-sm text-muted">
          An account is optional. It saves your chats, filters, and what you are designing.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {creating ? (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Name (optional)</span>
              <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" maxLength={200} className={inputClass} />
            </label>
          ) : null}
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Email</span>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              placeholder="you@example.com"
              className={inputClass}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Password{creating ? " (at least 6 characters)" : ""}</span>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={creating ? "new-password" : "current-password"}
              className={inputClass}
            />
          </label>
          {error ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={busy} className={`${buttonClass} w-full justify-center py-2.5 disabled:opacity-50`}>
            {busy ? "Working…" : creating ? "Create account" : "Sign in"}
          </button>
        </form>

        <div className="my-6 flex items-center gap-3 text-xs text-muted" role="separator">
          <span className="h-px flex-1 bg-line" />
          or
          <span className="h-px flex-1 bg-line" />
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => void run(signInWithGoogle)}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-line bg-surface px-3 py-2.5 text-sm font-medium hover:border-accent hover:text-accent disabled:opacity-50"
        >
          <span aria-hidden="true" className="flex size-5 items-center justify-center rounded-full border border-line text-xs font-semibold">
            G
          </span>
          {creating ? "Sign up with Google" : "Sign in with Google"}
        </button>
        <p className="mt-2 text-center text-xs text-muted">
          {creating
            ? "Uses your Google account. No separate password."
            : "New here? Choosing Google also creates your account."}
        </p>

        <p className="mt-6 border-t border-line pt-4 text-center text-sm">
          {creating ? "Already have an account?" : "New to FlameMind?"}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(creating ? "signin" : "create");
              setError("");
            }}
            className={linkClass}
          >
            {creating ? "Sign in" : "Create an account"}
          </button>
        </p>
      </section>

      <p className="mt-4 text-center text-sm text-muted">
        <Link href="/home/" className={linkClass}>
          Continue as a guest
        </Link>
        . Every page works without an account.{" "}
        <Link href="/account/" className={linkClass}>
          What is stored?
        </Link>
      </p>
    </div>
  );
}
