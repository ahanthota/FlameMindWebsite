import type { Metadata } from "next";
import Link from "next/link";
import { AskBox } from "@/components/AskBox";
import { EmptyState, linkClass } from "@/components/States";
import { gaps, investigations } from "@/lib/data";
import { knowledgeStats } from "@/lib/knowledge";

export const metadata: Metadata = { title: "Home" };

const PATHS = [
  {
    href: "/scenario/",
    title: "Ask the AI",
    section: "Scenario",
    text: "Describe your use case and get the relevant data, with sources, plus suggestions for your design.",
  },
  {
    href: "/explore/",
    title: "Filter the data yourself",
    section: "Explore",
    text: "Browse the tables of investigations and tests with manual and custom filters.",
  },
];

export default function Home() {
  const knowledge = knowledgeStats();
  // Every investigation with extracted records is also in the text index, so take the larger count.
  const indexed = Math.max(knowledge.investigations, investigations.length);
  const tests = investigations.reduce((total, item) => total + item.tests.length, 0);
  const numbers = [
    { label: "Investigations", value: indexed, note: `${investigations.length} with extracted test records` },
    { label: "Tests", value: tests, note: "Individual test conditions" },
    { label: "Data sources", value: knowledge.sources, note: "Source documents indexed" },
    { label: "Knowledge gaps", value: gaps.gaps.length, note: "Conditions not yet tested" },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6">
        <h1 className="text-4xl font-semibold tracking-tight text-accent sm:text-5xl">FlameMind</h1>
        <p className="mt-2 text-xl font-medium tracking-tight sm:text-2xl">
          Fire safety insights for living beyond Earth
        </p>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
          Future Moon bases may run at 30% oxygen or more, which makes everyday materials far more flammable than they
          are on Earth.
        </p>
      </header>

      <AskBox />

      <ul className="mb-6 grid gap-3 sm:grid-cols-2">
        {PATHS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="block h-full rounded-lg border border-line bg-surface p-5 hover:border-accent"
            >
              <span className="text-xs font-medium uppercase tracking-wide text-muted">{item.section}</span>
              <span className="mt-1 block text-lg font-semibold text-accent">{item.title}</span>
              <span className="mt-1 block text-sm text-muted">{item.text}</span>
            </Link>
          </li>
        ))}
      </ul>

      {indexed === 0 ? (
        <div className="mb-6">
          <EmptyState title="No investigations loaded">
            data/investigations.json is empty. Run the pipeline, then rebuild the site.
          </EmptyState>
        </div>
      ) : (
        <section aria-label="Key numbers" className="mb-6">
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {numbers.map((item) => (
              <div key={item.label} className="rounded-lg border border-line bg-surface p-4">
                <dt className="text-sm text-muted">{item.label}</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">{item.value.toLocaleString("en-US")}</dd>
                <dd className="mt-1 text-xs text-muted">{item.note}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 rounded-lg border border-line bg-accent-soft px-4 py-3 text-sm leading-6">
            PSI holds about 12 TB of combustion data. FlameMind indexes the knowledge layer of all {indexed}{" "}
            investigations and links every result to its PSI folder.
          </p>
        </section>
      )}

      <footer className="border-t border-line pt-4 text-xs leading-5 text-muted">
        <p>
          Built by Team Spherical Flame. Data from NASA&apos;s{" "}
          <a href="https://psi.nasa.gov" className={linkClass} target="_blank" rel="noreferrer">
            Physical Sciences Informatics (PSI)
          </a>{" "}
          system.
        </p>
        <p className="mt-1">Research summary, not certified safety guidance.</p>
      </footer>
    </div>
  );
}
