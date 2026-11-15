import { describe, expect, it } from "vitest";
import { readFilterText } from "./filterText";

describe("readFilterText", () => {
  it("reads the flame-spread example as a test filter", () => {
    expect(readFilterText("flame spread rate 2 to 5 mm/s")).toEqual({
      kind: "filter",
      filter: { kind: "mapped", field: "spread_rate_mm_s", level: "test", min: 2, max: 5 },
    });
  });

  it("reads a thickness ceiling as a derived filter", () => {
    expect(readFilterText("sample thickness under 1 mm")).toEqual({
      kind: "filter",
      filter: { kind: "derived", parameter: "sample thickness", min: null, max: 1, unit: "mm" },
    });
  });

  it("reads a diluent floor and keeps the percent", () => {
    expect(readFilterText("CO2 diluent above 10%")).toEqual({
      kind: "filter",
      filter: { kind: "derived", parameter: "co2 diluent", min: 10, max: null, unit: "%" },
    });
  });

  it("converts a pressure stated in kPa into psi", () => {
    const read = readFilterText("pressure above 100 kPa");
    expect(read?.kind).toBe("filter");
    if (read?.kind !== "filter" || read.filter.kind !== "mapped") throw new Error("expected a mapped filter");
    expect(read.filter.field).toBe("pressure_psi");
    expect(read.filter.min).toBeCloseTo(14.5038, 3);
    expect(read.filter.max).toBeNull();
  });

  it("leaves a line with no range for the API", () => {
    expect(readFilterText("show me the fabrics")).toBeNull();
  });
});
