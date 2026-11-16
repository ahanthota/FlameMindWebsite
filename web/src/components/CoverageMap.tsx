import { atSameConditions, deltaLabel, type MapData, type MapHabitat } from "@/lib/charts";
import { formatNumber } from "@/lib/format";

const CELL_W = 30;
const CELL_H = 20;
const PAD = { left: 46, right: 14, top: 12, bottom: 40 };
const MARKER_R = 9;

/**
 * Oxygen against pressure: shaded cells have a test, numbered dots are habitat
 * atmospheres. With `onSelect` the dots are buttons, and the selected habitat
 * gets a line to its nearest tested oxygen and pressure.
 *
 * No hooks, so it renders on the server (home page preview) or inside a client
 * component (Gaps page).
 */
export function CoverageMap({
  data,
  selectedId,
  onSelect,
  compact = false,
}: {
  data: MapData;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Fewer labels, for the home page preview. */
  compact?: boolean;
}) {
  const { o2Edges, psiEdges } = data;
  const cols = Math.max(o2Edges.length - 1, 1);
  const rows = Math.max(psiEdges.length - 1, 1);
  const plotW = cols * CELL_W;
  const plotH = rows * CELL_H;
  const width = PAD.left + plotW + PAD.right;
  const height = PAD.top + plotH + PAD.bottom;
  const o2Min = o2Edges[0] ?? 0;
  const o2Max = o2Edges[o2Edges.length - 1] ?? 1;
  const psiMin = psiEdges[0] ?? 0;
  const psiMax = psiEdges[psiEdges.length - 1] ?? 1;
  const x = (o2: number) => PAD.left + ((o2 - o2Min) / (o2Max - o2Min || 1)) * plotW;
  const y = (psi: number) => PAD.top + ((psiMax - psi) / (psiMax - psiMin || 1)) * plotH;
  const covered = new Set(data.covered.map((cell) => `${cell.o2Min}:${cell.psiMin}`));

  const shown = data.habitats.filter((habitat) => habitat.onGrid);
  const positions = spread(shown.map((habitat) => ({ habitat, cx: x(habitat.o2), cy: y(habitat.psi) })));
  const selectedAt = positions.find((item) => item.habitat.id === selectedId) ?? null;
  const summary = `Oxygen and pressure coverage: ${data.covered.length} of ${data.cellCount} cells have a test. ${shown.length} habitat atmospheres are marked.`;

  return (
    <svg role="img" aria-label={summary} viewBox={`0 0 ${width} ${height}`} className="h-auto w-full">
      <title>{summary}</title>

      {Array.from({ length: cols }, (_, column) =>
        Array.from({ length: rows }, (_, row) => {
          const o2 = o2Edges[column];
          const psi = psiEdges[row];
          const tested = covered.has(`${o2}:${psi}`);
          return (
            <rect
              key={`${o2}:${psi}`}
              x={PAD.left + column * CELL_W + 1}
              y={PAD.top + (rows - 1 - row) * CELL_H + 1}
              width={CELL_W - 2}
              height={CELL_H - 2}
              rx={2}
              fill={tested ? "var(--color-accent)" : "var(--color-canvas)"}
              fillOpacity={tested ? 0.82 : 1}
            >
              <title>
                {`${o2}–${o2Edges[column + 1]}% oxygen, ${psi}–${psiEdges[row + 1]} psi. ${tested ? "Tested." : "Not tested."}`}
              </title>
            </rect>
          );
        }),
      )}

      {/* Axes: ticks every 10 points of oxygen and every 2 psi. */}
      {o2Edges
        .filter((edge) => edge % 10 === 0)
        .map((edge) => (
          <text key={edge} x={x(edge)} y={PAD.top + plotH + 14} textAnchor="middle" fontSize="10" fill="var(--color-muted)">
            {edge}
          </text>
        ))}
      {psiEdges
        .filter((edge) => edge % 2 === 0)
        .map((edge) => (
          <text key={edge} x={PAD.left - 6} y={y(edge) + 3.5} textAnchor="end" fontSize="10" fill="var(--color-muted)">
            {edge}
          </text>
        ))}
      <text x={PAD.left + plotW / 2} y={height - 6} textAnchor="middle" fontSize="11" fill="var(--color-muted)">
        Oxygen (%)
      </text>
      <text
        x={12}
        y={PAD.top + plotH / 2}
        textAnchor="middle"
        fontSize="11"
        fill="var(--color-muted)"
        transform={`rotate(-90 12 ${PAD.top + plotH / 2})`}
      >
        Pressure (psi)
      </text>

      {selectedAt ? (
        <NearestLine
          key={selectedAt.habitat.id}
          habitat={selectedAt.habitat}
          from={{ x: selectedAt.cx, y: selectedAt.cy }}
          x={x}
          y={y}
          bounds={{ width, top: PAD.top }}
        />
      ) : null}

      {positions.map(({ habitat, cx, cy }) => {
        const active = habitat.id === selectedId;
        const label = `${habitat.marker}. ${habitat.name}: ${formatNumber(habitat.o2)}% oxygen, ${formatNumber(habitat.psi)} psi. ${
          habitat.tested ? "Tested at its gravity." : "Not tested at its gravity."
        }`;
        return (
          <g
            key={habitat.id}
            {...(onSelect
              ? {
                  role: "button",
                  tabIndex: 0,
                  "aria-label": label,
                  "aria-pressed": active,
                  onClick: () => onSelect(habitat.id),
                  onKeyDown: (event: { key: string; preventDefault: () => void }) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(habitat.id);
                    }
                  },
                  style: { cursor: "pointer" },
                }
              : {})}
          >
            <title>{label}</title>
            {/* Larger than the dot, so it is easy to hit. */}
            <circle cx={cx} cy={cy} r={MARKER_R + 5} fill="transparent" />
            <circle
              cx={cx}
              cy={cy}
              r={MARKER_R}
              fill={habitat.tested ? "var(--color-surface)" : "var(--color-warn-soft)"}
              stroke={habitat.tested ? "var(--color-ink)" : "var(--color-warn)"}
              strokeWidth={active ? 3 : 1.5}
            />
            {compact ? null : (
              <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--color-ink)">
                {habitat.marker}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Dots at (nearly) the same point are set side by side so each can be seen and selected. */
function spread(items: { habitat: MapHabitat; cx: number; cy: number }[]) {
  const placed: { habitat: MapHabitat; cx: number; cy: number }[] = [];
  const groups: (typeof items)[] = [];
  for (const item of items) {
    const group = groups.find((members) => Math.hypot(members[0].cx - item.cx, members[0].cy - item.cy) < MARKER_R * 2);
    if (group) group.push(item);
    else groups.push([item]);
  }
  for (const group of groups) {
    group.forEach((item, index) => {
      placed.push({ ...item, cx: item.cx + (index - (group.length - 1) / 2) * (MARKER_R * 2 + 2) });
    });
  }
  return placed;
}

/** From the habitat to its nearest tested point: a drawn line with the difference, or a ring when they coincide. */
function NearestLine({
  habitat,
  from,
  x,
  y,
  bounds,
}: {
  habitat: MapHabitat;
  /** Where the habitat's dot is drawn. */
  from: { x: number; y: number };
  x: (o2: number) => number;
  y: (psi: number) => number;
  bounds: { width: number; top: number };
}) {
  const nearest = habitat.nearest;
  if (!nearest) return null;
  const fromX = from.x;
  const fromY = from.y;

  if (atSameConditions(nearest)) {
    // No distance to draw: a ring closes in on the dot. White under ink, so it shows on any cell.
    return (
      <g aria-hidden="true" className="fm-pulse">
        <circle cx={fromX} cy={fromY} r={MARKER_R + 6} fill="none" stroke="var(--color-surface)" strokeWidth={5} />
        <circle cx={fromX} cy={fromY} r={MARKER_R + 6} fill="none" stroke="var(--color-ink)" strokeWidth={2} />
      </g>
    );
  }

  const toX = x(nearest.o2);
  const toY = y(nearest.psi);
  const length = Math.hypot(toX - fromX, toY - fromY);
  const text = deltaLabel(nearest);
  const labelW = text.length * 5.6 + 14;
  const labelX = Math.min(Math.max((fromX + toX) / 2, labelW / 2 + 2), bounds.width - labelW / 2 - 2);
  const labelY = Math.max((fromY + toY) / 2 - 14, bounds.top + 10);
  return (
    <g aria-hidden="true">
      <line
        className="fm-draw"
        x1={fromX}
        y1={fromY}
        x2={toX}
        y2={toY}
        stroke="var(--color-ink)"
        strokeWidth={2}
        strokeLinecap="round"
        style={{ "--fm-length": length } as React.CSSProperties}
      />
      <g className="fm-fade">
        <circle cx={toX} cy={toY} r={6} fill="var(--color-ink)" stroke="var(--color-surface)" strokeWidth={2} />
        <rect
          x={labelX - labelW / 2}
          y={labelY - 10}
          width={labelW}
          height={16}
          rx={4}
          fill="var(--color-surface)"
          stroke="var(--color-line)"
        />
        <text x={labelX} y={labelY + 1.5} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--color-ink)">
          {text}
        </text>
      </g>
    </g>
  );
}

/** What the fills and dots mean. Shown under the map. */
export function CoverageLegend({ data }: { data: MapData }) {
  const where = data.coveredGravities.length > 0 ? ` (${data.coveredGravities.join(", ")})` : "";
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="inline-block size-3 rounded-sm bg-accent/80" />
        Has a test{where}
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="inline-block size-3 rounded-sm border border-line bg-canvas" />
        No test
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="inline-block size-3 rounded-full border-[1.5px] border-warn bg-warn-soft" />
        Habitat, not tested at its gravity
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="inline-block size-3 rounded-full border-[1.5px] border-ink bg-surface" />
        Habitat, tested at its gravity
      </li>
    </ul>
  );
}
