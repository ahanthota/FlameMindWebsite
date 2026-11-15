/**
 * Science data, imported from ../data at build time. Nothing is fetched at
 * runtime. Import this from Server Components only: investigations.json is
 * large, so pages pass the rows they need to Client Components as props.
 */

import gapsJson from "../../../data/gaps.json";
import habitatsJson from "../../../data/habitats.json";
import insightsJson from "../../../data/insights.json";
import investigationsJson from "../../../data/investigations.json";
import type { GapsFile, Habitat, Insight, Investigation } from "./types";

export const investigations = investigationsJson as unknown as Investigation[];
export const habitats = habitatsJson as unknown as Habitat[];
export const gaps = gapsJson as unknown as GapsFile;
export const insights = insightsJson as unknown as Insight[];

const byId = new Map(investigations.map((item) => [item.id, item]));

export function getInvestigation(id: string): Investigation | undefined {
  return byId.get(id);
}
