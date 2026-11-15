import type { Metadata } from "next";
import { ComingLater } from "@/components/ComingLater";

export const metadata: Metadata = { title: "Gaps" };

export default function Page() {
  return <ComingLater title="Gaps" summary="Where the tested oxygen and pressure ranges do not cover habitat atmospheres." />;
}
