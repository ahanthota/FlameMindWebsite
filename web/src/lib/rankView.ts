/**
 * Habitat choices for the Rank page. Scoring is rank.ts, the same function
 * the chat API uses. A habitat sets oxygen, pressure, and gravity when the
 * preset has one gravity class. Materials and airflow are not set.
 */

import { formatNumber } from "./format";
import { rank, WEIGHTS, type AxisName, type PartName, type Ranked } from "./rank";
import type { Habitat, Investigation } from "./types";

export const PART_LABEL: Record<PartName, string> = {
  conditions: "Conditions",
  materials: "Materials",
  intent: "Intent",
  airflow: "Airflow",
};

const PART_ORDER: readonly PartName[] = ["conditions", "materials", "intent", "airflow"];

/** The habitats a visitor can rank. Rover shares the Moon base atmosphere. */
export const RANK_CHOICES: readonly { id: string; habitatId: string; label: string }[] = [
  { id: "iss", habitatId: "iss", label: "ISS" },
  { id: "moon_base", habitatId: "moon_base", label: "Moon base" },
  { id: "rover", habitatId: "moon_base", label: "Pressurized rover" },
  { id: "moon_base_upper_pressure", habitatId: "moon_base_upper_pressure", label: "Moon base upper pressure" },
  { id: "spacesuit", habitatId: "spacesuit", label: "Spacesuit" },
  { id: "mars_habitat", habitatId: "mars_habitat", label: "Mars" },
  { id: "earth_sea_level", habitatId: "earth_sea_level", label: "Earth" },
];

export interface RankTestView {
  testId: string;
  sampleId: string | null;
  closeness: number;
  o2Percent: number | null;
  pressurePsi: number | null;
  flowCmS: number | null;
}

export interface RankPartView {
  name: PartName;
  label: string;
  value: number;
  weight: number;
}

export interface RankedRow {
  id: string;
  acronym: string;
  name: string;
  needsReview: boolean;
  score: number;
  parts: RankPartView[];
  /** Oxygen, pressure, and airflow closeness behind the combined parts. */
  axes: Partial<Record<AxisName, number>>;
  reasons: string[];
  tests: RankTestView[];
}

export interface ScoreSlice {
  key: string;
  label: string;
  /** Points this slice adds to the 0–1 score. The slices add up to the score. */
  points: number;
}

export interface RankHabitatView {
  id: string;
  label: string;
  habitatName: string;
  o2Percent: number;
  pressurePsi: number;
  gravityG: number | null;
  /** Gravity sent to the ranker. Null when the preset covers more than one class. */
  gravityApplied: string | null;
  gravityClasses: string[];
  assumed: boolean;
  sourceNote: string;
  /** Another choice with the same order and scores, usually because the atmosphere matches. */
  matchesLabel: string | null;
  /** Shown once when every investigation shares the same gravity note. */
  gravityNote: string | null;
  ranked: RankedRow[];
}

export function buildRankViews(habitats: readonly Habitat[], investigations: readonly Investigation[]): RankHabitatView[] {
  const byId = new Map(habitats.map((habitat) => [habitat.id, habitat]));
  const names = new Map(investigations.map((item) => [item.id, item]));
  const views: RankHabitatView[] = [];
  const seen = new Map<string, string>();

  for (const choice of RANK_CHOICES) {
    const habitat = byId.get(choice.habitatId);
    if (!habitat) continue;
    const gravityApplied = habitat.gravity_classes.length === 1 ? habitat.gravity_classes[0] : null;
    const ranked = rank(
      investigations,
      {
        o2_percent: habitat.o2_percent,
        pressure_psi: habitat.pressure_psi,
        gravity: gravityApplied,
        materials: [],
      },
      "find_data",
    );
    const gravityNote = sharedGravityNote(ranked);
    const rows = ranked.map((item) => toRow(item, names.get(item.investigationId), gravityNote));
    const signature = rows.map((row) => `${row.id}:${row.score}`).join("|");
    const view: RankHabitatView = {
      id: choice.id,
      label: choice.label,
      habitatName: habitat.name,
      o2Percent: habitat.o2_percent,
      pressurePsi: habitat.pressure_psi,
      gravityG: habitat.gravity_g,
      gravityApplied,
      gravityClasses: habitat.gravity_classes,
      assumed: habitat.assumed,
      sourceNote: habitat.source_note,
      matchesLabel: seen.get(signature) ?? null,
      gravityNote,
      ranked: rows,
    };
    if (!seen.has(signature)) seen.set(signature, choice.label);
    views.push(view);
  }
  return views;
}

