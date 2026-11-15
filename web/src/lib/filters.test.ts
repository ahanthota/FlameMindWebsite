import { describe, expect, it } from "vitest";
import {
  activeChips,
  emptyFilters,
  facetOptions,
  filterInvestigations,
  filterTests,
  matchesSearch,
  normalizeFilters,
  parseBound,
  rangeOverlaps,
  removeChip,
  sortRows,
  toggleFacet,
  toInvestigationRow,
  toTestRows,
  valueInRange,
  type Filters,
} from "./filters";
import type { Investigation, TestCondition } from "./types";

function test(values: Partial<TestCondition>): TestCondition {
  return {
    sample_id: null,
    fuel: null,
    sample_geometry: null,
    o2_percent: null,
    pressure_kpa: null,
    pressure_psi: null,
    flow_cm_s: null,
    diluent: null,
    outcome: "unknown",
    spread_rate_mm_s: null,
    notes: null,
    evidence: [],
    ...values,
  };
}

function investigation(values: Partial<Investigation>): Investigation {
  return {
    id: "PSI-0",
    name: "Name",
    acronym: "ACR",
    tier: "A",
    psi_url: "https://psi.example",
    program: null,
    hardware: null,
    platform: [],
    years: null,
    objectives: [],
    approach: null,
    category: [],
    fuel_phase: null,
    fuels: [],
    sample_geometry: null,
    sample_size: null,
    o2_percent_min: null,
    o2_percent_max: null,
    pressure_kpa_min: null,
    pressure_kpa_max: null,
    pressure_psi_min: null,
    pressure_psi_max: null,
    flow_cm_s_min: null,
    flow_cm_s_max: null,
    gravity: null,
    diluents: [],
    variables_varied: [],
    variables_fixed: [],
    sensors: [],
    tests: [],
    ignition_findings: [],
    flame_spread_findings: [],
    extinction_findings: [],
    key_findings: [],
    fire_safety_relevance: "",
    sources: [],
    needs_review: false,
    ...values,
  };
}

const BASS = investigation({
  id: "PSI-25",
  acronym: "BASS-II",
  name: "Burning and Suppression of Solids II",
  hardware: "MSG",
  platform: ["ISS"],
  category: ["prevention", "suppression"],
  fuel_phase: "solid",
  fuels: ["cotton-fiberglass fabric", "PMMA"],
  gravity: "microgravity",
  o2_percent_min: 16,
  o2_percent_max: 21,
  pressure_psi_min: 14.7,
  flow_cm_s_min: 1,
  flow_cm_s_max: 55,
  objectives: ["Study flame spread over thin fabric."],
  tests: [
    test({ sample_id: "A1", fuel: "Cotton-fiberglass fabric", o2_percent: 21, pressure_psi: 14.7, flow_cm_s: 10, spread_rate_mm_s: 1.8, outcome: "ignited" }),
    test({ sample_id: "A2", fuel: "PMMA", o2_percent: 16, pressure_kpa: 101.3, flow_cm_s: 2, outcome: "extinguished", notes: "Quenched at low flow." }),
    test({ sample_id: "A3", fuel: "PMMA" }),
  ],
});

const FLEX = investigation({
  id: "PSI-68",
  acronym: "FLEX-2",
  name: "Flame Extinguishment Experiment 2",
  hardware: "CIR",
  platform: ["ISS"],
  category: ["suppression"],
  fuel_phase: "liquid",
  fuels: ["heptane", "methanol"],
  gravity: "microgravity",
  pressure_kpa_min: 50,
  pressure_kpa_max: 304,
  tests: [test({ sample_id: "D1", fuel: "Heptane", o2_percent: 30 }), test({ sample_id: "D2", fuel: "Methanol", o2_percent: 40 })],
});

const SAME = investigation({
  id: "PSI-101",
  acronym: "SAME-R",
  name: "Smoke Aerosol Measurement Experiment",
  hardware: "other",
  platform: ["drop_tower"],
  category: ["detection"],
  fuel_phase: "solid",
  fuels: ["Teflon"],
  gravity: "normal",
});

const ALL = [BASS, FLEX, SAME];
const ROWS = ALL.map(toInvestigationRow);
const TESTS = ALL.flatMap(toTestRows);

function filters(values: Partial<Filters>): Filters {
  return { ...emptyFilters(), ...values };
}

const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
const testIds = (rows: { testId: string }[]) => rows.map((row) => row.testId);

