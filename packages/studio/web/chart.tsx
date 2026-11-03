import { useEffect, useRef, useState } from 'react';

// Brand theme (tokens.css / Chart.dc.html): lavender series palette, Inter text, JetBrains Mono axis labels.
const light = {
  text: '#1a1525', body: '#2e2640', muted: '#52486a', grid: '#eae8f2', domain: '#d5cfe3',
  series: ['#574d7e', '#1b62b5', '#a8530a', '#9d93b3', '#7c6f9b', '#3f8f9b', '#c27c2c', '#b9adde'],
};
const dark = {
  text: '#f1eff5', body: '#dcd7e6', muted: '#a79fbb', grid: '#2f2740', domain: '#463e5c',
  series: ['#d5cfe3', '#8fd8f0', '#faca60', '#7c6f9b', '#c7a1f9', '#b5b9d8', '#a599c4', '#6b5d8a'],
};

export function chartConfig(isDark: boolean) {
  const t = isDark ? dark : light;
  const mono = "'JetBrains Mono', ui-monospace, monospace";
  const sans = "Inter, ui-sans-serif, system-ui, sans-serif";
  return {
    background: 'transparent',
    font: sans,
    view: { stroke: null },
    range: { category: t.series, ramp: [t.grid, t.series[0]!] },
    mark: { color: t.series[0] },
    bar: { color: t.series[0], cornerRadiusEnd: 2 },
    line: { color: t.series[0], strokeWidth: 2 },
    point: { color: t.series[0], filled: true },
    area: { color: t.series[0], opacity: 0.85 },
    axis: {
      labelFont: mono, labelFontSize: 11, labelColor: t.muted, titleFont: sans, titleFontSize: 12, titleFontWeight: 500, titleColor: t.body,
      gridColor: t.grid, domainColor: t.domain, tickColor: t.domain,
    },
    legend: { labelFont: sans, labelFontSize: 12, labelColor: t.body, titleFont: sans, titleFontSize: 12, titleFontWeight: 500, titleColor: t.muted },
    title: { font: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 18, fontWeight: 700, color: t.text, anchor: 'start', subtitleColor: t.muted, subtitleFont: sans },
  };
}

/** Renders a checked Vega-Lite spec over `data`. vega-embed is imported on first use, so it is a separate chunk. */
export function Chart(props: { spec: Record<string, unknown>; data: Record<string, unknown>[] }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    let finalize: (() => void) | undefined;
    const isDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    setError(undefined);
    import('vega-embed').then(async ({ default: embed }) => {
      if (cancelled || !host.current) return;
      const spec = { width: 'container', autosize: { type: 'fit', contains: 'padding' }, ...props.spec, data: { values: props.data } };
      const result = await embed(host.current, spec as never, { actions: false, renderer: 'svg', config: chartConfig(isDark) as never });
      if (cancelled) result.finalize(); else finalize = () => result.finalize();
    }).catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; finalize?.(); };
  }, [props.spec, props.data]);
  return (
    <>
      {error && <div className="error" role="alert"><div className="eyebrow">chart error</div><pre className="mono">{error}</pre></div>}
      <div ref={host} className="chart-host" data-testid="chart" />
    </>
  );
}
