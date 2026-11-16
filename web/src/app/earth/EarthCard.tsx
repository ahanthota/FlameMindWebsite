"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function EarthCard({
  image,
  imageAlt,
  badges,
  title,
  meta,
  children,
}: {
  image: string;
  imageAlt: string;
  badges: { label: string; tone: "accent" | "ink" }[];
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
      <div className="group/photo relative aspect-[16/10] bg-canvas">
        <img src={image} alt={imageAlt} className="h-full w-full object-cover" />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Expand illustration for ${title}`}
          className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-surface/95 px-3 py-1.5 text-xs font-medium text-ink opacity-0 shadow-sm transition-opacity hover:bg-surface focus-visible:opacity-100 group-hover/photo:opacity-100"
        >
          <ExpandIcon />
          Expand
        </button>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex flex-wrap gap-2">
          {badges.map((badge) => (
            <span
              key={badge.label}
              className={`rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                badge.tone === "accent" ? "bg-accent text-white" : "bg-ink text-white"
              }`}
            >
              {badge.label}
            </span>
          ))}
        </div>
        <h2 className="mt-3 text-lg font-semibold tracking-tight">{title}</h2>
        {meta ? <div className="mt-2 text-sm leading-6 text-muted">{meta}</div> : null}
        <div className="mt-2 text-sm leading-6">{children}</div>
      </div>
      {open
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-label={imageAlt}
              className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4"
              onClick={() => setOpen(false)}
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="absolute right-4 top-4 rounded-full bg-surface px-3 py-1.5 text-sm font-medium text-ink"
              >
                Close
              </button>
              <img
                src={image}
                alt={imageAlt}
                className="max-h-[85vh] w-full max-w-5xl rounded-lg object-contain"
                onClick={(event) => event.stopPropagation()}
              />
            </div>,
            document.body,
          )
        : null}
    </article>
  );
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5">
      <path
        d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
