"use client";

import dynamic from "next/dynamic";
import type { Data, Layout, PlotMouseEvent } from "plotly.js";
import { formatScore, partShare, type RankHabitatView, type RankPartView } from "@/lib/rankView";
import type { PartName } from "@/lib/rank";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

export const PART_COLOR: Record<PartName, string> = {
  conditions: "#1b3a8c",
  materials: "#8a5a00",
  intent: "#6d8fd4",
  airflow: "#2f6f4e",
};

const layoutBase: Partial<Layout> = {
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  font: { family: "inherit", color: "#16202e", size: 12 },
  margin: { l: 8, r: 8, t: 8, b: 8 },
};

export function RankCharts({ view }: { view: RankHabitatView }) {
  const rows = view.ranked;
  const parts = rows[0]?.parts ?? [];
  if (rows.length === 0 || parts.length === 0) return null;

  return (
    <section aria-label="Ranking charts" className="mb-6 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-base font-semibold">Score chart</h2>
      <p className="mb-4 max-w-3xl text-sm leading-6 text-muted">
        Each bar is one investigation, longest for the best match. Colors are the parts of that score. The ring is how
        much each part counts for {view.label}. Select a bar to jump to that investigation.
      </p>
      <div className="grid items-start gap-2 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div>
          <h3 className="mb-1 text-sm font-medium">Weight of each part</h3>
          <Plot
            data={[weightRing(parts)]}
            layout={{
              ...layoutBase,
              height: 240,
              showlegend: true,
              legend: { orientation: "h", y: -0.15, font: { size: 11 } },
            }}
            config={{ displayModeBar: false, responsive: true, staticPlot: true }}
            style={{ width: "100%" }}
            useResizeHandler
          />
        </div>
        <div>
          <h3 className="mb-1 text-sm font-medium">Score, best at the top</h3>
          <Plot
            data={scoreBars(rows)}
            layout={{
              ...layoutBase,
              height: Math.max(280, rows.length * 26 + 72),
              barmode: "stack",
              margin: { l: 16, r: 16, t: 8, b: 40 },
              xaxis: { title: { text: "Score (%)" }, range: [0, 100], ticksuffix: "%", fixedrange: true },
              yaxis: { automargin: true, autorange: "reversed", fixedrange: true },
              legend: { orientation: "h", y: 1.06, x: 0, traceorder: "normal" },
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: "100%", cursor: "pointer" }}
            useResizeHandler
            onClick={(event) => scrollToRow(rows, event)}
          />
        </div>
      </div>
    </section>
  );
}

export function MatchMeter({ label, value, color }: { label: string; value: number; color: string }) {
  const width = `${Math.max(0, Math.min(100, value * 100))}%`;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted">{formatScore(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-canvas">
        <div className="h-full rounded-full" style={{ width, background: color }} />
      </div>
    </div>
  );
}

function weightRing(parts: readonly RankPartView[]): Data {
  return {
    type: "pie",
    labels: parts.map((part) => part.label),
    values: parts.map((part) => partShare(part, parts)),
    hole: 0.62,
    sort: false,
    direction: "clockwise",
    marker: {
      colors: parts.map((part) => PART_COLOR[part.name]),
      line: { color: "#ffffff", width: 2 },
    },
    textinfo: "percent",
    textposition: "inside",
    hovertemplate: "%{label}<br>%{percent} of the score<extra></extra>",
  };
}

function scoreBars(rows: RankHabitatView["ranked"]): Data[] {
  const parts = rows[0]?.parts ?? [];
  const labels = rows.map((row) => row.acronym);
  const scores = rows.map((row) => formatScore(row.score));
  return parts.map((part) => ({
    type: "bar",
    orientation: "h",
    name: part.label,
    y: labels,
    x: rows.map((row) => contribution(row.parts, part.name)),
    customdata: scores,
    marker: { color: PART_COLOR[part.name] },
    hovertemplate: `%{y}<br>${part.label} adds %{x:.2f} points<br>Score %{customdata}<extra></extra>`,
  }));
}

function contribution(parts: readonly RankPartView[], name: PartName): number {
  const part = parts.find((item) => item.name === name);
  if (!part) return 0;
  return part.value * partShare(part, parts) * 100;
}

function scrollToRow(rows: RankHabitatView["ranked"], event: PlotMouseEvent) {
  const index = event.points[0]?.pointIndex;
  const id = index === undefined ? undefined : rows[index]?.id;
  if (!id) return;
  document.getElementById(`rank-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
