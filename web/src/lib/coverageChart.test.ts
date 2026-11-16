import { describe, expect, it } from "vitest";
import { buildCoverageMarks, type CoverageSource } from "./coverageChart";

function record(values: Partial<CoverageSource> & Pick<CoverageSource, "id">): CoverageSource {
  return {
    acronym: values.id,
    fuel_phase: "solid",
    gravity: "microgravity",
    o2_percent_min: null,
    o2_percent_max: null,
    pressure_psi_min: null,
    pressure_psi_max: null,
    tests: [],
    ...values,
  };
}

describe("buildCoverageMarks", () => {
  it("plots a test that states oxygen and pressure, and skips the range", () => {
    const marks = buildCoverageMarks([
      record({
        id: "PSI-25",
        acronym: "BASS-II",
        o2_percent_min: 13.6,
        o2_percent_max: 22.2,
        pressure_psi_min: 14.7,
        pressure_psi_max: 14.7,
        tests: [
          { sample_id: "A1", o2_percent: 21, pressure_psi: 14.7, outcome: "ignited" },
          { sample_id: null, o2_percent: 18, pressure_psi: null, outcome: "unknown" },
        ],
      }),
    ]);
    expect(marks.boxes).toEqual([]);
    expect(marks.points).toHaveLength(1);
    expect(marks.points[0]).toMatchObject({ acronym: "BASS-II", o2: 21, psi: 14.7 });
    expect(marks.points[0].hover).toContain("Sample: A1");
    expect(marks.points[0].hover).toContain("Outcome: Ignited");
  });

  it("draws the stated range when no test states both values", () => {
    const marks = buildCoverageMarks([
      record({
        id: "PSI-68",
        acronym: "FLEX-2",
        fuel_phase: "liquid",
        o2_percent_min: 10,
        o2_percent_max: 40,
        pressure_psi_min: 7,
        pressure_psi_max: 44,
      }),
    ]);
    expect(marks.points).toEqual([]);
    expect(marks.boxes[0]).toMatchObject({ acronym: "FLEX-2", o2Min: 10, o2Max: 40, psiMin: 7, psiMax: 44 });
  });

  it("leaves out a range that is missing an end", () => {
    const marks = buildCoverageMarks([
      record({
        id: "PSI-99",
        o2_percent_min: 21,
        o2_percent_max: 22,
        pressure_psi_min: null,
        pressure_psi_max: null,
      }),
    ]);
    expect(marks.points).toEqual([]);
    expect(marks.boxes).toEqual([]);
  });
});
