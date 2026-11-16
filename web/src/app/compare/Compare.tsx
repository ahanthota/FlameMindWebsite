"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { OutcomeChart } from "@/components/OutcomeChart";
import { RangeOverlay } from "@/components/RangeOverlay";
import { EmptyState, linkClass } from "@/components/States";
import {
  axisState,
  askAbout,
  CHART_AXIS_LABEL,
  chartNumber,
  COMPARE_ROWS,
  FINDING_PREVIEW,
  findingsFor,
  mainVaried,
  rowValue,
  sameAcross,
  TEST_AXES,
  visibleFindings,
  type AxisState,
  type CompareInvestigation,
  type CompareRowId,
  type TestSet,
} from "@/lib/compare";
import { label, MISSING } from "@/lib/format";

const MAX_SELECTED = 3;

export function Compare({ records, testSets }: { records: CompareInvestigation[]; testSets: TestSet[] }) {
  const [mode, setMode] = useState<"across" | "within">("across");
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(records.slice(0, 2).map((item) => item.id)));
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [withinId, setWithinId] = useState(testSets.find((item) => item.tests.length > 0)?.id ?? testSets[0]?.id ?? "");

  const shown = useMemo(() => records.filter((item) => selected.has(item.id)), [records, selected]);
  const within = testSets.find((item) => item.id === withinId) ?? null;

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_SELECTED) next.add(id);
      return next;
    });
  };

  return (
    <div>
      <div role="group" aria-label="Compare mode" className="mb-4 flex flex-wrap gap-2">
        <ModeButton pressed={mode === "across"} onClick={() => setMode("across")}>
          Across investigations
        </ModeButton>
        <ModeButton pressed={mode === "within"} onClick={() => setMode("within")}>
          Within one investigation
        </ModeButton>
      </div>

      {mode === "across" ? (
        <Across
          records={records}
          shown={shown}
          selected={selected}
          atMax={selected.size >= MAX_SELECTED}
          expanded={expanded}
          onToggle={toggle}
          onExpand={(id) =>
            setExpanded((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
        />
      ) : (
        <Within testSets={testSets} current={within} onPick={setWithinId} />
      )}
    </div>
  );
}

function ModeButton({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-sm ${pressed ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink hover:border-accent"}`}
    >
      {children}
    </button>
  );
}

function Across({
  records,
  shown,
  selected,
  atMax,
  expanded,
  onToggle,
  onExpand,
}: {
  records: CompareInvestigation[];
  shown: CompareInvestigation[];
  selected: ReadonlySet<string>;
  atMax: boolean;
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onExpand: (id: string) => void;
}) {
  const ready = shown.length >= 2 && shown.length <= MAX_SELECTED;
  return (
    <div>
      <fieldset className="mb-4 rounded-lg border border-line bg-surface p-4">
        <legend className="px-1 text-sm font-medium">Pick 2 or 3 investigations</legend>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {records.map((item) => {
            const checked = selected.has(item.id);
            return (
              <label key={item.id} className={`flex items-center gap-2 text-sm ${!checked && atMax ? "text-muted" : ""}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && atMax}
                  onChange={() => onToggle(item.id)}
                  className="size-4 accent-accent"
                />
                <span>
                  {item.acronym} <span className="text-muted">{item.id}</span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-muted">
          {shown.length} selected. {atMax ? "Three is the most this table holds." : "Choose 2 or 3."}
        </p>
      </fieldset>

      {ready ? (
        <p className="mb-3">
          <Link href={`/scenario/?ask=${encodeURIComponent(askAbout(shown))}`} className={`${linkClass} text-sm font-medium`}>
            Ask about these
          </Link>
        </p>
      ) : null}

      {shown.length >= 2 ? (
        <section aria-label="Oxygen and pressure overlay" className="mb-4 rounded-lg border border-line bg-surface p-4">
          <h2 className="mb-1 text-base font-semibold">Oxygen and pressure, on one chart</h2>
          <p className="mb-3 max-w-3xl text-sm leading-6 text-muted">
            Each selected investigation is a rectangle covering the oxygen and pressure it states. Overlap is where
            those stated ranges meet.
          </p>
          <RangeOverlay items={shown} />
        </section>
      ) : null}

      {!ready ? (
        <EmptyState title="Choose 2 or 3 investigations">The checkboxes pick which investigations sit in the table.</EmptyState>
      ) : (
        <>
          <div className="max-h-[70vh] overflow-auto rounded-lg border border-line bg-surface">
            <table className="border-collapse text-left text-sm">
              <thead className="sticky top-0 z-20 bg-surface">
                <tr className="border-b border-line">
                  <th scope="col" className="sticky left-0 z-30 min-w-40 bg-surface px-3 py-3 font-medium text-muted">
                    Field
                  </th>
                  {shown.map((item) => (
                    <th key={item.id} scope="col" className="min-w-64 border-l border-line px-3 py-3 align-top font-medium">
                      <Link href={`/investigations/${item.id}/`} className={linkClass}>
                        {item.acronym}
                      </Link>
                      <span className="mt-0.5 block text-xs font-normal text-muted">{item.id}</span>
                      {item.needsReview ? (
                        <span className="mt-1 inline-block rounded bg-warn-soft px-1.5 py-0.5 text-xs font-medium text-warn">
                          Needs review
                        </span>
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map((row) => {
                  const differs = !sameAcross(shown, row.id);
                  return (
                    <tr key={row.id} className="border-b border-line align-top last:border-b-0">
                      <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-3 font-medium">
                        {row.label}
                        {differs ? <span className="mt-0.5 block text-xs font-normal text-warn">Differs</span> : null}
                      </th>
                      {shown.map((item) => (
                        <td key={item.id} className={`min-w-64 border-l border-line px-3 py-3 ${differs ? "bg-accent-soft" : ""}`}>
                          <Cell
                            row={row.id}
                            item={item}
                            expanded={expanded.has(`${row.id}-${item.id}`)}
                            onToggle={() => onExpand(`${row.id}-${item.id}`)}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">Shaded cells are not the same across the selected investigations. A dash means the sources do not state the value.</p>
        </>
      )}
    </div>
  );
}

function Within({ testSets, current, onPick }: { testSets: TestSet[]; current: TestSet | null; onPick: (id: string) => void }) {
  const tests = current?.tests ?? [];
  const states = TEST_AXES.map((axis) => ({ ...axis, state: axisState(tests, axis.id) }));
  const varied = mainVaried(tests);
  const points =
    varied === null
      ? []
      : tests.flatMap((test) => {
          const x = chartNumber(test, varied);
          return x === null ? [] : [{ sample: test.sample, x, outcome: test.outcomeKey }];
        });
  const changed = states.filter((axis) => axis.state === "changed").map((axis) => axis.label);
  const fixed = states.filter((axis) => axis.state === "fixed").map((axis) => axis.label);

  return (
    <div>
      <label className="mb-4 block max-w-md text-sm">
        <span className="mb-1 block font-medium">Investigation</span>
        <select
          value={current?.id ?? ""}
          onChange={(event) => onPick(event.target.value)}
          className="w-full rounded-md border border-line bg-surface px-3 py-2"
        >
          {testSets.map((item) => (
            <option key={item.id} value={item.id}>
              {item.acronym} ({item.id})
            </option>
          ))}
        </select>
      </label>

      {tests.length === 0 ? (
        <EmptyState title="No individual tests">This investigation does not list tests with a sample, conditions, and outcome.</EmptyState>
      ) : (
        <>
          <p className="mb-3 max-w-3xl text-sm leading-6 text-muted">
            {changed.length > 0 ? `Changed between tests: ${changed.join(", ")}.` : "No stated condition changes between these tests."}{" "}
            {fixed.length > 0 ? `Stayed fixed: ${fixed.join(", ")}.` : ""}
          </p>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="px-3 py-2 font-medium">
                    Sample
                  </th>
                  {states.map((axis) => (
                    <th key={axis.id} scope="col" className="px-3 py-2 font-medium">
                      {axis.label}
                      <AxisNote state={axis.state} />
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 font-medium">
                    Outcome
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Spread rate (mm/s)
                  </th>
                </tr>
              </thead>
              <tbody>
                {tests.map((test) => (
                  <tr key={test.key} className="border-b border-line last:border-b-0">
                    <th scope="row" className="px-3 py-2 font-medium">
                      {test.sample}
                    </th>
                    {TEST_AXES.map((axis) => (
                      <td key={axis.id} className={`px-3 py-2 ${axisState(tests, axis.id) === "changed" ? "bg-accent-soft" : ""}`}>
                        <span className={test[axis.id] === MISSING ? "text-muted" : undefined}>{test[axis.id]}</span>
                      </td>
                    ))}
                    <td className="px-3 py-2">{test.outcome}</td>
                    <td className={`px-3 py-2 ${test.spread === MISSING ? "text-muted" : ""}`}>{test.spread}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {points.length >= 2 && varied ? (
            <section aria-label="Outcome chart" className="mt-4 rounded-lg border border-line bg-surface p-4">
              <h2 className="mb-3 text-base font-semibold">Outcome against {CHART_AXIS_LABEL[varied]}</h2>
              <OutcomeChart points={points} axisLabel={CHART_AXIS_LABEL[varied]} />
            </section>
          ) : (
            <p className="mt-3 text-sm text-muted">No condition takes two different stated values, so there is no varied axis to chart.</p>
          )}
        </>
      )}
    </div>
  );
}

function AxisNote({ state }: { state: AxisState }) {
  const text = state === "changed" ? "Changed" : state === "fixed" ? "Stayed fixed" : "Not stated";
  return <span className={`mt-0.5 block text-xs font-normal ${state === "changed" ? "text-warn" : "text-muted"}`}>{text}</span>;
}

function Cell({
  row,
  item,
  expanded,
  onToggle,
}: {
  row: CompareRowId;
  item: CompareInvestigation;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (row === "ignition" || row === "flameSpread" || row === "extinction") {
    const group = row === "ignition" ? "Ignition" : row === "flameSpread" ? "Flame spread" : "Extinction";
    return <Findings findings={findingsFor(item, group)} expanded={expanded} onToggle={onToggle} />;
  }
  if (row === "varied" || row === "sensors" || row === "platform") return <BulletList items={listFor(row, item)} />;
  if (row === "fuel") return <Fuels item={item} />;
  const text = rowValue(row, item);
  return <p className={text === MISSING ? "text-muted" : undefined}>{text}</p>;
}

function Fuels({ item }: { item: CompareInvestigation }) {
  if (!item.fuelPhase && item.fuels.length === 0) return <p className="text-muted">{MISSING}</p>;
  return (
    <div>
      {item.fuelPhase ? <p className={item.fuels.length > 0 ? "mb-1 text-muted" : undefined}>{label(item.fuelPhase)}</p> : null}
      {item.fuels.length > 0 ? <BulletList items={item.fuels} /> : null}
    </div>
  );
}

function Findings({
  findings,
  expanded,
  onToggle,
}: {
  findings: { group: string; text: string }[];
  expanded: boolean;
  onToggle: () => void;
}) {
  if (findings.length === 0) return <p className="text-muted">{MISSING}</p>;
  const visible = visibleFindings(findings, expanded);
  const hidden = findings.length - visible.length;
  return (
    <div className="space-y-2">
      {visible.map((finding, index) => (
        <p key={`${finding.text}-${index}`} className="leading-6">
          {finding.text}
        </p>
      ))}
      {hidden > 0 || (expanded && findings.length > FINDING_PREVIEW) ? (
        <button type="button" onClick={onToggle} aria-expanded={expanded} className="font-medium text-accent underline-offset-2 hover:underline">
          {expanded ? "Show fewer" : `Show all ${findings.length} findings`}
        </button>
      ) : null}
    </div>
  );
}

function BulletList({ items }: { items: readonly string[] }) {
  if (items.length === 0) return <p className="text-muted">{MISSING}</p>;
  return (
    <ul className="list-disc space-y-1 pl-4 leading-6">
      {items.map((item, index) => (
        <li key={`${index}-${item}`}>{label(item)}</li>
      ))}
    </ul>
  );
}

function listFor(row: CompareRowId, item: CompareInvestigation): string[] {
  switch (row) {
    case "varied":
      return item.varied;
    case "sensors":
      return item.sensors;
    case "platform":
      return item.platform;
    default:
      return [];
  }
}
