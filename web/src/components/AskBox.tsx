"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { STARTER_PROMPTS } from "@/lib/chat";

/** Home page entry to the chat: /scenario/?ask=<text> starts a new chat with that message. */
export function AskBox() {
  const router = useRouter();
  const [text, setText] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim()) router.push(`/scenario/?ask=${encodeURIComponent(text.trim())}`);
  };

  return (
    <section aria-label="Ask FlameMind" className="mb-6 rounded-lg border border-line bg-surface p-5">
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <label htmlFor="home-ask" className="sr-only">
          Describe what you are designing or what you need to know
        </label>
        <input
          id="home-ask"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={2000}
          placeholder="Describe what you are designing or what you need to know"
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm placeholder:text-muted/70 focus:border-accent"
        />
        <button type="submit" disabled={!text.trim()} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-40">
          Ask
        </button>
      </form>
      <ul className="mt-3 flex flex-wrap gap-2">
        {STARTER_PROMPTS.slice(0, 3).map((prompt) => (
          <li key={prompt}>
            <Link
              href={`/scenario/?ask=${encodeURIComponent(prompt)}`}
              className="block rounded-full border border-line px-3 py-1 text-xs text-muted hover:border-accent hover:text-accent"
            >
              {prompt}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
