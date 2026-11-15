import { describe, expect, it } from "vitest";
import habitatsJson from "../../../data/habitats.json";
import investigationsJson from "../../../data/investigations.json";
import { atmosphereLine, buildRankViews, formatScore, partShare } from "./rankView";
import type { Habitat, Investigation } from "./types";

const habitats = habitatsJson as unknown as Habitat[];
const investigations = investigationsJson as unknown as Investigation[];
const views = buildRankViews(habitats, investigations);

function view(id: string) {
  const found = views.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
}

describe("buildRankViews", () => {
  it("offers ISS, a Moon base, a rover, a spacesuit, and Mars", () => {
    expect(views.map((item) => item.label)).toEqual([
      "ISS",
      "Moon base",
      "Pressurized rover",
      "Moon base upper pressure",
      "Spacesuit",
      "Mars",
      "Earth",
    ]);
  });

  it("lists the ISS investigations best first, with score parts and the closest test", () => {
    const iss = view("iss");
    expect(iss.gravityApplied).toBe("microgravity");
    expect(iss.gravityNote).toBeNull();
    expect(iss.ranked.map((row) => [row.id, row.score])).toEqual([
      ["PSI-69", 1],
      ["PSI-25", 0.9997],
      ["PSI-20", 0.9077],
      ["PSI-68", 0.9077],
      ["PSI-26", 0.6154],
      ["PSI-98", 0.6154],
      ["PSI-99", 0.6089],
      ["PSI-100", 0.2308],
      ["PSI-101", 0.2308],
      ["PSI-102", 0.2308],
    ]);
    const first = iss.ranked[0];
    expect(first.acronym).toBe("FLEX");
    expect(first.parts.map((part) => part.name)).toEqual(["conditions", "intent"]);
    expect(first.parts.map((part) => part.value)).toEqual([1, 1]);
    expect(first.reasons[0]).toBe("Closest test PSI-69-T202 ran at 21% O2 and 14.7 psi; you asked about 21% O2, 14.7 psi.");
    expect(first.tests[0]).toMatchObject({ testId: "PSI-69-T202", o2Percent: 21, pressurePsi: 14.7 });
    expect(first.tests.length).toBeLessThanOrEqual(5);
  });

  it("ranks a Moon base, and gives the rover and Mars the same order", () => {
    const moon = view("moon_base");
    expect(moon.ranked.map((row) => row.id)).toEqual([
      "PSI-69",
      "PSI-68",
      "PSI-20",
      "PSI-25",
      "PSI-99",
      "PSI-98",
      "PSI-26",
      "PSI-100",
      "PSI-101",
      "PSI-102",
    ]);
    expect(moon.ranked[0].score).toBe(1);
    expect(moon.ranked[1].score).toBeCloseTo(0.9077, 4);
    expect(moon.gravityNote).toBe("Run in microgravity, not partial gravity.");
    expect(moon.ranked[0].reasons.some((text) => text.startsWith("Run in "))).toBe(false);

    const rover = view("rover");
    expect(rover.matchesLabel).toBe("Moon base");
    expect(rover.ranked.map((row) => [row.id, row.score])).toEqual(moon.ranked.map((row) => [row.id, row.score]));

    const mars = view("mars_habitat");
    expect(mars.assumed).toBe(true);
    expect(mars.matchesLabel).toBe("Moon base");
    expect(mars.ranked.map((row) => row.id)).toEqual(moon.ranked.map((row) => row.id));
  });

  it("ranks a spacesuit without applying one gravity", () => {
    const suit = view("spacesuit");
    expect(suit.gravityApplied).toBeNull();
    expect(suit.gravityNote).toBeNull();
    expect(atmosphereLine(suit)).toBe("100% oxygen · 4.3 psi · Microgravity and partial gravity");
    expect(suit.ranked[0]).toMatchObject({ id: "PSI-69", score: 0.3761 });
    expect(suit.ranked.map((row) => row.score)).toEqual([...suit.ranked.map((row) => row.score)].sort((a, b) => b - a));
  });

  it("formats a score and the share of the parts that were used", () => {
    expect(formatScore(1)).toBe("100%");
    expect(formatScore(0.9077)).toBe("90.77%");
    const parts = view("iss").ranked[0].parts;
    expect(partShare(parts[0], parts)).toBeCloseTo(0.5 / 0.65);
    expect(partShare(parts[1], parts)).toBeCloseTo(0.15 / 0.65);
  });
});