describe("rows", () => {
  it("uses the record range, converting kPa to psi", () => {
    const [bass, flex] = ROWS;
    expect(bass.o2).toEqual({ min: 16, max: 21 });
    expect(bass.pressure).toEqual({ min: 14.7, max: 14.7 });
    expect(flex.pressure.min).toBeCloseTo(7.25, 2);
    expect(flex.pressure.max).toBeCloseTo(44.09, 2);
  });

  it("falls back to the span of the tests when the record has no range", () => {
    expect(ROWS[1].o2).toEqual({ min: 30, max: 40 });
    expect(ROWS[1].flow).toEqual({ min: null, max: null });
  });

  it("makes one row per test with a stable id and psi pressure", () => {
    expect(testIds(TESTS)).toEqual(["PSI-25-T1", "PSI-25-T2", "PSI-25-T3", "PSI-68-T1", "PSI-68-T2"]);
    expect(TESTS[1].pressure).toBeCloseTo(14.69, 2);
    expect(TESTS[1].fuelPhase).toBe("solid");
    expect(TESTS[2].o2).toBeNull();
  });
});

describe("range matching", () => {
  it("valueInRange treats bounds as inclusive and missing values as no match", () => {
    expect(valueInRange(21, { min: 21, max: 30 })).toBe(true);
    expect(valueInRange(20.9, { min: 21, max: null })).toBe(false);
    expect(valueInRange(5, { min: null, max: 5 })).toBe(true);
    expect(valueInRange(null, { min: 1, max: null })).toBe(false);
    expect(valueInRange(null, { min: null, max: null })).toBe(true);
  });

  it("rangeOverlaps matches any overlap and rejects missing ranges", () => {
    expect(rangeOverlaps({ min: 16, max: 21 }, { min: 21, max: 40 })).toBe(true);
    expect(rangeOverlaps({ min: 16, max: 21 }, { min: 22, max: null })).toBe(false);
    expect(rangeOverlaps({ min: 16, max: 21 }, { min: null, max: 15.9 })).toBe(false);
    expect(rangeOverlaps({ min: null, max: null }, { min: 1, max: 2 })).toBe(false);
    expect(rangeOverlaps({ min: null, max: null }, { min: null, max: null })).toBe(true);
  });
});

describe("filterInvestigations", () => {
  it("returns everything with no filters", () => {
    expect(ids(filterInvestigations(ROWS, emptyFilters()))).toEqual(["PSI-25", "PSI-68", "PSI-101"]);
  });

  it("searches id, acronym, name, fuels, and objectives; every word must match", () => {
    expect(ids(filterInvestigations(ROWS, filters({ search: "bass" })))).toEqual(["PSI-25"]);
    expect(ids(filterInvestigations(ROWS, filters({ search: "thin FABRIC" })))).toEqual(["PSI-25"]);
    expect(ids(filterInvestigations(ROWS, filters({ search: "smoke heptane" })))).toEqual([]);
    expect(matchesSearch("anything", "   ")).toBe(true);
  });

  it("matches any selected value within a facet and all facets together", () => {
    expect(ids(filterInvestigations(ROWS, filters({ fuelPhase: ["solid"] })))).toEqual(["PSI-25", "PSI-101"]);
    expect(ids(filterInvestigations(ROWS, filters({ fuelPhase: ["solid", "liquid"], hardware: ["CIR", "other"] })))).toEqual(["PSI-68", "PSI-101"]);
    expect(ids(filterInvestigations(ROWS, filters({ category: ["suppression"], platform: ["ISS"] })))).toEqual(["PSI-25", "PSI-68"]);
    expect(ids(filterInvestigations(ROWS, filters({ gravity: ["normal"] })))).toEqual(["PSI-101"]);
    expect(ids(filterInvestigations(ROWS, filters({ fuel: ["pmma"] })))).toEqual(["PSI-25"]);
  });

  it("applies oxygen, pressure, and airflow ranges by overlap", () => {
    expect(ids(filterInvestigations(ROWS, filters({ o2: { min: 30, max: null } })))).toEqual(["PSI-68"]);
    expect(ids(filterInvestigations(ROWS, filters({ pressure: { min: null, max: 8 } })))).toEqual(["PSI-68"]);
    expect(ids(filterInvestigations(ROWS, filters({ flow: { min: 50, max: 60 } })))).toEqual(["PSI-25"]);
    expect(ids(filterInvestigations(ROWS, filters({ o2: { min: 20, max: 35 }, pressure: { min: 14, max: 15 } })))).toEqual(["PSI-25", "PSI-68"]);
  });
});

