import { formatRange } from "@/lib/format";

const COLORS = ["#1b3a8c", "#c2410c", "#0f766e", "#7c3aed", "#b45309", "#be123c", "#1d4ed8", "#3f6212"];

export interface OverlayRange {
  id: string;
  acronym: string;
  o2Min: number | null;
  o2Max: number | null;
  pressureMin: number | null;
  pressureMax: number | null;
}

const WIDTH = 720;
const HEIGHT = 360;
const PAD = { left: 52, right: 16, top: 16, bottom: 40 };

/**
 * Oxygen and pressure ranges of several investigations on one chart.
 * A rectangle is drawn only when the record states both ends of both axes.
 */
export function RangeOverlay({ items }: { items: OverlayRange[] }) {
  const boxes = items.flatMap((item, index) => {
    if (item.o2Min === null || item.o2Max === null || item.pressureMin === null || item.pressureMax === null) return [];
    return [
      {
        ...item,
        color: COLORS[index % COLORS.length],
        o2: [Math.min(item.o2Min, item.o2Max), Math.max(item.o2Min, item.o2Max)] as const,
        psi: [Math.min(item.pressureMin, item.pressureMax), Math.max(item.pressureMin, item.pressureMax)] as const,
      },
    ];
  });
  const missing = items.filter((item) => !boxes.some((box) => box.id === item.id)).map((item) => item.acronym);
  if (boxes.length === 0) {
    return <p className="text-sm text-muted">None of the selected investigations state both an oxygen range and a pressure range.</p>;
  }

  const o2Values = boxes.flatMap((box) => [...box.o2]);
  const psiValues = boxes.flatMap((box) => [...box.psi]);
  const o2Pad = Math.max(1, (Math.max(...o2Values) - Math.min(...o2Values)) * 0.08);
  const psiPad = Math.max(0.4, (Math.max(...psiValues) - Math.min(...psiValues)) * 0.08);
  const o2Min = Math.min(...o2Values) - o2Pad;
  const o2Max = Math.max(...o2Values) + o2Pad;
  const psiMin = Math.min(...psiValues) - psiPad;
  const psiMax = Math.max(...psiValues) + psiPad;
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (value: number) => PAD.left + ((value - psiMin) / (psiMax - psiMin)) * plotW;
  const y = (value: number) => PAD.top + plotH - ((value - o2Min) / (o2Max - o2Min)) * plotH;
  const xTicks = ticks(psiMin, psiMax, 5);
  const yTicks = ticks(o2Min, o2Max, 5);

  return (
    <figure>
      <svg
        role="img"
        aria-label={`Oxygen and pressure ranges for ${boxes.map((box) => box.acronym).join(", ")}.`}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
      >
        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--color-line)" />
            <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="var(--color-muted)">
              {formatTick(tick)}
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <text key={`x-${tick}`} x={x(tick)} y={PAD.top + plotH + 16} textAnchor="middle" fontSize="11" fill="var(--color-muted)">
            {formatTick(tick)}
          </text>
        ))}
        <text x={PAD.left + plotW / 2} y={HEIGHT - 6} textAnchor="middle" fontSize="11" fill="var(--color-muted)">
          Pressure (psi)
        </text>
        <text x={14} y={PAD.top + plotH / 2} textAnchor="middle" fontSize="11" fill="var(--color-muted)" transform={`rotate(-90 14 ${PAD.top + plotH / 2})`}>
          Oxygen (%)
        </text>
        {boxes.map((box) => {
          const left = x(box.psi[0]);
          const right = x(box.psi[1]);
          const top = y(box.o2[1]);
          const bottom = y(box.o2[0]);
          const width = Math.max(right - left, 6);
          const height = Math.max(bottom - top, 6);
          return (
            <g key={box.id}>
              <title>{`${box.acronym}: oxygen ${formatRange(box.o2[0], box.o2[1])}%, pressure ${formatRange(box.psi[0], box.psi[1])} psi`}</title>
              <rect x={left} y={top} width={width} height={height} fill={box.color} fillOpacity={0.18} stroke={box.color} strokeWidth={2} rx={2} />
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 text-xs leading-5 text-muted">
        <ul className="mb-1 flex flex-wrap gap-x-4 gap-y-1">
          {boxes.map((box) => (
            <li key={box.id} className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-3 w-4 rounded-sm border-2" style={{ borderColor: box.color, background: box.color, opacity: 0.45 }} />
              {box.acronym}
            </li>
          ))}
        </ul>
        Each rectangle is the oxygen and pressure range that investigation states.
        {missing.length > 0 ? ` Not drawn, because a full range is not stated: ${missing.join(", ")}.` : ""}
      </figcaption>
    </figure>
  );
}

function ticks(low: number, high: number, count: number): number[] {
  const step = (high - low) / count;
  return Array.from({ length: count + 1 }, (_, index) => low + step * index);
}

function formatTick(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 100) return String(Math.round(value));
  if (abs >= 10) return String(Number(value.toFixed(1)));
  return String(Number(value.toFixed(2)));
}
