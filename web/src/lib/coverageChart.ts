/**
 * Marks for the oxygen-pressure coverage chart. A test that states both oxygen
 * and pressure is a point. An investigation with no such test is a rectangle
 * of the range it states. A missing end is left off the chart.
 */

import { label } from "./format";
import type { FuelPhase, GravityName, OutcomeName } from "./types";

export interface CoverageSource {
  id: string;
  acronym: string;
  fuel_phase: FuelPhase | null;
  gravity: GravityName | null;
  o2_percent_min: number | null;
  o2_percent_max: number | null;
  pressure_psi_min: number | null;
  pressure_psi_max: number | null;
  tests: {
    sample_id: string | null;
    o2_percent: number | null;
    pressure_psi: number | null;
    outcome: OutcomeName;
  }[];
}

export interface CoveragePoint {
  investigationId: string;
  acronym: string;
  fuelPhase: FuelPhase | null;
  o2: number;
  psi: number;
  /** One hover sentence: investigation, sample, conditions, outcome. */
  hover: string;
}

export interface CoverageBox {
  investigationId: string;
  acronym: string;
  fuelPhase: FuelPhase | null;
  o2Min: number;
  o2Max: number;
  psiMin: number;
  psiMax: number;
  hover: string;
}

export const FUEL_COLOR: Record<string, string> = {
  solid: "#1b3a8c",
  liquid: "#8a5a00",
  gas: "#2f6f4e",
  unstated: "#586474",
};

export function fuelKey(phase: FuelPhase | null): string {
  return phase === "solid" || phase === "liquid" || phase === "gas" ? phase : "unstated";
}

export function fuelLabel(phase: FuelPhase | null): string {
  return phase ? label(phase) : "Fuel not stated";
}

/** Short names for the habitat markers on the chart. */
export const HABITAT_SHORT: Record<string, string> = {
  earth_sea_level: "Earth",
  iss: "ISS",
  moon_base: "Moon base",
  moon_base_upper_pressure: "Moon upper",
  spacesuit: "Spacesuit",
  mars_habitat: "Mars",
};

export function buildCoverageMarks(records: readonly CoverageSource[]): { points: CoveragePoint[]; boxes: CoverageBox[] } {
  const points: CoveragePoint[] = [];
  const boxes: CoverageBox[] = [];
  for (const record of records) {
    const tests = record.tests.filter((test) => test.o2_percent !== null && test.pressure_psi !== null);
    if (tests.length > 0) {
      for (const test of tests) {
        const o2 = test.o2_percent as number;
        const psi = test.pressure_psi as number;
        const sample = test.sample_id?.trim() ? test.sample_id : "sample not stated";
        points.push({
          investigationId: record.id,
          acronym: record.acronym,
          fuelPhase: record.fuel_phase,
          o2,
          psi,
          hover: `${record.acronym} (${record.id})<br>Sample: ${sample}<br>${o2}% oxygen, ${psi} psi${
            record.gravity ? `, ${label(record.gravity)}` : ""
          }<br>Outcome: ${label(test.outcome)}`,
        });
      }
      continue;
    }
    const box = statedBox(record);
    if (box) boxes.push(box);
  }
  return { points, boxes };
}

function statedBox(record: CoverageSource): CoverageBox | null {
  const { o2_percent_min: o2Min, o2_percent_max: o2Max, pressure_psi_min: psiMin, pressure_psi_max: psiMax } = record;
  if (o2Min === null || o2Max === null || psiMin === null || psiMax === null) return null;
  const o2Low = Math.min(o2Min, o2Max);
  const o2High = Math.max(o2Min, o2Max);
  const psiLow = Math.min(psiMin, psiMax);
  const psiHigh = Math.max(psiMin, psiMax);
  return {
    investigationId: record.id,
    acronym: record.acronym,
    fuelPhase: record.fuel_phase,
    o2Min: o2Low,
    o2Max: o2High,
    psiMin: psiLow,
    psiMax: psiHigh,
    hover: `${record.acronym} (${record.id})<br>Stated range, no individual test gives both values<br>Oxygen ${o2Low} to ${o2High}%<br>Pressure ${psiLow} to ${psiHigh} psi<br>Fuel: ${fuelLabel(record.fuel_phase)}`,
  };
}
