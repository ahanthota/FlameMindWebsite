"use client";

import { useState, type FormEvent } from "react";
import { buttonClass, linkClass } from "@/components/States";
import { DERIVE_BATCH, deriveFilter, parseFilter } from "@/lib/api";
import { errorMessage } from "@/lib/auth";
import {
  customFilterLabel,
  MAPPED_FIELDS,
  parseBound,
  type ActiveCustomFilter,
  type CustomFilter,
  type FilterLevel,
} from "@/lib/filters";

const EXAMPLES = ["flame spread rate 2 to 5 mm/s", "sample thickness under 1 mm", "CO2 diluent above 10%"];

const inputClass =
  "rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm placeholder:text-muted/70 focus:border-accent";

const PROGRESS_STYLE = {
  found: "border-accent/40 bg-accent-soft text-accent",
  none: "border-line bg-canvas text-muted",
  reading: "border-accent bg-surface text-ink",
  waiting: "border-dashed border-line bg-surface text-muted",
};

const PROGRESS_TEXT = { none: "Not reported", reading: "Reading", waiting: "Waiting" };

type Stage =
  | { kind: "idle" }
  | { kind: "parsing" }
  /** The interpretation, waiting for the user to confirm or edit it. */
  | { kind: "draft"; filter: CustomFilter }
  /** `found` is how many values each finished investigation has. */
  | { kind: "deriving"; filter: CustomFilter; done: number; found: Record<string, number> };

/**
 * Free-text filter: the API reads the text into a filter definition, the user
 * confirms or edits it, and the page applies it. It only ever filters the table.
 */
