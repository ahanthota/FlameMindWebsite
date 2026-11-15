"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState, linkClass } from "@/components/States";
import {
  COMPARE_ROWS,
  FINDING_PREVIEW,
  rowValue,
  sameAcross,
  visibleFindings,
  type CompareInvestigation,
  type CompareRowId,
} from "@/lib/compare";
import { label, MISSING } from "@/lib/format";

export function Compare({ records }: { records: CompareInvestigation[] }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(records.map((item) => item.id)));
  const [differencesOnly, setDifferencesOnly] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const shown = useMemo(() => records.filter((item) => selected.has(item.id)), [records, selected]);
  const rows = COMPARE_ROWS.filter((row) => !differencesOnly || !sameAcross(shown, row.id));

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div>
      <fieldset className="mb-4 rounded-lg border border-line bg-surface p-4">
        <legend className="px-1 text-sm font-medium">Investigations to compare</legend>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {records.map((item) => (
            <label key={item.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.has(item.id)}
                onChange={() => toggle(item.id)}
                className="size-4 accent-accent"
              />
              <span>
                {item.acronym} <span className="text-muted">{item.id}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <button
            type="button"
            onClick={() => setSelected(new Set(records.map((item) => item.id)))}
            className="font-medium text-accent underline-offset-2 hover:underline"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="font-medium text-accent underline-offset-2 hover:underline"
          >
            Clear
          </button>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={differencesOnly}
              onChange={(event) => setDifferencesOnly(event.target.checked)}
              className="size-4 accent-accent"
            />
            Show only rows that differ
          </label>
          <span className="text-muted">
            {shown.length} of {records.length} shown
          </span>
        </div>
      </fieldset>

      {shown.length < 2 ? (
        <EmptyState title="Choose at least two investigations">
          The checkboxes above pick which structured investigations sit in the table.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState title="These investigations match on every row">
          Turn off &quot;Show only rows that differ&quot; to see the full comparison.
        </EmptyState>
      ) : (
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
              {rows.map((row) => {
                const differs = !sameAcross(shown, row.id);
                return (
                  <tr key={row.id} className="border-b border-line align-top last:border-b-0">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-surface px-3 py-3 font-medium"
                    >
                      {row.label}
                      {differs ? <span className="mt-0.5 block text-xs font-normal text-muted">Differs</span> : null}
                    </th>
                    {shown.map((item) => (
                      <td key={item.id} className="min-w-64 border-l border-line px-3 py-3">
                        <Cell
                          row={row.id}
                          item={item}
                          expanded={expanded.has(item.id)}
                          onToggle={() =>
                            setExpanded((current) => {
                              const next = new Set(current);
                              if (next.has(item.id)) next.delete(item.id);
                              else next.add(item.id);
                              return next;
                            })
                          }
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {shown.length >= 2 ? (
        <p className="mt-2 text-xs text-muted">A dash means the sources do not state the value.</p>
      ) : null}
    </div>
  );
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
  if (row === "findings") return <Findings item={item} expanded={expanded} onToggle={onToggle} />;
  if (row === "objectives" || row === "varied" || row === "fixed" || row === "sensors") {
    return <BulletList items={listFor(row, item)} />;
  }
  if (row === "fuels") return <Fuels item={item} />;
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
  item,
  expanded,
  onToggle,
}: {
  item: CompareInvestigation;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (item.findings.length === 0) return <p className="text-muted">No findings are recorded.</p>;
  const visible = visibleFindings(item.findings, expanded);
  const hidden = item.findings.length - visible.length;
  return (
    <div className="space-y-2">
      {visible.map((finding, index) => {
        const showGroup = finding.group !== visible[index - 1]?.group;
        return (
          <div key={`${finding.group}-${index}`}>
            {showGroup ? <p className="text-xs font-medium text-muted">{finding.group}</p> : null}
            <p className="leading-6">{finding.text}</p>
          </div>
        );
      })}
      {hidden > 0 || (expanded && item.findings.length > FINDING_PREVIEW) ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="font-medium text-accent underline-offset-2 hover:underline"
        >
          {expanded ? "Show fewer" : `Show all ${item.findings.length} findings`}
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
        <li key={`${index}-${item}`}>{item}</li>
      ))}
    </ul>
  );
}

function listFor(row: CompareRowId, item: CompareInvestigation): string[] {
  switch (row) {
    case "objectives":
      return item.objectives;
    case "varied":
      return item.varied;
    case "fixed":
      return item.fixed;
    case "sensors":
      return item.sensors;
    default:
      return [];
  }
}
