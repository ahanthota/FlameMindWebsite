/**
 * Explore page rows and filter logic. Pure functions: no React, no I/O.
 *
 * Units: oxygen in % by volume, pressure in psi, airflow in cm/s,
 * flame spread rate in mm/s.
 */

import type { Investigation, TestCondition } from "./types";

export const KPA_TO_PSI = 0.1450377;

export interface Range {
  min: number | null;
  max: number | null;
}

export type FacetKey = "fuelPhase" | "fuel" | "hardware" | "platform" | "category" | "gravity";
export type RangeKey = "o2" | "pressure" | "flow";

export interface Filters {
  search: string;
  fuelPhase: string[];
  fuel: string[];
  hardware: string[];
  platform: string[];
  category: string[];
  gravity: string[];
  o2: Range;
  pressure: Range;
  flow: Range;
}

export const FACET_KEYS: readonly FacetKey[] = ["fuelPhase", "fuel", "hardware", "platform", "category", "gravity"];
export const RANGE_KEYS: readonly RangeKey[] = ["o2", "pressure", "flow"];

export const FACET_LABELS: Record<FacetKey, string> = {
  fuelPhase: "Fuel phase",
  fuel: "Fuel",
  hardware: "Hardware",
  platform: "Platform",
  category: "Category",
  gravity: "Gravity",
};

export const RANGE_LABELS: Record<RangeKey, { name: string; unit: string }> = {
  o2: { name: "Oxygen", unit: "%" },
  pressure: { name: "Pressure", unit: "psi" },
  flow: { name: "Airflow", unit: "cm/s" },
};

export function emptyFilters(): Filters {
  return {
    search: "",
    fuelPhase: [],
    fuel: [],
    hardware: [],
    platform: [],
    category: [],
    gravity: [],
    o2: { min: null, max: null },
    pressure: { min: null, max: null },
    flow: { min: null, max: null },
  };
}

/** Rebuild filters from stored data (a saved filter). Anything missing or malformed becomes "no filter". */
export function normalizeFilters(value: unknown): Filters {
  const source = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const strings = (item: unknown): string[] =>
    Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === "string") : [];
  const bound = (item: unknown): number | null => (typeof item === "number" && Number.isFinite(item) ? item : null);
  const range = (item: unknown): Range => {
    const data = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    return { min: bound(data.min), max: bound(data.max) };
  };
  return {
    search: typeof source.search === "string" ? source.search : "",
    fuelPhase: strings(source.fuelPhase),
    fuel: strings(source.fuel),
    hardware: strings(source.hardware),
    platform: strings(source.platform),
    category: strings(source.category),
    gravity: strings(source.gravity),
    o2: range(source.o2),
    pressure: range(source.pressure),
    flow: range(source.flow),
  };
}

// ---------- rows ----------

/** Fields shared by both row kinds, so one set of filters works on either. */
interface RowBase {
  fuelPhase: string | null;
  fuels: string[];
  hardware: string | null;
  platform: string[];
  category: string[];
  gravity: string | null;
  /** Lowercase text that the search box matches against. */
  searchText: string;
}

export interface InvestigationRow extends RowBase {
  id: string;
  acronym: string;
  name: string;
  years: string | null;
  /** Tested range, from the record or, if it has none, from its tests. */
  o2: Range;
  pressure: Range;
  flow: Range;
  testCount: number;
  needsReview: boolean;
}

export interface TestRow extends RowBase {
  /** Same id the API uses: PSI-25-T12 is the 12th test of PSI-25. */
  testId: string;
  investigationId: string;
  acronym: string;
  sampleId: string | null;
  geometry: string | null;
  o2: number | null;
  pressure: number | null;
  flow: number | null;
  diluent: string | null;
  outcome: string;
  spreadRate: number | null;
}

export function testPressurePsi(test: Pick<TestCondition, "pressure_psi" | "pressure_kpa">): number | null {
  if (test.pressure_psi !== null) return test.pressure_psi;
  return test.pressure_kpa !== null ? test.pressure_kpa * KPA_TO_PSI : null;
}

function spanOf(values: (number | null)[]): Range {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? { min: null, max: null } : { min: Math.min(...known), max: Math.max(...known) };
}

function recordRange(min: number | null, max: number | null, fallback: (number | null)[]): Range {
  if (min === null && max === null) return spanOf(fallback);
  const low = min ?? max;
  const high = max ?? min;
  return { min: Math.min(low!, high!), max: Math.max(low!, high!) };
}

