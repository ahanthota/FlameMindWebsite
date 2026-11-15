/** Display helpers. Missing values show as an en dash, never as 0. */

export const MISSING = "–";

export const LABELS: Record<string, string> = {
  ISS: "ISS",
  drop_tower: "Drop tower",
  parabolic_flight: "Parabolic flight",
  sounding_rocket: "Sounding rocket",
  prevention: "Prevention",
  detection: "Detection",
  suppression: "Suppression",
  solid: "Solid",
  liquid: "Liquid",
  gas: "Gas",
  microgravity: "Microgravity",
  normal: "Normal (1 g)",
  partial: "Partial",
  simulated_partial: "Simulated partial",
  ignited: "Ignited",
  no_ignition: "No ignition",
  extinguished: "Extinguished",
  steady: "Steady",
  unknown: "Not stated",
  other: "Other",
  CIR: "CIR",
  MDCA: "MDCA",
  MSG: "MSG",
};

export function label(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return MISSING;
  return LABELS[value] ?? value;
}

/** Up to 3 significant decimals, without trailing zeros. */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return MISSING;
  return String(Number(value.toFixed(3)));
}

/** "16 to 21", "21", or an en dash. The unit belongs in the column header. */
export function formatRange(min: number | null, max: number | null): string {
  if (min === null && max === null) return MISSING;
  const low = min ?? max;
  const high = max ?? min;
  if (low === high) return formatNumber(low);
  return `${formatNumber(low)} to ${formatNumber(high)}`;
}

export function formatList(values: readonly string[] | null | undefined): string {
  return values && values.length > 0 ? values.map((value) => label(value)).join(", ") : MISSING;
}
