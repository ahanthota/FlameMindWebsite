import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, linkClass } from "@/components/States";
import { DISCLAIMER } from "@/lib/chat";
import { investigations } from "@/lib/data";
import { knowledgeStats } from "@/lib/knowledge";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  const tests = investigations.reduce((sum, item) => sum + item.tests.length, 0);
  const needReview = investigations.filter((item) => item.needs_review).length;
  const knowledge = knowledgeStats();

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="About">How FlameMind reads NASA combustion records.</PageHeader>

      <div className="space-y-8">
        <section>
          <h2 className="text-lg font-semibold tracking-tight">The problem</h2>
          <p className="mt-2 text-sm leading-6">
            A habitat atmosphere can differ from the air on Earth. The Moon base preset in this dataset is 34% oxygen
            at 8 psi. At higher oxygen, everyday materials can ignite more readily and keep burning. Choosing fabrics,
            bedding, and ventilation means looking up what a combustion test actually measured at a nearby atmosphere.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold tracking-tight">How FlameMind works</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <article className="rounded-lg border border-line bg-surface p-4">
              <h3 className="font-semibold">
                <Link href="/scenario/" className={linkClass}>
                  Scenario
                </Link>
              </h3>
              <p className="mt-1 text-sm leading-6 text-muted">
                Describe the habitat, the materials, and the goal. The chat answers from the indexed records and cites
                the source. A question without a use case gets a follow-up and no design suggestion. When the use case
                is complete, each suggestion names the findings it builds on.
              </p>
            </article>
            <article className="rounded-lg border border-line bg-surface p-4">
              <h3 className="font-semibold">
                <Link href="/explore/" className={linkClass}>
                  Explore
                </Link>
              </h3>
              <p className="mt-1 text-sm leading-6 text-muted">
                Filter the investigations and tests yourself, by fuel, hardware, oxygen, pressure, airflow, and other
                values the records state. Prevention, Detection, and Suppression list the investigations tagged for
                that control, with the insight and its source when one exists.
              </p>
            </article>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold tracking-tight">NASA data used</h2>
          <p className="mt-2 text-sm leading-6">
            The records come from NASA&apos;s{" "}
            <a href="https://psi.nasa.gov/" className={linkClass}>
              Physical Sciences Informatics (PSI)
            </a>{" "}
            system: documents, reports, and test tables for combustion investigations. This build holds{" "}
            {investigations.length} structured investigations
            {tests > 0 ? ` and ${tests.toLocaleString("en-US")} individual tests` : ""}. The text index covers{" "}
            {knowledge.investigations.toLocaleString("en-US")} investigations and{" "}
            {knowledge.sources.toLocaleString("en-US")} source documents.
          </p>
          {needReview > 0 ? (
            <p className="mt-2 text-sm leading-6">
              {needReview} of the investigations are marked needs review: the extracted record is flagged for a manual
              check against the source documents.
            </p>
          ) : null}
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-muted">
            <li>Every finding links to the source document and page it was taken from.</li>
            <li>A dash means the source does not state that value. Nothing here is estimated or filled in.</li>
            <li>Oxygen is percent by volume, pressure is psi, airflow is cm/s, and flame spread is mm/s.</li>
            <li>Where a record states a gravity, it is microgravity. No test in this set states a partial-gravity result.</li>
            <li>Rank scores are calculated from the stated conditions. They are not a measurement from a paper.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold tracking-tight">Accounts and privacy</h2>
          <p className="mt-2 text-sm leading-6">
            Every page works as a guest. A guest chat stays in the browser and is not saved. Signing in saves chats,
            filter sets, and an optional use case on that account. Only that account can read those documents. The NASA
            records are not stored in the account.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold tracking-tight">Team Spherical Flame</h2>
          <p className="mt-2 text-sm leading-6">
            FlameMind was built by Team Spherical Flame for the NASA Space Apps challenge, Flame in Freefall.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold tracking-tight">Disclaimer</h2>
          <p className="mt-2 text-sm leading-6">{DISCLAIMER}</p>
        </section>

        {investigations.length === 0 ? (
          <EmptyState title="No investigations loaded">
            data/investigations.json is empty. Run the pipeline, then rebuild the site.
          </EmptyState>
        ) : null}
      </div>
    </div>
  );
}