export function toInvestigationRow(item: Investigation): InvestigationRow {
  const psiMin = item.pressure_psi_min ?? (item.pressure_kpa_min !== null ? item.pressure_kpa_min * KPA_TO_PSI : null);
  const psiMax = item.pressure_psi_max ?? (item.pressure_kpa_max !== null ? item.pressure_kpa_max * KPA_TO_PSI : null);
  return {
    id: item.id,
    acronym: item.acronym,
    name: item.name,
    years: item.years,
    fuelPhase: item.fuel_phase,
    fuels: item.fuels,
    hardware: item.hardware,
    platform: item.platform,
    category: item.category,
    gravity: item.gravity,
    o2: recordRange(item.o2_percent_min, item.o2_percent_max, item.tests.map((test) => test.o2_percent)),
    pressure: recordRange(psiMin, psiMax, item.tests.map(testPressurePsi)),
    flow: recordRange(item.flow_cm_s_min, item.flow_cm_s_max, item.tests.map((test) => test.flow_cm_s)),
    testCount: item.tests.length,
    needsReview: item.needs_review,
    searchText: [item.id, item.acronym, item.name, item.program, item.sample_geometry, ...item.fuels, ...item.objectives]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
  };
}

export function toTestRows(item: Investigation): TestRow[] {
  return item.tests.map((test, index) => ({
    testId: `${item.id}-T${index + 1}`,
    investigationId: item.id,
    acronym: item.acronym,
    sampleId: test.sample_id,
    geometry: test.sample_geometry,
    fuelPhase: item.fuel_phase,
    fuels: test.fuel ? [test.fuel] : [],
    hardware: item.hardware,
    platform: item.platform,
    category: item.category,
    gravity: item.gravity,
    o2: test.o2_percent,
    pressure: testPressurePsi(test),
    flow: test.flow_cm_s,
    diluent: test.diluent,
    outcome: test.outcome,
    spreadRate: test.spread_rate_mm_s,
    searchText: [item.id, item.acronym, item.name, test.sample_id, test.fuel, test.sample_geometry, test.diluent, test.notes]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
  }));
}

// ---------- matching ----------

export function isRangeActive(range: Range): boolean {
  return range.min !== null || range.max !== null;
}

/** True when the value lies inside the filter range. A missing value never matches an active range. */
export function valueInRange(value: number | null, filter: Range): boolean {
  if (!isRangeActive(filter)) return true;
  if (value === null) return false;
  return (filter.min === null || value >= filter.min) && (filter.max === null || value <= filter.max);
}

/** True when the tested range overlaps the filter range. A missing range never matches an active filter. */
export function rangeOverlaps(tested: Range, filter: Range): boolean {
  if (!isRangeActive(filter)) return true;
  if (tested.min === null || tested.max === null) return false;
  return (filter.min === null || tested.max >= filter.min) && (filter.max === null || tested.min <= filter.max);
}

/** Every word in the query must appear somewhere in the row's text. */
export function matchesSearch(searchText: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((word) => searchText.includes(word));
}

function anySelected(selected: string[], values: (string | null)[]): boolean {
  if (selected.length === 0) return true;
  const have = new Set(values.filter((value): value is string => value !== null).map((value) => value.toLowerCase()));
  return selected.some((value) => have.has(value.toLowerCase()));
}

function matchesFacets(row: RowBase, filters: Filters): boolean {
  return (
    matchesSearch(row.searchText, filters.search) &&
    anySelected(filters.fuelPhase, [row.fuelPhase]) &&
    anySelected(filters.fuel, row.fuels) &&
    anySelected(filters.hardware, [row.hardware]) &&
    anySelected(filters.platform, row.platform) &&
    anySelected(filters.category, row.category) &&
    anySelected(filters.gravity, [row.gravity])
  );
}

export function filterInvestigations(rows: InvestigationRow[], filters: Filters): InvestigationRow[] {
  return rows.filter(
    (row) =>
      matchesFacets(row, filters) &&
      rangeOverlaps(row.o2, filters.o2) &&
      rangeOverlaps(row.pressure, filters.pressure) &&
      rangeOverlaps(row.flow, filters.flow),
  );
}

export function filterTests(rows: TestRow[], filters: Filters): TestRow[] {
  return rows.filter(
    (row) =>
      matchesFacets(row, filters) &&
      valueInRange(row.o2, filters.o2) &&
      valueInRange(row.pressure, filters.pressure) &&
      valueInRange(row.flow, filters.flow),
  );
}

