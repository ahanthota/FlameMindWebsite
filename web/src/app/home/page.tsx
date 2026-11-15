import type { Metadata } from "next";
import Link from "next/link";
import { AskBox } from "@/components/AskBox";
import { EmptyState, PageHeader } from "@/components/States";
import { investigations } from "@/lib/data";
import { NAV_ITEMS } from "@/lib/nav";

export const metadata: Metadata = { title: "Home" };

const SUMMARIES: Record<string, string> = {
  "/scenario/": "Ask a question and get data with sources.",
  "/explore/": "Filter and sort every investigation and test.",
  "/compare/": "Put investigations side by side.",
  "/gaps/": "See what has not been tested.",
  "/earth/": "What the results mean on Earth.",
  "/about/": "Where the data comes from.",
};

export default function Home() {
  const tests = investigations.reduce((total, item) => total + item.tests.length, 0);
  return (
    <>
      <PageHeader title="Fire safety insights for living beyond Earth">
        FlameMind organizes NASA microgravity combustion data from the Physical Sciences Informatics (PSI) system, so
        you can find the tests closest to the atmosphere and materials you care about.
      </PageHeader>
      <AskBox />
      {investigations.length === 0 ? (
        <EmptyState title="No investigations loaded">
          data/investigations.json is empty. Run the pipeline, then rebuild the site.
        </EmptyState>
      ) : (
        <>
          <dl className="mb-6 grid max-w-xl grid-cols-2 gap-3">
            <div className="rounded-lg border border-line bg-surface p-4">
              <dt className="text-sm text-muted">Investigations with extracted data</dt>
              <dd className="mt-1 text-2xl font-semibold">{investigations.length}</dd>
            </div>
            <div className="rounded-lg border border-line bg-surface p-4">
              <dt className="text-sm text-muted">Individual tests</dt>
              <dd className="mt-1 text-2xl font-semibold">{tests}</dd>
            </div>
          </dl>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block h-full rounded-lg border border-line bg-surface p-4 hover:border-accent"
                >
                  <span className="font-medium text-accent">{item.label}</span>
                  <span className="mt-1 block text-sm text-muted">{SUMMARIES[item.href]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
