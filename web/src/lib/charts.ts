/**
 * Data preparation for the charts. Pure functions: no React, no I/O.
 * Charts only draw values the data states. Nothing is estimated.
 */

import { formatNumber } from "./format";
import { gravityPhrase, gravityStatus, groupHabitatReports, HABITAT_ORDER } from "./gapsView";
import type { GapsFile, OutcomeName } from "./types";

// ---------- coverage map ----------

export interface MapNearest {
  investigationId: string;
  acronym: string;
  /** Gravity the nearest test was run in, as a phrase. */
  gravity: string;
  o2: number;
  psi: number;
  /** Nearest tested value minus the habitat's value. */
  deltaO2: number;
  deltaPsi: number;
  distance: number;
}

export interface MapHabitat {
  id: string;
  /** The number the Gaps page uses for this habitat. */
  marker: string;
  name: string;
  o2: number;
  psi: number;
  onGrid: boolean;
  /** True only when a test covers this atmosphere at the habitat's own gravity. */
  tested: boolean;
  /** One sentence per gravity the habitat is defined at. */
  statuses: string[];
  /** The closest tested oxygen and pressure at any gravity. */
  nearest: MapNearest | null;
}

export interface MapData {
  o2Edges: number[];
  psiEdges: number[];
  /** Cells with a test at any gravity, by their lower edges. */
  covered: { o2Min: number; psiMin: number }[];
  /** Cells in one gravity's grid. */
  cellCount: number;
  /** Gravities that have at least one tested cell, as phrases. */
  coveredGravities: string[];
  habitats: MapHabitat[];
}

export function habitatMarker(id: string): string {
  const index = (HABITAT_ORDER as readonly string[]).indexOf(id);
  return index >= 0 ? String(index + 1) : id;
}

/** What the coverage map draws, from data/gaps.json. */
export function buildMapData(gaps: GapsFile): MapData {
  const covered = new Map<string, { o2Min: number; psiMin: number }>();
  const gravities = new Set<string>();
  for (const cell of gaps.grid.cells) {
    if (!cell.covered) continue;
    covered.set(`${cell.o2_min}:${cell.psi_min}`, { o2Min: cell.o2_min, psiMin: cell.psi_min });
    gravities.add(gravityPhrase(cell.gravity));
  }
  const habitats = groupHabitatReports(gaps.habitats).map((reports): MapHabitat => {
    const first = reports[0];
    const closest = [...first.nearest_any_gravity].sort((a, b) => a.distance - b.distance)[0];
    return {
      id: first.habitat_id,
      marker: habitatMarker(first.habitat_id),
      name: first.name,
      o2: first.o2_percent,
      psi: first.pressure_psi,
      onGrid: first.on_grid,
      tested: reports.every((report) => report.inside_tested),
      statuses: reports.map(gravityStatus),
      nearest: closest
        ? {
            investigationId: closest.investigation_id,
            acronym: closest.acronym || closest.investigation_id,
            gravity: gravityPhrase(closest.gravity),
            o2: closest.nearest_o2_percent,
            psi: closest.nearest_pressure_psi,
            deltaO2: closest.delta_o2_percent,
            deltaPsi: closest.delta_pressure_psi,
            distance: closest.distance,
          }
        : null,
    };
  });
  return {
    o2Edges: gaps.grid.o2_percent_edges,
    psiEdges: gaps.grid.pressure_psi_edges,
    covered: [...covered.values()],
    cellCount: Math.max(gaps.grid.o2_percent_edges.length - 1, 0) * Math.max(gaps.grid.pressure_psi_edges.length - 1, 0),
    coveredGravities: [...gravities],
    habitats,
  };
}

/** Differences smaller than this are rounding, not a gap. */
const SAME = 0.05;

/** Map text uses one decimal: the map cannot show more. The tables below it give the stored values. */
export function oneDecimal(value: number): string {
  return formatNumber(Math.round(value * 10) / 10);
}

/** True when the nearest tested point has the habitat's oxygen and pressure. */
export function atSameConditions(nearest: MapNearest): boolean {
  return Math.abs(nearest.deltaO2) < SAME && Math.abs(nearest.deltaPsi) < SAME;
}

