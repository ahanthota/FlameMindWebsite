"use client";

import Link from "next/link";
import { useState } from "react";
import { CoverageLegend, CoverageMap } from "@/components/CoverageMap";
import { linkClass } from "@/components/States";
import { atSameConditions, deltaSentence, oneDecimal, type MapData } from "@/lib/charts";
import { formatNumber } from "@/lib/format";

/**
 * The coverage map with a habitat picker. Selecting a habitat draws a line to
 * the nearest tested oxygen and pressure and states the difference.
 */
export function NearestExplorer({
  data,
  investigationPages,
}: {
  data: MapData;
  /** Ids of the investigations that have their own page. */
  investigationPages: string[];
}) {
  const habitats = data.habitats.filter((habitat) => habitat.onGrid);
  const [selectedId, setSelectedId] = useState<string | null>(habitats[0]?.id ?? null);
  const selected = habitats.find((habitat) => habitat.id === selectedId) ?? null;
  const nearest = selected?.nearest ?? null;

  return (
    <section aria-label="Nearest tested conditions" className="mb-8">
      <h2 className="mb-1 text-base font-semibold">How far is the nearest test?</h2>
      <p className="mb-3 max-w-3xl text-sm leading-6 text-muted">
        Shaded cells hold at least one test. Pick a habitat to see the closest tested oxygen and pressure, at any
        gravity. Matching oxygen and pressure is not the same as matching gravity.
      </p>

      <div role="group" aria-label="Habitat" className="mb-3 flex flex-wrap gap-2">
        {habitats.map((habitat) => (
          <button
            key={habitat.id}
            type="button"
            aria-pressed={habitat.id === selectedId}
            onClick={() => setSelectedId(habitat.id)}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              habitat.id === selectedId ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink hover:border-accent"
            }`}
          >
            {habitat.marker}. {habitat.name}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <figure className="rounded-lg border border-line bg-surface p-3">
          <CoverageMap data={data} selectedId={selectedId} onSelect={setSelectedId} />
          <figcaption className="mt-2">
            <CoverageLegend data={data} />
          </figcaption>
        </figure>

        <div aria-live="polite" className="rounded-lg border border-line bg-surface p-4 text-sm leading-6">
          {selected ? (
            <>
              <h3 className="text-base font-semibold">
                <span className="mr-1.5 text-muted">{selected.marker}.</span>
                {selected.name}
              </h3>
              <p className="text-muted">
                {formatNumber(selected.o2)}% oxygen · {formatNumber(selected.psi)} psi
              </p>

              {nearest ? (
                <dl className="mt-3 space-y-3">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted">Nearest tested conditions</dt>
                    <dd>
                      {oneDecimal(nearest.o2)}% oxygen at {oneDecimal(nearest.psi)} psi, in {nearest.gravity}, from{" "}
                      {investigationPages.includes(nearest.investigationId) ? (
                        <Link href={`/investigations/${nearest.investigationId}/`} className={linkClass}>
                          {nearest.acronym}
                        </Link>
                      ) : (
                        nearest.acronym
                      )}
                      .
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted">Difference</dt>
                    <dd className="font-medium">
                      {atSameConditions(nearest)
                        ? "None: this oxygen and pressure is inside a tested range."
                        : `The nearest test is ${deltaSentence(nearest)}.`}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-3">No investigation in this dataset states both oxygen and pressure.</p>
              )}

              <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
                {selected.statuses.map((status) => (
                  <li key={status} className={status.startsWith("Tested") ? "" : "text-warn"}>
                    {status}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-muted">No habitat atmosphere falls on this grid.</p>
          )}
        </div>
      </div>
    </section>
  );
}
