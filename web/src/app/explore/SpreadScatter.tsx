"use client";

import { useState } from "react";
import { niceTicks, RAMP_GRADIENT, rampColor } from "@/lib/charts";
import type { TestRow } from "@/lib/filters";
import { formatNumber } from "@/lib/format";

const WIDTH = 640;
const HEIGHT = 300;
const PAD = { left: 52, right: 16, top: 14, bottom: 42 };

/**
 * Flame spread rate against airflow for the tests in the table, colored by
 * oxygen. Only tests that state both values can be placed, so the caption says
 * how many that is.
 */
export function SpreadScatter({ rows }: { rows: TestRow[] }) {
  const [active, setActive] = useState<string | null>(null);
  const points = rows.flatMap((row) =>
    row.flow !== null && row.spreadRate !== null ? [{ row, flow: row.flow, spread: row.spreadRate }] : [],
  );

  if (points.length === 0) {
    return (
      <p className="mb-4 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-muted">
        Spread rate against airflow: none of the {rows.length.toLocaleString("en-US")} listed tests state both values,
        so there is nothing to plot.
      </p>
    );
  }

  const xTicks = niceTicks(Math.max(...points.map((point) => point.flow)));
  const yTicks = niceTicks(Math.max(...points.map((point) => point.spread)));
  const xMax = xTicks[xTicks.length - 1];
  const yMax = yTicks[yTicks.length - 1];
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (value: number) => PAD.left + (value / xMax) * plotW;
  const y = (value: number) => PAD.top + plotH - (value / yMax) * plotH;

  const oxygen = points.flatMap((point) => (point.row.o2 === null ? [] : [point.row.o2]));
  const o2Min = oxygen.length > 0 ? Math.min(...oxygen) : 0;
  const o2Max = oxygen.length > 0 ? Math.max(...oxygen) : 0;
  const unstated = points.length - oxygen.length;
  const hovered = points.find((point) => point.row.testId === active) ?? null;

  return (
    <figure className="mb-4 rounded-lg border border-line bg-surface p-4">
      <figcaption className="mb-2">
        <h2 className="text-sm font-semibold">Flame spread rate against airflow</h2>
        <p className="text-xs text-muted">
          {points.length.toLocaleString("en-US")} of the {rows.length.toLocaleString("en-US")} listed tests state both
          values. The rest cannot be placed.
        </p>
      </figcaption>

      <div className="relative">
        <svg
          role="img"
          aria-label={`Scatter of flame spread rate against airflow for ${points.length} tests, colored by oxygen.`}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full max-w-3xl"
        >
          {yTicks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--color-line)" />
              <text x={PAD.left - 8} y={y(tick) + 3.5} textAnchor="end" fontSize="11" fill="var(--color-muted)">
                {formatNumber(tick)}
              </text>
            </g>
          ))}
          {xTicks.map((tick) => (
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
            Spread rate (mm/s)
          </text>

          {points.map(({ row, flow, spread }) => {
            const on = row.testId === active;
            return (
              <g
                key={row.testId}
                tabIndex={0}
                role="img"
                aria-label={describe(row, flow, spread)}
                onMouseEnter={() => setActive(row.testId)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(row.testId)}
                onBlur={() => setActive(null)}
              >
                <circle cx={x(flow)} cy={y(spread)} r={13} fill="transparent" />
                <circle
                  cx={x(flow)}
                  cy={y(spread)}
                  r={on ? 7 : 5.5}
                  fill={row.o2 === null ? "var(--color-surface)" : rampColor(row.o2, o2Min, o2Max)}
                  stroke={row.o2 === null ? "var(--color-muted)" : "var(--color-surface)"}
                  strokeWidth={2}
                />
              </g>
            );
          })}
        </svg>

        {hovered ? (
          <div
            role="status"
            className="pointer-events-none absolute z-10 w-max max-w-64 -translate-x-1/2 -translate-y-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-sm"
            style={{
              left: `${Math.min(Math.max((x(hovered.flow) / WIDTH) * 100, 18), 82)}%`,
              top: `calc(${(y(hovered.spread) / HEIGHT) * 100}% - 10px)`,
            }}
          >
            <p className="font-medium">
              {hovered.row.testId} · {hovered.row.acronym}
            </p>
            <p className="text-muted">
              {formatNumber(hovered.flow)} cm/s airflow · {formatNumber(hovered.spread)} mm/s spread ·{" "}
              {hovered.row.o2 === null ? "oxygen not stated" : `${formatNumber(hovered.row.o2)}% oxygen`}
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {oxygen.length > 0 ? (
          <span className="flex items-center gap-2">
            Oxygen
            <span>{formatNumber(o2Min)}%</span>
            {o2Max > o2Min ? (
              <>
                <span aria-hidden="true" className="inline-block h-2.5 w-24 rounded-sm" style={{ background: RAMP_GRADIENT }} />
                <span>{formatNumber(o2Max)}%</span>
              </>
            ) : (
              <span aria-hidden="true" className="inline-block size-2.5 rounded-full" style={{ background: rampColor(o2Min, o2Min, o2Max) }} />
            )}
          </span>
        ) : null}
        {unstated > 0 ? (
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block size-2.5 rounded-full border-2 border-muted bg-surface" />
            Oxygen not stated ({unstated})
          </span>
        ) : null}
      </div>
    </figure>
  );
}

function describe(row: TestRow, flow: number, spread: number): string {
  const oxygen = row.o2 === null ? "oxygen not stated" : `${formatNumber(row.o2)}% oxygen`;
  return `${row.testId}, ${row.acronym}: ${formatNumber(flow)} cm/s airflow, ${formatNumber(spread)} mm/s spread rate, ${oxygen}.`;
}
