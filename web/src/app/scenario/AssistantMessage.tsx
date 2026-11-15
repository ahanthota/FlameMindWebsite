"use client";

import Link from "next/link";
import { useEffect } from "react";
import { linkClass } from "@/components/States";
import { DISCLAIMER, pageLabel, type Answer, type ChatSource, type Confidence } from "@/lib/chat";

export type InvestigationNames = Record<string, { acronym: string; name: string }>;

const CONFIDENCE: Record<Confidence, { label: string; className: string }> = {
  high: { label: "High confidence", className: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  medium: { label: "Medium confidence", className: "bg-accent-soft text-accent ring-accent/20" },
  low: { label: "Low confidence", className: "bg-warn-soft text-warn ring-warn/20" },
};

function InvestigationLabel({ id, names }: { id: string; names: InvestigationNames }) {
  const known = names[id];
  if (!known) return <span>{id}</span>;
  return (
    <Link href={`/investigations/${id}/`} className={linkClass}>
      {known.acronym} ({id})
    </Link>
  );
}

function CitationChips({
  citations,
  sources,
  onCite,
}: {
  citations: number[];
  sources: ChatSource[];
  onCite: (source: ChatSource) => void;
}) {
  if (citations.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="text-xs text-muted">Sources</span>
      {citations.map((number) => {
        const source = sources.find((item) => item.n === number);
        return (
          <button
            key={number}
            type="button"
            disabled={!source}
            onClick={() => source && onCite(source)}
            aria-label={source ? `Open source ${number}: ${source.title}` : `Source ${number} is not available`}
            className="rounded border border-accent/30 bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent hover:border-accent disabled:border-line disabled:bg-canvas disabled:text-muted"
          >
            [{number}]
          </button>
        );
      })}
    </span>
  );
}

/** The structured answer from POST /chat. Falls back to plain text when there is no structure. */
export function AssistantMessage({
  text,
  answer,
  sources,
  names,
  onCite,
}: {
  text: string;
  answer: Answer | null;
  sources: ChatSource[];
  names: InvestigationNames;
  onCite: (source: ChatSource) => void;
}) {
  if (!answer) {
    return <p className="whitespace-pre-wrap text-sm leading-6">{text}</p>;
  }
  const confidence = CONFIDENCE[answer.confidence];

  return (
    <div className="space-y-5 text-sm leading-6">
      <p className="text-[0.95rem] leading-7">{answer.summary}</p>

      {answer.relevant_data.length > 0 ? (
        <section aria-label="Relevant data">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Relevant data</h3>
          <div className="grid gap-3 xl:grid-cols-2">
            {answer.relevant_data.map((item, index) => {
              const known = names[item.investigation_id];
              return (
                <article key={`${item.investigation_id}-${index}`} className="rounded-lg border border-line bg-surface p-4">
                  <header className="mb-2">
                    <h4 className="font-semibold">{known ? known.acronym : item.investigation_id}</h4>
                    <p className="text-xs text-muted">
                      {known ? `${known.name} · ${item.investigation_id}` : "NASA PSI investigation"}
                    </p>
                  </header>
                  <p>{item.what_it_shows}</p>
                  {item.key_values.length > 0 ? (
                    <dl className="mt-3 divide-y divide-line rounded-md border border-line text-sm">
                      {item.key_values.map((entry, position) => (
                        <div key={position} className="flex items-baseline justify-between gap-4 px-3 py-1.5">
                          <dt className="text-muted">{entry.name}</dt>
                          <dd className="text-right font-medium tabular-nums">
                            {entry.value}
                            {entry.unit ? <span className="ml-1 font-normal text-muted">{entry.unit}</span> : null}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {item.test_ids.length > 0 ? (
                    <p className="mt-2 text-xs text-muted">Tests: {item.test_ids.join(", ")}</p>
                  ) : null}
                  <footer className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <CitationChips citations={item.citations} sources={sources} onCite={onCite} />
                    {known ? (
                      <Link href={`/investigations/${item.investigation_id}/`} className={`text-xs ${linkClass}`}>
                        View investigation →
                      </Link>
                    ) : null}
                  </footer>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {answer.suggestions.length > 0 ? (
        <section aria-label="Suggestions for your use case" className="rounded-lg border border-accent/30 bg-accent-soft p-4">
          <h3 className="font-semibold text-accent">Suggestions for your use case</h3>
          <p className="mb-3 text-xs text-accent/80">
            These are suggestions based on the cited findings, not requirements or certified guidance.
          </p>
          <ul className="space-y-3">
            {answer.suggestions.map((item, index) => (
              <li key={index} className="rounded-md border border-accent/20 bg-surface p-3">
                <p>{item.text}</p>
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <span>
                    Builds on findings from{" "}
                    {item.based_on.map((id, position) => (
                      <span key={id}>
                        {position > 0 ? ", " : null}
                        <InvestigationLabel id={id} names={names} />
                      </span>
                    ))}
                  </span>
                  <CitationChips citations={item.citations} sources={sources} onCite={onCite} />
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {answer.follow_up_question ? (
        <section aria-label="Question for you" className="rounded-lg border-l-4 border-accent bg-surface px-4 py-3 ring-1 ring-line">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">To tailor this to your use case</h3>
          <p className="mt-1 font-medium">{answer.follow_up_question}</p>
        </section>
      ) : null}

      {answer.gaps_noted.length > 0 ? (
        <section aria-label="Gaps noted">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Gaps noted</h3>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            {answer.gaps_noted.map((gap, index) => (
              <li key={index}>{gap}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-xs text-muted">
        <span className={`rounded-full px-2 py-0.5 font-medium ring-1 ${confidence.className}`}>{confidence.label}</span>
        <span>{DISCLAIMER}</span>
      </footer>
    </div>
  );
}

/** Side drawer with one source: document title, pages, snippet, PSI link, DOI link. */
export function SourceDrawer({
  source,
  names,
  onClose,
}: {
  source: ChatSource;
  names: InvestigationNames;
  onClose: () => void;
}) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);

  const pages = pageLabel(source);
  const known = names[source.investigation_id];
  return (
    <div className="fixed inset-0 z-40">
      <button type="button" aria-label="Close source" onClick={onClose} className="absolute inset-0 bg-ink/30" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Source ${source.n}`}
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-accent">Source [{source.n}]</p>
            <h2 className="mt-1 font-semibold leading-snug">{source.title || "Untitled document"}</h2>
          </div>
          <button type="button" autoFocus onClick={onClose} className="rounded-md border border-line px-2 py-1 text-sm hover:border-accent">
            Close
          </button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm leading-6">
          <dl className="grid grid-cols-[7rem_1fr] gap-y-2">
            <dt className="text-muted">Investigation</dt>
            <dd>
              {known ? `${known.acronym} · ` : ""}
              {source.investigation_id}
            </dd>
            <dt className="text-muted">Pages</dt>
            <dd>{pages || "Structured record (data extracted from the investigation's documents)"}</dd>
          </dl>
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Snippet</h3>
            <blockquote className="border-l-2 border-accent-soft pl-3 text-muted">{source.snippet || "No text available."}</blockquote>
          </div>
          <div className="flex flex-wrap gap-2">
            {source.url ? (
              <a href={source.url} target="_blank" rel="noreferrer" className="rounded-md border border-accent px-3 py-1.5 font-medium text-accent hover:bg-accent-soft">
                Open on PSI ↗
              </a>
            ) : null}
            {source.doi ? (
              <a href={`https://doi.org/${source.doi}`} target="_blank" rel="noreferrer" className="rounded-md border border-line px-3 py-1.5 font-medium hover:border-accent hover:text-accent">
                DOI: {source.doi} ↗
              </a>
            ) : null}
            {known ? (
              <Link href={`/investigations/${source.investigation_id}/`} className="rounded-md border border-line px-3 py-1.5 font-medium hover:border-accent hover:text-accent">
                Investigation page
              </Link>
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}
