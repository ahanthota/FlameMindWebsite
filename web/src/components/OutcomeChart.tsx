import type { ReactNode } from "react";
import { OUTCOME_SERIES } from "@/lib/charts";
import { formatNumber } from "@/lib/format";
import type { OutcomeName } from "@/lib/types";

const WIDTH = 640;
const HEIGHT = 260;
const PAD = { left: 108, right: 16, top: 12, bottom: 40 };

export interface OutcomePoint {
  sample: string;
  x: number;
  outcome: OutcomeName;
}

/** Outcome against one varied condition. Marks only: no fitted boundary. */
export function OutcomeChart({ points, axisLabel }: { points: OutcomePoint[]; axisLabel: string }) {
  const outcomes = OUTCOME_SERIES.filter((series) => points.some((point) => point.outcome === series.key));
  const xs = points.map((point) => point.x);
  const low = Math.min(...xs);
  const high = Math.max(...xs);
  const span = high - low || 1;
  const pad = span * 0.08;
  const xMin = low - pad;
  const xMax = high + pad;
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (value: number) => PAD.left + ((value - xMin) / (xMax - xMin)) * plotW;
  const y = (index: number) => PAD.top + (outcomes.length === 1 ? plotH / 2 : (index / (outcomes.length - 1)) * plotH);
  const ticks = [low, low + (high - low) / 2, high].filter((value, index, all) => all.findIndex((item) => item === value) === index);

  return (
    <figure>
      <svg role="img" aria-label={`Outcome against ${axisLabel}`} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full max-w-3xl">
        {outcomes.map((series, index) => (
          <g key={series.key}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(index)} y2={y(index)} stroke="var(--color-line)" />
            <text x={PAD.left - 8} y={y(index) + 4} textAnchor="end" fontSize="11" fill="var(--color-muted)">
              {series.label}
            </text>
          </g>
        ))}
        {ticks.map((tick) => (
          <text key={tick} x={x(tick)} y={PAD.top + plotH + 16} textAnchor="middle" fontSize="11" fill="var(--color-muted)">
            {formatNumber(tick)}
          </text>
        ))}
        <text x={PAD.left + plotW / 2} y={HEIGHT - 4} textAnchor="middle" fontSize="11" fill="var(--color-muted)">
          {axisLabel}
        </text>
        {points.map((point, index) => {
          const series = outcomes.find((item) => item.key === point.outcome);
          const row = outcomes.findIndex((item) => item.key === point.outcome);
          if (!series || row < 0) return null;
          return <g key={`${point.sample}-${index}`}>{mark(point.outcome, x(point.x), y(row), series.color)}</g>;
        })}
      </svg>
      <figcaption className="mt-2 text-xs leading-5 text-muted">
        Outcome against {axisLabel}, the condition with the most different stated values. No boundary line is drawn.
      </figcaption>
    </figure>
  );
}

function mark(outcome: OutcomeName, cx: number, cy: number, color: string): ReactNode {
  const ring = { stroke: "var(--color-surface)", strokeWidth: 1.5 };
  switch (outcome) {
    case "extinguished":
      return <path d={`M${cx - 5} ${cy - 5} L${cx + 5} ${cy + 5} M${cx + 5} ${cy - 5} L${cx - 5} ${cy + 5}`} stroke={color} strokeWidth={3} strokeLinecap="round" />;
    case "steady":
      return <rect x={cx - 5} y={cy - 5} width={10} height={10} rx={1.5} fill={color} {...ring} />;
    case "no_ignition":
      return <path d={`M${cx} ${cy - 6.5} L${cx + 6} ${cy + 5} L${cx - 6} ${cy + 5} Z`} fill={color} {...ring} />;
    case "unknown":
      return <circle cx={cx} cy={cy} r={4.5} fill="var(--color-surface)" stroke="var(--color-muted)" strokeWidth={2} />;
    default:
      return <circle cx={cx} cy={cy} r={5.5} fill={color} {...ring} />;
  }
}
