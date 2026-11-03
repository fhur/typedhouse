/** Small UI decisions as pure functions (DOM-free, unit-tested). */
export type View = 'table' | 'chart' | 'sql';

/** F11: a generated query keeps the current tab, except an empty Chart tab (no spec yet) goes to Table. */
export function viewAfterGeneration(view: View, hasChartSpec: boolean): View {
  return view === 'chart' && !hasChartSpec ? 'table' : view;
}

/** Title area for the Chart tab (Chart.dc.html): eyebrow from the mark, title from the spec, the spec without its title. */
export function chartHeading(spec: Record<string, unknown>): { eyebrow: string; title?: string; subtitle?: string; spec: Record<string, unknown> } {
  const mark = spec['mark'];
  const kind = typeof mark === 'string' ? mark : mark && typeof mark === 'object' && typeof (mark as { type?: unknown }).type === 'string' ? (mark as { type: string }).type
    : Array.isArray(spec['layer']) ? 'layered' : Array.isArray(spec['hconcat']) || Array.isArray(spec['vconcat']) || Array.isArray(spec['concat']) ? 'concat' : 'chart';
  const eyebrow = `${kind[0]!.toUpperCase()}${kind.slice(1)} · Vega-Lite`;
  const raw = spec['title'];
  const { title: _title, ...rest } = spec;
  if (typeof raw === 'string') return { eyebrow, title: raw, spec: rest };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const t = raw as { text?: unknown; subtitle?: unknown };
    const text = Array.isArray(t.text) ? t.text.join(' ') : typeof t.text === 'string' ? t.text : undefined;
    const subtitle = Array.isArray(t.subtitle) ? t.subtitle.join(' ') : typeof t.subtitle === 'string' ? t.subtitle : undefined;
    if (text !== undefined) return { eyebrow, title: text, ...(subtitle ? { subtitle } : {}), spec: rest };
  }
  return { eyebrow, spec };
}
