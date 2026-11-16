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
    <section aria-label="Ask FlameMind" className="mb-6 rounded-lg border border-line bg-surface p-5 sm:p-6">
      <form onSubmit={submit}>
        <label htmlFor="home-ask" className="block text-lg font-semibold tracking-tight">
          Ask FlameMind about your design
        </label>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            id="home-ask"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={2000}
            placeholder="Describe the atmosphere, materials, or question you have"
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-4 py-3 text-base placeholder:text-muted/70 focus:border-accent"
          />
          <button
            type="submit"
            disabled={!text.trim()}
            className="rounded-md bg-accent px-6 py-3 text-base font-medium text-white hover:bg-accent-strong disabled:opacity-40 sm:shrink-0"
          >
            Ask
          </button>
        </div>
      </form>
      <p className="mt-4 text-sm font-medium">Moon base crew quarters</p>
      <p className="text-sm leading-6 text-muted">34% oxygen at 8 psi. Each of these opens a new chat.</p>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {STARTER_PROMPTS.map((prompt) => (
          <li key={prompt}>
            <Link
              href={`/scenario/?ask=${encodeURIComponent(prompt)}`}
              className="block rounded-lg border border-line px-3 py-2 text-sm leading-6 text-ink hover:border-accent hover:text-accent"
            >
              {prompt}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
