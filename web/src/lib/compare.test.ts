import { describe, expect, it } from "vitest";
import investigationsJson from "../../../data/investigations.json";
import { COMPARE_ROWS, askAbout, axisState, mainVaried, rowValue, sameAcross, toCompareInvestigation, toCompareTests, visibleFindings } from "./compare";
import type { Investigation } from "./types";

const investigations = investigationsJson as unknown as Investigation[];

function record(values: Partial<Investigation> & Pick<Investigation, "id" | "acronym">): Investigation {
  return {
    name: values.acronym,
    tier: "A",
    psi_url: "https://psi.nasa.gov",
    program: null,
    hardware: null,
    platform: [],
    years: null,
    objectives: [],
    approach: null,
    category: [],
    fuel_phase: null,
    fuels: [],
    sample_geometry: null,
    sample_size: null,
    o2_percent_min: null,
    o2_percent_max: null,
    pressure_kpa_min: null,
    pressure_kpa_max: null,
    pressure_psi_min: null,
    pressure_psi_max: null,
    flow_cm_s_min: null,
    flow_cm_s_max: null,
    gravity: null,
    diluents: [],
    variables_varied: [],
    variables_fixed: [],
    sensors: [],
    tests: [],
    ignition_findings: [],
    flame_spread_findings: [],
    extinction_findings: [],
    key_findings: [],
    fire_safety_relevance: "",
    sources: [],
    needs_review: false,
    ...values,
  };
}

describe("compare", () => {
  it("covers every structured investigation and the rows the page has to show", () => {
    const rows = investigations.map(toCompareInvestigation);
    expect(rows).toHaveLength(24);
    expect(rows.map((item) => item.id)).toEqual([
      "PSI-10",
      "PSI-20",
      "PSI-21",
      "PSI-22",
      "PSI-23",
      "PSI-25",
      "PSI-26",
      "PSI-39",
      "PSI-47",
      "PSI-60",
      "PSI-62",
      "PSI-68",
      "PSI-69",
      "PSI-98",
      "PSI-99",
      "PSI-100",
      "PSI-101",
      "PSI-102",
      "PSI-106",
      "PSI-107",
      "PSI-115",
      "PSI-117",
      "PSI-142",
      "PSI-159",
    ]);
    expect(COMPARE_ROWS.map((row) => row.label)).toEqual([
      "Hardware",
      "Platform",
      "Fuel",
      "Sample geometry",
      "Oxygen (%)",
      "Pressure (psi)",
      "Flow (cm/s)",
      "Gravity",
      "Variables varied",
      "Sensors",
      "Ignition findings",
      "Flame spread findings",
      "Extinction findings",
    ]);
  });

  it("leaves unstated pressure as a dash and keeps a stated oxygen range", () => {
    const saffire = investigations.map(toCompareInvestigation).find((item) => item.id === "PSI-98");
    const flex = investigations.map(toCompareInvestigation).find((item) => item.id === "PSI-69");
    expect(saffire && rowValue("pressure", saffire)).toBe("–");
    expect(saffire && rowValue("oxygen", saffire)).toBe("21.5 to 21.7");
    expect(saffire && rowValue("flameSpread", saffire)).toContain("420 s");
    expect(flex && rowValue("oxygen", flex)).toBe("12 to 34");
    expect(flex && rowValue("hardware", flex)).toBe("CIR");
    expect(flex && rowValue("fuel", flex).startsWith("Liquid\n")).toBe(true);
  });

  it("treats matching hardware as the same and different oxygen as a difference", () => {
    const [bass, bass2] = investigations
      .filter((item) => item.id === "PSI-26" || item.id === "PSI-25")
      .map(toCompareInvestigation);
    expect(sameAcross([bass, bass2], "hardware")).toBe(true);
    expect(sameAcross([bass, bass2], "oxygen")).toBe(false);
    expect(sameAcross([bass], "oxygen")).toBe(true);
  });

  it("previews a long findings list and shows a short one in full", () => {
    const findings = [
      { group: "Key findings", text: "a" },
      { group: "Key findings", text: "b" },
      { group: "Ignition", text: "c" },
      { group: "Extinction", text: "d" },
    ];
    expect(visibleFindings(findings, false)).toHaveLength(3);
    expect(visibleFindings(findings, true)).toHaveLength(4);
    expect(visibleFindings(findings.slice(0, 2), false)).toHaveLength(2);
  });

  it("drops blank objectives and keeps a needs-review flag", () => {
    const item = toCompareInvestigation(
      record({
        id: "PSI-1",
        acronym: "X",
        objectives: ["  ", "Measure spread."],
        needs_review: true,
        key_findings: [{ text: "  ", evidence: [] }, { text: "Quenched at low flow.", evidence: [] }],
      }),
    );
    expect(item.objectives).toEqual(["Measure spread."]);
    expect(item.needsReview).toBe(true);
    expect(item.findings).toEqual([{ group: "Key findings", text: "Quenched at low flow." }]);
  });

  it("names each selected investigation in the scenario question", () => {
    const [bass, bass2] = investigations
      .filter((item) => item.id === "PSI-26" || item.id === "PSI-25")
      .map(toCompareInvestigation);
    const question = askAbout([bass, bass2]);
    expect(question).toContain("BASS (PSI-26)");
    expect(question).toContain("BASS-II (PSI-25)");
    expect(question.startsWith("How do ")).toBe(true);
  });

  it("marks a condition changed only when two stated values disagree", () => {
    const tests = toCompareTests(
      record({
        id: "PSI-1",
        acronym: "X",
        tests: [
          { sample_id: "A", fuel: "heptane", sample_geometry: "droplet", o2_percent: 21, pressure_kpa: null, pressure_psi: null, flow_cm_s: 1, diluent: null, outcome: "ignited", spread_rate_mm_s: 2, notes: null, evidence: [] },
          { sample_id: "B", fuel: "heptane", sample_geometry: "droplet", o2_percent: 21, pressure_kpa: null, pressure_psi: 8, flow_cm_s: 5, diluent: null, outcome: "extinguished", spread_rate_mm_s: null, notes: null, evidence: [] },
        ],
      }),
    );
    expect(axisState(tests, "fuel")).toBe("fixed");
    expect(axisState(tests, "geometry")).toBe("fixed");
    expect(axisState(tests, "oxygen")).toBe("fixed");
    expect(axisState(tests, "flow")).toBe("changed");
    expect(axisState(tests, "pressure")).toBe("fixed");
    expect(mainVaried(tests)).toBe("flow");
  });
});
