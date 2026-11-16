import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/States";
import { toCompareInvestigation, toCompareTests } from "@/lib/compare";
import { investigations } from "@/lib/data";
import { Compare } from "./Compare";

export const metadata: Metadata = { title: "Compare" };

export default function ComparePage() {
  const records = investigations.map(toCompareInvestigation);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Compare">
        Pick 2 or 3 investigations and read them down one column each, or open one investigation and see which of its
        test conditions changed.
      </PageHeader>
      {records.length === 0 ? (
        <EmptyState title="No investigations loaded">
          data/investigations.json is empty. Run the pipeline, then rebuild the site.
        </EmptyState>
      ) : (
        <Compare
          records={records}
          testSets={investigations.map((item) => ({
            id: item.id,
            acronym: item.acronym,
            name: item.name,
            tests: toCompareTests(item),
          }))}
        />
      )}
    </div>
  );
}
