/**
 * Types for the JSON in ../data. Written by hand to match pipeline/schema.py.
 * Unknown values are null, never guessed.
 */

export type Hardware = "CIR" | "MDCA" | "MSG" | "other";
export type PlatformName = "ISS" | "drop_tower" | "parabolic_flight" | "sounding_rocket";
export type CategoryName = "prevention" | "detection" | "suppression";
export type FuelPhase = "solid" | "liquid" | "gas";
export type GravityName = "microgravity" | "normal" | "partial" | "simulated_partial";
export type OutcomeName = "ignited" | "no_ignition" | "extinguished" | "steady" | "unknown";
export type TierName = "A" | "B";

/** Page-level citation. `page` is the page marker in the processed text. */
export interface SourceRef {
  file_name: string;
  title: string;
  url: string;
  doi: string | null;
  page: number;
}

/** A statement taken from the source text, with the page it came from. */
export interface Finding {
  text: string;
  evidence: SourceRef[];
}

/** One stated test sample. */
export interface TestCondition {
  sample_id: string | null;
  fuel: string | null;
  sample_geometry: string | null;
  /** Oxygen, percent by volume. */
  o2_percent: number | null;
  pressure_kpa: number | null;
  pressure_psi: number | null;
  /** Forced flow speed, cm/s. */
  flow_cm_s: number | null;
  diluent: string | null;
  outcome: OutcomeName;
  /** Flame spread rate, mm/s. */
  spread_rate_mm_s: number | null;
  notes: string | null;
  evidence: SourceRef[];
  reviewed?: boolean;
  reviewed_by?: string | null;
}

/** One PSI investigation. */
export interface Investigation {
  id: string;
  name: string;
  acronym: string;
  tier: TierName;
  psi_url: string;
  program: string | null;
  hardware: Hardware | null;
  platform: PlatformName[];
  years: string | null;
  objectives: string[];
  approach: string | null;
  category: CategoryName[];
  fuel_phase: FuelPhase | null;
  fuels: string[];
  sample_geometry: string | null;
  sample_size: string | null;
  o2_percent_min: number | null;
  o2_percent_max: number | null;
  pressure_kpa_min: number | null;
  pressure_kpa_max: number | null;
  pressure_psi_min: number | null;
  pressure_psi_max: number | null;
  flow_cm_s_min: number | null;
  flow_cm_s_max: number | null;
  gravity: GravityName | null;
  diluents: string[];
  variables_varied: string[];
  variables_fixed: string[];
  sensors: string[];
  tests: TestCondition[];
  ignition_findings: Finding[];
  flame_spread_findings: Finding[];
  extinction_findings: Finding[];
  key_findings: Finding[];
  fire_safety_relevance: string;
  sources: SourceRef[];
  needs_review: boolean;
  reviewed?: boolean;
  reviewed_by?: string | null;
}

/** A habitat atmosphere preset from data/habitats.json. */
export interface Habitat {
  id: string;
  name: string;
  o2_percent: number;
  pressure_psi: number;
  pressure_kpa: number;
  /** Fraction of Earth gravity. null in orbit. */
  gravity_g: number | null;
  gravity_classes: GravityName[];
  assumed: boolean;
  source_note: string;
  source_url: string | null;
}

export interface Insight {
  id: string;
  title: string;
  text: string;
  category: CategoryName;
  habitats: string[];
  investigation_ids: string[];
  sources: SourceRef[];
}

export interface GapCell {
  gravity: GravityName;
  o2_min: number;
  o2_max: number;
  psi_min: number;
  psi_max: number;
  covered: boolean;
  investigation_ids: string[];
}

export interface NearestTested {
  investigation_id: string;
  acronym: string;
  gravity: GravityName;
  basis: "tests" | "ranges";
  nearest_o2_percent: number;
  nearest_pressure_psi: number;
  delta_o2_percent: number;
  delta_pressure_psi: number;
  distance: number;
}

export interface HabitatCoverage {
  habitat_id: string;
  name: string;
  o2_percent: number;
  pressure_psi: number;
  pressure_kpa: number;
  gravity: GravityName;
  assumed: boolean;
  on_grid: boolean;
  inside_tested: boolean;
  covering_investigation_ids: string[];
  nearest_same_gravity: NearestTested[];
  nearest_any_gravity: NearestTested[];
}

export interface Gap {
  id: string;
  title: string;
  text: string;
  notes?: string[];
  habitat_id?: string;
  gravity?: GravityName;
  related_investigation_ids: string[];
}

/** data/gaps.json, written by pipeline/gaps.py. */
export interface GapsFile {
  source: string;
  investigation_count: number;
  grid: {
    o2_percent_edges: number[];
    pressure_psi_edges: number[];
    gravity_classes: GravityName[];
    distance_note: string;
    coverage: Record<string, { covered_cells: number; total_cells: number }>;
    cells: GapCell[];
  };
  placements: { investigation_id: string; acronym: string; gravity: GravityName; basis: string; points: number }[];
  unplaced: { investigation_id: string; acronym: string; gravity: GravityName; reason: string }[];
  habitats: HabitatCoverage[];
  gaps: Gap[];
}
