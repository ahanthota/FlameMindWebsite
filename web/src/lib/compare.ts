/**
 * Side-by-side values for the structured investigations. Missing values stay
 * an en dash. Nothing here estimates a number the record does not state.
 */

import { formatRange, label, MISSING } from "./format";
import type { Investigation } from "./types";

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
  varied: string[];
  fixed: string[];
  sensors: string[];
  findings: CompareFinding[];
}

export const COMPARE_ROWS = [
  { id: "objectives", label: "Objectives" },
  { id: "fuels", label: "Fuels" },
  { id: "sampleShape", label: "Sample shape" },
  { id: "sampleSize", label: "Sample size" },
  { id: "oxygen", label: "Oxygen (%)" },
  { id: "pressure", label: "Pressure (psi)" },
  { id: "airflow", label: "Airflow (cm/s)" },
  { id: "hardware", label: "Hardware" },
  { id: "varied", label: "What varied" },
  { id: "fixed", label: "What stayed fixed" },
  { id: "sensors", label: "Sensors" },
  { id: "findings", label: "Findings" },
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
    varied: clean(item.variables_varied),
    fixed: clean(item.variables_fixed),
    sensors: clean(item.sensors),
    findings,
  };
}

/** Text used both for display of scalar rows and for "does this row differ?". */
export function rowValue(id: CompareRowId, item: CompareInvestigation): string {
  switch (id) {
    case "objectives":
      return lines(item.objectives);
    case "fuels":
      return lines([item.fuelPhase ? label(item.fuelPhase) : "", ...item.fuels]);
    case "sampleShape":
      return item.sampleGeometry ?? MISSING;
    case "sampleSize":
      return item.sampleSize ?? MISSING;
    case "oxygen":
      return formatRange(item.o2Min, item.o2Max);
    case "pressure":
      return formatRange(item.pressureMin, item.pressureMax);
    case "airflow":
      return formatRange(item.flowMin, item.flowMax);
    case "hardware":
      return label(item.hardware);
    case "varied":
      return lines(item.varied);
    case "fixed":
      return lines(item.fixed);
    case "sensors":
      return lines(item.sensors);
    case "findings":
      return item.findings.length === 0 ? MISSING : item.findings.map((finding) => `${finding.group}: ${finding.text}`).join("\n");
  }
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
