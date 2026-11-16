import Link from "next/link";
import type { Timeline as TimelineData } from "@/lib/charts";

const LABEL_W = 132;
const ROW_H = 22;
const GROUP_H = 26;
const WIDTH = 760;
const PAD = { right: 16, top: 8, bottom: 26 };

/** Investigations by the years their record states, grouped by hardware. */
export function Timeline({ data }: { data: TimelineData }) {
  if (data.groups.length === 0) return null;
  const first = Math.floor(data.start / 5) * 5;
  const last = Math.ceil((data.end + 1) / 5) * 5;
  const plotW = WIDTH - LABEL_W - PAD.right;
  const x = (year: number) => LABEL_W + ((year - first) / (last - first)) * plotW;
  const ticks: number[] = [];
  for (let year = first; year <= last; year += 5) ticks.push(year);

  let cursor = PAD.top;
  const groups = data.groups.map((group) => {
    const top = cursor;
    cursor += GROUP_H + group.rows.length * ROW_H;
    return { ...group, top };
  });
  const height = cursor + PAD.bottom;

  return (
    <figure>
      <div className="overflow-x-auto">
        <svg
          role="img"
          aria-label={`Timeline of ${groups.reduce((sum, group) => sum + group.rows.length, 0)} investigations from ${data.start} to ${data.end}, grouped by hardware.`}
          viewBox={`0 0 ${WIDTH} ${height}`}
          className="h-auto w-full min-w-[36rem]"
        >
          {ticks.map((year) => (
            <g key={year}>
              <line x1={x(year)} x2={x(year)} y1={PAD.top} y2={cursor} stroke="var(--color-line)" />
              <text x={x(year)} y={cursor + 16} textAnchor="middle" fontSize="11" fill="var(--color-muted)">
                {year}
              </text>
            </g>
          ))}
          {groups.map((group) => (
            <g key={group.label}>
              <text x={0} y={group.top + 17} fontSize="11" fontWeight="600" fill="var(--color-ink)">
                {group.label}
              </text>
              {group.rows.map((row, index) => {
                const top = group.top + GROUP_H + index * ROW_H;
                // A single year still gets a visible mark: it spans that year.
                const left = x(row.start);
                const right = x(row.end + 1);
                return (
                  <g key={row.id}>
                    <title>{`${row.acronym} (${row.id}): ${row.start === row.end ? row.start : `${row.start} to ${row.end}`}`}</title>
                    <text x={LABEL_W - 8} y={top + 13} textAnchor="end" fontSize="11" fill="var(--color-muted)">
                      {row.acronym.length > 20 ? `${row.acronym.slice(0, 19)}…` : row.acronym}
                    </text>
                    <rect x={left} y={top + 4} width={Math.max(right - left, 4)} height={12} rx={3} fill="var(--color-accent)" fillOpacity={0.85} />
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      </div>
      <figcaption className="mt-2 text-xs leading-5 text-muted">
        Years are the ones each record states. A bar covers its first to its last stated year.
        {data.undated.length > 0 ? ` Not shown, because the record states no years: ${data.undated.join(", ")}.` : ""}{" "}
        <Link href="/explore/" className="font-medium text-accent underline-offset-2 hover:underline">
          See every investigation in Explore
        </Link>
        .
      </figcaption>
    </figure>
  );
}
