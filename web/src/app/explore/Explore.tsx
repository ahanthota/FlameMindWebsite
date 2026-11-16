"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { OutcomeLegend, OutcomeStrip } from "@/components/OutcomeStrip";
import { buttonClass, EmptyState, linkClass, PageHeader } from "@/components/States";
import { CONTROL_CATEGORIES } from "@/lib/controlTabs";
import type { CategoryName, Insight } from "@/lib/types";
import { CategoryPanel } from "./CategoryPanel";
import { RangeBar } from "@/components/RangeBar";
import { outcomeSummary, rangeDomain, statedOutcomes } from "@/lib/charts";
import { deriveFilter } from "@/lib/api";
import { errorMessage, useAuth } from "@/lib/auth";
import {
  activeChips,
  applyCustomFilters,
  customFilterId,
  customFilterLabel,
  customFilterName,
  derivedValuesFor,
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
  toCsv,
  toggleFacet,
  type ActiveCustomFilter,
  type Chip,
  type CustomFilter,
  type DerivedValue,
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
import { getSavedFilter, listSavedFilters, NAME_MAX_LENGTH, saveFilter, type SavedFilter } from "@/lib/userdata";
import { CustomFilterBox } from "./CustomFilter";
import { SpreadScatter } from "./SpreadScatter";

type Mode = "investigations" | "tests";

interface Column<T> {
  key: string;
  /** Header text. Units go here, never in the cells. */
  header: string;
  numeric?: boolean;
  sortValue: (row: T) => SortValue;
  cell: (row: T) => ReactNode;
  /** The CSV cell. Defaults to the sort value. */
  csv?: (row: T) => CsvValue;
  /** More CSV columns that follow this one, such as source links. */
  csvExtra?: CsvColumn<T>[];
}

type CsvValue = string | number | null;

interface CsvColumn<T> {
  header: string;
  value: (row: T) => CsvValue;
}

const joined = (values: readonly string[]): string | null => (values.length > 0 ? values.join("; ") : null);
const rangeCsv = (min: number | null, max: number | null): string | null =>
  min === null && max === null ? null : formatRange(min, max);

const PAGE_SIZE = 50;
const CHECKBOX_FACETS: readonly FacetKey[] = ["fuelPhase", "hardware", "platform", "category", "gravity"];

/** For each range column: the scale its bars share and the active filter to shade. */
type RangeBars = Record<RangeKey, { domain: [number, number] | null; filter: Filters[RangeKey] }>;

function investigationColumns(bars: RangeBars): Column<InvestigationRow>[] {
  return [
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
  {
    key: "outcomes",
    header: "Outcomes",
    // Sorts by how many tests state an outcome.
    sortValue: (row) => (row.testCount > 0 ? statedOutcomes(row.outcomes) : null),
    cell: (row) => <OutcomeStrip counts={row.outcomes} />,
    csv: (row) => outcomeSummary(row.outcomes) || null,
  },
  { key: "fuelPhase", header: "Fuel phase", sortValue: (row) => row.fuelPhase, cell: (row) => label(row.fuelPhase) },
  {
    key: "fuels",
    header: "Fuels",
    sortValue: (row) => row.fuels[0] ?? null,
    cell: (row) => <span className="block min-w-48 max-w-72">{formatList(row.fuels)}</span>,
    csv: (row) => joined(row.fuels),
  },
  { key: "hardware", header: "Hardware", sortValue: (row) => row.hardware, cell: (row) => label(row.hardware) },
  { key: "platform", header: "Platform", sortValue: (row) => row.platform[0] ?? null, cell: (row) => formatList(row.platform), csv: (row) => joined(row.platform) },
  { key: "category", header: "Category", sortValue: (row) => row.category[0] ?? null, cell: (row) => formatList(row.category), csv: (row) => joined(row.category) },
  { key: "gravity", header: "Gravity", sortValue: (row) => row.gravity, cell: (row) => label(row.gravity) },
  { key: "o2", header: "O2 (%)", numeric: true, sortValue: (row) => row.o2.min, cell: (row) => <RangeBar range={row.o2} unit="%" {...bars.o2} />, csv: (row) => rangeCsv(row.o2.min, row.o2.max) },
  {
    key: "pressure",
    header: "Pressure (psi)",
    numeric: true,
    sortValue: (row) => row.pressure.min,
    cell: (row) => <RangeBar range={row.pressure} unit="psi" {...bars.pressure} />,
    csv: (row) => rangeCsv(row.pressure.min, row.pressure.max),
  },
  {
    key: "flow",
    header: "Airflow (cm/s)",
    numeric: true,
    sortValue: (row) => row.flow.min,
    cell: (row) => <RangeBar range={row.flow} unit="cm/s" {...bars.flow} />,
    csv: (row) => rangeCsv(row.flow.min, row.flow.max),
  },
  { key: "tests", header: "Tests (count)", numeric: true, sortValue: (row) => row.testCount, cell: (row) => row.testCount },
  { key: "years", header: "Years", sortValue: (row) => row.years, cell: (row) => row.years ?? MISSING },
];
}

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
  { key: "outcome", header: "Outcome", sortValue: (row) => (row.outcome === "unknown" ? null : row.outcome), cell: (row) => label(row.outcome), csv: (row) => row.outcome },
  {
    key: "spreadRate",
    header: "Spread rate (mm/s)",
    numeric: true,
    sortValue: (row) => row.spreadRate,
    cell: (row) => formatNumber(row.spreadRate),
  },
  { key: "gravity", header: "Gravity", sortValue: (row) => row.gravity, cell: (row) => label(row.gravity) },
];

