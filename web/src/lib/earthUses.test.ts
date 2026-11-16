import { describe, expect, it } from "vitest";
import insightsJson from "../../../data/insights.json";
import { insightsForUse, isEarthCategory, otherEarthInsights } from "./earthUses";
import type { Insight } from "./types";

const insights = insightsJson as Insight[];

const source = {
  file_name: "overview/overview.md",
  title: "A report",
  url: "https://psi.nasa.gov/example",
  doi: null,
  page: 1,
};

function insight(partial: Partial<Insight> & Pick<Insight, "id" | "text" | "category">): Insight {
  return {
    title: partial.id,
    habitats: [],
    investigation_ids: ["PSI-25"],
    sources: [source],
    ...partial,
  };
}

describe("earth uses", () => {
  it("keeps only an earth tag", () => {
    expect(isEarthCategory("earth")).toBe(true);
    expect(isEarthCategory("detection")).toBe(false);
    expect(isEarthCategory(["suppression", "earth"])).toBe(true);
  });

  it("does not attach the dataset's earth insight to water mist, smoke, or gear", () => {
    expect(insightsForUse("water-mist", insights)).toEqual([]);
    expect(insightsForUse("smoke", insights)).toEqual([]);
    expect(insightsForUse("gear", insights)).toEqual([]);
    expect(otherEarthInsights(insights).map((item) => item.id)).toEqual(["bass-ii-models-on-earth"]);
  });

  it("leaves a detection insight off the smoke card", () => {
    const smoke = insight({
      id: "smoke",
      category: "detection",
      text: "An ionization smoke detector sees sub-micron particulate.",
    });
    expect(insightsForUse("smoke", [smoke])).toEqual([]);
  });

  it("attaches an earth insight only to the use its text names", () => {
    const mist = insight({
      id: "mist",
      category: "earth",
      text: "A fine water-mist extinguisher put the sample out.",
    });
    expect(insightsForUse("water-mist", [mist]).map((item) => item.id)).toEqual(["mist"]);
    expect(insightsForUse("smoke", [mist])).toEqual([]);
    expect(otherEarthInsights([mist])).toEqual([]);
  });

  it("drops an earth insight that has no source", () => {
    const bare = insight({ id: "bare", category: "earth", text: "Water mist worked.", sources: [] });
    expect(insightsForUse("water-mist", [bare])).toEqual([]);
  });
});
