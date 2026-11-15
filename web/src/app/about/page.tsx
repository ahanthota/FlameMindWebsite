import type { Metadata } from "next";
import { EmptyState, linkClass, PageHeader } from "@/components/States";
import { investigations } from "@/lib/data";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  const tests = investigations.reduce((total, item) => total + item.tests.length, 0);
  const needReview = investigations.filter((item) => item.needs_review).length;
  return (
    <>
      <PageHeader title="About FlameMind">Where the data comes from and how to read it.</PageHeader>
      {investigations.length === 0 ? (
        <EmptyState title="No investigations loaded">
          data/investigations.json is empty. Run the pipeline, then rebuild the site.
        </EmptyState>
      ) : (
        <div className="max-w-3xl space-y-4 rounded-lg border border-line bg-surface p-6 text-sm leading-6">
          <p>
            All data comes from NASA&apos;s{" "}
            <a href="https://psi.nasa.gov" className={linkClass} target="_blank" rel="noreferrer">
              Physical Sciences Informatics (PSI)
            </a>{" "}
            system. FlameMind reads the documents, reports, and test tables published for combustion science
            investigations and stores what they state as structured records.
          </p>
          <p>
            This build holds {investigations.length} investigations and {tests} individual tests. {needReview} of the
            investigations are marked &quot;needs review&quot;: their extracted record is flagged for a manual check against the sources

          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Every finding links to the source document and page it was taken from.</li>
            <li>A value that a source does not state is shown as a dash. Nothing is estimated.</li>
            <li>
              Rank scores are calculated from how close an investigation&apos;s tests are to a habitat atmosphere. They are
              not values copied from a source.
            </li>
            <li>Units are fixed: oxygen in % by volume, pressure in psi, airflow in cm/s, flame spread rate in mm/s.</li>
            <li>All tests in this dataset were run in microgravity. None were run at Moon or Mars gravity.</li>
          </ul>
        </div>
      )}
    </>
  );
}
