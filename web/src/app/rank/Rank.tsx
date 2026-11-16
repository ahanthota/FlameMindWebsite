"use client";

import Link from "next/link";
import { useState } from "react";
import { HabitatArt } from "@/components/HabitatArt";
import { MatchMeter, PART_COLOR, RankCharts } from "@/components/RankCharts";
import { linkClass } from "@/components/States";
import { formatNumber, MISSING } from "@/lib/format";
import { formatScore, partShare, type RankHabitatView, type RankedRow } from "@/lib/rankView";

export function Rank({ views }: { views: RankHabitatView[] }) {
  const [id, setId] = useState(views[0]?.id ?? "");
  const current = views.find((item) => item.id === id) ?? views[0];

  return (
    <div>
      <fieldset className="mb-4 rounded-lg border border-line bg-surface p-4">
        <legend className="px-1 text-sm font-medium">Habitat</legend>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
          {views.map((item) => {
            const checked = current.id === item.id;
            return (
              <label
                key={item.id}
                className={`flex cursor-pointer flex-col rounded-lg border p-1.5 text-sm transition-shadow has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                  checked ? "border-accent bg-accent-soft shadow-sm ring-1 ring-accent" : "border-line bg-surface hover:border-accent"
                }`}
              >
                <HabitatArt id={item.id} />
                <span className="flex items-center gap-2 px-1 pb-0.5 pt-2">
                  <input
                    type="radio"
                    name="habitat"
                    value={item.id}
                    checked={checked}
                    onChange={() => setId(item.id)}
                    className="size-4 shrink-0 accent-accent focus-visible:outline-none"
                  />
                  <span className={checked ? "font-medium text-accent" : ""}>{item.label}</span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
          Conditions is how close the oxygen and pressure are, and it counts for 50%. Intent counts for 15%: here, that
          is whether the investigation recorded test conditions. Those two parts make the whole score for a habitat.
          Materials (25%) and airflow (10%) join the score when a question names them. A different gravity is noted
          beside the list. It leaves the score unchanged.
        </p>
      </fieldset>

      <HabitatSummary view={current} count={current.ranked.length} />
      <RankCharts view={current} />
      <ol className="space-y-4">
        {current.ranked.map((row, index) => (
          <li key={row.id}>
            <InvestigationRank row={row} place={index + 1} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function HabitatSummary({ view, count }: { view: RankHabitatView; count: number }) {
  return (
    <section className="mb-4 rounded-lg border border-line bg-surface p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{view.label}</h2>
          <p className="mt-1 text-sm text-muted">{view.habitatName}</p>
        </div>
        {view.assumed ? (
          <span className="rounded bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">Assumed atmosphere</span>
        ) : null}
      </header>
      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <AtmosphereStat label="Oxygen" value={`${formatNumber(view.o2Percent)}%`} />
        <AtmosphereStat label="Pressure" value={`${formatNumber(view.pressurePsi)} psi`} />
        <AtmosphereStat label="Gravity" value={gravityValue(view)} note={gravityNote(view)} />
      </dl>
      <p className="mt-3 text-sm leading-6">{view.sourceNote}</p>
      {view.matchesLabel ? (
        <p className="mt-2 text-sm leading-6">
          This order matches {view.matchesLabel}. Both use {formatNumber(view.o2Percent)}% oxygen at{" "}
          {formatNumber(view.pressurePsi)} psi.
        </p>
      ) : null}
      {view.gravityNote ? <p className="mt-2 text-sm font-medium text-warn">{view.gravityNote}</p> : null}
      <p className="mt-2 text-sm text-muted">
        {count} investigations, best first.
      </p>
    </section>
  );
}

function AtmosphereStat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-md bg-accent-soft px-3 py-3">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
      {note ? <dd className="mt-0.5 text-xs text-muted">{note}</dd> : null}
    </div>
  );
}

function gravityValue(view: RankHabitatView): string {
  if (view.gravityG !== null) return `${formatNumber(view.gravityG)} g`;
  if (view.gravityClasses.length > 1) return "Two classes";
  return gravityClass(view);
}

function gravityNote(view: RankHabitatView): string {
  if (view.gravityG !== null) return gravityClass(view);
  if (view.gravityClasses.length > 1) return "Microgravity and partial gravity. The ranking uses oxygen and pressure.";
  return "Used in the ranking";
}

function gravityClass(view: RankHabitatView): string {
  if (view.gravityApplied === "microgravity") return "Microgravity";
  if (view.gravityApplied === "partial") return "Partial gravity";
  if (view.gravityApplied === "normal") return "Normal gravity";
  if (view.gravityApplied === "simulated_partial") return "Simulated partial gravity";
  return "Gravity not set";
}

function InvestigationRank({ row, place }: { row: RankedRow; place: number }) {
  return (
    <article id={`rank-${row.id}`} className="scroll-mt-20 rounded-lg border border-line bg-surface p-5">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold">
            <span className="mr-2 tabular-nums text-muted">{place}.</span>
            <Link href={`/investigations/${row.id}/`} className={linkClass}>
              {row.acronym}
            </Link>
            <span className="ml-2 text-sm font-normal text-muted">{row.id}</span>
          </h3>
          {row.name ? <p className="mt-1 text-sm text-muted">{row.name}</p> : null}
          {row.needsReview ? (
            <span className="mt-2 inline-block rounded bg-warn-soft px-1.5 py-0.5 text-xs font-medium text-warn">
              Needs review
            </span>
          ) : null}
        </div>
        <div className="w-36 shrink-0">
          <p className="text-right text-2xl font-semibold tabular-nums">
            <span className="sr-only">Score </span>
            {formatScore(row.score)}
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-canvas" aria-hidden>
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, row.score * 100)}%` }} />
          </div>
        </div>
      </header>

      <div className="mt-4 grid max-w-md gap-3" aria-label={`Score parts for ${row.acronym}`}>
        {row.parts.map((part) => (
          <MatchMeter key={part.name} label={part.label} value={part.value} color={PART_COLOR[part.name]} />
        ))}
      </div>

      <table className="mt-4 w-full text-left text-sm">
        <caption className="sr-only">Score parts for {row.acronym}</caption>
        <thead>
          <tr className="border-b border-line text-muted">
            <th scope="col" className="py-2 pr-3 font-medium">
              Part
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Match
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Weight
            </th>
            <th scope="col" className="py-2 font-medium">
              Share of this score
            </th>
          </tr>
        </thead>
        <tbody>
          {row.parts.map((part) => (
            <tr key={part.name} className="border-b border-line last:border-b-0">
              <th scope="row" className="py-2 pr-3 font-medium">
                {part.label}
              </th>
              <td className="py-2 pr-3 tabular-nums">{formatScore(part.value)}</td>
              <td className="py-2 pr-3 tabular-nums">{formatScore(part.weight)}</td>
              <td className="py-2 tabular-nums">{formatScore(partShare(part, row.parts))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {row.reasons.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6">
          {row.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {row.tests.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <h4 className="text-sm font-medium">Closest tests</h4>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Closest tests for {row.acronym}. Closeness uses the oxygen and pressure recorded on that test. A missing
              value counts as no match on that axis. The conditions score can fill a missing value from the
              investigation&apos;s stated range.
            </caption>
            <thead>
              <tr className="border-b border-line text-muted">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Test
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Sample
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Oxygen (%)
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Pressure (psi)
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Airflow (cm/s)
                </th>
                <th scope="col" className="py-2 font-medium">
                  Closeness
                </th>
              </tr>
            </thead>
            <tbody>
              {row.tests.map((test) => (
                <tr key={test.testId} className="border-b border-line last:border-b-0">
                  <td className="whitespace-nowrap py-2 pr-3">{test.testId}</td>
                  <td className="py-2 pr-3">{test.sampleId ?? MISSING}</td>
                  <td className="py-2 pr-3 tabular-nums">{formatNumber(test.o2Percent)}</td>
                  <td className="py-2 pr-3 tabular-nums">{formatNumber(test.pressurePsi)}</td>
                  <td className="py-2 pr-3 tabular-nums">{formatNumber(test.flowCmS)}</td>
                  <td className="py-2">
                    <div className="min-w-24">
                      <span className="tabular-nums">{formatScore(test.closeness)}</span>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-canvas" aria-hidden>
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${Math.min(100, test.closeness * 100)}%` }}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : row.reasons.some((reason) => reason.startsWith("Ranges:")) ? (
        <p className="mt-4 text-sm text-muted">The conditions score uses the investigation&apos;s stated range.</p>
      ) : null}
    </article>
  );
}
