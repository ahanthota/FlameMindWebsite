import { describe, expect, it } from "vitest";
import {
  atSameConditions,
  buildEvidence,
  buildMapData,
  buildTimeline,
  countOutcomes,
  deltaLabel,
  deltaSentence,
  domainPercent,
  niceTicks,
  parseYears,
  rangeDomain,
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

describe("range bars", () => {
  it("spans every stated value and places values along it", () => {
    const domain = rangeDomain([{ min: 10, max: 40 }, { min: null, max: null }, { min: 21, max: 21 }, { min: null, max: 85 }]);
    expect(domain).toEqual([10, 85]);
    expect(domainPercent(10, domain!)).toBe(0);
    expect(domainPercent(85, domain!)).toBe(100);
    expect(domainPercent(200, domain!)).toBe(100);
    expect(rangeDomain([{ min: 21, max: 21 }])).toBeNull();
    expect(rangeDomain([])).toBeNull();
  });
});

describe("timeline", () => {
  it("reads a year or a span of years, and nothing else", () => {
    expect(parseYears("1999-2025")).toEqual({ start: 1999, end: 2025 });
    expect(parseYears("2017")).toEqual({ start: 2017, end: 2017 });
    expect(parseYears("ongoing")).toBeNull();
    expect(parseYears(null)).toBeNull();
  });

  it("groups by hardware, earliest first, and lists records with no years", () => {
    const timeline = buildTimeline(
      [
        { id: "PSI-69", acronym: "FLEX", years: "2007-2016", hardware: "CIR" },
        { id: "PSI-26", acronym: "BASS", years: "2009-2013", hardware: "MSG" },
        { id: "PSI-102", acronym: "SAME", years: "2000-2009", hardware: "MSG" },
        { id: "PSI-106", acronym: "SLICE", years: null, hardware: null },
      ],
      (hardware) => hardware ?? "Not stated",
    );
    expect(timeline.groups.map((group) => [group.label, group.rows.map((row) => row.acronym)])).toEqual([
      ["MSG", ["SAME", "BASS"]],
      ["CIR", ["FLEX"]],
    ]);
    expect(timeline.undated).toEqual(["SLICE"]);
    expect([timeline.start, timeline.end]).toEqual([2000, 2016]);
  });
});

describe("buildEvidence", () => {
  const source = {
    ranges: {
      "PSI-25": { acronym: "BASS-II", o2: [13.6, 22.2] as [number, number], psi: [14.7, 14.7] as [number, number] },
      "PSI-26": { acronym: "BASS", o2: [21, 21] as [number, number], psi: null },
      "PSI-101": { acronym: "SAME-R", o2: null, psi: null },
    },
    tests: { "PSI-26-T3": [21, 14.7] as [number, number] },
  };

  it("places cited investigations by range and cited tests by their own values", () => {
    const evidence = buildEvidence(
      [
        { investigation_id: "PSI-25", test_ids: [] },
        { investigation_id: "PSI-26", test_ids: ["PSI-26-T3", "PSI-26-T9"] },
        { investigation_id: "PSI-101", test_ids: [] },
        { investigation_id: "PSI-25", test_ids: [] },
      ],
      source,
      { o2: 34, psi: 8 },
    );
    expect(evidence.rects.map((rect) => rect.label)).toEqual(["BASS-II"]);
    expect(evidence.points).toEqual([{ id: "PSI-26-T3", o2: 21, psi: 14.7 }]);
    expect(evidence.unplaced).toEqual(["SAME-R"]);
    expect(evidence.asked).toEqual({ o2: 34, psi: 8 });
  });

  it("has no asked point unless the question gave both oxygen and pressure", () => {
    expect(buildEvidence([], source, { o2: 34, psi: null }).asked).toBeNull();
    expect(buildEvidence([], source, null).asked).toBeNull();
  });
});
