import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { EmptyState, linkClass } from "@/components/States";
import { getInvestigation, investigations } from "@/lib/data";
import { testPressurePsi } from "@/lib/filters";
import { formatList, formatNumber, formatRange, label, MISSING } from "@/lib/format";
import type { Finding, Investigation, SourceRef } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

// Static export: one page per investigation in the dataset, nothing else.
export const dynamicParams = false;

export function generateStaticParams() {
  return investigations.map((item) => ({ id: item.id }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const item = getInvestigation(id);
  return { title: item ? `${item.acronym} (${item.id})` : "Investigation not found" };
}

const FINDING_GROUPS: { key: keyof Pick<Investigation, "key_findings" | "ignition_findings" | "flame_spread_findings" | "extinction_findings">; title: string }[] = [
  { key: "key_findings", title: "Key findings" },
  { key: "ignition_findings", title: "Ignition" },
  { key: "flame_spread_findings", title: "Flame spread" },
  { key: "extinction_findings", title: "Extinction" },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6 rounded-lg border border-line bg-surface p-5">
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

function SourceLink({ source }: { source: SourceRef }) {
  return (
    <span>
      <a href={source.url} target="_blank" rel="noreferrer" className={linkClass}>
        {source.title}, p. {source.page}
      </a>
      {source.doi ? (
        <>
          {" "}
          (
          <a href={`https://doi.org/${source.doi}`} target="_blank" rel="noreferrer" className={linkClass}>
            DOI
          </a>
          )
        </>
      ) : null}
    </span>
  );
}

function uniqueSources(sources: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.file_name}#${source.page}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function FindingList({ findings }: { findings: Finding[] }) {
  return (
    <ul className="space-y-3">
      {findings.map((finding, index) => (
        <li key={index} className="border-l-2 border-accent-soft pl-3 text-sm leading-6">
          <p>{finding.text}</p>
          <p className="mt-0.5 text-xs text-muted">
            Source:{" "}
            {uniqueSources(finding.evidence).map((source, position) => (
              <span key={`${source.file_name}#${source.page}`}>
                {position > 0 ? "; " : null}
                <SourceLink source={source} />
              </span>
            ))}
          </p>
        </li>
      ))}
    </ul>
  );
}

function BulletList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <Empty>{empty}</Empty>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export default async function InvestigationPage({ params }: Params) {
  const { id } = await params;
  const item = getInvestigation(id);
  if (!item) notFound();

  const conditions: { parameter: string; value: string; unit: string }[] = [
    { parameter: "Oxygen", value: formatRange(item.o2_percent_min, item.o2_percent_max), unit: "% by volume" },
    { parameter: "Pressure", value: formatRange(item.pressure_psi_min, item.pressure_psi_max), unit: "psi" },
    { parameter: "Pressure", value: formatRange(item.pressure_kpa_min, item.pressure_kpa_max), unit: "kPa" },
    { parameter: "Airflow", value: formatRange(item.flow_cm_s_min, item.flow_cm_s_max), unit: "cm/s" },
    { parameter: "Gravity", value: label(item.gravity), unit: "" },
    { parameter: "Diluents", value: formatList(item.diluents), unit: "" },
    { parameter: "Fuel phase", value: label(item.fuel_phase), unit: "" },
    { parameter: "Fuels", value: formatList(item.fuels), unit: "" },
    { parameter: "Sample geometry", value: item.sample_geometry ?? MISSING, unit: "" },
    { parameter: "Sample size", value: item.sample_size ?? MISSING, unit: "as stated" },
    { parameter: "Hardware", value: label(item.hardware), unit: "" },
    { parameter: "Platform", value: formatList(item.platform), unit: "" },
    { parameter: "Years", value: item.years ?? MISSING, unit: "" },
  ];
  const findingCount = FINDING_GROUPS.reduce((total, group) => total + item[group.key].length, 0);

  return (
    <article>
      <p className="mb-3 text-sm">
        <Link href="/explore/" className={linkClass}>
          ← Explore
        </Link>
      </p>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{item.acronym}</h1>
            <span className="rounded bg-canvas px-2 py-0.5 text-xs font-medium text-muted ring-1 ring-line">{item.id}</span>
            {item.category.map((category) => (
              <span key={category} className="rounded bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                {label(category)}
              </span>
            ))}
            {item.needs_review ? (
              <span
                className="rounded bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn"
                title="This extracted record is flagged for a manual check against the source documents."
              >
                Needs review
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-muted">{item.name}</p>
        </div>
        <a
          href={item.psi_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center rounded-md border border-accent px-3 py-2 text-sm font-medium text-accent hover:bg-accent-soft"
        >
          View raw data on PSI ↗
        </a>
      </header>

      {item.needs_review ? (
        <p className="mb-6 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
          Needs review: this record is flagged for a manual check. Confirm values against the linked sources before
          relying on them.
        </p>
      ) : null}

      <Section title="Objectives">
        <BulletList items={item.objectives} empty="No objectives are recorded for this investigation." />
        {item.approach ? <p className="mt-3 text-sm leading-6 text-muted">{item.approach}</p> : null}
      </Section>

      <Section title="Conditions">
        <div className="overflow-x-auto">
          <table className="w-full max-w-3xl border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-muted">
                <th scope="col" className="py-2 pr-4 font-medium">Parameter</th>
                <th scope="col" className="py-2 pr-4 font-medium">Tested value or range</th>
                <th scope="col" className="py-2 font-medium">Unit</th>
              </tr>
            </thead>
            <tbody>
              {conditions.map((row) => (
                <tr key={`${row.parameter}-${row.unit}`} className="border-b border-line last:border-b-0">
                  <th scope="row" className="py-2 pr-4 align-top font-medium">{row.parameter}</th>
                  <td className="py-2 pr-4 align-top">{row.value}</td>
                  <td className="py-2 align-top text-muted">{row.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">A dash means the sources do not state the value.</p>
      </Section>

      <div className="grid gap-x-6 lg:grid-cols-3">
        <Section title="Variables varied">
          <BulletList items={item.variables_varied} empty="None recorded." />
        </Section>
        <Section title="Variables held fixed">
          <BulletList items={item.variables_fixed} empty="None recorded." />
        </Section>
        <Section title="Sensors">
          <BulletList items={item.sensors} empty="None recorded." />
        </Section>
      </div>

      <Section title={`Findings (${findingCount})`}>
        {findingCount === 0 ? (
          <Empty>No findings are recorded for this investigation.</Empty>
        ) : (
          <div className="space-y-5">
            {FINDING_GROUPS.filter((group) => item[group.key].length > 0).map((group) => (
              <div key={group.key}>
                <h3 className="mb-2 text-sm font-semibold text-muted">{group.title}</h3>
                <FindingList findings={item[group.key]} />
              </div>
            ))}
          </div>
        )}
        {item.fire_safety_relevance ? (
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="mb-1 text-sm font-semibold text-muted">Fire safety relevance</h3>
            <p className="text-sm leading-6">{item.fire_safety_relevance}</p>
          </div>
        ) : null}
      </Section>

      <Section title={`Tests (${item.tests.length})`}>
        {item.tests.length === 0 ? (
          <EmptyState title="No individual tests recorded">
            The sources for this investigation do not list separate test samples.
          </EmptyState>
        ) : (
          <div className="max-h-[36rem] overflow-auto rounded-md border border-line">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 bg-canvas">
                <tr className="border-b border-line">
                  {["Test", "Sample", "Fuel", "Sample geometry"].map((header) => (
                    <th key={header} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{header}</th>
                  ))}
                  {["O2 (%)", "Pressure (psi)", "Airflow (cm/s)"].map((header) => (
                    <th key={header} scope="col" className="whitespace-nowrap px-3 py-2 text-right font-medium">{header}</th>
                  ))}
                  <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Diluent</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Outcome</th>
                  <th scope="col" className="whitespace-nowrap px-3 py-2 text-right font-medium">Spread rate (mm/s)</th>
                  <th scope="col" className="px-3 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {item.tests.map((test, index) => (
                  <tr key={index} className="border-b border-line align-top last:border-b-0">
                    <td className="whitespace-nowrap px-3 py-2">{`${item.id}-T${index + 1}`}</td>
                    <td className="px-3 py-2">{test.sample_id ?? MISSING}</td>
                    <td className="px-3 py-2">{test.fuel ?? MISSING}</td>
                    <td className="px-3 py-2">{test.sample_geometry ?? MISSING}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(test.o2_percent)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(testPressurePsi(test))}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(test.flow_cm_s)}</td>
                    <td className="px-3 py-2">{test.diluent ?? MISSING}</td>
                    <td className="whitespace-nowrap px-3 py-2">{label(test.outcome)}</td>
                    <td className="px-3 py-2 text-right">{formatNumber(test.spread_rate_mm_s)}</td>
                    <td className="min-w-64 px-3 py-2 text-muted">{test.notes ?? MISSING}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={`Sources (${uniqueSources(item.sources).length})`}>
        {item.sources.length === 0 ? (
          <Empty>No source pages are recorded.</Empty>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
            {uniqueSources(item.sources).map((source) => (
              <li key={`${source.file_name}#${source.page}`}>
                <SourceLink source={source} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </article>
  );
}
