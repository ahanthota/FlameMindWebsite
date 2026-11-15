import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, linkClass } from "@/components/States";
import { getInvestigation } from "@/lib/data";
import type { Finding, Investigation } from "@/lib/types";

export const metadata: Metadata = { title: "Controls" };

const SECTIONS: {
  title: string;
  text: string;
  entries: { id: string; fields: (keyof Pick<Investigation, "key_findings" | "ignition_findings" | "flame_spread_findings" | "extinction_findings">)[] }[];
}[] = [
  {
    title: "Prevention",
    text: "Findings from BASS and FLEX on ignition and flame spread.",
    entries: [
      { id: "PSI-26", fields: ["key_findings", "ignition_findings", "flame_spread_findings"] },
      { id: "PSI-69", fields: ["key_findings", "ignition_findings", "flame_spread_findings"] },
    ],
  },
  {
    title: "Detection",
    text: "Findings from SAME on the smoke a spacecraft detector would see.",
    entries: [{ id: "PSI-102", fields: ["key_findings", "ignition_findings"] }],
  },
  {
    title: "Suppression",
    text: "Findings from BASS and FLEX on how a flame goes out.",
    entries: [
      { id: "PSI-26", fields: ["extinction_findings"] },
      { id: "PSI-69", fields: ["extinction_findings"] },
    ],
  },
];

export default function ControlsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Controls">
        Prevention, detection, and suppression claims from BASS, FLEX, and SAME. Each claim is the finding text, with
        the page it came from.
      </PageHeader>
      {SECTIONS.map((section) => (
        <section key={section.title} className="mb-8">
          <h2 className="text-lg font-semibold">{section.title}</h2>
          <p className="mt-1 text-sm text-muted">{section.text}</p>
          {section.entries.map((entry) => {
            const item = getInvestigation(entry.id);
            if (!item) return null;
            const claims = entry.fields.flatMap((field) => item[field]);
            return (
              <div key={entry.id} className="mt-4">
                <h3 className="text-sm font-semibold">
                  <Link href={`/investigations/${item.id}/`} className={linkClass}>
                    {item.acronym}
                  </Link>
                  <span className="ml-2 font-normal text-muted">{item.id}</span>
                </h3>
                {claims.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">No findings in this group.</p>
                ) : (
                  <ul className="mt-2 space-y-3">
                    {claims.map((claim) => (
                      <Claim key={claim.text} claim={claim} />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function Claim({ claim }: { claim: Finding }) {
  return (
    <li className="rounded-lg border border-line bg-surface px-4 py-3 text-sm leading-6">
      <p>{claim.text}</p>
      <p className="mt-1 text-xs text-muted">
        {claim.evidence.map((source) => (
          <span key={`${source.file_name}-${source.page}`} className="mr-3">
            {source.title}, page {source.page}
          </span>
        ))}
      </p>
    </li>
  );
}
