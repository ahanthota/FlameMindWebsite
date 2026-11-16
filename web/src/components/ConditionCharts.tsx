"use client";

import { useMemo, useState } from "react";
import type { Data, Layout } from "plotly.js";
import { PlotView } from "@/components/PlotView";
import { gravityPhrase, type HabitatGapRank } from "@/lib/gapsView";
import type { GravityName } from "@/lib/types";

export interface ChartCell {
  gravity: GravityName;
  o2Min: number;
  psiMin: number;
  covered: boolean;
}

export interface ChartSpan {
  id: string;
  acronym: string;
  o2Min: number | null;
  o2Max: number | null;
  psiMin: number | null;
  psiMax: number | null;
}

const GRAVITY: { id: GravityName; label: string }[] = [
  { id: "microgravity", label: "Microgravity" },
  { id: "partial", label: "Partial gravity" },
  { id: "normal", label: "Normal gravity" },
];

const layoutBase: Partial<Layout> = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  font: { family: "inherit", color: "#1c1917", size: 12 },
  margin: { l: 120, r: 16, t: 8, b: 48 },
};

export function ConditionCharts({
  cells,
  spans,
  gapRanks = [],
}: {
  cells: ChartCell[];
  spans: ChartSpan[];
  /** Untested oxygen-pressure cells, most habitats first. */
  gapRanks?: HabitatGapRank[];
}) {
  const [gravity, setGravity] = useState<GravityName>("microgravity");
  const selected = useMemo(() => cells.filter((cell) => cell.gravity === gravity), [cells, gravity]);
  const covered = selected.filter((cell) => cell.covered).length;
  const heatmapData = useMemo(() => [heatmap(selected)], [selected]);
  const heatmapLayout = useMemo(
    () => ({
      ...layoutBase,
      height: 460,
      margin: { l: 64, r: 16, t: 8, b: 48 },
      xaxis: { title: { text: "Oxygen (%)" }, dtick: 5 },
      yaxis: { title: { text: "Pressure (psi)" }, dtick: 1 },
    }),
    [],
  );

  return (
    <section aria-label="Oxygen and pressure charts" className="mb-8">
      <h2 className="mb-1 text-base font-semibold">Charts</h2>
      <p className="mb-4 max-w-3xl text-sm leading-6 text-muted">
        The grid shows which oxygen and pressure bands contain a stated test or range. The spans show the oxygen and
        pressure each investigation states. A missing end is left off the chart.
      </p>
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Gravity">
        {GRAVITY.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={gravity === item.id}
            onClick={() => setGravity(item.id)}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              gravity === item.id ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="rounded-lg border border-line bg-surface p-3">
        <p className="mb-2 text-sm text-muted">
          {covered} of {selected.length} cells covered
        </p>
        <PlotView data={heatmapData} layout={heatmapLayout} height={460} />
      </div>
      {gapRanks.length > 0 ? (
        <div className="mt-4 rounded-lg border border-line bg-surface p-4">
          <h3 className="text-sm font-semibold">Gaps ranked by how many habitats fall into them</h3>
          <p className="mt-1 mb-3 text-sm text-muted">
            Each row is one untested oxygen and pressure band. A habitat that was tested at its own gravity is left off.
          </p>
          <ol className="space-y-2 text-sm leading-6">
            {gapRanks.map((gap) => (
              <li key={`${gap.o2Min}-${gap.psiMin}-${gap.offGrid}`} className="flex gap-3">
                <span className="w-24 shrink-0 font-medium tabular-nums">
                  {gap.habitatCount} {gap.habitatCount === 1 ? "habitat" : "habitats"}
                </span>
                <span>
                  {gap.offGrid
                    ? "Outside the oxygen and pressure grid"
                    : `${gap.o2Min}–${gap.o2Max}% oxygen, ${gap.psiMin}–${gap.psiMax} psi`}
                  . {gap.habitats.map((habitat) => habitat.name).join(", ")}. {gap.gravities.map((gravity) => gravityPhrase(gravity)).join(", ")}.
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SpanChart title="Oxygen span (%)" axis="Oxygen (%)" spans={spans} minKey="o2Min" maxKey="o2Max" />
        <SpanChart title="Pressure span (psi)" axis="Pressure (psi)" spans={spans} minKey="psiMin" maxKey="psiMax" />
      </div>
    </section>
  );
}

function heatmap(cells: ChartCell[]): Data {
  const oxygen = [...new Set(cells.map((cell) => cell.o2Min))].sort((a, b) => a - b);
  const pressure = [...new Set(cells.map((cell) => cell.psiMin))].sort((a, b) => a - b);
  const covered = new Set(cells.filter((cell) => cell.covered).map((cell) => `${cell.o2Min}:${cell.psiMin}`));
  return {
    type: "heatmap",
    x: oxygen,
    y: pressure,
    z: pressure.map((psi) => oxygen.map((o2) => (covered.has(`${o2}:${psi}`) ? 1 : 0))),
    customdata: pressure.map((psi) => oxygen.map((o2) => (covered.has(`${o2}:${psi}`) ? "Tested" : "Not tested"))),
    colorscale: [
      [0, "#f4f1ea"],
      [1, "#1b3a8c"],
    ],
    showscale: false,
    hovertemplate: "%{x}%% oxygen, %{y} psi. %{customdata}<extra></extra>",
    xgap: 1,
    ygap: 1,
  };
}

function SpanChart({
  title,
  axis,
  spans,
  minKey,
  maxKey,
}: {
  title: string;
  axis: string;
  spans: ChartSpan[];
  minKey: "o2Min" | "psiMin";
  maxKey: "o2Max" | "psiMax";
}) {
  const rows = spans.flatMap((span) => {
    const low = span[minKey];
    const high = span[maxKey];
    if (low === null && high === null) return [];
    return [{ acronym: span.acronym, low: low ?? high ?? 0, high: high ?? low ?? 0 }];
  });
  const height = Math.max(220, rows.length * 28 + 70);
  const data: Data[] = rows.map((row) => ({
    type: "scatter",
    mode: "lines+markers",
    name: row.acronym,
    x: [row.low, row.high],
    y: [row.acronym, row.acronym],
    line: { color: "#1b3a8c", width: 3 },
    marker: { color: "#1b3a8c", size: 7 },
    hovertemplate: `${row.acronym}: %{x}<extra></extra>`,
    showlegend: false,
  }));
  const layout = {
    ...layoutBase,
    height,
    xaxis: { title: { text: axis } },
    yaxis: { automargin: true, categoryorder: "category descending" as const },
  };

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No investigation states this range.</p>
      ) : (
        <PlotView data={data} layout={layout} height={height} />
      )}
    </div>
  );
}