export function CustomFilterBox({
  investigations,
  onApply,
}: {
  /** The investigations in the table. A derived parameter is looked up for these. */
  investigations: { id: string; acronym: string }[];
  onApply: (custom: ActiveCustomFilter) => void;
}) {
  const [text, setText] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [question, setQuestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = stage.kind === "parsing" || stage.kind === "deriving";
  const investigationIds = investigations.map((item) => item.id);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() || busy) return;
    setQuestion(null);
    setError(null);
    setStage({ kind: "parsing" });
    try {
      const parsed = await parseFilter(text.trim());
      if (parsed.kind === "unclear") {
        setQuestion(parsed.question);
        setStage({ kind: "idle" });
      } else {
        setStage({ kind: "draft", filter: parsed.filter });
      }
    } catch (reason) {
      setError(errorMessage(reason));
      setStage({ kind: "idle" });
    }
  };

  const finish = (custom: ActiveCustomFilter) => {
    onApply(custom);
    setText("");
    setStage({ kind: "idle" });
  };

  const confirm = async (filter: CustomFilter) => {
    setError(null);
    if (filter.kind === "mapped") {
      finish({ filter, values: [] });
      return;
    }
    setStage({ kind: "deriving", filter, done: 0, found: {} });
    try {
      const values = await deriveFilter(filter, investigationIds, (done, soFar) => {
        const found: Record<string, number> = {};
        for (const value of soFar) found[value.investigationId] = (found[value.investigationId] ?? 0) + 1;
        setStage({ kind: "deriving", filter, done, found });
      });
      finish({ filter, values });
    } catch (reason) {
      setError(errorMessage(reason));
      setStage({ kind: "draft", filter });
    }
  };

  return (
    <section aria-label="Custom filter" className="mb-4 rounded-lg border border-line bg-surface p-4">
      <form onSubmit={submit}>
        <label htmlFor="custom-filter" className="mb-1 block text-sm font-medium">
          Add a custom filter
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="custom-filter"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={500}
            disabled={busy}
            placeholder="A parameter and a range, for example: sample thickness under 1 mm"
            aria-describedby="custom-filter-help"
            className={`${inputClass} min-w-0 flex-1 basis-64`}
          />
          <button type="submit" disabled={!text.trim() || busy} className={`${buttonClass} py-1.5 disabled:opacity-40`}>
            {stage.kind === "parsing" ? "Reading…" : "Add filter"}
          </button>
        </div>
        <p id="custom-filter-help" className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          Examples:
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              disabled={busy}
              onClick={() => setText(example)}
              className="rounded-full border border-line px-2.5 py-0.5 hover:border-accent hover:text-accent"
            >
              {example}
            </button>
          ))}
        </p>
      </form>

      {question ? (
        <p role="status" className="mt-3 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
          {question}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {stage.kind === "draft" ? (
        <Draft
          key={JSON.stringify(stage.filter)}
          filter={stage.filter}
          onConfirm={confirm}
          onCancel={() => setStage({ kind: "idle" })}
        />
      ) : null}

      {stage.kind === "deriving" ? (
        <div role="status" className="mt-3 text-sm">
          <p>
            Reading the source documents for &quot;{stage.filter.kind === "derived" ? stage.filter.parameter : ""}&quot;:{" "}
            {stage.done} of {investigationIds.length} investigations done.
          </p>
          <ul aria-label="Progress by investigation" className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {investigations.map((item, index) => {
              const state =
                index < stage.done
                  ? (stage.found[item.id] ?? 0) > 0
                    ? "found"
                    : "none"
                  : index < stage.done + DERIVE_BATCH
                    ? "reading"
                    : "waiting";
              return (
                <li
                  key={item.id}
                  className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${PROGRESS_STYLE[state]}`}
                >
                  <span className="truncate font-medium">{item.acronym}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {state === "reading" ? <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-accent" /> : null}
                    {state === "found"
                      ? `Found ${stage.found[item.id]} ${stage.found[item.id] === 1 ? "value" : "values"}`
                      : PROGRESS_TEXT[state]}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** The interpretation as a chip, with its range (and level or unit) open to edits before it is applied. */
function Draft({
  filter,
  onConfirm,
  onCancel,
}: {
  filter: CustomFilter;
  onConfirm: (filter: CustomFilter) => void;
  onCancel: () => void;
}) {
  const [min, setMin] = useState(filter.min === null ? "" : String(filter.min));
  const [max, setMax] = useState(filter.max === null ? "" : String(filter.max));
  const [level, setLevel] = useState<FilterLevel>(filter.kind === "mapped" ? filter.level : "investigation");
  const [unit, setUnit] = useState(filter.kind === "derived" ? (filter.unit ?? "") : "");

  let low = parseBound(min);
  let high = parseBound(max);
  if (low !== null && high !== null && low > high) [low, high] = [high, low];
  const edited: CustomFilter =
    filter.kind === "mapped"
      ? { ...filter, level, min: low, max: high }
      : { ...filter, min: low, max: high, unit: unit.trim() || null };
  const valid = low !== null || high !== null;
  const levels: readonly FilterLevel[] = filter.kind === "mapped" ? MAPPED_FIELDS[filter.field].levels : [];
  const fixedUnit = filter.kind === "mapped" ? MAPPED_FIELDS[filter.field].unit : null;

  return (
    <form
      aria-label="Confirm the custom filter"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onConfirm(edited);
      }}
      className="mt-3 rounded-md border border-line bg-canvas p-3 text-sm"
    >
      <p className="flex flex-wrap items-center gap-2">
        <span className="text-muted">Read as</span>
        <span className="rounded-full border border-accent/30 bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">
          {valid ? customFilterLabel(edited) : "Enter a minimum or a maximum"}
        </span>
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs text-muted">Minimum</span>
          <input
            type="number"
            step="any"
            inputMode="decimal"
            value={min}
            onChange={(event) => setMin(event.target.value)}
            className={`${inputClass} w-28`}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">Maximum</span>
          <input
            type="number"
            step="any"
            inputMode="decimal"
            value={max}
            onChange={(event) => setMax(event.target.value)}
            className={`${inputClass} w-28`}
          />
        </label>
        {filter.kind === "derived" ? (
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Unit</span>
            <input
              value={unit}
              maxLength={30}
              onChange={(event) => setUnit(event.target.value)}
              className={`${inputClass} w-28`}
            />
          </label>
        ) : (
          <span className="pb-2 text-muted">{fixedUnit}</span>
        )}
        {levels.length > 1 ? (
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Applies to</span>
            <select
              value={level}
              onChange={(event) => setLevel(event.target.value as FilterLevel)}
              className={inputClass}
            >
              <option value="investigation">Investigations</option>
              <option value="test">Tests</option>
            </select>
          </label>
        ) : null}
        <button type="submit" disabled={!valid} className={`${buttonClass} py-1.5 disabled:opacity-40`}>
          Apply filter
        </button>
        <button type="button" onClick={onCancel} className={`pb-2 ${linkClass}`}>
          Cancel
        </button>
      </div>
      {filter.kind === "derived" ? (
        <p className="mt-2 text-xs text-muted">
          The dataset has no column for this parameter. Applying reads it from the source documents and adds it as a
          column, with a link to where each value is written.
        </p>
      ) : null}
    </form>
  );
}
