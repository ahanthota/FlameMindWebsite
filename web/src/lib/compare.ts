/**
 * Side-by-side values for the structured investigations. Missing values stay
 * an en dash. Nothing here estimates a number the record does not state.
 */

import { formatNumber, formatRange, label, MISSING } from "./format";
import type { Investigation, OutcomeName } from "./types";

export const FINDING_GROUPS: readonly { key: keyof Pick<Investigation, "key_findings" | "ignition_findings" | "flame_spread_findings" | "extinction_findings">; title: string }[] = [
  { key: "key_findings", title: "Key findings" },
  { key: "ignition_findings", title: "Ignition" },
  { key: "flame_spread_findings", title: "Flame spread" },
  { key: "extinction_findings", title: "Extinction" },
];

/** How many findings to show before asking to expand a long cell. */
export const FINDING_PREVIEW = 3;

export interface CompareFinding {
  group: string;
  text: string;
}

export interface CompareInvestigation {
  id: string;
  acronym: string;
  name: string;
  needsReview: boolean;
  categories: string[];
  objectives: string[];
  fuelPhase: string | null;
  fuels: string[];
  sampleGeometry: string | null;
  sampleSize: string | null;
  o2Min: number | null;
  o2Max: number | null;
  pressureMin: number | null;
  pressureMax: number | null;
  flowMin: number | null;
  flowMax: number | null;
  hardware: string | null;
  platform: string[];
  gravity: string | null;
  varied: string[];
  fixed: string[];
  sensors: string[];
  findings: CompareFinding[];
}

export const COMPARE_ROWS = [
  { id: "hardware", label: "Hardware" },
  { id: "platform", label: "Platform" },
  { id: "fuel", label: "Fuel" },
  { id: "geometry", label: "Sample geometry" },
  { id: "oxygen", label: "Oxygen (%)" },
  { id: "pressure", label: "Pressure (psi)" },
  { id: "flow", label: "Flow (cm/s)" },
  { id: "gravity", label: "Gravity" },
  { id: "varied", label: "Variables varied" },
  { id: "sensors", label: "Sensors" },
  { id: "ignition", label: "Ignition findings" },
  { id: "flameSpread", label: "Flame spread findings" },
  { id: "extinction", label: "Extinction findings" },
] as const;

export type CompareRowId = (typeof COMPARE_ROWS)[number]["id"];

export function toCompareInvestigation(item: Investigation): CompareInvestigation {
  const findings: CompareFinding[] = [];
  for (const group of FINDING_GROUPS) {
    for (const finding of item[group.key]) {
      const text = finding.text.trim();
      if (text) findings.push({ group: group.title, text });
    }
  }
  return {
    id: item.id,
    acronym: item.acronym,
    name: item.name,
    needsReview: item.needs_review,
    categories: clean(item.category),
    objectives: clean(item.objectives),
    fuelPhase: item.fuel_phase,
    fuels: clean(item.fuels),
    sampleGeometry: blankToNull(item.sample_geometry),
    sampleSize: blankToNull(item.sample_size),
    o2Min: item.o2_percent_min,
    o2Max: item.o2_percent_max,
    pressureMin: item.pressure_psi_min,
    pressureMax: item.pressure_psi_max,
    flowMin: item.flow_cm_s_min,
    flowMax: item.flow_cm_s_max,
    hardware: item.hardware,
    platform: clean(item.platform),
    gravity: item.gravity,
    varied: clean(item.variables_varied),
    fixed: clean(item.variables_fixed),
    sensors: clean(item.sensors),
    findings,
  };
}

/** Text used both for display of scalar rows and for "does this row differ?". */
export function rowValue(id: CompareRowId, item: CompareInvestigation): string {
  switch (id) {
    case "hardware":
      return label(item.hardware);
    case "platform":
      return lines(item.platform.map((value) => label(value)));
    case "fuel":
      return lines([item.fuelPhase ? label(item.fuelPhase) : "", ...item.fuels]);
    case "geometry":
      return item.sampleGeometry ?? MISSING;
    case "oxygen":
      return formatRange(item.o2Min, item.o2Max);
    case "pressure":
      return formatRange(item.pressureMin, item.pressureMax);
    case "flow":
      return formatRange(item.flowMin, item.flowMax);
    case "gravity":
      return label(item.gravity);
    case "varied":
      return lines(item.varied);
    case "sensors":
      return lines(item.sensors);
    case "ignition":
      return findingText(item, "Ignition");
    case "flameSpread":
      return findingText(item, "Flame spread");
    case "extinction":
      return findingText(item, "Extinction");
  }
}

