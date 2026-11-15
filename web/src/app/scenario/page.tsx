import type { Metadata } from "next";
import { investigations } from "@/lib/data";
import { Chat } from "./Chat";

export const metadata: Metadata = { title: "Scenario" };

export default function ScenarioPage() {
  // Names for the investigations that have their own page, so answer cards can link to them.
  const names = Object.fromEntries(investigations.map((item) => [item.id, { acronym: item.acronym, name: item.name }]));
  return <Chat investigations={names} />;
}
