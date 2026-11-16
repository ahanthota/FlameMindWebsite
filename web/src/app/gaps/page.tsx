import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, linkClass } from "@/components/States";
import { ConditionCharts } from "@/components/ConditionCharts";
import { CoverageChart } from "@/components/CoverageChart";
import { NearestExplorer } from "@/components/NearestExplorer";
import { buildMapData } from "@/lib/charts";
import { buildCoverageMarks } from "@/lib/coverageChart";
import { gaps, getInvestigation, habitats, investigations } from "@/lib/data";
import { formatNumber } from "@/lib/format";
import {
  binIndex,
  coveragePhrase,
  gravityPhrase,
  gravityStatus,
  groupHabitatReports,
  habitatsAtGravity,
  rankHabitatGaps,
  sameNeighbors,
} from "@/lib/gapsView";
import type { GapCell, GravityName, Habitat, HabitatCoverage, NearestTested } from "@/lib/types";

export const metadata: Metadata = { title: "Gaps" };

const MAP_GRAVITY: GravityName[] = ["microgravity", "partial", "normal"];

export default function GapsPage() {
  const reports = gaps.habitats;
  const partial = gaps.grid.coverage.partial;
  const partialGap = gaps.gaps.find((gap) => gap.id === "no_partial_gravity");
  const marks = buildCoverageMarks(investigations);
  const groups = groupHabitatReports(reports);
  const catalog = new Map(habitats.map((habitat) => [habitat.id, habitat]));
  const acronyms = new Map<string, string>();
  for (const item of [...gaps.placements, ...gaps.unplaced]) {
    if (item.investigation_id && item.acronym) acronyms.set(item.investigation_id, item.acronym);
  }

  if (reports.length === 0) {
    return (
      <>
        <PageHeader title="Gaps">Where tested oxygen and pressure do not cover habitat atmospheres.</PageHeader>
        <EmptyState title="No habitat coverage yet">
          data/gaps.json has no habitat rows. Run the gaps step in the pipeline, then rebuild the site.
        </EmptyState>
      </>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Gaps">
        Where the oxygen and pressure in this dataset cover a habitat atmosphere, and where they do not. Coverage uses
        the {gaps.investigation_count} structured investigations. A gravity the investigations did not run is left empty.
      </PageHeader>

      <section aria-label="Coverage by gravity" className="mb-6">
        <dl className="grid gap-3 sm:grid-cols-3">
          {MAP_GRAVITY.map((gravity) => {
            const row = gaps.grid.coverage[gravity];
            const covered = row?.covered_cells ?? 0;
            const total = row?.total_cells ?? 0;
            const empty = covered === 0;
            return (
              <div key={gravity} className="rounded-lg border border-line bg-surface p-4">
                <dt className="text-sm text-muted">{gravityPhrase(gravity)}</dt>
                <dd className={`mt-1 text-2xl font-semibold tabular-nums ${empty ? "text-warn" : "text-ink"}`}>
                  {coveragePhrase(covered, total)}
                </dd>
                <dd className="mt-1 text-xs text-muted">Oxygen–pressure cells with a test</dd>
              </div>
            );
          })}
        </dl>
      </section>

      <CoverageChart
        points={marks.points}
        boxes={marks.boxes}
        habitats={habitats.map((habitat) => ({
          id: habitat.id,
          name: habitat.name,
          o2: habitat.o2_percent,
          psi: habitat.pressure_psi,
        }))}
        reports={reports}
        investigationPages={investigations.map((item) => item.id)}
      />

      <NearestExplorer data={buildMapData(gaps)} investigationPages={investigations.map((item) => item.id)} />

      <section className="mb-6 rounded-lg border border-warn/30 bg-warn-soft px-4 py-4 text-sm leading-6">
        <h2 className="text-base font-semibold text-warn">
          No partial-gravity combustion data in PSI yet; upcoming LUCI and FM2 experiments
        </h2>
        <p className="mt-1">
          {partialGap?.text ??
            "No PSI combustion investigation in this dataset was run at Moon or Mars gravity. Habitat presets at partial gravity can only be compared with microgravity and 1 g results."}
        </p>
        <p className="mt-2">
          <Link href="/investigations/PSI-22/" className={linkClass}>
            E-FIELD Flames (PSI-22)
          </Link>{" "}
          is a partial stand-in. It flew in microgravity and uses an electric field to mimic some gravity effects, so it
          does not fill this partial-gravity grid.
        </p>
        <p className="mt-2">Microgravity and 1 g results bound behavior at lunar and Martian gravity.</p>
        <p className="mt-2 text-xs text-muted">
          Partial gravity: {coveragePhrase(partial?.covered_cells ?? 0, partial?.total_cells ?? 0)} cells tested.
        </p>
      </section>

      <section aria-label="Coverage maps" className="mb-8">
        <h2 className="mb-1 text-base font-semibold">Oxygen and pressure grid</h2>
        <p className="mb-4 max-w-3xl text-sm leading-6 text-muted">
          Each cell is a 5 percentage-point oxygen band and a 1 psi pressure band, from 15% to 100% oxygen and from 2
          psi to 16 psi. A filled cell has at least one structured investigation at that gravity. A numbered dot is a
          habitat atmosphere.
        </p>
        <div className="grid gap-4 xl:grid-cols-3">
          {MAP_GRAVITY.map((gravity) => (
            <CoverageMap
              key={gravity}
              gravity={gravity}
              cells={gaps.grid.cells.filter((cell) => cell.gravity === gravity)}
              o2Edges={gaps.grid.o2_percent_edges}
              psiEdges={gaps.grid.pressure_psi_edges}
              habitats={habitatsAtGravity(reports, gravity)}
            />
          ))}
        </div>
      </section>

      <ConditionCharts
        gapRanks={rankHabitatGaps(reports, gaps.grid.o2_percent_edges, gaps.grid.pressure_psi_edges)}
        cells={gaps.grid.cells.map((cell) => ({
          gravity: cell.gravity,
          o2Min: cell.o2_min,
          psiMin: cell.psi_min,
          covered: cell.covered,
        }))}
        spans={investigations.flatMap((item) => {
          const hasOxygen = item.o2_percent_min !== null || item.o2_percent_max !== null;
          const hasPressure = item.pressure_psi_min !== null || item.pressure_psi_max !== null;
          if (!hasOxygen && !hasPressure) return [];
          return [
            {
              id: item.id,
              acronym: item.acronym,
              o2Min: item.o2_percent_min,
              o2Max: item.o2_percent_max,
              psiMin: item.pressure_psi_min,
              psiMax: item.pressure_psi_max,
            },
          ];
        })}
      />

      <section aria-label="Habitats" className="mb-8">
        <h2 className="mb-1 text-base font-semibold">Habitats</h2>
        <p className="mb-4 max-w-3xl text-sm leading-6 text-muted">
          {gaps.grid.distance_note.replace(/^distance/, "Distance")} A distance of 0 in microgravity does not mean Moon
          or Mars gravity was tested.
        </p>
        <div className="space-y-4">
          {groups.map((group) => (
            <HabitatCard
              key={group[0].habitat_id}
              reports={group}
              catalog={catalog.get(group[0].habitat_id)}
              acronyms={acronyms}
            />
          ))}
        </div>
      </section>

      <section aria-label="Investigations left off the grid" className="mb-6">
        <h2 className="mb-1 text-base font-semibold">Left off the grid</h2>
        <p className="mb-3 max-w-3xl text-sm leading-6 text-muted">
          These investigations are in the dataset and were run in microgravity. They have no stated oxygen or pressure
          to place in a cell, so they do not change the counts above.
        </p>
        {gaps.unplaced.length === 0 ? (
          <EmptyState title="Every structured investigation is on the grid" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th scope="col" className="px-3 py-2 font-medium">Investigation</th>
                  <th scope="col" className="px-3 py-2 font-medium">Gravity</th>
                  <th scope="col" className="px-3 py-2 font-medium">Why it is off the grid</th>
                </tr>
              </thead>
              <tbody>
                {gaps.unplaced.map((item) => (
                  <tr key={item.investigation_id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2">
                      <InvestigationName id={item.investigation_id} acronym={item.acronym} />
                    </td>
                    <td className="px-3 py-2">{gravityPhrase(item.gravity)}</td>
                    <td className="px-3 py-2 text-muted">{unplacedReason(item.reason)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function CoverageMap({
  gravity,
  cells,
  o2Edges,
  psiEdges,
  habitats,
}: {
  gravity: GravityName;
  cells: GapCell[];
  o2Edges: number[];
  psiEdges: number[];
  habitats: HabitatCoverage[];
}) {
  const cols = Math.max(o2Edges.length - 1, 1);
  const rows = Math.max(psiEdges.length - 1, 1);
  const cellW = 16;
  const cellH = 12;
  const padL = 32;
  const padB = 22;
  const padT = 6;
  const padR = 6;
  const width = padL + cols * cellW + padR;
  const height = padT + rows * cellH + padB;
  const byKey = new Map(cells.map((cell) => [`${cell.o2_min}:${cell.psi_min}`, cell]));
  const covered = cells.filter((cell) => cell.covered).length;
  const phrase = coveragePhrase(covered, cells.length);
  const summary = `${gravityPhrase(gravity)}: ${phrase} cells tested.`;

  return (
    <figure className="rounded-lg border border-line bg-surface p-3">
      <figcaption className="mb-2 text-sm font-medium">
        {gravityPhrase(gravity)}
        <span className="ml-2 font-normal text-muted">{phrase} cells</span>
      </figcaption>
      <svg
        role="img"
        aria-label={summary}
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
      >
        <title>{summary}</title>
        {Array.from({ length: cols }, (_, column) =>
          Array.from({ length: rows }, (_, row) => {
            const o2 = o2Edges[column];
            const psi = psiEdges[row];
            const cell = byKey.get(`${o2}:${psi}`);
            const x = padL + column * cellW;
            const y = padT + (rows - 1 - row) * cellH;
            return (
              <rect
                key={`${o2}:${psi}`}
                x={x + 0.5}
                y={y + 0.5}
                width={cellW - 1}
                height={cellH - 1}
                rx={1}
                fill={cell?.covered ? "var(--color-accent)" : "var(--color-canvas)"}
                stroke="var(--color-line)"
              >
                <title>
                  {`${o2}–${o2Edges[column + 1]}% oxygen, ${psi}–${psiEdges[row + 1]} psi. ${
                    cell?.covered ? "Tested." : "Not tested."
                  }`}
                </title>
              </rect>
            );
          }),
        )}
        {psiEdges.filter((_, index) => index % 4 === 0).map((psi) => {
          const row = binIndex(psiEdges, psi);
          if (row === null) return null;
          const y = padT + (rows - 1 - row) * cellH + cellH / 2;
          return (
            <text key={psi} x={padL - 4} y={y + 3} textAnchor="end" fontSize="8" fill="var(--color-muted)">
              {psi}
            </text>
          );
        })}
        {o2Edges.filter((_, index) => index % 4 === 0).map((o2) => {
          const column = binIndex(o2Edges, o2);
          if (column === null && o2 !== o2Edges[0]) return null;
          const index = column ?? 0;
          return (
            <text
              key={o2}
              x={padL + index * cellW}
              y={height - 6}
              textAnchor="middle"
              fontSize="8"
              fill="var(--color-muted)"
            >
              {o2}
            </text>
          );
        })}
        {habitats.map((habitat, index) => {
          const column = binIndex(o2Edges, habitat.o2_percent);
          const row = binIndex(psiEdges, habitat.pressure_psi);
          if (column === null || row === null) return null;
          const cx = padL + column * cellW + cellW / 2 + (index % 3) * 3 - 3;
          const cy = padT + (rows - 1 - row) * cellH + cellH / 2;
          const marker = habitatMarker(habitat.habitat_id);
          return (
            <g key={habitat.habitat_id}>
              <circle
                cx={cx}
                cy={cy}
                r={6}
                fill={habitat.inside_tested ? "var(--color-surface)" : "var(--color-warn)"}
                stroke="var(--color-ink)"
              />
              <text x={cx} y={cy + 2.5} textAnchor="middle" fontSize="8" fontWeight="600" fill="var(--color-ink)">
                {marker}
              </text>
              <title>
                {`${marker}. ${habitat.name}: ${habitat.o2_percent}% oxygen, ${habitat.pressure_psi} psi. ${gravityStatus(habitat)}`}
              </title>
            </g>
          );
        })}
      </svg>
      <ul className="mt-2 space-y-1 text-xs leading-5 text-muted">
        {habitats.map((habitat) => (
          <li key={habitat.habitat_id}>
            <span className="font-medium text-ink">{habitatMarker(habitat.habitat_id)}.</span> {habitat.name}
            {habitat.inside_tested ? " — tested at this gravity" : " — not tested at this gravity"}
          </li>
        ))}
        {habitats.length === 0 ? <li>No habitat atmosphere is defined at this gravity.</li> : null}
      </ul>
    </figure>
  );
}

function HabitatCard({
  reports,
  catalog,
  acronyms,
}: {
  reports: HabitatCoverage[];
  catalog: Habitat | undefined;
  acronyms: Map<string, string>;
}) {
  const first = reports[0];
  const marker = habitatMarker(first.habitat_id);
  return (
    <article className="rounded-lg border border-line bg-surface p-5">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">
            <span className="mr-2 text-muted">{marker}.</span>
            {first.name}
          </h3>
          <p className="mt-1 text-sm text-muted">
            {formatNumber(first.o2_percent)}% oxygen · {formatNumber(first.pressure_psi)} psi ·{" "}
            {formatNumber(first.pressure_kpa)} kPa
            {catalog?.gravity_g != null ? ` · ${formatNumber(catalog.gravity_g)} g` : ""}
          </p>
        </div>
        {first.assumed ? (
          <span className="rounded bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">Assumed atmosphere</span>
        ) : null}
      </header>
      {catalog?.source_note ? <p className="mb-4 text-sm leading-6">{catalog.source_note}</p> : null}
      <div className="space-y-5">
        {reports.map((report) => (
          <GravityBlock key={`${report.habitat_id}-${report.gravity}`} report={report} acronyms={acronyms} />
        ))}
      </div>
    </article>
  );
}

function GravityBlock({ report, acronyms }: { report: HabitatCoverage; acronyms: Map<string, string> }) {
  const tested = report.inside_tested;
  const showAny = !sameNeighbors(report.nearest_same_gravity, report.nearest_any_gravity);
  return (
    <div>
      <p className={`text-sm font-medium ${tested ? "text-ink" : "text-warn"}`}>{gravityStatus(report)}</p>
      {tested && report.covering_investigation_ids.length > 0 ? (
        <p className="mt-2 text-sm">
          Covered by{" "}
          {report.covering_investigation_ids.map((id, index) => (
            <span key={id}>
              {index > 0 ? ", " : null}
              <InvestigationName id={id} acronym={acronyms.get(id) ?? id} />
            </span>
          ))}
          .
        </p>
      ) : null}
      {report.nearest_same_gravity.length > 0 ? (
        <NeighborTable title={`Nearest at ${gravityPhrase(report.gravity)}`} rows={report.nearest_same_gravity} />
      ) : (
        <p className="mt-2 text-sm text-muted">No investigation in this dataset was run in {gravityPhrase(report.gravity)}.</p>
      )}
      {showAny ? (
        <NeighborTable title="Nearest oxygen and pressure at another gravity" rows={report.nearest_any_gravity} />
      ) : null}
    </div>
  );
}

function NeighborTable({ title, rows }: { title: string; rows: NearestTested[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-3">
      <h4 className="mb-1 text-sm font-medium text-muted">{title}</h4>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-muted">
                <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">Investigation</th>
                <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">Gravity</th>
                <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">Taken from</th>
                <th scope="col" className="whitespace-nowrap py-2 pr-3 text-right font-medium">Nearest O2 (%)</th>
                <th scope="col" className="whitespace-nowrap py-2 pr-3 text-right font-medium">Nearest pressure (psi)</th>
                <th scope="col" className="whitespace-nowrap py-2 pr-3 text-right font-medium">Δ oxygen (%)</th>
                <th scope="col" className="whitespace-nowrap py-2 pr-3 text-right font-medium">Δ pressure (psi)</th>
                <th scope="col" className="whitespace-nowrap py-2 text-right font-medium">Distance (scaled)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.investigation_id}-${row.gravity}`} className="border-b border-line last:border-b-0">
                  <td className="py-2 pr-3">
                    <InvestigationName id={row.investigation_id} acronym={row.acronym} />
                  </td>
                  <td className="py-2 pr-3">{gravityPhrase(row.gravity)}</td>
                  <td className="py-2 pr-3">{row.basis === "tests" ? "Individual tests" : "Stated range"}</td>
                  <td className="py-2 pr-3 text-right">{formatNumber(row.nearest_o2_percent)}</td>
                  <td className="py-2 pr-3 text-right">{formatNumber(row.nearest_pressure_psi)}</td>
                  <td className="py-2 pr-3 text-right">{signed(row.delta_o2_percent)}</td>
                  <td className="py-2 pr-3 text-right">{signed(row.delta_pressure_psi)}</td>
                  <td className="py-2 text-right">{formatDistance(row.distance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
    </div>
  );
}

function InvestigationName({ id, acronym }: { id: string; acronym: string }) {
  const text = `${acronym} (${id})`;
  if (!getInvestigation(id)) return <span className="whitespace-nowrap">{text}</span>;
  return (
    <Link href={`/investigations/${id}/`} className={`${linkClass} whitespace-nowrap`}>
      {text}
    </Link>
  );
}

function habitatMarker(id: string): string {
  const index = ["moon_base", "moon_base_upper_pressure", "spacesuit", "iss", "mars_habitat", "earth_sea_level"].indexOf(id);
  return index >= 0 ? String(index + 1) : id;
}

function signed(value: number): string {
  const text = formatNumber(value);
  return value > 0 ? `+${text}` : text;
}

function formatDistance(value: number): string {
  return String(Number(value.toFixed(4)));
}

function unplacedReason(reason: string): string {
  if (reason === "no pressure values in tests or ranges") {
    return "No pressure is stated in the tests or the investigation range.";
  }
  if (reason === "no oxygen or pressure values in tests or ranges") {
    return "No oxygen or pressure is stated in the tests or the investigation range.";
  }
  return reason;
}