const SPREAD_RATE_COLUMN: Column<InvestigationRow> = {
  key: "spreadRate",
  header: "Spread rate (mm/s)",
  numeric: true,
  sortValue: (row) => row.spreadRate.min,
  cell: (row) => formatRange(row.spreadRate.min, row.spreadRate.max),
  csv: (row) => rangeCsv(row.spreadRate.min, row.spreadRate.max),
};

const VALUES_SHOWN = 4;

function citationText(value: DerivedValue): string {
  const citation = value.citation;
  if (!citation) return "";
  const pages =
    citation.pageStart === null
      ? ""
      : citation.pageEnd !== null && citation.pageEnd !== citation.pageStart
        ? `, pages ${citation.pageStart} to ${citation.pageEnd}`
        : `, page ${citation.pageStart}`;
  return `${citation.title || "Source document"}${pages}`;
}

/** The column a derived custom filter adds: each value with its unit and a link to where it is written. */
function derivedColumn<T extends InvestigationRow | TestRow>(custom: ActiveCustomFilter): Column<T> {
  const { name, unit } = customFilterName(custom.filter);
  const header = unit ? `${name} (${unit})` : name;
  const valuesOf = (row: T) => derivedValuesFor(row, custom.values);
  const text = (value: DerivedValue) => `${formatNumber(value.value)}${value.unit ? ` ${value.unit}` : ""}`;
  return {
    key: customFilterId(custom.filter),
    header,
    sortValue: (row) => {
      const values = valuesOf(row).map((value) => value.value);
      return values.length > 0 ? Math.min(...values) : null;
    },
    cell: (row) => {
      const values = valuesOf(row);
      if (values.length === 0) return <span className="whitespace-nowrap text-muted">Not reported</span>;
      return (
        <ul className="min-w-40 space-y-0.5">
          {values.slice(0, VALUES_SHOWN).map((value, index) => (
            <li key={index} className="whitespace-nowrap">
              {text(value)}{" "}
              {value.citation?.url ? (
                <a
                  href={value.citation.url}
                  target="_blank"
                  rel="noreferrer"
                  title={citationText(value)}
                  className={`text-xs ${linkClass}`}
                >
                  source
                </a>
              ) : null}
            </li>
          ))}
          {values.length > VALUES_SHOWN ? (
            <li className="text-xs text-muted">and {values.length - VALUES_SHOWN} more (all are in the CSV)</li>
          ) : null}
        </ul>
      );
    },
    csv: (row) => joined(valuesOf(row).map(text)),
    csvExtra: [
      {
        header: `${name} source`,
        value: (row) =>
          joined([
            ...new Set(
              valuesOf(row)
                .filter((value) => value.citation)
                .map((value) => [citationText(value), value.citation?.url].filter(Boolean).join(" ")),
            ),
          ]),
      },
    ],
  };
}

