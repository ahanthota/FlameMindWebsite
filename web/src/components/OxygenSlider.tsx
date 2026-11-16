"use client";

import { useEffect, useRef, useState } from "react";
import { HabitatArt, hasHabitatPhoto } from "@/components/HabitatArt";
import { formatNumber } from "@/lib/format";
import type { Habitat } from "@/lib/types";

const MIN = 21;
const MAX = 34;
const STEP_MS = 420;

/**
 * The habitat presets in the slider's range. Oxygen and pressure are the
 * stated preset values. Nothing here is a flame measurement.
 * The bar travels the range and back on its own. The highlighted cards are the
 * presets closest to the current oxygen. Dragging or focusing the bar pauses it.
 */
export function OxygenSlider({ habitats }: { habitats: Habitat[] }) {
  const [oxygen, setOxygen] = useState(MIN);
  const oxygenRef = useRef(MIN);
  const directionRef = useRef(1);
  const pausedRef = useRef(false);
  const ordered = [...habitats].sort((a, b) => a.o2_percent - b.o2_percent || a.name.localeCompare(b.name));

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (pausedRef.current) return;
      let next = oxygenRef.current + directionRef.current;
      if (next > MAX) {
        directionRef.current = -1;
        next = MAX - 1;
      } else if (next < MIN) {
        directionRef.current = 1;
        next = MIN + 1;
      }
      oxygenRef.current = next;
      setOxygen(next);
    }, STEP_MS);
    return () => window.clearInterval(timer);
  }, []);

  function showOxygen(value: number) {
    oxygenRef.current = value;
    setOxygen(value);
  }

  return (
    <figure className="rounded-lg border border-line bg-surface p-4">
      <label className="block text-sm">
        <span className="flex items-baseline justify-between">
          <span className="font-medium">Oxygen (%)</span>
          <span className="text-lg font-semibold tabular-nums">{oxygen}%</span>
        </span>
        <input
          type="range"
          min={MIN}
          max={MAX}
          step={1}
          value={oxygen}
          onChange={(event) => showOxygen(Number(event.target.value))}
          onPointerDown={() => {
            pausedRef.current = true;
          }}
          onPointerUp={() => {
            pausedRef.current = false;
          }}
          onFocus={() => {
            pausedRef.current = true;
          }}
          onBlur={() => {
            pausedRef.current = false;
          }}
          className="mt-1 w-full accent-accent"
          list="oxygen-marks"
        />
        <datalist id="oxygen-marks">
          {ordered.map((habitat) => (
            <option key={habitat.id} value={Math.round(habitat.o2_percent)} label={habitat.name} />
          ))}
        </datalist>
      </label>
      <ul className="mt-3 space-y-2">
        {ordered.map((habitat) => {
          const distance = Math.abs(habitat.o2_percent - oxygen);
          const nearest = Math.min(...ordered.map((item) => Math.abs(item.o2_percent - oxygen)));
          const selected = distance - nearest < 0.01;
          return (
            <li
              key={habitat.id}
              className={`flex gap-3 rounded-md border p-2 sm:p-3 ${selected ? "border-accent bg-accent-soft" : "border-line"}`}
            >
              {hasHabitatPhoto(habitat.id) ? (
                <div className="w-28 shrink-0 sm:w-40">
                  <HabitatArt id={habitat.id} />
                </div>
              ) : null}
              <div className="min-w-0 flex-1 self-center">
                <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                  <span className={selected ? "font-medium text-accent" : "font-medium"}>{habitat.name}</span>
                  <span className="tabular-nums">
                    {formatNumber(habitat.o2_percent)}% oxygen at {formatNumber(habitat.pressure_psi)} psi
                  </span>
                </p>
                <p className="mt-1 text-xs leading-5 text-muted">{habitat.source_note}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <figcaption className="mt-3 text-xs leading-5 text-muted">
        These are the habitat presets. Photographs: NASA. No flame size is shown, because none was measured, calculated,
        or predicted from a test.
      </figcaption>
    </figure>
  );
}
