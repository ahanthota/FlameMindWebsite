import type { ReactNode } from "react";
import { niceTicks, OUTCOME_SERIES } from "@/lib/charts";
import { formatNumber } from "@/lib/format";
import type { OutcomeName } from "@/lib/types";

const WIDTH = 640;
const HEIGHT = 320;
const PAD = { left: 52, right: 16, top: 14, bottom: 42 };

export interface FlammabilityPoint {
  testId: string;
  o2: number;
  flow: number;
  outcome: OutcomeName;
}

/** Each outcome has its own shape as well as its own color, so it reads without color. */
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

/**
 * Oxygen against airflow for one investigation's tests, marked by outcome.
 * No boundary is fitted or drawn: where the marks change is where the limit lies.
 */
export function FlammabilityChart({ points, total }: { points: FlammabilityPoint[]; total: number }) {
  const flows = points.map((point) => point.flow);
  const xMin = Math.min(0, ...flows);
  const xTicks = niceTicks(Math.max(...flows));
  const xMax = xTicks[xTicks.length - 1];
  const xSpan = xMax - xMin || 1;
  const oxygen = points.map((point) => point.o2);
  const low = Math.floor(Math.min(...oxygen) - 1);
  const high = Math.ceil(Math.max(...oxygen) + 1);
  const yStep = high - low > 12 ? 5 : high - low > 5 ? 2 : 1;
  const yTicks: number[] = [];
  for (let tick = Math.ceil(low / yStep) * yStep; tick <= high; tick += yStep) yTicks.push(tick);
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (value: number) => PAD.left + ((value - xMin) / xSpan) * plotW;
  const y = (value: number) => PAD.top + plotH - ((value - low) / (high - low)) * plotH;
  const present = OUTCOME_SERIES.filter((series) => points.some((point) => point.outcome === series.key));

  return (
    <figure>
      <svg
        role="img"
        aria-label={`Oxygen against airflow for ${points.length} tests, marked by outcome.`}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full max-w-3xl"
      >
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--color-line)" />
            <text x={PAD.left - 8} y={y(tick) + 3.5} textAnchor="end" fontSize="11" fill="var(--color-muted)">
              {tick}
            </text>
          </g>
        ))}
        {(xMin < 0 ? [xMin, ...xTicks] : xTicks).map((tick) => (
          <text key={tick} x={x(tick)} y={PAD.top + plotH + 16} textAnchor="middle" fontSize="11" fill="var(--color-muted)">
            {formatNumber(tick)}
          </text>
        ))}
        <text x={PAD.left + plotW / 2} y={HEIGHT - 6} textAnchor="middle" fontSize="11" fill="var(--color-muted)">
          Airflow (cm/s)
        </text>
        <text
          x={12}
          y={PAD.top + plotH / 2}
          textAnchor="middle"
          fontSize="11"
          fill="var(--color-muted)"
          transform={`rotate(-90 12 ${PAD.top + plotH / 2})`}
        >
          Oxygen (%)
        </text>
        {points.map((point) => {
          const series = OUTCOME_SERIES.find((item) => item.key === point.outcome) ?? OUTCOME_SERIES[OUTCOME_SERIES.length - 1];
          return (
            <g key={point.testId}>
              <title>
                {`${point.testId}: ${formatNumber(point.o2)}% oxygen, ${formatNumber(point.flow)} cm/s airflow. ${series.label}.`}
              </title>
              <circle cx={x(point.flow)} cy={y(point.o2)} r={11} fill="transparent" />
              {mark(point.outcome, x(point.flow), y(point.o2), series.color)}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 text-xs leading-5 text-muted">
        <ul className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          {present.map((series) => (
            <li key={series.key} className="flex items-center gap-1.5">
              <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4">
                {mark(series.key, 8, 8, series.color)}
              </svg>
              {series.label}
            </li>
          ))}
        </ul>
        {points.length} of {total} tests state both oxygen and airflow. No boundary line is drawn: the chart shows only
        the outcomes the sources state. Each test is also in the table below.
      </figcaption>
    </figure>
  );
}