export function atmosphereLine(view: RankHabitatView): string {
  const bits = [`${formatNumber(view.o2Percent)}% oxygen`, `${formatNumber(view.pressurePsi)} psi`];
  if (view.gravityG !== null) bits.push(`${formatNumber(view.gravityG)} g`);
  bits.push(gravityText(view));
  return bits.join(" · ");
}

/** Score as a percent. 0.9077 displays as 90.77%. */
export function formatScore(score: number): string {
  return `${(score * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

/**
 * The score split into the pieces that add up to it. Oxygen and pressure are
 * shown apart, each taking an equal share of the conditions weight. Gravity
 * is not a slice: the ranker records it and leaves the score unchanged.
 */
export function scoreSlices(row: Pick<RankedRow, "parts" | "axes">): ScoreSlice[] {
  const weight = row.parts.reduce((sum, part) => sum + part.weight, 0);
  if (weight === 0) return [];
  const slices: ScoreSlice[] = [];
  for (const part of row.parts) {
    if (part.name === "conditions") {
      const oxygen = row.axes.o2_percent;
      const pressure = row.axes.pressure_psi;
      const count = [oxygen, pressure].filter((value) => value !== undefined).length || 1;
      if (oxygen !== undefined) slices.push({ key: "oxygen", label: "Oxygen", points: (oxygen * part.weight) / count / weight });
      if (pressure !== undefined) slices.push({ key: "pressure", label: "Pressure", points: (pressure * part.weight) / count / weight });
      if (oxygen === undefined && pressure === undefined) {
        slices.push({ key: "conditions", label: part.label, points: (part.value * part.weight) / weight });
      }
    } else if (part.name === "airflow") {
      slices.push({ key: "airflow", label: "Airflow", points: ((row.axes.flow_cm_s ?? part.value) * part.weight) / weight });
    } else {
      slices.push({ key: part.name, label: part.label, points: (part.value * part.weight) / weight });
    }
  }
  return slices;
}

/** This part's weight divided by the weights of the parts that were scored. */
export function partShare(part: RankPartView, parts: readonly RankPartView[]): number {
  const total = parts.reduce((sum, item) => sum + item.weight, 0);
  return total === 0 ? 0 : part.weight / total;
}

function toRow(item: Ranked, record: Investigation | undefined, gravityNote: string | null): RankedRow {
  return {
    id: item.investigationId,
    acronym: record?.acronym ?? item.investigationId,
    name: record?.name ?? "",
    needsReview: record?.needs_review ?? false,
    score: item.score,
    parts: PART_ORDER.filter((name) => item.parts[name] !== undefined).map((name) => ({
      name,
      label: PART_LABEL[name],
      value: item.parts[name] as number,
      weight: WEIGHTS[name],
    })),
    axes: item.axes,
    reasons: gravityNote ? item.reasons.filter((text) => text !== gravityNote) : item.reasons,
    tests: item.tests.map((test) => ({
      testId: test.testId,
      sampleId: test.sampleId,
      closeness: test.closeness,
      o2Percent: test.values.o2_percent ?? null,
      pressurePsi: test.values.pressure_psi ?? null,
      flowCmS: test.values.flow_cm_s ?? null,
    })),
  };
}

function sharedGravityNote(ranked: readonly Ranked[]): string | null {
  const notes = ranked.map((item) => item.reasons.find((text) => text.startsWith("Run in ")) ?? null);
  const first = notes[0];
  if (!first || notes.some((note) => note !== first)) return null;
  return first;
}

function gravityText(view: RankHabitatView): string {
  if (view.gravityApplied === "microgravity") return "Microgravity";
  if (view.gravityApplied === "partial") return "Partial gravity";
  if (view.gravityApplied === "normal") return "Normal gravity";
  if (view.gravityApplied === "simulated_partial") return "Simulated partial gravity";
  if (view.gravityClasses.length > 1) return "Microgravity and partial gravity";
  return "Gravity not set";
}