// ---------- options ----------

/** The values present in the rows for each facet, sorted. Fuels that differ only by case are merged. */
export function facetOptions(rows: RowBase[]): Record<FacetKey, string[]> {
  const seen: Record<FacetKey, Map<string, string>> = {
    fuelPhase: new Map(),
    fuel: new Map(),
    hardware: new Map(),
    platform: new Map(),
    category: new Map(),
    gravity: new Map(),
  };
  const add = (key: FacetKey, value: string | null) => {
    if (value && !seen[key].has(value.toLowerCase())) seen[key].set(value.toLowerCase(), value);
  };
  for (const row of rows) {
    add("fuelPhase", row.fuelPhase);
    row.fuels.forEach((value) => add("fuel", value));
    add("hardware", row.hardware);
    row.platform.forEach((value) => add("platform", value));
    row.category.forEach((value) => add("category", value));
    add("gravity", row.gravity);
  }
  const sorted = (key: FacetKey) =>
    [...seen[key].values()].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  return {
    fuelPhase: sorted("fuelPhase"),
    fuel: sorted("fuel"),
    hardware: sorted("hardware"),
    platform: sorted("platform"),
    category: sorted("category"),
    gravity: sorted("gravity"),
  };
}

// ---------- sorting ----------

export type SortDirection = "asc" | "desc";
export type SortValue = string | number | null;

/** Stable sort. Missing values always go last, in either direction. */
export function sortRows<T>(rows: T[], value: (row: T) => SortValue, direction: SortDirection): T[] {
  const sign = direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, key: value(row) }))
    .sort((a, b) => {
      if (a.key === null && b.key === null) return a.index - b.index;
      if (a.key === null) return 1;
      if (b.key === null) return -1;
      const order =
        typeof a.key === "number" && typeof b.key === "number"
          ? a.key - b.key
          : String(a.key).localeCompare(String(b.key), "en", { numeric: true, sensitivity: "base" });
      return order !== 0 ? sign * order : a.index - b.index;
    })
    .map((entry) => entry.row);
}

// ---------- chips ----------

export interface Chip {
  /** "search", "o2", or "fuel:Methanol". Pass to removeChip. */
  id: string;
  label: string;
}

function rangeText(range: Range, unit: string): string {
  const suffix = unit === "%" ? "%" : ` ${unit}`;
  if (range.min !== null && range.max !== null) return `${range.min} to ${range.max}${suffix}`;
  if (range.min !== null) return `at least ${range.min}${suffix}`;
  return `at most ${range.max}${suffix}`;
}

/** One chip per active filter value, in a fixed order. `display` turns a stored value into its label. */
export function activeChips(filters: Filters, display: (value: string) => string = (value) => value): Chip[] {
  const chips: Chip[] = [];
  if (filters.search.trim()) chips.push({ id: "search", label: `Search: ${filters.search.trim()}` });
  for (const key of FACET_KEYS) {
    for (const value of filters[key]) {
      chips.push({ id: `${key}:${value}`, label: `${FACET_LABELS[key]}: ${display(value)}` });
    }
  }
  for (const key of RANGE_KEYS) {
    if (isRangeActive(filters[key])) {
      const { name, unit } = RANGE_LABELS[key];
      chips.push({ id: key, label: `${name}: ${rangeText(filters[key], unit)}` });
    }
  }
  return chips;
}

/** A copy of the filters without the chip's value. Unknown ids return an equal copy. */
export function removeChip(filters: Filters, id: string): Filters {
  if (id === "search") return { ...filters, search: "" };
  if ((RANGE_KEYS as readonly string[]).includes(id)) {
    return { ...filters, [id]: { min: null, max: null } };
  }
  const separator = id.indexOf(":");
  const key = id.slice(0, separator) as FacetKey;
  if (separator > 0 && FACET_KEYS.includes(key)) {
    const value = id.slice(separator + 1);
    return { ...filters, [key]: filters[key].filter((item) => item !== value) };
  }
  return { ...filters };
}

export function toggleFacet(filters: Filters, key: FacetKey, value: string): Filters {
  const current = filters[key];
  return { ...filters, [key]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value] };
}

/** Parse a number typed into a range box. Blank or invalid text means "no bound". */
export function parseBound(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}
