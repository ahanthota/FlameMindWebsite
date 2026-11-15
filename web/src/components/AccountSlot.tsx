"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { errorMessage, useAuth } from "@/lib/auth";

/** Top-bar account area: "Sign in" for guests, a menu when signed in. */
export function AccountSlot() {
  const { user, loading, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  if (loading) {
    return <span role="status" aria-label="Checking sign-in" className="h-8 w-20 animate-pulse rounded-md bg-canvas" />;
  }

  if (!user) {
    return (
      <Link
        href="/login/"
        className="rounded-md border border-accent px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent-soft"
      >
        Sign in
      </Link>
    );
  }

  const name = user.displayName || user.email || "Account";
  return (
    <div ref={menu} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium hover:bg-canvas"
      >
        <span
          aria-hidden="true"
          className="flex size-7 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white"
        >
          {name.charAt(0).toUpperCase()}
        </span>
        <span className="hidden max-w-40 truncate sm:inline">{name}</span>
        <span aria-hidden="true" className="text-muted">▾</span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-60 rounded-lg border border-line bg-surface p-1 text-sm shadow-lg"
        >
          <p className="truncate border-b border-line px-3 py-2 text-xs text-muted">Signed in as {user.email ?? name}</p>
          <Link
            role="menuitem"
            href="/account/"
            onClick={() => setOpen(false)}
            className="block rounded-md px-3 py-2 hover:bg-canvas"
          >
            Account and saved items
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              signOut().catch((reason) => setError(errorMessage(reason)));
            }}
            className="block w-full rounded-md px-3 py-2 text-left hover:bg-canvas"
          >
            Sign out
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="absolute right-0 mt-1 w-60 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">
          {error}
        </p>
      ) : null}
    </div>
  );
}
