import type { Metadata } from "next";
import { buildMapData, type EvidenceSource } from "@/lib/charts";
import { gaps, investigations } from "@/lib/data";
import { Chat } from "./Chat";

function statedSpan(low: number | null, high: number | null): [number, number] | null {
  if (low === null || high === null) return null;
  return [Math.min(low, high), Math.max(low, high)];
}

function evidenceSource(): EvidenceSource {
  const ranges: EvidenceSource["ranges"] = {};
  const tests: EvidenceSource["tests"] = {};
  for (const item of investigations) {
    ranges[item.id] = {
      acronym: item.acronym,
      o2: statedSpan(item.o2_percent_min, item.o2_percent_max),
      psi: statedSpan(item.pressure_psi_min, item.pressure_psi_max),
    };
    item.tests.forEach((test, index) => {
      if (test.o2_percent !== null && test.pressure_psi !== null) {
        tests[`${item.id}-T${index + 1}`] = [test.o2_percent, test.pressure_psi];
      }
    });
  }
  return { ranges, tests };
}

export const metadata: Metadata = { title: "Scenario" };

export default function ScenarioPage() {
  // Names for the investigations that have their own page, so answer cards can link to them.
  const names = Object.fromEntries(investigations.map((item) => [item.id, { acronym: item.acronym, name: item.name }]));
  return <Chat investigations={names} evidence={{ map: buildMapData(gaps), source: evidenceSource() }} />;
}
