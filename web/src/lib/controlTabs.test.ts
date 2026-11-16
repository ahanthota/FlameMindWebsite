import { describe, expect, it } from "vitest";
import { categoryLine } from "./controlTabs";
import type { Insight } from "./types";

const source = {
  file_name: "documents/report.pdf",
  title: "SAME final report",
  url: "https://psi.nasa.gov/example",
  doi: null,
  page: 57,
};

function insight(category: Insight["category"], sources = [source]): Pick<Insight, "category" | "sources"> {
  return { category, sources };
}

describe("categoryLine", () => {
  it("names the insight source for a category that has one", () => {
    expect(categoryLine("detection", [insight("detection"), insight("suppression")])).toBe(
      "Investigations whose record is tagged detection. Insight sources: SAME final report, page 57.",
    );
  });

  it("says when insights.json has no entry for the category", () => {
    expect(categoryLine("prevention", [insight("detection")])).toBe(
      "Investigations whose record is tagged prevention. No written insight is tagged prevention.",
    );
  });
});
