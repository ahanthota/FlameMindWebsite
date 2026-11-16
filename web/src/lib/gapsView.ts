/**
 * Display rules for the Gaps page. The numbers come from data/gaps.json.
 * A distance of 0 means the oxygen and pressure match a tested range. It does
 * not mean the habitat's gravity was tested.
 */

import { label } from "./format";
import type { GravityName, HabitatCoverage, NearestTested } from "./types";

/** Moon and suit first: that is the atmosphere story in the challenge brief. */
export const HABITAT_ORDER = [
  "moon_base",
  "moon_base_upper_pressure",
  "spacesuit",
  "iss",
  "mars_habitat",
  "earth_sea_level",
] as const;

export function coveragePhrase(covered: number, total: number): string {
  return `${covered.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`;
}

export function groupHabitatReports(reports: readonly HabitatCoverage[]): HabitatCoverage[][] {
  const groups = new Map<string, HabitatCoverage[]>();
  for (const report of reports) {
    const list = groups.get(report.habitat_id) ?? [];
    list.push(report);
    groups.set(report.habitat_id, list);
  }
  const known = HABITAT_ORDER.filter((id) => groups.has(id));
  const rest = [...groups.keys()].filter((id) => !known.includes(id as (typeof HABITAT_ORDER)[number]));
  return [...known, ...rest].map((id) => groups.get(id) ?? []);
}

export function matchesAtmosphere(item: NearestTested): boolean {
  return item.delta_o2_percent === 0 && item.delta_pressure_psi === 0;
}

/** Which oxygen-pressure bin a value falls in. The last bin includes its top edge. */
export function binIndex(edges: readonly number[], value: number): number | null {
  if (edges.length < 2) return null;
  for (let index = 0; index < edges.length - 1; index += 1) {
    const start = edges[index];
    const end = edges[index + 1];
    const last = index === edges.length - 2;
    if (value >= start && (value < end || (last && value <= end))) return index;
  }
  return null;
}

export function sameNeighbors(left: readonly NearestTested[], right: readonly NearestTested[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (item, index) =>
        item.investigation_id === right[index]?.investigation_id && item.gravity === right[index]?.gravity,
    )
  );
}

/**
 * One sentence a judge can read. Matching oxygen and pressure at another
 * gravity stays "not tested" at the habitat's gravity.
 */
const GRAVITY_PHRASE: Record<string, string> = {
  microgravity: "microgravity",
  partial: "partial gravity",
  normal: "normal gravity",
  simulated_partial: "simulated partial gravity",
};

export function gravityPhrase(gravity: string): string {
  return GRAVITY_PHRASE[gravity] ?? label(gravity);
}

export function gravityStatus(report: HabitatCoverage): string {
  const gravity = gravityPhrase(report.gravity);
  const atmosphere = `${formatCount(report.o2_percent)}% oxygen at ${formatCount(report.pressure_psi)} psi`;
  if (!report.on_grid) {
    return `${atmosphere} falls outside the oxygen and pressure grid, so this page cannot say whether it was tested in ${gravity}.`;
  }
  if (report.inside_tested) {
    return `Tested in ${gravity}. An investigation in this dataset covers ${atmosphere} in ${gravity}.`;
  }
  const match = report.nearest_any_gravity.find(
    (item) => matchesAtmosphere(item) && item.gravity !== report.gravity,
  );
  if (match) {
    const name = match.acronym || match.investigation_id;
    return `Not tested in ${gravity}. ${name} reaches this oxygen and pressure in ${gravityPhrase(match.gravity)}. That is a different gravity.`;
  }
  return `Not tested in ${gravity}. No investigation in this dataset covers ${atmosphere} in ${gravity}.`;
}

function formatCount(value: number): string {
  return String(Number(value.toFixed(3)));
}

export interface HabitatGapRank {
  /** Oxygen band the habitats fall in. Null when the atmosphere is off the grid. */
  o2Min: number | null;
  o2Max: number | null;
  psiMin: number | null;
  psiMax: number | null;
  offGrid: boolean;
  habitatCount: number;
  habitats: { id: string; name: string }[];
  gravities: GravityName[];
}

/**
 * Untested habitat atmospheres, grouped by the oxygen-pressure cell they fall
 * in, most habitats first. A tested atmosphere is not a gap.
 */
export function rankHabitatGaps(
  reports: readonly HabitatCoverage[],
  o2Edges: readonly number[],
  psiEdges: readonly number[],
): HabitatGapRank[] {
  const groups = new Map<string, HabitatGapRank>();
  for (const report of reports) {
    if (report.inside_tested) continue;
    const o2Bin = binIndex(o2Edges, report.o2_percent);
    const psiBin = binIndex(psiEdges, report.pressure_psi);
    const offGrid = o2Bin === null || psiBin === null;
    const key = offGrid
      ? `off:${report.o2_percent}:${report.pressure_psi}`
      : `${o2Edges[o2Bin]}:${psiEdges[psiBin]}`;
    const group = groups.get(key) ?? {
      o2Min: offGrid ? null : o2Edges[o2Bin],
      o2Max: offGrid ? null : o2Edges[o2Bin + 1],
      psiMin: offGrid ? null : psiEdges[psiBin],
      psiMax: offGrid ? null : psiEdges[psiBin + 1],
      offGrid,
      habitatCount: 0,
      habitats: [],
      gravities: [],
    };
    if (!group.habitats.some((item) => item.id === report.habitat_id)) {
      group.habitats.push({ id: report.habitat_id, name: report.name });
      group.habitatCount = group.habitats.length;
    }
    if (!group.gravities.includes(report.gravity)) group.gravities.push(report.gravity);
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) => b.habitatCount - a.habitatCount || (a.o2Min ?? 999) - (b.o2Min ?? 999) || (a.psiMin ?? 999) - (b.psiMin ?? 999),
  );
}

export function habitatsAtGravity(
  reports: readonly HabitatCoverage[],
  gravity: GravityName,
): HabitatCoverage[] {
  const seen = new Set<string>();
  return reports.filter((report) => {
    if (report.gravity !== gravity || seen.has(report.habitat_id)) return false;
    seen.add(report.habitat_id);
    return true;
  });
}
