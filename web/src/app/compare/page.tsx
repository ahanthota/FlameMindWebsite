import type { Metadata } from "next";
import { ComingLater } from "@/components/ComingLater";

export const metadata: Metadata = { title: "Compare" };

export default function Page() {
  return <ComingLater title="Compare" summary="Put investigations side by side: conditions, fuels, and findings." />;
}
