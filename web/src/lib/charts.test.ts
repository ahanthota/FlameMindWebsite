import { describe, expect, it } from "vitest";
import {
  atSameConditions,
  buildMapData,
  countOutcomes,
  deltaLabel,
  deltaSentence,
  niceTicks,
  outcomeSummary,
  rampColor,
  statedOutcomes,
  type MapNearest,
} from "./charts";
import type { GapsFile, HabitatCoverage, NearestTested } from "./types";

function neighbor(values: Partial<NearestTested>): NearestTested {
  return {
    investigation_id: "PSI-68",
    acronym: "FLEX-2",
    gravity: "microgravity",
    basis: "ranges",
    nearest_o2_percent: 34,
    nearest_pressure_psi: 8,
    delta_o2_percent: 0,
    delta_pressure_psi: 0,
    distance: 0,
    ...values,
  };
}

function habitat(values: Partial<HabitatCoverage>): HabitatCoverage {
  return {
    habitat_id: "moon_base",
    name: "Moon base",
    o2_percent: 34,
    pressure_psi: 8,
    pressure_kpa: 55.2,
    gravity: "partial",
    assumed: false,
    on_grid: true,
    inside_tested: false,
    covering_investigation_ids: [],
    nearest_same_gravity: [],
    nearest_any_gravity: [],
    ...values,
  };
}

const GAPS: GapsFile = {
  source: "test",
  investigation_count: 2,
  grid: {
    o2_percent_edges: [15, 20, 25],
    pressure_psi_edges: [2, 3, 4, 5],
    gravity_classes: ["microgravity", "partial"],
    distance_note: "",
    coverage: {},
    cells: [
      { gravity: "microgravity", o2_min: 15, o2_max: 20, psi_min: 2, psi_max: 3, covered: true, investigation_ids: ["PSI-68"] },
      { gravity: "microgravity", o2_min: 20, o2_max: 25, psi_min: 2, psi_max: 3, covered: false, investigation_ids: [] },
      { gravity: "partial", o2_min: 15, o2_max: 20, psi_min: 2, psi_max: 3, covered: false, investigation_ids: [] },
    ],
  },
  placements: [],
  unplaced: [],
  habitats: [
    habitat({
      habitat_id: "spacesuit",
      name: "Spacesuit",
      o2_percent: 100,
      pressure_psi: 4.3,
      gravity: "microgravity",
      nearest_any_gravity: [
        neighbor({ acronym: "FLEX-2", nearest_o2_percent: 40, delta_o2_percent: -60, delta_pressure_psi: 3.048, distance: 0.739 }),
        neighbor({ investigation_id: "PSI-21", acronym: "CFI-G", nearest_o2_percent: 85, nearest_pressure_psi: 8.001, delta_o2_percent: -15, delta_pressure_psi: 3.701, distance: 0.318 }),
      ],
    }),
    habitat({ habitat_id: "spacesuit", name: "Spacesuit", o2_percent: 100, pressure_psi: 4.3, gravity: "partial" }),
    habitat({ nearest_any_gravity: [neighbor({})] }),
    habitat({ habitat_id: "iss", name: "ISS", o2_percent: 21, pressure_psi: 14.7, gravity: "microgravity", inside_tested: true }),
  ],
  gaps: [],
};

describe("buildMapData", () => {
  const map = buildMapData(GAPS);

  it("lists the cells that have a test and the gravities they were tested in", () => {
    expect(map.covered).toEqual([{ o2Min: 15, psiMin: 2 }]);
    expect(map.cellCount).toBe(6);
    expect(map.coveredGravities).toEqual(["microgravity"]);
  });

  it("makes one habitat per id, in the Gaps page order, with its marker", () => {
    expect(map.habitats.map((item) => [item.marker, item.id])).toEqual([
      ["1", "moon_base"],
      ["3", "spacesuit"],
      ["4", "iss"],
    ]);
    expect(map.habitats[1].statuses).toHaveLength(2);
  });

  it("counts a habitat as tested only when every gravity it is defined at is covered", () => {
    expect(map.habitats.map((item) => item.tested)).toEqual([false, false, true]);
  });

  it("takes the closest tested point, whatever order the file lists them in", () => {
    expect(map.habitats[1].nearest).toMatchObject({ acronym: "CFI-G", o2: 85, deltaO2: -15, gravity: "microgravity" });
    expect(map.habitats[2].nearest).toBeNull();
  });
});

describe("difference text", () => {
  const far: MapNearest = { investigationId: "PSI-21", acronym: "CFI-G", gravity: "microgravity", o2: 85, psi: 8.001, deltaO2: -15, deltaPsi: 3.701, distance: 0.318 };
  const same: MapNearest = { ...far, deltaO2: 0, deltaPsi: -0.004, distance: 0 };

  it("states each difference with its direction", () => {
    expect(deltaLabel(far)).toBe("−15% O2, +3.7 psi");
    expect(deltaSentence(far)).toBe("15 points lower in oxygen and 3.7 psi higher in pressure");
    expect(deltaSentence({ ...far, deltaO2: 1, deltaPsi: 0 })).toBe("1 point higher in oxygen");
  });

  it("treats a rounding-sized difference as the same conditions", () => {
    expect(atSameConditions(same)).toBe(true);
    expect(atSameConditions(far)).toBe(false);
    expect(deltaLabel(same)).toBe("");
  });
});

describe("outcomes", () => {
  it("counts each outcome and reports how many are stated", () => {
    const counts = countOutcomes(["ignited", "ignited", "extinguished", "unknown", "unknown", "unknown"]);
    expect(counts).toEqual({ extinguished: 1, ignited: 2, steady: 0, no_ignition: 0, unknown: 3 });
    expect(statedOutcomes(counts)).toBe(3);
    expect(outcomeSummary(counts)).toBe("1 extinguished, 2 ignited, 3 not stated");
    expect(outcomeSummary(countOutcomes([]))).toBe("");
  });
});

describe("axes and color", () => {
  it("picks round steps that reach the largest value", () => {
    expect(niceTicks(20)).toEqual([0, 5, 10, 15, 20]);
    expect(niceTicks(2.6)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(0.012)).toEqual([0, 0.005, 0.01, 0.015]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });

  it("runs light to dark and handles a single-valued range", () => {
    expect(rampColor(18, 18, 22)).toBe("#86b6ef");
    expect(rampColor(22, 18, 22)).toBe("#0d366b");
    expect(rampColor(30, 18, 22)).toBe("#0d366b");
    expect(rampColor(21, 21, 21)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