/** Short label for the line on the map: "−15% O2, +3.7 psi". */
export function deltaLabel(nearest: MapNearest): string {
  const signed = (value: number) => `${value > 0 ? "+" : "−"}${oneDecimal(Math.abs(value))}`;
  const parts: string[] = [];
  if (Math.abs(nearest.deltaO2) >= SAME) parts.push(`${signed(nearest.deltaO2)}% O2`);
  if (Math.abs(nearest.deltaPsi) >= SAME) parts.push(`${signed(nearest.deltaPsi)} psi`);
  return parts.join(", ");
}

/** The same difference as a sentence fragment: "15 points lower in oxygen and 3.7 psi higher in pressure". */
export function deltaSentence(nearest: MapNearest): string {
  const parts: string[] = [];
  if (Math.abs(nearest.deltaO2) >= SAME) {
    const size = oneDecimal(Math.abs(nearest.deltaO2));
    parts.push(`${size} ${size === "1" ? "point" : "points"} ${nearest.deltaO2 > 0 ? "higher" : "lower"} in oxygen`);
  }
  if (Math.abs(nearest.deltaPsi) >= SAME) {
    parts.push(`${oneDecimal(Math.abs(nearest.deltaPsi))} psi ${nearest.deltaPsi > 0 ? "higher" : "lower"} in pressure`);
  }
  return parts.join(" and ");
}

// ---------- outcomes ----------

/** Fixed order and colors: a color belongs to an outcome, never to its rank. */
export const OUTCOME_SERIES: readonly { key: OutcomeName; label: string; color: string }[] = [
  { key: "extinguished", label: "Extinguished", color: "#2a78d6" },
  { key: "ignited", label: "Ignited", color: "#eb6834" },
  { key: "steady", label: "Steady", color: "#1baf7a" },
  { key: "no_ignition", label: "No ignition", color: "#eda100" },
  { key: "unknown", label: "Not stated", color: "#c3c8cf" },
];

export type OutcomeCounts = Record<OutcomeName, number>;

export function countOutcomes(outcomes: readonly OutcomeName[]): OutcomeCounts {
  const counts: OutcomeCounts = { extinguished: 0, ignited: 0, steady: 0, no_ignition: 0, unknown: 0 };
  for (const outcome of outcomes) counts[outcome] = (counts[outcome] ?? 0) + 1;
  return counts;
}

/** Tests whose outcome the sources state. */
export function statedOutcomes(counts: OutcomeCounts): number {
  return counts.extinguished + counts.ignited + counts.steady + counts.no_ignition;
}

/** "12 extinguished, 8 ignited, 119 not stated". Empty when there are no tests. */
export function outcomeSummary(counts: OutcomeCounts): string {
  return OUTCOME_SERIES.filter((series) => counts[series.key] > 0)
    .map((series) => `${counts[series.key]} ${series.label.toLowerCase()}`)
    .join(", ");
}

// ---------- axes and color ----------

/** Round axis steps (1, 2, or 5 times a power of ten) from 0 to at least `max`. */
export function niceTicks(max: number, target = 5): number[] {
  if (!(max > 0)) return [0, 1];
  const rough = max / target;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((factor) => factor * power).find((value) => value >= rough) ?? 10 * power;
  const ticks: number[] = [];
  for (let index = 0; index * step < max + step - 1e-9; index += 1) {
    ticks.push(Number((index * step).toPrecision(12)));
  }
  return ticks;
}

/** One hue, light to dark: a higher value is a darker blue. */
const RAMP = ["#86b6ef", "#3987e5", "#1c5cab", "#0d366b"];

