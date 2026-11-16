import { domainPercent } from "@/lib/charts";
import type { Range } from "@/lib/filters";
import { formatRange, MISSING } from "@/lib/format";

/**
 * A tested range as a bar on a scale shared by the whole column, so rows can
 * be compared by eye. The numbers stay underneath. An active filter on the same
 * value is shaded behind the bar.
 */
export function RangeBar({
  range,
  domain,
  filter,
  unit,
}: {
  range: Range;
  /** Lowest and highest value in the column. Null when the column has no spread to draw. */
  domain: [number, number] | null;
  filter: Range;
  unit: string;
}) {
  if (range.min === null && range.max === null) return <span className="text-muted">{MISSING}</span>;
  const text = formatRange(range.min, range.max);
  if (!domain) return <>{text}</>;

  const low = domainPercent(range.min ?? range.max!, domain);
  const high = domainPercent(range.max ?? range.min!, domain);
  const filtered = filter.min !== null || filter.max !== null;
  const filterLow = filter.min === null ? 0 : domainPercent(filter.min, domain);
  const filterHigh = filter.max === null ? 100 : domainPercent(filter.max, domain);
  return (
    <div className="ml-auto w-28" title={`${text} ${unit}. Scale: ${domain[0]} to ${domain[1]} ${unit}.`}>
      <div aria-hidden="true" className="relative h-2.5 rounded-sm bg-canvas">
        {filtered ? (
          <span
            className="absolute inset-y-0 rounded-sm bg-warn-soft ring-1 ring-warn/40"
            style={{ left: `${filterLow}%`, width: `${Math.max(filterHigh - filterLow, 0)}%` }}
          />
        ) : null}
        <span
          className="absolute inset-y-0.5 min-w-1.5 rounded-sm bg-accent"
          style={{ left: `min(${low}%, calc(100% - 0.375rem))`, width: `${Math.max(high - low, 0)}%` }}
        />
      </div>
      <p className="mt-1 text-right text-xs">{text}</p>
    </div>
  );
}
