/** Small UI decisions as pure functions (DOM-free, unit-tested). */
export type View = 'table' | 'chart' | 'sql';

/** The largest source the editor sends back. A longer one would make every next send fail validation (F30). */
export const MAX_SOURCE = 64_000;

/** What a reply does to the tab (R13.6, prototype): a query shows the table, a chart the chart, anything else stays put. */
export function viewAfterReply(view: View, reply: 'query' | 'chart' | 'other'): View {
  return reply === 'query' ? 'table' : reply === 'chart' ? 'chart' : view;
}

/** A failed turn's last attempt is unfiltered: it can be loaded only if the editor could then send it back. */
export const canLoadAttempt = (source: unknown): boolean => typeof source === 'string' && source.length <= MAX_SOURCE;

/** The newest version whose source is what the editor holds, so a hand edit marks none. */
export function versionInEditor(turns: readonly { kind: string; n?: number; source?: string | null }[], source: string | null): number | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]!;
    if (turn.kind === 'version' && turn.source === source) return turn.n;
  }
  return undefined;
}

const CHANGES_SHOWN = 12;
/** Changed lines in the server's order (a removal before its addition, never re-sorted). The diff can list every line, so a long one is cut. */
export function cappedChanges<T>(changes: readonly T[]): { shown: readonly T[]; more: number } {
  return changes.length > CHANGES_SHOWN ? { shown: changes.slice(0, CHANGES_SHOWN), more: changes.length - CHANGES_SHOWN } : { shown: changes, more: 0 };
}

const channelField = (encoding: unknown, channel: string) => {
  const def = encoding && typeof encoding === 'object' ? (encoding as Record<string, unknown>)[channel] : undefined;
  const field = def && typeof def === 'object' ? (def as { field?: unknown }).field : undefined;
  return typeof field === 'string' ? `${channel}: ${field}` : undefined;
};
/** One line for a chart turn with an unchanged query: `bar · x: country · y: revenue`. */
export function chartSummary(spec: Record<string, unknown>): string {
  const mark = spec['mark'];
  const kind = typeof mark === 'string' ? mark : mark && typeof mark === 'object' && typeof (mark as { type?: unknown }).type === 'string' ? (mark as { type: string }).type : 'chart';
  return [kind, channelField(spec['encoding'], 'x'), channelField(spec['encoding'], 'y')].filter(Boolean).join(' · ');
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
export const attemptsLabel = (attempts: number, elapsedMs: number) => `${attempts} ${attempts === 1 ? 'attempt' : 'attempts'} · ${seconds(elapsedMs)}`;

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