/** The ramp color for `value` within [min, max]. A single-valued range uses the middle of the ramp. */
export function rampColor(value: number, min: number, max: number): string {
  const position = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0.5;
  const scaled = position * (RAMP.length - 1);
  const index = Math.min(Math.floor(scaled), RAMP.length - 2);
  const mix = scaled - index;
  const channel = (hex: string, offset: number) => parseInt(hex.slice(offset, offset + 2), 16);
  return `#${[1, 3, 5]
    .map((offset) =>
      Math.round(channel(RAMP[index], offset) * (1 - mix) + channel(RAMP[index + 1], offset) * mix)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export const RAMP_GRADIENT = `linear-gradient(to right, ${RAMP.join(", ")})`;

// ---------- range bars ----------

/** The lowest and highest value any row states, so every bar in a column shares one scale. */
export function rangeDomain(ranges: readonly { min: number | null; max: number | null }[]): [number, number] | null {
  const values = ranges.flatMap((range) => [range.min, range.max]).filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  return high > low ? [low, high] : null;
}

/** Position of `value` along the domain, as a percentage clamped to the track. */
export function domainPercent(value: number, domain: readonly [number, number]): number {
  return Math.min(100, Math.max(0, ((value - domain[0]) / (domain[1] - domain[0])) * 100));
}

// ---------- timeline ----------

/** "1999-2025" or "2017" as years. Anything else is not placed on the timeline. */
export function parseYears(text: string | null): { start: number; end: number } | null {
  const years = (text ?? "").match(/\b(19|20)\d{2}\b/g)?.map(Number) ?? [];
  if (years.length === 0) return null;
  return { start: Math.min(...years), end: Math.max(...years) };
}

export interface TimelineRow {
  id: string;
  acronym: string;
  start: number;
  end: number;
}

export interface Timeline {
  /** One group per hardware, the earliest first. */
  groups: { label: string; rows: TimelineRow[] }[];
  /** Investigations whose record states no years. */
  undated: string[];
  start: number;
  end: number;
}

export function buildTimeline(
  items: readonly { id: string; acronym: string; years: string | null; hardware: string | null }[],
  hardwareLabel: (hardware: string | null) => string,
): Timeline {
  const groups = new Map<string, TimelineRow[]>();
  const undated: string[] = [];
  for (const item of items) {
    const years = parseYears(item.years);
    if (!years) {
      undated.push(item.acronym);
      continue;
    }
    const key = hardwareLabel(item.hardware);
    groups.set(key, [...(groups.get(key) ?? []), { id: item.id, acronym: item.acronym, ...years }]);
  }
  const sorted = [...groups.entries()]
    .map(([label, rows]) => ({ label, rows: [...rows].sort((a, b) => a.start - b.start || a.end - b.end) }))
    .sort((a, b) => a.rows[0].start - b.rows[0].start || a.label.localeCompare(b.label));
  const all = sorted.flatMap((group) => group.rows);
  return {
    groups: sorted,
    undated,
    start: all.length > 0 ? Math.min(...all.map((row) => row.start)) : 0,
    end: all.length > 0 ? Math.max(...all.map((row) => row.end)) : 0,
  };
}

// ---------- evidence on the coverage map ----------

/** What the chat page knows about each investigation and test, for placing cited evidence. */
export interface EvidenceSource {
  /** Stated oxygen and pressure range per investigation id. */
  ranges: Record<string, { acronym: string; o2: [number, number] | null; psi: [number, number] | null }>;
  /** Oxygen and pressure per test id, for tests that state both. */
  tests: Record<string, [number, number]>;
}

export interface MapEvidence {
  /** Cited investigations, as their stated oxygen and pressure range. */
  rects: { id: string; label: string; o2: [number, number]; psi: [number, number] }[];
  /** Cited tests that state both oxygen and pressure. */
  points: { id: string; o2: number; psi: number }[];
  /** The atmosphere in the question, when it gave both values. */
  asked: { o2: number; psi: number } | null;
  /** Cited investigations that state no oxygen and pressure to place. */
  unplaced: string[];
}

export function buildEvidence(
  cited: readonly { investigation_id: string; test_ids: readonly string[] }[],
  source: EvidenceSource,
  asked: { o2: number | null; psi: number | null } | null,
): MapEvidence {
  const rects: MapEvidence["rects"] = [];
  const points: MapEvidence["points"] = [];
  const unplaced: string[] = [];
  const seen = new Set<string>();
  for (const item of cited) {
    const before = points.length;
    for (const testId of item.test_ids) {
      const point = source.tests[testId];
      if (point && !points.some((existing) => existing.id === testId)) points.push({ id: testId, o2: point[0], psi: point[1] });
    }
    if (seen.has(item.investigation_id)) continue;
    seen.add(item.investigation_id);
    const range = source.ranges[item.investigation_id];
    if (range?.o2 && range.psi) {
      rects.push({ id: item.investigation_id, label: range.acronym, o2: range.o2, psi: range.psi });
    } else if (points.length === before) {
      unplaced.push(range?.acronym ?? item.investigation_id);
    }
  }
  return {
    rects,
    points,
    asked: asked && asked.o2 !== null && asked.psi !== null ? { o2: asked.o2, psi: asked.psi } : null,
    unplaced,
  };
}
