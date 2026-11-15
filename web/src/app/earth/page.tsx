import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, linkClass } from "@/components/States";
import { insights } from "@/lib/data";
import type { Insight } from "@/lib/types";

export const metadata: Metadata = { title: "Earth applications" };

export default function EarthPage() {
  const detection = insights.filter((item) => item.category === "detection");
  const earth = insights.filter((item) => item.category === "earth");
  const suppression = insights.filter((item) => item.category === "suppression");

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Earth applications">
        Fine water mist, smoke detection, and firefighter gear are the Earth-side topics in the challenge. An
        investigation is attached only where one of its findings states the link.
      </PageHeader>

      <section className="mb-8">
        <h2 className="text-lg font-semibold">Fine water mist</h2>
        <p className="mt-2 text-sm leading-6">
          Fine water mist is studied as a way to suppress a fire with less water than a sprinkler, including in a
          sealed cabin. No finding in this dataset states a water-mist result, so no investigation is attached here.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold">Smoke detection</h2>
        <p className="mt-2 text-sm leading-6">
          SAME measured the smoke particles from spacecraft materials. Those findings are what this dataset can say
          about which detector would see that smoke.
        </p>
        <ul className="mt-3 space-y-3">
          {detection.map((item) => (
            <InsightCard key={item.id} insight={item} />
          ))}
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold">Firefighter gear</h2>
        <p className="mt-2 text-sm leading-6">
          Protective clothing for firefighters is one of the challenge topics. No finding in this dataset states a
          result about firefighter gear, so no investigation is attached here.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold">Models used on Earth</h2>
        <p className="mt-2 text-sm leading-6">
          One finding states that a flight investigation feeds fire-safety models used on Earth.
        </p>
        <ul className="mt-3 space-y-3">
          {earth.map((item) => (
            <InsightCard key={item.id} insight={item} />
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold">A suppression result from the same records</h2>
        <ul className="mt-3 space-y-3">
          {suppression.map((item) => (
            <InsightCard key={item.id} insight={item} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  return (
    <li className="rounded-lg border border-line bg-surface px-4 py-3 text-sm leading-6">
      <p className="font-medium">{insight.title}</p>
      <p className="mt-1">{insight.text}</p>
      <p className="mt-2 text-xs text-muted">
        {insight.investigation_ids.map((id) => (
          <Link key={id} href={`/investigations/${id}/`} className={`${linkClass} mr-3`}>
            {id}
          </Link>
        ))}
        {insight.sources.map((source) => (
          <span key={`${source.file_name}-${source.page}`} className="mr-3">
            {source.title}, page {source.page}
          </span>
        ))}
      </p>
    </li>
  );
}
