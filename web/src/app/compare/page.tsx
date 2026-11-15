import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/States";
import { toCompareInvestigation } from "@/lib/compare";
import { investigations } from "@/lib/data";
import { Compare } from "./Compare";

export const metadata: Metadata = { title: "Compare" };

export default function ComparePage() {
  const records = investigations.map(toCompareInvestigation);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Compare">
        The {records.length} structured investigations side by side. Objectives, fuels, sample shape and size, oxygen,
        pressure, airflow, hardware, what varied, what stayed fixed, sensors, and findings.
      </PageHeader>
      {records.length === 0 ? (
        <EmptyState title="No investigations loaded">
          data/investigations.json is empty. Run the pipeline, then rebuild the site.
        </EmptyState>
      ) : (
        <Compare records={records} />
      )}
    </div>
  );
}