describe("filterTests", () => {
  it("filters on the test's own values", () => {
    expect(testIds(filterTests(TESTS, filters({ o2: { min: 20, max: 30 } })))).toEqual(["PSI-25-T1", "PSI-68-T1"]);
    expect(testIds(filterTests(TESTS, filters({ pressure: { min: 14.6, max: 14.8 } })))).toEqual(["PSI-25-T1", "PSI-25-T2"]);
    expect(testIds(filterTests(TESTS, filters({ flow: { min: null, max: 5 } })))).toEqual(["PSI-25-T2"]);
  });

  it("uses the test fuel and the parent investigation's facets", () => {
    expect(testIds(filterTests(TESTS, filters({ fuel: ["PMMA"] })))).toEqual(["PSI-25-T2", "PSI-25-T3"]);
    expect(testIds(filterTests(TESTS, filters({ hardware: ["CIR"], fuel: ["methanol"] })))).toEqual(["PSI-68-T2"]);
    expect(testIds(filterTests(TESTS, filters({ search: "quenched" })))).toEqual(["PSI-25-T2"]);
    expect(filterTests(TESTS, filters({ gravity: ["normal"] }))).toEqual([]);
  });
});

describe("facetOptions", () => {
  it("lists the values present, sorted, merging fuels that differ only by case", () => {
    const options = facetOptions([...ROWS, ...TESTS]);
    expect(options.fuelPhase).toEqual(["liquid", "solid"]);
    expect(options.hardware).toEqual(["CIR", "MSG", "other"]);
    expect(options.platform).toEqual(["drop_tower", "ISS"]);
    expect(options.gravity).toEqual(["microgravity", "normal"]);
    expect(options.fuel).toEqual(["cotton-fiberglass fabric", "heptane", "methanol", "PMMA", "Teflon"]);
  });
});

describe("sortRows", () => {
  it("sorts numbers and text in both directions with missing values last", () => {
    expect(testIds(sortRows(TESTS, (row) => row.o2, "asc"))).toEqual(["PSI-25-T2", "PSI-25-T1", "PSI-68-T1", "PSI-68-T2", "PSI-25-T3"]);
    expect(testIds(sortRows(TESTS, (row) => row.o2, "desc"))).toEqual(["PSI-68-T2", "PSI-68-T1", "PSI-25-T1", "PSI-25-T2", "PSI-25-T3"]);
    expect(ids(sortRows(ROWS, (row) => row.acronym, "desc"))).toEqual(["PSI-101", "PSI-68", "PSI-25"]);
  });

  it("orders ids numerically and does not change the input", () => {
    const before = ids(ROWS);
    expect(ids(sortRows(ROWS, (row) => row.id, "asc"))).toEqual(["PSI-25", "PSI-68", "PSI-101"]);
    expect(ids(ROWS)).toEqual(before);
  });
});

describe("chips", () => {
  const active = filters({
    search: " fabric ",
    fuelPhase: ["solid"],
    fuel: ["PMMA", "heptane"],
    o2: { min: 21, max: 40 },
    pressure: { min: null, max: 8 },
    flow: { min: 5, max: null },
  });

  it("makes one chip per active value, with units", () => {
    expect(activeChips(active).map((chip) => chip.label)).toEqual([
      "Search: fabric",
      "Fuel phase: solid",
      "Fuel: PMMA",
      "Fuel: heptane",
      "Oxygen: 21 to 40%",
      "Pressure: at most 8 psi",
      "Airflow: at least 5 cm/s",
    ]);
    expect(activeChips(emptyFilters())).toEqual([]);
    expect(activeChips(filters({ platform: ["drop_tower"] }), (value) => value.replace("_", " "))[0].label).toBe("Platform: drop tower");
  });

  it("removes exactly one chip and leaves the input unchanged", () => {
    expect(removeChip(active, "fuel:PMMA").fuel).toEqual(["heptane"]);
    expect(removeChip(active, "o2").o2).toEqual({ min: null, max: null });
    expect(removeChip(active, "search").search).toBe("");
    expect(removeChip(active, "nonsense")).toEqual(active);
    expect(active.fuel).toEqual(["PMMA", "heptane"]);
    const cleared = activeChips(active).reduce((current, chip) => removeChip(current, chip.id), active);
    expect(cleared).toEqual(emptyFilters());
  });

  it("toggles facet values and parses range bounds", () => {
    const on = toggleFacet(emptyFilters(), "hardware", "MSG");
    expect(on.hardware).toEqual(["MSG"]);
    expect(toggleFacet(on, "hardware", "MSG").hardware).toEqual([]);
    expect([parseBound("21"), parseBound(" 8.5 "), parseBound(""), parseBound("abc")]).toEqual([21, 8.5, null, null]);
  });
});

describe("normalizeFilters", () => {
  it("round-trips real filters and repairs stored data that is missing or malformed", () => {
    const saved = filters({ search: "fabric", fuel: ["PMMA"], o2: { min: 21, max: null } });
    expect(normalizeFilters(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(normalizeFilters(null)).toEqual(emptyFilters());
    expect(normalizeFilters({ search: 5, fuel: ["PMMA", 3], o2: { min: "21", max: 40 }, extra: true })).toEqual(
      filters({ fuel: ["PMMA"], o2: { min: null, max: 40 } }),
    );
  });
});
