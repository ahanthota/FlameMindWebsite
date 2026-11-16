import type { Insight, InsightCategory } from "./types";

export interface EarthUse {
  id: "water-mist" | "smoke" | "gear";
  title: string;
  /** True only when the insight text itself names this use. */
  matches: (text: string) => boolean;
}

export const EARTH_USES: readonly EarthUse[] = [
  {
    id: "water-mist",
    title: "Fine water-mist extinguishers",
    matches: (text) => /water[\s-]?mist/i.test(text),
  },
  {
    id: "smoke",
    title: "Smoke detection",
    matches: (text) => /\bsmoke\b/i.test(text),
  },
  {
    id: "gear",
    title: "Firefighter gear",
    matches: (text) => /firefighter|fire fighter|protective clothing/i.test(text),
  },
];

/** Category is the earth tag, including a list or a comma-separated value. */
export function isEarthCategory(category: InsightCategory | readonly string[]): boolean {
  const values = typeof category === "string" ? category.split(/[,\s/]+/) : category;
  return values.includes("earth");
}

function sourcedEarth(insights: readonly Insight[]): Insight[] {
  return insights.filter((item) => isEarthCategory(item.category) && item.text.trim() !== "" && item.sources.length > 0);
}

export function insightsForUse(useId: EarthUse["id"], insights: readonly Insight[]): Insight[] {
  const use = EARTH_USES.find((item) => item.id === useId);
  if (!use) return [];
  return sourcedEarth(insights).filter((item) => use.matches(item.text));
}

/** Earth-tagged insights whose text does not name one of the three uses. */
export function otherEarthInsights(insights: readonly Insight[]): Insight[] {
  return sourcedEarth(insights).filter((item) => !EARTH_USES.some((use) => use.matches(item.text)));
}
