"use client";

import { useEffect, useState } from "react";

const DURATION_MS = 900;

/**
 * Counts from zero to `value` once, when the page loads. Screen readers hear the
 * final number. With reduced motion, the final number is shown immediately.
 */
export function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    let frame = 0;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      frame = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(frame);
    }
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / DURATION_MS);
      // Ease out: fast at first, settling on the number.
      setShown(Math.round(value * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <>
      <span aria-hidden="true">{shown.toLocaleString("en-US")}</span>
      <span className="sr-only">{value.toLocaleString("en-US")}</span>
    </>
  );
}