/** A question that names each selected investigation, for the scenario chat. */
export function askAbout(items: readonly CompareInvestigation[]): string {
  const names = items.map((item) => `${item.acronym} (${item.id})`);
  const list = names.length <= 1 ? names[0] ?? "these investigations" : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `How do ${list} compare?`;
}

/** True when every selected investigation shows the same value, or fewer than two are selected. */
export function sameAcross(items: readonly CompareInvestigation[], id: CompareRowId): boolean {
  if (items.length < 2) return true;
  const first = rowValue(id, items[0]);
  return items.every((item) => rowValue(id, item) === first);
}

export function visibleFindings(findings: readonly CompareFinding[], expanded: boolean): CompareFinding[] {
  if (expanded || findings.length <= FINDING_PREVIEW) return [...findings];
  return findings.slice(0, FINDING_PREVIEW);
}

export function findingsFor(item: CompareInvestigation, group: string): CompareFinding[] {
  return item.findings.filter((finding) => finding.group === group);
}

export interface CompareTest {
  key: string;
  sample: string;
  fuel: string;
  geometry: string;
  oxygen: string;
  pressure: string;
  flow: string;
  outcome: string;
  outcomeKey: OutcomeName;
  spread: string;
  o2: number | null;
  psi: number | null;
  flowValue: number | null;
}

export interface TestSet {
  id: string;
  acronym: string;
  name: string;
  tests: CompareTest[];
}

/** Condition columns. Outcome and spread rate are results, not conditions that "vary". */
export const TEST_AXES = [
  { id: "fuel", label: "Fuel" },
  { id: "geometry", label: "Geometry" },
  { id: "oxygen", label: "Oxygen (%)" },
  { id: "pressure", label: "Pressure (psi)" },
  { id: "flow", label: "Flow (cm/s)" },
] as const;

export type TestAxis = (typeof TEST_AXES)[number]["id"];
export type ChartAxis = "oxygen" | "pressure" | "flow";
export type AxisState = "changed" | "fixed" | "unstated";

export const CHART_AXIS_LABEL: Record<ChartAxis, string> = {
  oxygen: "Oxygen (%)",
  pressure: "Pressure (psi)",
  flow: "Flow (cm/s)",
};

export function toCompareTests(item: Investigation): CompareTest[] {
  return item.tests.map((test, index) => ({
    key: `${item.id}-${index}`,
    sample: test.sample_id?.trim() || `Test ${index + 1}`,
    fuel: test.fuel?.trim() || MISSING,
    geometry: test.sample_geometry?.trim() || MISSING,
    oxygen: test.o2_percent === null ? MISSING : formatNumber(test.o2_percent),
    pressure: test.pressure_psi === null ? MISSING : formatNumber(test.pressure_psi),
    flow: test.flow_cm_s === null ? MISSING : formatNumber(test.flow_cm_s),
    outcome: label(test.outcome),
    outcomeKey: test.outcome,
    spread: test.spread_rate_mm_s === null ? MISSING : formatNumber(test.spread_rate_mm_s),
    o2: test.o2_percent,
    psi: test.pressure_psi,
    flowValue: test.flow_cm_s,
  }));
}

/** Changed when two stated values disagree. A missing value is not a stated change. */
export function axisState(tests: readonly CompareTest[], axis: TestAxis): AxisState {
  const stated = tests.map((test) => test[axis]).filter((value) => value !== MISSING);
  if (stated.length === 0) return "unstated";
  return stated.every((value) => value === stated[0]) ? "fixed" : "changed";
}

/**
 * The condition among oxygen, pressure, and flow that takes the most distinct
 * stated numbers. Ties keep the earlier axis. Null when none takes two values.
 */
export function mainVaried(tests: readonly CompareTest[]): ChartAxis | null {
  const axes: ChartAxis[] = ["oxygen", "pressure", "flow"];
  let best: ChartAxis | null = null;
  let bestCount = 1;
  for (const axis of axes) {
    const distinct = new Set(tests.map((test) => chartNumber(test, axis)).filter((value): value is number => value !== null).map((value) => value.toFixed(3)));
    if (distinct.size > bestCount) {
      best = axis;
      bestCount = distinct.size;
    }
  }
  return best;
}

export function chartNumber(test: CompareTest, axis: ChartAxis): number | null {
  if (axis === "oxygen") return test.o2;
  if (axis === "pressure") return test.psi;
  return test.flowValue;
}

function findingText(item: CompareInvestigation, group: string): string {
  const texts = findingsFor(item, group).map((finding) => finding.text);
  return texts.length > 0 ? texts.join("\n") : MISSING;
}

function clean(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function lines(values: readonly string[]): string {
  const cleaned = clean(values);
  return cleaned.length > 0 ? cleaned.join("\n") : MISSING;
}

function blankToNull(value: string | null): string | null {
  const text = value?.trim();
  return text ? text : null;
}
