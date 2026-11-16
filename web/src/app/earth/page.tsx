import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, linkClass } from "@/components/States";
import { getInvestigation, insights } from "@/lib/data";
import type { Insight } from "@/lib/types";
import { EarthCard } from "./EarthCard";

export const metadata: Metadata = { title: "Earth applications" };

const SMOKE_ID = "same-ionization-smoke-detection";
const MODELS_ID = "bass-ii-models-on-earth";
const QUENCH_ID = "bass-low-flow-quenching";

export default function EarthPage() {
  const smoke = insights.find((item) => item.id === SMOKE_ID) ?? null;
  const models = insights.find((item) => item.id === MODELS_ID) ?? null;
  const quench = insights.find((item) => item.id === QUENCH_ID) ?? null;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Earth applications">
        Fine water mist, smoke detection, and firefighter gear are the Earth-side topics in the challenge. An
        investigation is attached only where one of its findings states the link.
      </PageHeader>
      <div className="grid items-stretch gap-5 sm:grid-cols-2 xl:grid-cols-3">
        <EarthCard
          image="/images/earth/water-mist.jpg"
          imageAlt="Illustration of a water-mist nozzle beside a small flame. Not a photograph from a NASA test."
          badges={[{ label: "Suppression", tone: "accent" }]}
          title="Fine water mist"
          meta="No investigation attached"
        >
          Fine water mist is studied as a way to suppress a fire with less water than a sprinkler, including in a
          sealed cabin. No finding in this dataset states a water-mist result, so no investigation is attached here.
        </EarthCard>

        <EarthCard
          image="/images/earth/smoke-detector.jpg"
          imageAlt="Illustration of a ceiling smoke detector in a cabin with a light haze. Not a photograph from a NASA test."
          badges={[
            { label: "Detection", tone: "accent" },
            ...(smoke ? [{ label: "PSI-102", tone: "ink" as const }] : []),
          ]}
          title="Smoke detection"
          meta={smoke ? undefined : "No investigation attached"}
        >
          {smoke ? (
            <>
              <p>
                SAME measured the smoke particles from spacecraft materials. Those findings are what this dataset can
                say about which detector would see that smoke.
              </p>
              <FindingBox insight={smoke} />
            </>
          ) : (
            <p>No finding in this dataset states a smoke-detection result, so no investigation is attached here.</p>
          )}
        </EarthCard>

        <EarthCard
          image="/images/earth/firefighter-gear.jpg"
          imageAlt="Illustration of firefighter turnout gear on a bench. Not a photograph from a NASA test."
          badges={[{ label: "Challenge topic", tone: "accent" }]}
          title="Firefighter gear"
          meta="No investigation attached"
        >
          Protective clothing for firefighters is one of the challenge topics. No finding in this dataset states a
          result about firefighter gear, so no investigation is attached here.
        </EarthCard>

        <EarthCard
          image="/images/earth/fire-model.jpg"
          imageAlt="Illustration of a computer showing a flame simulation. Not a photograph from a NASA test."
          badges={[
            { label: "Earth", tone: "accent" },
            ...(models ? [{ label: "PSI-25", tone: "ink" as const }] : []),
          ]}
          title="Models used on Earth"
          meta={models ? undefined : "No earth-tagged finding is loaded."}
        >
          {models ? (
            <>
              <p>One finding states that a flight investigation feeds fire-safety models used on Earth.</p>
              <FindingBox insight={models} />
            </>
          ) : (
            <p>No earth-tagged finding is loaded.</p>
          )}
        </EarthCard>

        <EarthCard
          image="/images/earth/low-airflow.jpg"
          imageAlt="Illustration of a small flame on fabric inside a laboratory flow duct. Not a photograph from a NASA test."
          badges={[
            { label: "Suppression", tone: "accent" },
            ...(quench ? [{ label: "PSI-26", tone: "ink" as const }] : []),
          ]}
          title="A suppression result from the same records"
          meta={quench ? undefined : "No suppression finding is loaded."}
        >
          {quench ? <FindingBox insight={quench} /> : <p>No suppression finding is loaded.</p>}
        </EarthCard>
      </div>
    </div>
  );
}

function FindingBox({ insight }: { insight: Insight }) {
  return (
    <div className="mt-3 rounded-xl border border-line bg-canvas px-3 py-3">
      <p className="font-semibold text-ink">{insight.title}</p>
      <p className="mt-1">{insight.text}</p>
      <div className="mt-2">
        <FindingMeta insight={insight} />
      </div>
    </div>
  );
}

function FindingMeta({ insight }: { insight: Insight }) {
  const source = insight.sources[0];
  return (
    <p className="flex flex-wrap items-start gap-x-2 gap-y-1">
      <PinIcon />
      {insight.investigation_ids.map((id) => {
        const item = getInvestigation(id);
        return (
          <Link key={id} href={`/investigations/${id}/`} className={linkClass}>
            {item ? `${item.acronym} (${id})` : id}
          </Link>
        );
      })}
      {source ? (
        <a href={source.url} className={linkClass}>
          {source.title}, page {source.page}
        </a>
      ) : null}
    </p>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="mt-1 size-3.5 shrink-0 text-accent">
      <path
        d="M8 1.5a4.2 4.2 0 0 0-4.2 4.2c0 3.2 4.2 8.8 4.2 8.8s4.2-5.6 4.2-8.8A4.2 4.2 0 0 0 8 1.5Zm0 5.6a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8Z"
        fill="currentColor"
      />
    </svg>
  );
}
