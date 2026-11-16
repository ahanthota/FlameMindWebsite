"use client";

import { useEffect, useRef, useState } from "react";
import type { Config, Data, Layout, PlotMouseEvent } from "plotly.js";

type PlotlyApi = {
  newPlot: (root: HTMLElement, data: Data[], layout?: Partial<Layout>, config?: Partial<Config>) => Promise<unknown>;
  react: (root: HTMLElement, data: Data[], layout?: Partial<Layout>, config?: Partial<Config>) => Promise<unknown>;
  purge: (root: HTMLElement) => void;
};

type PlotNode = HTMLElement & {
  on?: (event: string, handler: (event: PlotMouseEvent) => void) => void;
};

type PlotlyWindow = Window & { Plotly?: PlotlyApi };

let loading: Promise<PlotlyApi> | null = null;

function loadPlotly(): Promise<PlotlyApi> {
  if (loading) return loading;
  const pending = new Promise<PlotlyApi>((resolve, reject) => {
    const current = (window as PlotlyWindow).Plotly;
    if (current?.newPlot) {
      resolve(current);
      return;
    }
    const script = document.createElement("script");
    script.src = "/plotly-cartesian.min.js";
    script.async = true;
    script.onload = () => {
      const api = (window as PlotlyWindow).Plotly;
      if (api?.newPlot) resolve(api);
      else reject(new Error("Plotly did not load."));
    };
    script.onerror = () => reject(new Error("Plotly did not load."));
    document.head.appendChild(script);
  });
  loading = pending.then(
    (api) => api,
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/**
 * Draws a Plotly graph after mount. The page stays a sized empty box until
 * the cartesian bundle loads, so server render and the first client render match.
 */
export function PlotView({
  data,
  layout,
  height,
  onClick,
}: {
  data: Data[];
  layout: Partial<Layout>;
  height: number;
  onClick?: (event: PlotMouseEvent) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onClickRef = useRef(onClick);
  const drawn = useRef(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    onClickRef.current = onClick;
  }, [onClick]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let cancelled = false;
    const click = (event: PlotMouseEvent) => onClickRef.current?.(event);
    loadPlotly()
      .then(async (Plotly) => {
        if (cancelled) return;
        const config = { displayModeBar: false, responsive: true };
        if (drawn.current) {
          await Plotly.react(node, data, layout, config);
          return;
        }
        await Plotly.newPlot(node, data, layout, config);
        if (cancelled) {
          Plotly.purge(node);
          return;
        }
        drawn.current = true;
        (node as PlotNode).on?.("plotly_click", click);
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "The chart could not be drawn.");
      });
    return () => {
      cancelled = true;
    };
  }, [data, layout]);

  useEffect(() => {
    const node = ref.current;
    return () => {
      if (!node || !drawn.current) return;
      drawn.current = false;
      loadPlotly()
        .then((Plotly) => Plotly.purge(node))
        .catch(() => undefined);
    };
  }, []);

  if (message) return <p className="text-sm text-warn">{message}</p>;
  return <div ref={ref} style={{ width: "100%", height }} />;
}
