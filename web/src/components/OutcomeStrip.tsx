import { OUTCOME_SERIES, outcomeSummary, statedOutcomes, type OutcomeCounts } from "@/lib/charts";
import { MISSING } from "@/lib/format";

/** A thin stacked bar: how many of an investigation's tests ended in each outcome. */
export function OutcomeStrip({ counts }: { counts: OutcomeCounts }) {
  const total = OUTCOME_SERIES.reduce((sum, series) => sum + counts[series.key], 0);
  if (total === 0) return <span className="text-muted">{MISSING}</span>;
  const summary = outcomeSummary(counts);
  return (
    <div className="w-36" title={summary}>
      <div role="img" aria-label={`Outcomes: ${summary}`} className="flex h-2.5 gap-0.5">
        {OUTCOME_SERIES.filter((series) => counts[series.key] > 0).map((series) => (
          <span
            key={series.key}
            className="min-w-1 rounded-sm"
            style={{ flexGrow: counts[series.key], flexBasis: 0, background: series.color }}
          />
        ))}
      </div>
      <p className="mt-1 whitespace-nowrap text-xs text-muted">
        {statedOutcomes(counts)} of {total} stated
      </p>
    </div>
  );
}

/** The colors of the outcome strip. Shown once above the table. */
export function OutcomeLegend() {
  return (
    <ul aria-label="Outcome colors" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      <li className="font-medium text-ink">Outcomes</li>
      {OUTCOME_SERIES.map((series) => (
        <li key={series.key} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2.5 w-4 rounded-sm" style={{ background: series.color }} />
          {series.label}
        </li>
      ))}
    </ul>
  );
}
