/**
 * Same scoring as api/ai/ranker.py. Weights:
 *   conditions (oxygen and pressure)  0.50
 *   materials                         0.25
 *   intent                            0.15
 *   airflow                           0.10
 * A part is left out, and the rest are scaled, when the question gives it
 * nothing to compare. Closeness is 1 inside a tested range and falls to 0
 * at CLOSE_AT of the axis span. Spans match data/gaps.json.
 */

export const WEIGHTS = { conditions: 0.5, materials: 0.25, intent: 0.15, airflow: 0.1 } as const;
export const SPANS = { o2_percent: 85, pressure_psi: 14, flow_cm_s: 50 } as const;
export const CLOSE_AT = 0.35;
const KPA_TO_PSI = 0.1450377;
const TOP_TESTS = 5;

export type AxisName = keyof typeof SPANS;
export type PartName = keyof typeof WEIGHTS;

const AXIS_LABEL: Record<AxisName, string> = {
  o2_percent: "oxygen",
  pressure_psi: "pressure",
  flow_cm_s: "airflow",
};
const AXIS_UNIT: Record<AxisName, string> = {
  o2_percent: "% O2",
  pressure_psi: " psi",
  flow_cm_s: " cm/s",
};

const MATERIAL_GROUPS: Record<string, readonly string[]> = {
  fabric: ["fabric", "fabrics", "cloth", "textile", "textiles", "cotton", "nomex", "fiberglass", "clothing", "garment", "garments", "towel"],
  plastic: ["plastic", "plastics", "pmma", "acrylic", "polymer", "polymers", "plexiglas", "plexiglass", "polyethylene", "delrin", "polycarbonate", "ultem", "silicone", "polyoxymethylene"],
  paper: ["paper", "cardboard", "kimwipe", "kimwipes", "cellulose", "tissue"],
  wire: ["wire", "wires", "insulation", "cable", "cables", "electrical", "ptfe", "teflon"],
  liquid: ["heptane", "ethanol", "methanol", "decane", "droplet", "droplets", "alcohol", "octane", "dodecane"],
  gas: ["methane", "ethylene", "propane", "hydrogen", "ethane"],
};
const STOPWORDS = new Set(["and", "the", "with", "for", "sample", "samples", "material", "materials", "fuel", "fuels", "flat", "sheet", "sheets", "thin", "thick"]);

export interface RankTestInput {
  sample_id?: string | null;
  fuel?: string | null;
  o2_percent?: number | null;
  pressure_psi?: number | null;
  pressure_kpa?: number | null;
  flow_cm_s?: number | null;
}

/** The fields the ranker reads. Investigation records satisfy this. */
export interface RankSource {
  id: string;
  name?: string | null;
  gravity?: string | null;
  fuel_phase?: string | null;
  fuels?: readonly string[] | null;
  sample_geometry?: string | null;
  variables_varied?: readonly string[] | null;
  o2_percent_min?: number | null;
  o2_percent_max?: number | null;
  pressure_psi_min?: number | null;
  pressure_psi_max?: number | null;
  pressure_kpa_min?: number | null;
  pressure_kpa_max?: number | null;
  flow_cm_s_min?: number | null;
  flow_cm_s_max?: number | null;
  tests?: readonly RankTestInput[] | null;
  key_findings?: readonly unknown[] | null;
  ignition_findings?: readonly unknown[] | null;
  flame_spread_findings?: readonly unknown[] | null;
  extinction_findings?: readonly unknown[] | null;
}

export interface RankConditions {
  o2_percent?: number | null;
  pressure_psi?: number | null;
  flow_cm_s?: number | null;
  materials?: readonly string[] | null;
  fuel_phase?: string | null;
  gravity?: string | null;
}

export interface RankedTest {
  testId: string;
  sampleId: string | null;
  closeness: number;
  values: Partial<Record<AxisName, number>>;
}

export interface Ranked {
  investigationId: string;
  score: number;
  parts: Partial<Record<PartName, number>>;
  /** Per-axis closeness that the conditions and airflow parts were built from. */
  axes: Partial<Record<AxisName, number>>;
  reasons: string[];
  tests: RankedTest[];
}

export function makeTestId(investigationId: string, index: number): string {
  return `${investigationId}-T${index + 1}`;
}

