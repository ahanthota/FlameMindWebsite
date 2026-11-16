"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Data, Layout, PlotMouseEvent } from "plotly.js";
import { HabitatArt, hasHabitatPhoto } from "@/components/HabitatArt";
import { PlotView } from "@/components/PlotView";
import { linkClass } from "@/components/States";
import {
  FUEL_COLOR,
  fuelKey,
  fuelLabel,
  HABITAT_SHORT,
  type CoverageBox,
  type CoveragePoint,
} from "@/lib/coverageChart";
import { formatNumber } from "@/lib/format";
import { gravityPhrase, gravityStatus, sameNeighbors } from "@/lib/gapsView";
import type { HabitatCoverage, NearestTested } from "@/lib/types";

export interface ChartHabitat {
  id: string;
  name: string;
  o2: number;
  psi: number;
}

const PHASES = ["solid", "liquid", "gas", "unstated"] as const;

/**
 * Oxygen against pressure. Tests that state both values are points. An
 * investigation with no such test is the rectangle of the range it states.
 * Color is fuel phase. Habitat atmospheres are labeled markers.
 */
export function CoverageChart({
  points,
  boxes,
  habitats,
  reports = [],
  investigationPages = [],
  compact = false,
}: {
  points: CoveragePoint[];
  boxes: CoverageBox[];
  habitats: ChartHabitat[];
  reports?: HabitatCoverage[];
  investigationPages?: string[];
  /** Chart only, for the home page preview. */
  compact?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(habitats.find((item) => item.id === "moon_base")?.id ?? habitats[0]?.id ?? null);
  const selected = habitats.find((item) => item.id === selectedId) ?? null;
  const selectedReports = reports.filter((report) => report.habitat_id === selectedId);
  const data = useMemo(() => traces(points, boxes, habitats, selectedId), [points, boxes, habitats, selectedId]);
  const layout = useMemo(() => chartLayout(compact), [compact]);
  const height = compact ? 300 : 480;
  const plot = (
    <PlotView
      data={data}
      layout={layout}
      height={height}
      onClick={(event: PlotMouseEvent) => {
        const point = event.points?.[0];
        const payload = point?.customdata;
        const id = Array.isArray(payload) ? payload[0] : payload;
        if (point?.data?.name === "Habitats" && typeof id === "string") setSelectedId(id);
      }}
    />
  );

  if (compact) return plot;

  return (
    <section aria-label="Coverage chart" className="mb-8">
      <h2 className="mb-1 text-base font-semibold">Tested oxygen and pressure</h2>
      <p className="mb-3 max-w-3xl text-sm leading-6 text-muted">
        Each point is a test that states both oxygen and pressure. A rectangle is an investigation whose tests do not
        state both, drawn from the range it does state. Color is the fuel phase. Select a habitat to see whether that
        atmosphere was tested.
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
            {HABITAT_SHORT[habitat.id] ?? habitat.name}
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)]">
        <div className="rounded-lg border border-line bg-surface p-3">{plot}</div>
        <div aria-live="polite" className="rounded-lg border border-line bg-surface p-4 text-sm leading-6">
          {selected ? (
            <>
              {hasHabitatPhoto(selected.id) ? (
                <>
                  <HabitatArt id={selected.id} />
                  <p className="mt-1 text-xs text-muted">Photograph: NASA.</p>
                </>
              ) : null}
              <h3 className={`text-base font-semibold ${hasHabitatPhoto(selected.id) ? "mt-3" : ""}`}>{selected.name}</h3>
              <p className="text-muted">
                {formatNumber(selected.o2)}% oxygen · {formatNumber(selected.psi)} psi
              </p>
              {selectedReports.length === 0 ? (
                <p className="mt-3">This habitat has no coverage row in the dataset.</p>
              ) : (
                selectedReports.map((report) => (
                  <div key={`${report.habitat_id}-${report.gravity}`} className="mt-3 border-t border-line pt-3">
                    <p className={report.inside_tested ? "font-medium" : "font-medium text-warn"}>{gravityStatus(report)}</p>
                    <NearestList
                      title={`Nearest in ${gravityPhrase(report.gravity)}`}
                      rows={report.nearest_same_gravity}
                      pages={investigationPages}
                    />
                    {sameNeighbors(report.nearest_same_gravity, report.nearest_any_gravity) ? null : (
                      <NearestList title="Nearest at another gravity" rows={report.nearest_any_gravity} pages={investigationPages} />
                    )}
                  </div>
                ))
              )}
            </>
          ) : (
            <p className="text-muted">Select a habitat.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function NearestList({ title, rows, pages }: { title: string; rows: NearestTested[]; pages: string[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-2">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted">{title}</h4>
      <ul className="mt-1 space-y-1">
        {rows.slice(0, 3).map((row) => (
          <li key={`${row.investigation_id}-${row.gravity}`}>
            {pages.includes(row.investigation_id) ? (
              <Link href={`/investigations/${row.investigation_id}/`} className={linkClass}>
                {row.acronym}
              </Link>
            ) : (
              row.acronym
            )}
            <span className="text-muted">
              {" "}
              · {formatNumber(row.nearest_o2_percent)}% oxygen, {formatNumber(row.nearest_pressure_psi)} psi,{" "}
              {gravityPhrase(row.gravity)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function traces(points: CoveragePoint[], boxes: CoverageBox[], habitats: ChartHabitat[], selectedId: string | null): Data[] {
  const shown = new Set<string>();
  const data: Data[] = [];
  for (const phase of PHASES) {
    const phaseBoxes = boxes.filter((box) => fuelKey(box.fuelPhase) === phase);
    const phasePoints = points.filter((point) => fuelKey(point.fuelPhase) === phase);
    const color = FUEL_COLOR[phase];
    if (phaseBoxes.length === 0 && phasePoints.length === 0) continue;
    phaseBoxes.forEach((box, index) => {
      const flat = box.o2Min === box.o2Max && box.psiMin === box.psiMax;
      data.push({
        type: "scatter",
        mode: flat ? "markers" : "lines",
        x: flat ? [box.o2Min] : [box.o2Min, box.o2Max, box.o2Max, box.o2Min, box.o2Min],
        y: flat ? [box.psiMin] : [box.psiMin, box.psiMin, box.psiMax, box.psiMax, box.psiMin],
        fill: flat ? "none" : "toself",
        fillcolor: hexAlpha(color, 0.15),
        line: { color, width: 2 },
        marker: { color, size: 9, symbol: "square" },
        name: fuelLabel(phase === "unstated" ? null : phase),
        legendgroup: phase,
        showlegend: !shown.has(phase) && index === 0 && phasePoints.length === 0,
        hovertemplate: `${box.hover.replaceAll("%", "%%")}<extra></extra>`,
      });
    });
    if (phasePoints.length > 0) {
      data.push({
        type: "scatter",
        mode: "markers",
        x: phasePoints.map((point) => point.o2),
        y: phasePoints.map((point) => point.psi),
        marker: { color, size: 7 },
        name: fuelLabel(phase === "unstated" ? null : phase),
        legendgroup: phase,
        showlegend: true,
        customdata: phasePoints.map((point) => point.hover),
        hovertemplate: "%{customdata}<extra></extra>",
      });
      shown.add(phase);
    }
  }
  if (habitats.length > 0) {
    data.push({
      type: "scatter",
      mode: "markers+text",
      name: "Habitats",
      x: habitats.map((habitat) => habitat.o2),
      y: habitats.map((habitat) => habitat.psi),
      text: habitats.map((habitat) => HABITAT_SHORT[habitat.id] ?? habitat.name),
      textposition: "top center",
      customdata: habitats.map((habitat) => [habitat.id, `${habitat.name}<br>${habitat.o2}% oxygen, ${habitat.psi} psi`]),
      marker: {
        symbol: "diamond",
        size: habitats.map((habitat) => (habitat.id === selectedId ? 16 : 11)),
        color: habitats.map((habitat) => (habitat.id === selectedId ? "#1b3a8c" : "#16202e")),
        line: { color: "#ffffff", width: 1 },
      },
      hovertemplate: "%{customdata[1]}<extra></extra>",
    });
  }
  return data;
}

function chartLayout(compact: boolean): Partial<Layout> {
  return {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { family: "inherit", color: "#16202e", size: 12 },
    height: compact ? 300 : 480,
    margin: compact ? { l: 52, r: 12, t: 8, b: 64 } : { l: 56, r: 16, t: 8, b: 72 },
    xaxis: { title: { text: "Oxygen (%)" }, zeroline: false, gridcolor: "#dfe3e8" },
    yaxis: { title: { text: "Pressure (psi)" }, zeroline: false, gridcolor: "#dfe3e8" },
    legend: { orientation: "h", y: -0.22, font: { size: 11 } },
    showlegend: true,
  };
}

function hexAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
