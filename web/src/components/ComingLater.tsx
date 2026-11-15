import Link from "next/link";
import { EmptyState, linkClass, PageHeader } from "@/components/States";

/** A section that is in the navigation but built in a later phase. */
export function ComingLater({ title, summary }: { title: string; summary: string }) {
  return (
    <>
      <PageHeader title={title}>{summary}</PageHeader>
      <EmptyState title="Not built yet">
        This section is added in a later phase. The investigation and test data is ready now in{" "}
        <Link href="/explore/" className={linkClass}>
          Explore
        </Link>
        .
      </EmptyState>
    </>
  );
}