function download(name: string, text: string) {
  // The byte order mark makes spreadsheet apps read the file as UTF-8.
  const url = URL.createObjectURL(new Blob(["\ufeff", text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

const inputClass =
  "w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm placeholder:text-muted/70 focus:border-accent";

export function Explore({
  investigations,
  tests,
  insights,
}: {
  investigations: InvestigationRow[];
  tests: TestRow[];
  insights: Insight[];
}) {
  const [mode, setMode] = useState<Mode>("investigations");
  const [tab, setTab] = useState<"all" | CategoryName>("all");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [customs, setCustoms] = useState<ActiveCustomFilter[]>([]);
  const [showNotReported, setShowNotReported] = useState(false);
  const [sort, setSort] = useState<{ key: string; direction: SortDirection } | null>(null);
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [savedVersion, setSavedVersion] = useState(0);
  const { user, loading: authLoading } = useAuth();

  const investigationIds = useMemo(() => investigations.map((row) => row.id), [investigations]);
  const domains = useMemo(
    () => ({
      o2: rangeDomain(investigations.map((row) => row.o2)),
      pressure: rangeDomain(investigations.map((row) => row.pressure)),
      flow: rangeDomain(investigations.map((row) => row.flow)),
    }),
    [investigations],
  );
  const psiUrls = useMemo(() => new Map(investigations.map((row) => [row.id, row.psiUrl])), [investigations]);

  const addCustom = useCallback((custom: ActiveCustomFilter) => {
    const id = customFilterId(custom.filter);
    setCustoms((current) => [...current.filter((item) => customFilterId(item.filter) !== id), custom]);
    // A filter on tests is shown in the tests table.
    if (custom.filter.kind === "mapped" && custom.filter.level === "test") {
      setMode("tests");
      setSort(null);
    }
  }, []);

  // Only the latest "apply a saved filter set" may add its derived filters.
  const applyRun = useRef(0);
  const applySaved = useCallback(
    async (saved: SavedFilter) => {
      const run = ++applyRun.current;
      setFilters(saved.manualFilters);
      setCustoms([]);
      setShowNotReported(false);
      const derived: CustomFilter[] = [];
      for (const filter of saved.customFilters) {
        if (filter.kind === "mapped") addCustom({ filter, values: [] });
        else derived.push(filter);
      }
      const shown = `Showing your saved filter set "${saved.name}".`;
      setNotice({ kind: "info", text: derived.length > 0 ? `${shown} Reading its custom parameters from the source documents…` : shown });
      try {
        for (const filter of derived) {
          if (filter.kind !== "derived") continue;
          const values = await deriveFilter(filter, investigationIds);
          if (run !== applyRun.current) return;
          addCustom({ filter, values });
        }
        if (run === applyRun.current) setNotice({ kind: "info", text: shown });
      } catch (error) {
        if (run === applyRun.current) setNotice({ kind: "error", text: errorMessage(error) });
      }
    },
    [addCustom, investigationIds],
  );

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
      if (current) void applySaved(found);
      return null;
    };
    load().then(
      (result) => current && result && setNotice(result),
      (error) => current && setNotice({ kind: "error", text: errorMessage(error) }),
    );
    return () => {
      current = false;
    };
  }, [user, authLoading, applySaved]);

  // Options come from all rows of both kinds, so they do not change with the toggle.
  const options = useMemo(() => facetOptions([...investigations, ...tests]), [investigations, tests]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setSort(null);
  };
  const toggleSort = (key: string) => {
    setSort((current) =>
      current?.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" },
    );
  };

  const customIds = new Set(customs.map((item) => customFilterId(item.filter)));
  const chips: Chip[] = [
    ...activeChips(filters, label),
    ...customs.map((item) => ({ id: customFilterId(item.filter), label: customFilterLabel(item.filter) })),
  ];
  const removeFilter = (id: string) => {
    if (customIds.has(id)) setCustoms((current) => current.filter((item) => customFilterId(item.filter) !== id));
    else setFilters(removeChip(filters, id));
  };
  const clearAll = () => {
    applyRun.current += 1;
    setFilters(emptyFilters());
    setCustoms([]);
    setShowNotReported(false);
  };

  const total = mode === "investigations" ? investigations.length : tests.length;
  const noun = mode === "investigations" ? "investigations" : "tests";
  const derived = customs.filter((item) => item.filter.kind === "derived");
  const hasSpreadRate = customs.some((item) => item.filter.kind === "mapped" && item.filter.field === "spread_rate_mm_s");
  const customDefinitions = customs.map((item) => item.filter);

  // Scales come from every investigation, so a bar keeps its place when filters change.
  const rangeBars: RangeBars = {
    o2: { domain: domains.o2, filter: filters.o2 },
    pressure: { domain: domains.pressure, filter: filters.pressure },
    flow: { domain: domains.flow, filter: filters.flow },
  };
  const testResults = applyCustomFilters(mode === "tests" ? filterTests(tests, filters) : [], customs);

  const shared = {
    total,
    noun,
    chips,
    sort,
    toggleSort,
    removeFilter,
    clearAll,
    showNotReported,
    setShowNotReported,
    customCount: customs.length,
    // Any change to what is listed goes back to the first page.
    resetKey: JSON.stringify([mode, filters, customDefinitions, sort]),
    controls: (
      <>
        <SavedFilters version={savedVersion} onApply={applySaved} />
        <SaveFilter
          filters={filters}
          customFilters={customDefinitions}
          hasFilters={chips.length > 0}
          onSaved={() => setSavedVersion((value) => value + 1)}
        />
      </>
    ),
  };

  return (
    <>
      <PageHeader
        title="Explore"
        aside={
          tab === "all" ? (
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
          ) : undefined
        }
      >
        Every investigation and test in the dataset. Show one row per investigation, or one row per test sample.
      </PageHeader>

      <div role="tablist" aria-label="Category" className="mb-4 inline-flex rounded-md border border-line bg-surface p-0.5">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "all"}
          onClick={() => setTab("all")}
          className={`rounded px-3 py-1.5 text-sm font-medium ${tab === "all" ? "bg-accent text-white" : "text-muted hover:text-ink"}`}
        >
          All
        </button>
        {CONTROL_CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            role="tab"
            aria-selected={tab === category}
            onClick={() => setTab(category)}
            className={`rounded px-3 py-1.5 text-sm font-medium ${tab === category ? "bg-accent text-white" : "text-muted hover:text-ink"}`}
          >
            {label(category)}
          </button>
        ))}
      </div>

      {tab !== "all" ? (
        <CategoryPanel category={tab} investigations={investigations} insights={insights} />
      ) : total === 0 ? (
        <EmptyState title={`No ${noun} in the dataset`}>
          {mode === "tests"
            ? "No investigation has individual tests recorded."
            : "data/investigations.json is empty. Run the pipeline, then rebuild the site."}
        </EmptyState>
      ) : (
        <>
          <FilterPanel filters={filters} options={options} onChange={setFilters} />

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

          <CustomFilterBox investigations={investigations} onApply={addCustom} />

          {mode === "investigations" ? (
            <Results
              {...applyCustomFilters(filterInvestigations(investigations, filters), customs)}
              columns={[
                ...investigationColumns(rangeBars),
                ...(hasSpreadRate ? [SPREAD_RATE_COLUMN] : []),
                ...derived.map((item) => derivedColumn<InvestigationRow>(item)),
              ]}
              csvExtra={[
                { header: "PSI id", value: (row) => row.id },
                { header: "Name", value: (row) => row.name },
                { header: "PSI folder", value: (row) => row.psiUrl },
              ]}
              rowKey={(row) => row.id}
              legend={<OutcomeLegend />}
              {...shared}
            />
          ) : (
            <Results
              {...testResults}
              chart={<SpreadScatter rows={testResults.matches} />}
              columns={[...TEST_COLUMNS, ...derived.map((item) => derivedColumn<TestRow>(item))]}
              csvExtra={[
                { header: "PSI id", value: (row) => row.investigationId },
                { header: "PSI folder", value: (row) => psiUrls.get(row.investigationId) ?? null },
              ]}
              rowKey={(row) => row.testId}
              {...shared}
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

/** The signed-in user's saved filter sets, to reapply one. Guests see nothing here. */
function SavedFilters({ version, onApply }: { version: number; onApply: (saved: SavedFilter) => void }) {
  const { user } = useAuth();
  const [saved, setSaved] = useState<SavedFilter[]>([]);
  const uid = user?.uid;

  useEffect(() => {
    const db = getFirebase()?.db;
    if (!uid || !db) return;
    let current = true;
    listSavedFilters(db, uid).then(
      (items) => current && setSaved(items),
      () => current && setSaved([]),
    );
    return () => {
      current = false;
    };
  }, [uid, version]);

  if (!uid || saved.length === 0) return null;
  return (
    <select
      aria-label="Saved filters"
      value=""
      onChange={(event) => {
        const found = saved.find((item) => item.id === event.target.value);
        if (found) onApply(found);
      }}
      className={`${inputClass} w-auto max-w-56`}
    >
      <option value="">Saved filters ({saved.length})</option>
      {saved.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </select>
  );
}

/** Saving needs an account. Guests see "Sign in to save" instead. */
function SaveFilter({
  filters,
  customFilters,
  hasFilters,
  onSaved,
}: {
  filters: Filters;
  customFilters: CustomFilter[];
  hasFilters: boolean;
  onSaved: () => void;
}) {
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
      await saveFilter(db, user.uid, name, filters, customFilters);
      setStatus({ kind: "saved" });
      setNaming(false);
      setName("");
      onSaved();
    } catch (reason) {
      setStatus({ kind: "error", text: errorMessage(reason) });
    }
  };

  if (naming) {
    return (
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Name for this filter set"
          autoFocus
          required
          maxLength={NAME_MAX_LENGTH}
          placeholder="Name for this filter set"
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
        className={outlineButtonClass}
      >
        Save this filter set
      </button>
    </span>
  );
}

const outlineButtonClass =
  "rounded-md border border-accent px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent-soft disabled:border-line disabled:text-muted disabled:hover:bg-transparent";

function Results<T>({
  matches,
  notReported,
  columns,
  csvExtra,
  rowKey,
  total,
  noun,
  chips,
  sort,
  toggleSort,
  removeFilter,
  clearAll,
  showNotReported,
  setShowNotReported,
  customCount,
  resetKey,
  controls,
  chart,
  legend,
}: {
  /** A chart of the matching rows, above the table. */
  chart?: ReactNode;
  /** A key for colored cells in the table. */
  legend?: ReactNode;
  /** Rows that pass every filter. */
  matches: T[];
  /** Rows that pass the other filters but have no value for a custom parameter. Never counted as matches. */
  notReported: T[];
  columns: Column<T>[];
  /** CSV-only columns, after the table's own. */
  csvExtra: CsvColumn<T>[];
  rowKey: (row: T) => string;
  total: number;
  noun: string;
  chips: Chip[];
  sort: { key: string; direction: SortDirection } | null;
  toggleSort: (key: string) => void;
  removeFilter: (id: string) => void;
  clearAll: () => void;
  showNotReported: boolean;
  setShowNotReported: (show: boolean) => void;
  /** How many custom filters are applied. */
  customCount: number;
  resetKey: string;
  controls: ReactNode;
}) {
  const sortColumn = sort ? columns.find((column) => column.key === sort.key) : undefined;
  const order = (rows: T[]) => (sortColumn && sort ? sortRows(rows, sortColumn.sortValue, sort.direction) : rows);
  const sorted = order(matches);
  const sortedNotReported = order(notReported);
  const parameter = customCount > 1 ? "a custom parameter is not reported" : "this parameter is not reported";
  const listed = showNotReported ? [...sorted, ...sortedNotReported] : sorted;

  const downloadCsv = () => {
    const csvColumns: CsvColumn<T>[] = [
      ...columns.flatMap((column) => [
        { header: column.header, value: column.csv ?? column.sortValue },
        ...(column.csvExtra ?? []),
      ]),
      ...csvExtra,
    ];
    const matched = new Set(sorted);
    const headers = csvColumns.map((column) => column.header);
    const body = listed.map((row) => csvColumns.map((column) => column.value(row)));
    if (customCount > 0) {
      headers.push("Custom filter result");
      listed.forEach((row, index) => body[index].push(matched.has(row) ? "match" : "not reported"));
    }
    download(`flamemind-${noun}.csv`, toCsv(headers, body));
  };

  return (
    <section aria-label="Results">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="mr-2 text-sm font-medium" aria-live="polite">
          {matches.length === total ? `${total} ${noun}` : `${matches.length} of ${total} ${noun}`}
        </p>
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => removeFilter(chip.id)}
            aria-label={`Remove filter ${chip.label}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent hover:border-accent"
          >
            {chip.label}
            <span aria-hidden="true">×</span>
          </button>
        ))}
        {chips.length > 1 ? (
          <button type="button" onClick={clearAll} className={`text-xs ${linkClass}`}>
            Clear all
          </button>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {controls}
          <button type="button" disabled={listed.length === 0} onClick={downloadCsv} className={outlineButtonClass}>
            Download CSV
          </button>
        </div>
      </div>

      {matches.length > 0 ? chart : null}
      {matches.length > 0 && legend ? <div className="mb-2">{legend}</div> : null}

      {matches.length === 0 ? (
        <EmptyState
          title={`No ${noun} match these filters`}
          action={
            <button type="button" className={buttonClass} onClick={clearAll}>
              Clear filters
            </button>
          }
        >
          A range filter only matches rows that record that value. Remove a filter above, or clear them all.
        </EmptyState>
      ) : (
        <DataTable key={resetKey} rows={sorted} {...{ columns, rowKey, sort, toggleSort }} />
      )}

      {notReported.length > 0 ? (
        <section aria-label="Rows where the parameter is not reported" className="mt-4">
          <button
            type="button"
            aria-expanded={showNotReported}
            onClick={() => setShowNotReported(!showNotReported)}
            className={`text-sm ${linkClass}`}
          >
            {showNotReported ? "Hide" : "Show"} {notReported.length} {notReported.length === 1 ? "row" : "rows"} where{" "}
            {parameter}
          </button>
          {showNotReported ? (
            <>
              <p className="mb-2 mt-1 text-sm text-muted">
                These {noun} pass the other filters, but the sources do not state a value for the custom filter. They
                are not counted as matches.
              </p>
              <DataTable key={resetKey} rows={sortedNotReported} {...{ columns, rowKey, sort, toggleSort }} />
            </>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

/** One sortable table with its own paging. */
function DataTable<T>({
  rows,
  columns,
  rowKey,
  sort,
  toggleSort,
}: {
  /** Already sorted. */
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  sort: { key: string; direction: SortDirection } | null;
  toggleSort: (key: string) => void;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const visible = rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  return (
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
            Rows {current * PAGE_SIZE + 1} to {current * PAGE_SIZE + visible.length} of {rows.length}
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
  );
}
