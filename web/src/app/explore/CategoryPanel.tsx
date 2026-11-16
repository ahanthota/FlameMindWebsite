import Link from "next/link";
import { linkClass } from "@/components/States";
import { categoryLine } from "@/lib/controlTabs";
import { label } from "@/lib/format";
import type { InvestigationRow } from "@/lib/filters";
import type { CategoryName, Insight } from "@/lib/types";

export function CategoryPanel({
  category,
  investigations,
  insights,
}: {
  category: CategoryName;
  investigations: InvestigationRow[];
  insights: Insight[];
}) {
  const listed = investigations.filter((item) => item.category.includes(category));
  const notes = insights.filter((item) => item.category === category);

  return (
    <div>
      <p className="mb-6 max-w-3xl text-sm leading-6 text-muted">{categoryLine(category, insights)}</p>

      <section className="mb-8" aria-label={`${label(category)} investigations`}>
        <h2 className="text-lg font-semibold">Investigations</h2>
        {listed.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No investigation is tagged {category}.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
            {listed.map((item) => (
              <li key={item.id} className="px-4 py-3 text-sm">
                <Link href={`/investigations/${item.id}/`} className={linkClass}>
                  {item.acronym}
                </Link>
                <span className="ml-2 text-muted">{item.id}</span>
                <span className="mt-0.5 block text-muted">{item.name}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={`${label(category)} insights`}>
        <h2 className="text-lg font-semibold">Insights</h2>
        {notes.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No insight is tagged {category}.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {notes.map((item) => (
              <li key={item.id} className="rounded-lg border border-line bg-surface px-4 py-3 text-sm leading-6">
                <p className="font-medium">{item.title}</p>
                <p className="mt-1">{item.text}</p>
                <p className="mt-2 text-xs text-muted">
                  {item.investigation_ids.map((id) => (
                    <Link key={id} href={`/investigations/${id}/`} className={`${linkClass} mr-3`}>
                      {id}
                    </Link>
                  ))}
                  {item.sources.map((source) => (
                    <span key={`${source.file_name}-${source.page}`} className="mr-3">
                      {source.title}, page {source.page}
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