export function rank(records: readonly RankSource[], conditions: RankConditions, intent: string): Ranked[] {
  return records
    .map((record) => scoreInvestigation(record, conditions, intent))
    .sort((a, b) => b.score - a.score || compareText(a.investigationId, b.investigationId));
}

export function scoreInvestigation(record: RankSource, conditions: RankConditions, intent: string): Ranked {
  const query = queryAxes(conditions);
  const parts: Partial<Record<PartName, number>> = {};
  const axes: Partial<Record<AxisName, number>> = {};
  const reasons: string[] = [];
  const tests = scoredTests(record, query);

  const conditionAxes = (["o2_percent", "pressure_psi"] as const).filter((axis) => axis in query);
  if (conditionAxes.length > 0) {
    const [value, text, axisValues] = closenessPart(record, query, conditionAxes, tests);
    parts.conditions = value;
    Object.assign(axes, axisValues);
    reasons.push(text);
  }
  if ("flow_cm_s" in query) {
    const [value, text, axisValues] = closenessPart(record, query, ["flow_cm_s"], tests);
    parts.airflow = value;
    Object.assign(axes, axisValues);
    reasons.push(text);
  }

  const materials = (conditions.materials ?? []).filter((item) => item.trim());
  if (materials.length > 0 || conditions.fuel_phase) {
    const [value, text] = materialPart(record, materials, conditions.fuel_phase ?? null);
    parts.materials = value;
    reasons.push(text);
  }

  const intentScore = intentPart(record, intent);
  if (intentScore) {
    parts.intent = intentScore[0];
    reasons.push(intentScore[1]);
  }

  const gravity = conditions.gravity;
  if (gravity && record.gravity && record.gravity !== gravity) {
    reasons.push(`Run in ${record.gravity}, not ${gravity} gravity.`);
  }

  const names = Object.keys(parts) as PartName[];
  const weight = names.reduce((sum, name) => sum + WEIGHTS[name], 0);
  const score = weight === 0 ? 0 : names.reduce((sum, name) => sum + WEIGHTS[name] * (parts[name] ?? 0), 0) / weight;
  const rounded: Partial<Record<PartName, number>> = {};
  for (const name of names) rounded[name] = round4(parts[name] ?? 0);
  return {
    investigationId: record.id,
    score: round4(score),
    parts: rounded,
    axes,
    reasons,
    tests: tests.filter((test) => test.closeness > 0).slice(0, TOP_TESTS),
  };
}

export function axisCloseness(axis: AxisName, wanted: number, low: number, high = low): number {
  const gap = low <= wanted && wanted <= high ? 0 : Math.min(Math.abs(wanted - low), Math.abs(wanted - high));
  return Math.max(0, 1 - gap / SPANS[axis] / CLOSE_AT);
}

function queryAxes(conditions: RankConditions): Partial<Record<AxisName, number>> {
  const query: Partial<Record<AxisName, number>> = {};
  for (const axis of Object.keys(SPANS) as AxisName[]) {
    const value = conditions[axis];
    if (value !== null && value !== undefined) query[axis] = value;
  }
  return query;
}

function testValues(test: RankTestInput): Partial<Record<AxisName, number>> {
  const values: Partial<Record<AxisName, number>> = {};
  if (isNumber(test.o2_percent)) values.o2_percent = test.o2_percent;
  if (isNumber(test.pressure_psi)) values.pressure_psi = test.pressure_psi;
  else if (isNumber(test.pressure_kpa)) values.pressure_psi = test.pressure_kpa * KPA_TO_PSI;
  if (isNumber(test.flow_cm_s)) values.flow_cm_s = test.flow_cm_s;
  return values;
}

function axisEnds(record: RankSource, axis: AxisName): [number | null | undefined, number | null | undefined] {
  if (axis === "o2_percent") return [record.o2_percent_min, record.o2_percent_max];
  if (axis === "pressure_psi") return [record.pressure_psi_min, record.pressure_psi_max];
  return [record.flow_cm_s_min, record.flow_cm_s_max];
}

