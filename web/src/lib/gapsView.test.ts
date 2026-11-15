import { describe, expect, it } from "vitest";
import gapsJson from "../../../data/gaps.json";
import {
  binIndex,
  coveragePhrase,
  gravityStatus,
  groupHabitatReports,
  habitatsAtGravity,
  matchesAtmosphere,
} from "./gapsView";
import type { GapsFile, HabitatCoverage, NearestTested } from "./types";

const gaps = gapsJson as unknown as GapsFile;

function nearest(values: Partial<NearestTested> & Pick<NearestTested, "gravity">): NearestTested {
  return {
    investigation_id: "PSI-68",
    acronym: "FLEX-2",
    basis: "ranges",
    nearest_o2_percent: 34,
    nearest_pressure_psi: 8,
    delta_o2_percent: 0,
    delta_pressure_psi: 0,
    distance: 0,
    ...values,
  };
}

function report(values: Partial<HabitatCoverage>): HabitatCoverage {
  return {
    habitat_id: "moon_base",
    name: "Moon base / pressurized rover",
    o2_percent: 34,
    pressure_psi: 8,
    pressure_kpa: 55.16,
    gravity: "partial",
    assumed: false,
    on_grid: true,
    inside_tested: false,
    covering_investigation_ids: [],
    nearest_same_gravity: [],
    nearest_any_gravity: [nearest({ gravity: "microgravity" })],
    ...values,
  };
}

describe("gaps page rules", () => {
  it("states the partial-gravity grid as 0 of 238 cells", () => {
    const partial = gaps.grid.coverage.partial;
    expect(partial.covered_cells).toBe(0);
    expect(partial.total_cells).toBe(238);
    expect(coveragePhrase(partial.covered_cells, partial.total_cells)).toBe("0 of 238");
  });

  it("keeps a Moon-base atmosphere untested when only microgravity matches", () => {
    const moon = gaps.habitats.find((item) => item.habitat_id === "moon_base" && item.gravity === "partial");
    expect(moon?.inside_tested).toBe(false);
    expect(moon?.nearest_any_gravity[0]?.distance).toBe(0);
    expect(gravityStatus(report({}))).toBe(
      "Not tested in partial gravity. FLEX-2 reaches this oxygen and pressure in microgravity. That is a different gravity.",
    );
  });

  it("says the ISS cabin was tested in microgravity", () => {
    const iss = gaps.habitats.find((item) => item.habitat_id === "iss");
    expect(iss?.inside_tested).toBe(true);
    expect(iss && gravityStatus(iss)).toMatch(/^Tested in microgravity/);
  });

  it("says a spacesuit atmosphere was not tested when nothing matches", () => {
    const text = gravityStatus(
      report({
        habitat_id: "spacesuit",
        name: "Spacesuit",
        o2_percent: 100,
        pressure_psi: 4.3,
        gravity: "microgravity",
        nearest_any_gravity: [nearest({ gravity: "microgravity", delta_o2_percent: -60, delta_pressure_psi: 3.048, distance: 0.7387 })],
        nearest_same_gravity: [nearest({ gravity: "microgravity", delta_o2_percent: -60, delta_pressure_psi: 3.048, distance: 0.7387 })],
      }),
    );
    expect(text).toBe(
      "Not tested in microgravity. No investigation in this dataset covers 100% oxygen at 4.3 psi in microgravity.",
    );
  });

  it("orders habitats with the Moon base first and groups both spacesuit gravities", () => {
    const groups = groupHabitatReports(gaps.habitats);
    expect(groups.map((group) => group[0]?.habitat_id)).toEqual([
      "moon_base",
      "moon_base_upper_pressure",
      "spacesuit",
      "iss",
      "mars_habitat",
      "earth_sea_level",
    ]);
    expect(groups.find((group) => group[0]?.habitat_id === "spacesuit")).toHaveLength(2);
  });

  it("includes the top edge of the last oxygen and pressure bins", () => {
    const o2 = gaps.grid.o2_percent_edges;
    const psi = gaps.grid.pressure_psi_edges;
    expect(binIndex(o2, 100)).toBe(o2.length - 2);
    expect(binIndex(psi, 16)).toBe(psi.length - 2);
    expect(binIndex(o2, 14)).toBeNull();
    expect(matchesAtmosphere(nearest({ gravity: "microgravity", delta_o2_percent: 0, delta_pressure_psi: 0.2 }))).toBe(false);
  });

  it("puts ISS on the microgravity map and the Moon base on the partial-gravity map", () => {
    expect(habitatsAtGravity(gaps.habitats, "microgravity").map((item) => item.habitat_id)).toEqual([
      "iss",
      "spacesuit",
    ]);
    expect(habitatsAtGravity(gaps.habitats, "partial").map((item) => item.habitat_id)).toContain("moon_base");
    expect(habitatsAtGravity(gaps.habitats, "normal").map((item) => item.habitat_id)).toEqual(["earth_sea_level"]);
  });
});
