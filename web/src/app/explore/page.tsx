import type { Metadata } from "next";
import { investigations } from "@/lib/data";
import { toInvestigationRow, toTestRows } from "@/lib/filters";
import { Explore } from "./Explore";

export const metadata: Metadata = { title: "Explore" };

export default function ExplorePage() {
  // Rows are built at build time. Only the fields the table needs reach the browser.
  return (
    <Explore
      investigations={investigations.map(toInvestigationRow)}
      tests={investigations.flatMap(toTestRows)}
    />
  );
}
