"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { buttonClass, EmptyState, linkClass, PageHeader } from "@/components/States";
import { errorMessage, useAuth } from "@/lib/auth";
import {
  activeChips,
  emptyFilters,
  FACET_LABELS,
  facetOptions,
  filterInvestigations,
  filterTests,
  parseBound,
  RANGE_KEYS,
  RANGE_LABELS,
  removeChip,
  sortRows,
  toggleFacet,
  type FacetKey,
  type Filters,
  type InvestigationRow,
  type RangeKey,
  type SortDirection,
  type SortValue,
  type TestRow,
} from "@/lib/filters";
import { getFirebase } from "@/lib/firebase";
import { formatList, formatNumber, formatRange, label, MISSING } from "@/lib/format";
import { getSavedFilter, NAME_MAX_LENGTH, saveFilter } from "@/lib/userdata";

type Mode = "investigations" | "tests";

interface Column<T> {
  key: string;
  /** Header text. Units go here, never in the cells. */
  header: string;
  numeric?: boolean;
  sortValue: (row: T) => SortValue;
  cell: (row: T) => ReactNode;
}

const PAGE_SIZE = 50;
const CHECKBOX_FACETS: readonly FacetKey[] = ["fuelPhase", "hardware", "platform", "category", "gravity"];

const INVESTIGATION_COLUMNS: Column<InvestigationRow>[] = [
  {
    key: "acronym",
    header: "Investigation",
    sortValue: (row) => row.acronym,
    cell: (row) => (
      <div className="min-w-52">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={`/investigations/${row.id}/`} className={`whitespace-nowrap ${linkClass}`}>
            {row.acronym}
          </Link>
          {row.needsReview ? (
            <span className="whitespace-nowrap rounded bg-warn-soft px-1.5 py-0.5 text-xs font-medium text-warn">
              Needs review
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-xs text-muted">
          {row.id} · {row.name}
        </span>
      </div>
    ),
  },
  { key: "fuelPhase", header: "Fuel phase", sortValue: (row) => row.fuelPhase, cell: (row) => label(row.fuelPhase) },
  {
    key: "fuels",
    header: "Fuels",
    sortValue: (row) => row.fuels[0] ?? null,
    cell: (row) => <span className="block min-w-48 max-w-72">{formatList(row.fuels)}</span>,
  },
  { key: "hardware", header: "Hardware", sortValue: (row) => row.hardware, cell: (row) => label(row.hardware) },
  { key: "platform", header: "Platform", sortValue: (row) => row.platform[0] ?? null, cell: (row) => formatList(row.platform) },
  { key: "category", header: "Category", sortValue: (row) => row.category[0] ?? null, cell: (row) => formatList(row.category) },
  { key: "gravity", header: "Gravity", sortValue: (row) => row.gravity, cell: (row) => label(row.gravity) },
  { key: "o2", header: "O2 (%)", numeric: true, sortValue: (row) => row.o2.min, cell: (row) => formatRange(row.o2.min, row.o2.max) },
  {
    key: "pressure",
    header: "Pressure (psi)",
    numeric: true,
    sortValue: (row) => row.pressure.min,
    cell: (row) => formatRange(row.pressure.min, row.pressure.max),
  },
  {
    key: "flow",
    header: "Airflow (cm/s)",
    numeric: true,
    sortValue: (row) => row.flow.min,
    cell: (row) => formatRange(row.flow.min, row.flow.max),
  },
  { key: "tests", header: "Tests (count)", numeric: true, sortValue: (row) => row.testCount, cell: (row) => row.testCount },
  { key: "years", header: "Years", sortValue: (row) => row.years, cell: (row) => row.years ?? MISSING },
];

const TEST_COLUMNS: Column<TestRow>[] = [
  { key: "testId", header: "Test", sortValue: (row) => row.testId, cell: (row) => row.testId },
  {
    key: "acronym",
    header: "Investigation",
    sortValue: (row) => row.acronym,
    cell: (row) => (
      <Link href={`/investigations/${row.investigationId}/`} className={linkClass}>
        {row.acronym}
      </Link>
    ),
  },
  { key: "sampleId", header: "Sample", sortValue: (row) => row.sampleId, cell: (row) => row.sampleId ?? MISSING },
  { key: "fuel", header: "Fuel", sortValue: (row) => row.fuels[0] ?? null, cell: (row) => row.fuels[0] ?? MISSING },
  {
    key: "geometry",
    header: "Sample geometry",
    sortValue: (row) => row.geometry,
    cell: (row) => <span className="block max-w-56">{row.geometry ?? MISSING}</span>,
  },
  { key: "o2", header: "O2 (%)", numeric: true, sortValue: (row) => row.o2, cell: (row) => formatNumber(row.o2) },
  {
    key: "pressure",
    header: "Pressure (psi)",
    numeric: true,
    sortValue: (row) => row.pressure,
    cell: (row) => formatNumber(row.pressure),
  },
  { key: "flow", header: "Airflow (cm/s)", numeric: true, sortValue: (row) => row.flow, cell: (row) => formatNumber(row.flow) },
  { key: "diluent", header: "Diluent", sortValue: (row) => row.diluent, cell: (row) => row.diluent ?? MISSING },
  { key: "outcome", header: "Outcome", sortValue: (row) => (row.outcome === "unknown" ? null : row.outcome), cell: (row) => label(row.outcome) },
  {
    key: "spreadRate",
    header: "Spread rate (mm/s)",
    numeric: true,
    sortValue: (row) => row.spreadRate,
    cell: (row) => formatNumber(row.spreadRate),
  },
  { key: "gravity", header: "Gravity", sortValue: (row) => row.gravity, cell: (row) => label(row.gravity) },
];

const inputClass =
  "w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm placeholder:text-muted/70 focus:border-accent";

export function Explore({ investigations, tests }: { investigations: InvestigationRow[]; tests: TestRow[] }) {
  const [mode, setMode] = useState<Mode>("investigations");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>(null);
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const { user, loading: authLoading } = useAuth();

  // /explore/?filter=<id> opens one of the user's saved filters (linked from the account page).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("filter");
    if (!id || authLoading) return;
    const db = getFirebase()?.db;
    let current = true;
    const load = async () => {
      if (!user || !db) return { kind: "info" as const, text: "Sign in to open a saved filter." };
      const found = await getSavedFilter(db, user.uid, id);
      if (!found) return { kind: "error" as const, text: "That saved filter no longer exists." };
      if (current) {
        setFilters(found.manualFilters);
        setPage(0);
      }
      return { kind: "info" as const, text: `Showing your saved filter "${found.name}".` };
    };
    load().then(
      (result) => current && setNotice(result),
      (error) => current && setNotice({ kind: "error", text: errorMessage(error) }),
    );
    return () => {
      current = false;
    };
  }, [user, authLoading]);

  // Options come from all rows of both kinds, so they do not change with the toggle.
  const options = useMemo(() => facetOptions([...investigations, ...tests]), [investigations, tests]);

  const update = (next: Filters) => {
    setFilters(next);
    setPage(0);
  };
  const switchMode = (next: Mode) => {
    setMode(next);
    setSort(null);
    setPage(0);
  };
  const toggleSort = (key: string) => {
    setSort((current) =>
      current?.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" },
    );
    setPage(0);
  };

  const chips = activeChips(filters, label);
  const total = mode === "investigations" ? investigations.length : tests.length;
  const noun = mode === "investigations" ? "investigations" : "tests";

  return (
    <>
      <PageHeader
        title="Explore"
        aside={
          <div role="group" aria-label="Show" className="inline-flex rounded-md border border-line bg-surface p-0.5">
            {(["investigations", "tests"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => switchMode(value)}
                className={`rounded px-3 py-1.5 text-sm font-medium ${
                  mode === value ? "bg-accent text-white" : "text-muted hover:text-ink"
                }`}
              >
                {value === "investigations" ? "Investigations" : "Tests"}
              </button>
            ))}
          </div>
        }
      >
        Every investigation and test in the dataset. Show one row per investigation, or one row per test sample.
      </PageHeader>

      {total === 0 ? (
        <EmptyState title={`No ${noun} in the dataset`}>
          {mode === "tests"
            ? "No investigation has individual tests recorded."
            : "data/investigations.json is empty. Run the pipeline, then rebuild the site."}
        </EmptyState>
      ) : (
        <>
          <FilterPanel filters={filters} options={options} onChange={update} />

          {notice ? (
            <p
              role={notice.kind === "error" ? "alert" : "status"}
              className={`mb-4 rounded-md px-3 py-2 text-sm ${
                notice.kind === "error" ? "bg-red-50 text-red-800" : "bg-accent-soft text-accent"
              }`}
            >
              {notice.text}
            </p>
          ) : null}

          {/* Custom filter slot. The free-text filter is added here in Phase 9. */}
          <div data-slot="custom-filter" />

          {mode === "investigations" ? (
            <Results
              rows={filterInvestigations(investigations, filters)}
              columns={INVESTIGATION_COLUMNS}
              rowKey={(row) => row.id}
              saveControl={<SaveFilter filters={filters} hasFilters={chips.length > 0} />}
              {...{ total, noun, chips, filters, sort, page, toggleSort, setPage, update }}
            />
          ) : (
            <Results
              rows={filterTests(tests, filters)}
              columns={TEST_COLUMNS}
              rowKey={(row) => row.testId}
              saveControl={<SaveFilter filters={filters} hasFilters={chips.length > 0} />}
              {...{ total, noun, chips, filters, sort, page, toggleSort, setPage, update }}
            />
          )}
        </>
      )}
    </>
  );
}

