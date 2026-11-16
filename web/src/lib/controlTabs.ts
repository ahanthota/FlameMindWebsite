import type { CategoryName, Insight } from "./types";

export const CONTROL_CATEGORIES: readonly CategoryName[] = ["prevention", "detection", "suppression"];

/** One line: the category tag, then the insight sources that carry it. */
export function categoryLine(category: CategoryName, insights: readonly Pick<Insight, "category" | "sources">[]): string {
  const sources = [
    ...new Set(
      insights
        .filter((item) => item.category === category)
        .flatMap((item) => item.sources.map((source) => `${source.title}, page ${source.page}`)),
    ),
  ];
  const tag = `Investigations whose record is tagged ${category}.`;
  if (sources.length === 0) return `${tag} No written insight is tagged ${category}.`;
  return `${tag} Insight sources: ${sources.join("; ")}.`;
}
