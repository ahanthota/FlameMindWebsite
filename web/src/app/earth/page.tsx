import type { Metadata } from "next";
import { ComingLater } from "@/components/ComingLater";

export const metadata: Metadata = { title: "Earth applications" };

export default function Page() {
  return <ComingLater title="Earth applications" summary="How microgravity combustion results apply to fire safety on Earth." />;
}
