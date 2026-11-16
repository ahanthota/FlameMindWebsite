import { CoverageMap } from "@/components/CoverageMap";
import type { MapData, MapEvidence } from "@/lib/charts";

/**
 * Where an answer's cited evidence sits on the oxygen and pressure grid,
 * next to the conditions the question asked about.
 */
export function EvidenceMap({ data, evidence }: { data: MapData; evidence: MapEvidence }) {
  if (evidence.rects.length === 0 && evidence.points.length === 0) return null;
  return (
    <section aria-label="Where the cited evidence sits">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Where the cited evidence sits</h3>
      <figure className="max-w-xl rounded-lg border border-line bg-surface p-3">
        <CoverageMap data={{ ...data, habitats: [] }} evidence={evidence} />
        <figcaption className="mt-2 text-xs leading-5 text-muted">
          <ul className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1">
            {evidence.asked ? (
              <li className="flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block size-2.5 rotate-45 border-2 border-warn bg-warn-soft" />
                Your conditions
              </li>
            ) : null}
            {evidence.rects.length > 0 ? (
              <li className="flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block h-3 w-4 rounded-sm border-2 border-ink bg-ink/10" />
                Cited investigation, stated range ({evidence.rects.map((rect) => rect.label).join(", ")})
              </li>
            ) : null}
            {evidence.points.length > 0 ? (
              <li className="flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block size-2.5 rounded-full bg-ink" />
                Cited test ({evidence.points.length})
              </li>
            ) : null}
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block size-3 rounded-sm bg-accent/80" />
              Any test in the dataset
            </li>
          </ul>
          {evidence.asked ? null : "The question did not give both an oxygen level and a pressure, so no asked point is drawn. "}
          {evidence.unplaced.length > 0
            ? `Not drawn, because the record states no oxygen and pressure: ${evidence.unplaced.join(", ")}. `
            : null}
          Oxygen and pressure only. Gravity is not shown on this map.
        </figcaption>
      </figure>
    </section>
  );
}
