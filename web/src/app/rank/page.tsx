import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/States";
import { habitats, investigations } from "@/lib/data";
import { buildRankViews } from "@/lib/rankView";
import { Rank } from "./Rank";

export const metadata: Metadata = { title: "Rank" };

export default function RankPage() {
  const views = buildRankViews(habitats, investigations);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Rank">
        Investigations listed best first for a habitat atmosphere. The score is the same one the scenario chat uses:
        conditions 50%, materials 25%, intent 15%, and airflow 10%.
      </PageHeader>
      {views.length === 0 || investigations.length === 0 ? (
        <EmptyState title="No investigations loaded">
          data/investigations.json is empty. Run the pipeline, then rebuild the site.
        </EmptyState>
      ) : (
        <Rank views={views} />
      )}
    </div>
  );
}
