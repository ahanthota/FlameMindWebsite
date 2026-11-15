import type { ReactNode } from "react";

/** Shown while a page or a table is loading. */
export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="rounded-lg border border-line bg-surface p-6">
      <span className="sr-only">{label}</span>
      <div className="animate-pulse space-y-3" aria-hidden="true">
        <div className="h-5 w-1/3 rounded bg-line" />
        <div className="h-4 w-2/3 rounded bg-line" />
        <div className="h-4 w-1/2 rounded bg-line" />
        <div className="h-32 w-full rounded bg-canvas" />
      </div>
    </div>
  );
}

/** Shown when there is nothing to list. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-10 text-center">
      <p className="font-medium text-ink">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-xl text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** Shown when something failed. */
export function ErrorState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-6 py-8">
      <p className="font-medium text-red-900">{title}</p>
      {children ? <div className="mt-1 text-sm text-red-800">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function PageHeader({ title, children, aside }: { title: string; children?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {children ? <div className="mt-1 max-w-3xl text-sm text-muted">{children}</div> : null}
      </div>
      {aside}
    </div>
  );
}

export const buttonClass =
  "inline-flex items-center rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-strong";
export const linkClass = "font-medium text-accent underline-offset-2 hover:underline";