function FilterPanel({
  filters,
  options,
  onChange,
}: {
  filters: Filters;
  options: Record<FacetKey, string[]>;
  onChange: (next: Filters) => void;
}) {
  const setRange = (key: RangeKey, bound: "min" | "max", text: string) =>
    onChange({ ...filters, [key]: { ...filters[key], [bound]: parseBound(text) } });
  const availableFuels = options.fuel.filter((fuel) => !filters.fuel.includes(fuel));

  return (
    <section aria-label="Filters" className="mb-4 rounded-lg border border-line bg-surface p-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Search</span>
          <input
            type="search"
            value={filters.search}
            onChange={(event) => onChange({ ...filters, search: event.target.value })}
            placeholder="Name, acronym, PSI id, fuel, sample, notes"
            className={inputClass}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{FACET_LABELS.fuel}</span>
          <select
            value=""
            onChange={(event) => event.target.value && onChange(toggleFacet(filters, "fuel", event.target.value))}
            disabled={availableFuels.length === 0}
            className={inputClass}
          >
            <option value="">
              {filters.fuel.length > 0 ? `Add another fuel (${filters.fuel.length} selected)` : "Any fuel"}
            </option>
            {availableFuels.map((fuel) => (
              <option key={fuel} value={fuel}>
                {fuel}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-5">
        {CHECKBOX_FACETS.map((key) => (
          <fieldset key={key} className="text-sm">
            <legend className="mb-1 font-medium">{FACET_LABELS[key]}</legend>
            {options[key].length === 0 ? (
              <p className="text-muted">No values recorded</p>
            ) : (
              options[key].map((value) => (
                <label key={value} className="flex items-center gap-2 py-0.5">
                  <input
                    type="checkbox"
                    checked={filters[key].includes(value)}
                    onChange={() => onChange(toggleFacet(filters, key, value))}
                    className="size-4 accent-accent"
                  />
                  {label(value)}
                </label>
              ))
            )}
          </fieldset>
        ))}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {RANGE_KEYS.map((key) => {
          const { name, unit } = RANGE_LABELS[key];
          return (
            <fieldset key={key} className="text-sm">
              <legend className="mb-1 font-medium">
                {name} ({unit})
              </legend>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  aria-label={`Minimum ${name.toLowerCase()} in ${unit}`}
                  placeholder="Min"
                  value={filters[key].min ?? ""}
                  onChange={(event) => setRange(key, "min", event.target.value)}
                  className={inputClass}
                />
                <span className="text-muted">to</span>
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  aria-label={`Maximum ${name.toLowerCase()} in ${unit}`}
                  placeholder="Max"
                  value={filters[key].max ?? ""}
                  onChange={(event) => setRange(key, "max", event.target.value)}
                  className={inputClass}
                />
              </div>
            </fieldset>
          );
        })}
      </div>
    </section>
  );
}

/** Saving needs an account. Guests see "Sign in to save" instead. */
function SaveFilter({ filters, hasFilters }: { filters: Filters; hasFilters: boolean }) {
  const { user, loading } = useAuth();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error"; text?: string }>({ kind: "idle" });

  if (loading) return null;
  if (!user) {
    return (
      <Link href="/login/" className={`text-sm ${linkClass}`}>
        Sign in to save
      </Link>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const db = getFirebase()?.db;
    if (!db || !name.trim()) return;
    setStatus({ kind: "saving" });
    try {
      await saveFilter(db, user.uid, name, filters);
      setStatus({ kind: "saved" });
      setNaming(false);
      setName("");
    } catch (reason) {
      setStatus({ kind: "error", text: errorMessage(reason) });
    }
  };

  if (naming) {
    return (
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Name for this filter"
          autoFocus
          required
          maxLength={NAME_MAX_LENGTH}
          placeholder="Name for this filter"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={`${inputClass} w-56`}
        />
        <button type="submit" disabled={status.kind === "saving"} className={`${buttonClass} py-1.5 disabled:opacity-50`}>
          {status.kind === "saving" ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => setNaming(false)} className={`text-sm ${linkClass}`}>
          Cancel
        </button>
        {status.kind === "error" ? (
          <span role="alert" className="text-sm text-red-800">
            {status.text}
          </span>
        ) : null}
      </form>
    );
  }

  return (
    <span className="flex items-center gap-3 text-sm">
      {status.kind === "saved" ? (
        <span role="status" className="text-muted">
          Saved.{" "}
          <Link href="/account/" className={linkClass}>
            View saved filters
          </Link>
        </span>
      ) : null}
      <button
        type="button"
        disabled={!hasFilters}
        title={hasFilters ? undefined : "Set at least one filter first"}
        onClick={() => {
          setNaming(true);
          setStatus({ kind: "idle" });
        }}
        className="rounded-md border border-accent px-3 py-1.5 font-medium text-accent hover:bg-accent-soft disabled:border-line disabled:text-muted disabled:hover:bg-transparent"
      >
        Save filter
      </button>
    </span>
  );
}

function Results<T>({
  rows,
  columns,
  rowKey,
  total,
  noun,
  chips,
  filters,
  sort,
  page,
  toggleSort,
  setPage,
  update,
  saveControl,
}: {
  saveControl: ReactNode;
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  total: number;
  noun: string;
  chips: { id: string; label: string }[];
  filters: Filters;
  sort: { key: string; direction: SortDirection } | null;
  page: number;
  toggleSort: (key: string) => void;
  setPage: (page: number) => void;
  update: (next: Filters) => void;
}) {
  const sortColumn = sort ? columns.find((column) => column.key === sort.key) : undefined;
  const sorted = sortColumn && sort ? sortRows(rows, sortColumn.sortValue, sort.direction) : rows;
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const visible = sorted.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  return (
    <section aria-label="Results">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="mr-2 text-sm font-medium" aria-live="polite">
          {rows.length === total ? `${total} ${noun}` : `${rows.length} of ${total} ${noun}`}
        </p>
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => update(removeChip(filters, chip.id))}
            aria-label={`Remove filter ${chip.label}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent hover:border-accent"
          >
            {chip.label}
            <span aria-hidden="true">×</span>
          </button>
        ))}
        {chips.length > 1 ? (
          <button type="button" onClick={() => update(emptyFilters())} className={`text-xs ${linkClass}`}>
            Clear all
          </button>
        ) : null}
        <div className="ml-auto">{saveControl}</div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={`No ${noun} match these filters`}
          action={
            <button type="button" className={buttonClass} onClick={() => update(emptyFilters())}>
              Clear filters
            </button>
          }
        >
          A range filter only matches rows that record that value. Remove a filter above, or clear them all.
        </EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-canvas">
                  {columns.map((column) => {
                    const active = sort?.key === column.key;
                    return (
                      <th
                        key={column.key}
                        scope="col"
                        aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                        className={`whitespace-nowrap px-3 py-2 font-medium ${column.numeric ? "text-right" : ""}`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(column.key)}
                          className={`inline-flex items-center gap-1 hover:text-accent ${active ? "text-accent" : ""}`}
                        >
                          {column.header}
                          <span aria-hidden="true" className={active ? "" : "text-muted/50"}>
                            {active ? (sort.direction === "asc" ? "▲" : "▼") : "↕"}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={rowKey(row)} className="border-b border-line last:border-b-0 hover:bg-canvas/60">
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={`px-3 py-2 align-top ${column.numeric ? "whitespace-nowrap text-right" : ""}`}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 ? (
            <div className="mt-3 flex items-center justify-between text-sm">
              <p className="text-muted">
                Rows {current * PAGE_SIZE + 1} to {current * PAGE_SIZE + visible.length} of {sorted.length}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={current === 0}
                  onClick={() => setPage(current - 1)}
                  className="rounded-md border border-line bg-surface px-3 py-1.5 font-medium disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-muted">
                  Page {current + 1} of {pages}
                </span>
                <button
                  type="button"
                  disabled={current >= pages - 1}
                  onClick={() => setPage(current + 1)}
                  className="rounded-md border border-line bg-surface px-3 py-1.5 font-medium disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