function recordRange(record: RankSource, axis: AxisName): [number, number] | null {
  let [low, high] = axisEnds(record, axis);
  if (axis === "pressure_psi" && !isNumber(low) && !isNumber(high)) {
    low = isNumber(record.pressure_kpa_min) ? record.pressure_kpa_min * KPA_TO_PSI : null;
    high = isNumber(record.pressure_kpa_max) ? record.pressure_kpa_max * KPA_TO_PSI : null;
  }
  if (!isNumber(low) && !isNumber(high)) return null;
  const start = isNumber(low) ? low : (high as number);
  const end = isNumber(high) ? high : (low as number);
  return [Math.min(start, end), Math.max(start, end)];
}

function scoredTests(record: RankSource, query: Partial<Record<AxisName, number>>): RankedTest[] {
  const asked = Object.keys(query) as AxisName[];
  const matches: RankedTest[] = [];
  (record.tests ?? []).forEach((test, index) => {
    const values = testValues(test);
    const present = asked.filter((axis) => values[axis] !== undefined);
    if (present.length === 0) return;
    const closeness =
      asked.reduce((sum, axis) => sum + (values[axis] === undefined ? 0 : axisCloseness(axis, query[axis] as number, values[axis] as number)), 0) /
      asked.length;
    matches.push({
      testId: makeTestId(record.id, index),
      sampleId: test.sample_id ?? null,
      closeness: round4(closeness),
      values,
    });
  });
  return matches.sort((a, b) => b.closeness - a.closeness);
}

function closenessPart(
  record: RankSource,
  query: Partial<Record<AxisName, number>>,
  axes: readonly AxisName[],
  tests: readonly RankedTest[],
): [number, string, Partial<Record<AxisName, number>>] {
  const ranges: Partial<Record<AxisName, [number, number] | null>> = {};
  for (const axis of axes) ranges[axis] = recordRange(record, axis);
  const scoreAxes = (values: readonly number[]): Partial<Record<AxisName, number>> => {
    const scored: Partial<Record<AxisName, number>> = {};
    axes.forEach((axis, index) => {
      scored[axis] = round4(values[index] ?? 0);
    });
    return scored;
  };
  let best = 0;
  let bestAxes = axes.map(() => 0);
  let bestTest: RankedTest | null = null;
  for (const test of tests) {
    const perAxis = axes.map((axis) => {
      const value = test.values[axis];
      if (value !== undefined) return axisCloseness(axis, query[axis] as number, value);
      const span = ranges[axis];
      return span ? axisCloseness(axis, query[axis] as number, span[0], span[1]) : 0;
    });
    const value = perAxis.reduce((sum, item) => sum + item, 0) / axes.length;
    if (value > best) {
      best = value;
      bestAxes = perAxis;
      bestTest = test;
    }
  }
  const fromRanges = axes.map((axis) => {
    const span = ranges[axis];
    return span ? axisCloseness(axis, query[axis] as number, span[0], span[1]) : 0;
  });
  const rangeValue = fromRanges.reduce((sum, item) => sum + item, 0) / axes.length;
  if (bestTest && best >= rangeValue) return [best, describeTest(bestTest, query, axes, ranges), scoreAxes(bestAxes)];
  return [rangeValue, describeRanges(ranges, query, axes), scoreAxes(fromRanges)];
}

function describeTest(
  test: RankedTest,
  query: Partial<Record<AxisName, number>>,
  axes: readonly AxisName[],
  ranges: Partial<Record<AxisName, [number, number] | null>>,
): string {
  const bits = axes.map((axis) => {
    const value = test.values[axis];
    if (value !== undefined) return `${fmt(value)}${AXIS_UNIT[axis]}`;
    const span = ranges[axis];
    return span ? `${rangeText(axis, span)} (investigation range)` : "";
  });
  const asked = axes.map((axis) => `${fmt(query[axis] as number)}${AXIS_UNIT[axis]}`).join(", ");
  return `Closest test ${test.testId} ran at ${bits.filter(Boolean).join(" and ")}; you asked about ${asked}.`;
}

