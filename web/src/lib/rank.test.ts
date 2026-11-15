import { describe, expect, it } from "vitest";
import fixture from "../../../api/tests/fixtures/investigations.json";
import { axisCloseness, makeTestId, rank, scoreInvestigation, WEIGHTS, type RankConditions, type RankSource } from "./rank";

const records = fixture as RankSource[];
const byId = new Map(records.map((record) => [record.id, record]));

function conditions(values: RankConditions = {}): RankConditions {
  return { materials: [], ...values };
}

describe("rank", () => {
  it("keeps the chat ranker weights", () => {
    expect(WEIGHTS.conditions + WEIGHTS.materials + WEIGHTS.intent + WEIGHTS.airflow).toBeCloseTo(1);
    expect(WEIGHTS).toEqual({ conditions: 0.5, materials: 0.25, intent: 0.15, airflow: 0.1 });
  });

  it("scores 1 inside a tested range and 0 far outside it", () => {
    expect(axisCloseness("o2_percent", 21, 16, 21)).toBe(1);
    expect(axisCloseness("o2_percent", 34, 21)).toBeCloseTo(1 - 13 / 85 / 0.35);
    expect(axisCloseness("o2_percent", 100, 21)).toBe(0);
  });

  it("gives a full score to an exact test and names that test", () => {
    const result = scoreInvestigation(
      byId.get("PSI-25") as RankSource,
      conditions({ o2_percent: 21, pressure_psi: 14.7, flow_cm_s: 10, materials: ["cotton fabric"] }),
      "find_data",
    );
    expect(result.score).toBeCloseTo(1);
    expect(result.parts).toEqual({ conditions: 1, airflow: 1, materials: 1, intent: 1 });
    expect(result.tests[0]?.testId).toBe(makeTestId("PSI-25", 0));
    expect(result.reasons[0]).toContain("PSI-25-T1");
  });

  it("uses individual tests before ranges and converts kPa", () => {
    const result = scoreInvestigation(byId.get("PSI-25") as RankSource, conditions({ o2_percent: 16, pressure_psi: 14.7 }), "find_data");
    expect(result.parts.conditions).toBeCloseTo(1, 2);
    expect(result.tests[0]?.testId).toBe("PSI-25-T2");
    expect(result.tests[0]?.values.pressure_psi).toBeCloseTo(14.69, 2);
  });

  it("uses stated ranges when an investigation has no tests", () => {
    const result = scoreInvestigation(byId.get("PSI-68") as RankSource, conditions({ o2_percent: 34, pressure_psi: 8 }), "find_data");
    expect(result.parts.conditions).toBe(1);
    expect(result.tests).toEqual([]);
    expect(result.reasons[0]).toContain("covers");
  });

  it("ranks the investigation that covers a Moon base atmosphere first", () => {
    const ranked = rank(records, conditions({ o2_percent: 34, pressure_psi: 8 }), "find_data");
    expect(ranked.map((item) => item.investigationId)).toEqual(["PSI-68", "PSI-25", "PSI-101"]);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    expect(ranked[1].score).toBeGreaterThan(ranked[2].score);
  });

  it("matches a material by name, by group, or by fuel phase", () => {
    const exact = scoreInvestigation(byId.get("PSI-25") as RankSource, conditions({ materials: ["PMMA"] }), "other");
    const similar = scoreInvestigation(byId.get("PSI-25") as RankSource, conditions({ materials: ["acrylic panels"] }), "other");
    const phase = scoreInvestigation(
      byId.get("PSI-101") as RankSource,
      conditions({ materials: ["wood"], fuel_phase: "solid" }),
      "other",
    );
    const miss = scoreInvestigation(
      byId.get("PSI-68") as RankSource,
      conditions({ materials: ["wood"], fuel_phase: "solid" }),
      "other",
    );
    expect(exact.parts.materials).toBe(1);
    expect(similar.parts.materials).toBe(0.8);
    expect(phase.parts.materials).toBe(0.5);
    expect(miss.parts.materials).toBe(0);
    expect(miss.reasons[0]).toContain("does not match wood");
  });

  it("scores missing oxygen as zero and says so", () => {
    const result = scoreInvestigation(byId.get("PSI-101") as RankSource, conditions({ o2_percent: 21, pressure_psi: 14.7 }), "find_data");
    expect(result.parts.conditions).toBe(0);
    expect(result.reasons[0]).toContain("no oxygen values recorded");
    expect(result.parts.intent).toBe(0.2);
  });

  it("drops parts the question does not set and scales the rest", () => {
    const explained = scoreInvestigation(byId.get("PSI-25") as RankSource, conditions(), "explain");
    expect(explained.parts).toEqual({ intent: 1 });
    expect(explained.score).toBe(1);
    const nothing = scoreInvestigation(byId.get("PSI-25") as RankSource, conditions(), "other");
    expect(nothing.parts).toEqual({});
    expect(nothing.score).toBe(0);
  });

  it("matches the stated weighted sum", () => {
    const result = scoreInvestigation(
      byId.get("PSI-68") as RankSource,
      conditions({ o2_percent: 34, pressure_psi: 8, flow_cm_s: 10, materials: ["cotton"] }),
      "find_data",
    );
    expect(result.score).toBeCloseTo(0.5 * 1 + 0.25 * 0 + 0.15 * 0.6 + 0.1 * 0);
  });

  it("notes a gravity mismatch without changing the weights", () => {
    const result = scoreInvestigation(byId.get("PSI-25") as RankSource, conditions({ o2_percent: 21, gravity: "partial" }), "find_data");
    expect(result.reasons).toContain("Run in microgravity, not partial gravity.");
    expect(result.parts.conditions).toBeDefined();
    expect(result.parts.airflow).toBeUndefined();
  });
});
