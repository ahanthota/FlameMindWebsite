/**
 * Reads a typed filter without calling the API. A line that names a quantity
 * and a range becomes a filter. Anything else returns null so the API can read it.
 */

import { MAPPED_FIELDS, type CustomFilter, type FilterLevel, type MappedField } from "./filters";

const UNCLEAR = "Which parameter do you want to filter on, and over what range?";

export type ReadFilter = { kind: "filter"; filter: CustomFilter } | { kind: "unclear"; question: string };

interface Bounds {
  min: number | null;
  max: number | null;
}

/** base = value * factor + offset. Mirrors the units the API converts. */
const UNITS: Record<string, { dimension: string; factor: number; offset: number }> = {};

function add(dimension: string, factor: number, names: string[], offset = 0): void {
  for (const name of names) UNITS[name] = { dimension, factor, offset };
}

add("pressure", 1, ["psi", "psia"]);
add("pressure", 0.1450377, ["kpa"]);
add("pressure", 14.69595, ["atm"]);
add("pressure", 14.50377, ["bar"]);
add("speed", 1, ["cm/s"]);
add("speed", 0.1, ["mm/s"]);
add("speed", 100, ["m/s"]);
add("fraction", 1, ["%", "percent", "pct"]);
add("length", 1, ["mm"]);
add("length", 10, ["cm"]);
add("length", 1000, ["m"]);
add("length", 25.4, ["in", "inch", "inches"]);

const WORDS: Record<string, string> = {
  percent: "%",
  pct: "%",
  millimeters: "mm",
  millimeter: "mm",
  centimeters: "cm",
  centimeter: "cm",
  kilopascals: "kpa",
  kilopascal: "kpa",
};

function normalizeUnit(unit: string): string {
  let text = unit.toLowerCase().trim().replaceAll(" per ", "/");
  text = WORDS[text] ?? text;
  return text.replaceAll(/\s+/g, "");
}

function convert(value: number, fromUnit: string, toUnit: string): number | null {
  const source = normalizeUnit(fromUnit);
  const target = normalizeUnit(toUnit);
  if (source === target) return value;
  const from = UNITS[source];
  const to = UNITS[target];
  if (!from || !to || from.dimension !== to.dimension) return null;
  return (value * from.factor + from.offset - to.offset) / to.factor;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

const RANGE_PATTERNS: { pattern: RegExp; bounds: (match: RegExpMatchArray) => Bounds }[] = [
  {
    pattern: /\bbetween\s+(-?\d*\.?\d+)\s+and\s+(-?\d*\.?\d+)/i,
    bounds: (match) => ({ min: Number(match[1]), max: Number(match[2]) }),
  },
  {
    pattern: /(-?\d*\.?\d+)\s*(?:to|–)\s*(-?\d*\.?\d+)/i,
    bounds: (match) => ({ min: Number(match[1]), max: Number(match[2]) }),
  },
  {
    pattern: /\b(?:under|below|less than|at most|up to)\s+(-?\d*\.?\d+)/i,
    bounds: (match) => ({ min: null, max: Number(match[1]) }),
  },
  {
    pattern: /\b(?:above|over|more than|at least|greater than)\s+(-?\d*\.?\d+)/i,
    bounds: (match) => ({ min: Number(match[1]), max: null }),
  },
  {
    pattern: /\b(?:at|equal to|exactly)\s+(-?\d*\.?\d+)/i,
    bounds: (match) => ({ min: Number(match[1]), max: Number(match[1]) }),
  },
];

function fieldOf(parameter: string): MappedField | null {
  const text = parameter.toLowerCase();
  if (/flame\s*spread|spread\s*rate/.test(text)) return "spread_rate_mm_s";
  if (/\boxygen\b|\bo2\b/.test(text)) return "o2_percent";
  if (/\bpressure\b/.test(text)) return "pressure_psi";
  if (/\bair\s*flow\b|\bairflow\b|\bflow\s*speed\b|\bventilation\b/.test(text)) return "flow_cm_s";
  return null;
}

function levelOf(parameter: string, field: MappedField): FilterLevel {
  const levels = MAPPED_FIELDS[field].levels;
  if (levels.length === 1) return levels[0];
  if (/\btests?\b|\bsamples?\b|\bruns?\b/.test(parameter)) return "test";
  return "investigation";
}

function unitAfter(rest: string, attachedPercent: boolean): string | null {
  if (attachedPercent) return "%";
  const token = rest.trim().split(/\s+/)[0]?.replace(/[.,]$/, "") ?? "";
  if (!token || !/[a-zA-Z%µμ°/]/.test(token)) return null;
  return token;
}

/** A filter read from the text, or null when the line is not a quantity plus a range. */
export function readFilterText(text: string): ReadFilter | null {
  const source = text.trim();
  if (!source) return null;
  for (const candidate of RANGE_PATTERNS) {
    const match = candidate.pattern.exec(source);
    if (!match || match.index === undefined) continue;
    const bounds = candidate.bounds(match);
    if ((bounds.min !== null && !Number.isFinite(bounds.min)) || (bounds.max !== null && !Number.isFinite(bounds.max))) {
      continue;
    }
    const before = source.slice(0, match.index).trim();
    const after = source.slice(match.index + match[0].length);
    const attachedPercent = /^\s*%/.test(after) || /%\s*$/.test(match[0]);
    const unit = unitAfter(after, attachedPercent);
    const parameter = before.replace(/[:\-–]+$/g, "").trim();
    if (!parameter) return { kind: "unclear", question: UNCLEAR };
    const field = fieldOf(parameter);
    let min = bounds.min;
    let max = bounds.max;
    if (min !== null && max !== null && min > max) [min, max] = [max, min];
    if (field) {
      const stored = MAPPED_FIELDS[field].unit;
      const from = unit ?? stored;
      const converted = [min, max].map((value) => (value === null ? null : convert(value, from, stored)));
      if (converted.some((value, index) => (index === 0 ? min : max) !== null && value === null)) {
        return {
          kind: "unclear",
          question: `${MAPPED_FIELDS[field].label} is stored in ${stored}. What unit is your range in?`,
        };
      }
      return {
        kind: "filter",
        filter: {
          kind: "mapped",
          field,
          level: levelOf(parameter, field),
          min: converted[0] === null ? null : round4(converted[0]),
          max: converted[1] === null ? null : round4(converted[1]),
        },
      };
    }
    return {
      kind: "filter",
      filter: {
        kind: "derived",
        parameter: parameter.toLowerCase().replace(/\s+/g, " "),
        min,
        max,
        unit: unit ? normalizeUnit(unit) : null,
      },
    };
  }
  return null;
}