function describeRanges(
  ranges: Partial<Record<AxisName, [number, number] | null>>,
  query: Partial<Record<AxisName, number>>,
  axes: readonly AxisName[],
): string {
  const bits = axes.map((axis) => {
    const span = ranges[axis];
    const wanted = query[axis] as number;
    if (!span) return `no ${AXIS_LABEL[axis]} values recorded`;
    if (span[0] <= wanted && wanted <= span[1]) {
      return `${AXIS_LABEL[axis]} ${rangeText(axis, span)} covers ${fmt(wanted)}${AXIS_UNIT[axis]}`;
    }
    return `${AXIS_LABEL[axis]} tested at ${rangeText(axis, span)}, you asked about ${fmt(wanted)}${AXIS_UNIT[axis]}`;
  });
  return `Ranges: ${bits.join("; ")}.`;
}

function rangeText(axis: AxisName, span: [number, number]): string {
  const [low, high] = span;
  return isClose(low, high) ? `${fmt(low)}${AXIS_UNIT[axis]}` : `${fmt(low)}-${fmt(high)}${AXIS_UNIT[axis]}`;
}

function materialPart(record: RankSource, materials: readonly string[], fuelPhase: string | null): [number, string] {
  const described = [
    ...(record.fuels ?? []),
    record.sample_geometry ?? "",
    record.name ?? "",
    ...(record.tests ?? []).map((test) => String(test.fuel ?? "")),
  ].join(" ");
  const have = tokens(described);
  const haveGroups = groups(have);
  const fuels = (record.fuels ?? []).join(", ") || "unstated fuels";
  let best = 0;
  let matched: string | null = null;
  for (const material of materials) {
    const wanted = tokens(material);
    let score = 0;
    if (intersects(wanted, have)) score = 1;
    else if (intersects(groups(wanted), haveGroups)) score = 0.8;
    else continue;
    if (score > best) {
      best = score;
      matched = material;
    }
  }
  if (matched) {
    const kind = best === 1 ? "names" : "uses a similar material to";
    return [best, `Fuel (${fuels}) ${kind} ${matched}.`];
  }
  if (fuelPhase && record.fuel_phase === fuelPhase) {
    return [0.5, `Burned a ${fuelPhase} fuel (${fuels}), like you asked about.`];
  }
  const asked = materials.join(", ") || `${fuelPhase} fuels`;
  return [0, `Fuel (${fuels}) does not match ${asked}.`];
}

function intentPart(record: RankSource, intent: string): [number, string] | null {
  const tests = record.tests ?? [];
  const withValues = tests.filter((test) => Object.keys(testValues(test)).length > 0).length;
  const findings = ["key_findings", "ignition_findings", "flame_spread_findings", "extinction_findings"].reduce(
    (sum, name) => sum + ((record[name as keyof RankSource] as readonly unknown[] | null | undefined)?.length ?? 0),
    0,
  );
  if (intent === "find_data" || intent === "use_case_update") {
    if (withValues > 0) return [1, `Has ${withValues} test(s) with recorded conditions.`];
    if ((Object.keys(SPANS) as AxisName[]).some((axis) => recordRange(record, axis))) {
      return [0.6, "Has tested ranges but no per-test values."];
    }
    return [0.2, "No recorded test conditions."];
  }
  if (intent === "explain") return [Math.min(1, findings / 3), `Has ${findings} recorded finding(s) to explain from.`];
  if (intent === "compare") {
    const varied = record.variables_varied ?? [];
    const distinct = new Set(tests.filter((test) => Object.keys(testValues(test)).length > 0).map((test) => valueKey(testValues(test))));
    if (distinct.size > 1 || varied.length > 0) return [1, "Varied conditions across tests, so results can be compared."];
    return [0.4, "Few varied conditions to compare."];
  }
  return null;
}

function tokens(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => word.length > 2 && !STOPWORDS.has(word)),
  );
}

function groups(words: Set<string>): Set<string> {
  const found = new Set<string>();
  for (const [name, members] of Object.entries(MATERIAL_GROUPS)) {
    if (members.some((word) => words.has(word))) found.add(name);
  }
  return found;
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  for (const word of left) if (right.has(word)) return true;
  return false;
}

function valueKey(values: Partial<Record<AxisName, number>>): string {
  return (Object.keys(values) as AxisName[])
    .sort()
    .map((axis) => `${axis}:${values[axis]}`)
    .join("|");
}

function fmt(value: number): string {
  if (Math.abs(value) >= 100) return String(Math.round(value));
  return String(Number(value.toPrecision(3)));
}

function isClose(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9 * Math.max(Math.abs(left), Math.abs(right));
}

function isNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
