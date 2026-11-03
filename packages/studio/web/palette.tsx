import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { rank } from './palette-match.js';

export type Group = 'Actions' | 'Tables' | 'Saved' | 'Models';
/** A palette entry. `run` closes the palette, unless it returns a next step (e.g. the model list). */
export interface PaletteItem {
  id: string;
  group: Group;
  label: string;
  hint?: string | undefined;
  kbd?: string | undefined;
  mono?: boolean;
  icon?: 'action' | 'table' | 'saved' | 'model';
  run: () => void | PaletteStep | Promise<void | PaletteStep>;
}
export interface PaletteStep { title: string; items: PaletteItem[]; empty?: string }

const ORDER: Group[] = ['Actions', 'Saved', 'Tables', 'Models'];

function Icon(props: { kind: PaletteItem['icon'] }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', 'aria-hidden': true, fill: 'none', stroke: 'var(--typedhouse-icon)', strokeWidth: 2, strokeLinecap: 'round' as const };
  switch (props.kind) {
    case 'table': return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 10v10" /></svg>;
    case 'saved': return <svg {...common}><path d="M6 3h12v18l-6-4-6 4z" /></svg>;
    case 'model': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    default: return <svg {...common}><path d="M4 7h16M4 12h10M4 17h6" /></svg>;
  }
}

function highlight(text: string, indices: readonly number[]): ReactNode {
  if (!indices.length) return text;
  const marked = new Set(indices);
  const out: ReactNode[] = [];
  let run = '';
  let on = false;
  const flush = (key: number) => { if (run) out.push(on ? <mark key={key}>{run}</mark> : run); run = ''; };
  [...text].forEach((c, i) => {
    if (marked.has(i) !== on) { flush(i); on = marked.has(i); }
    run += c;
  });
  flush(text.length);
  return out;
}

/** ⌘K command palette (Palette.dc.html): one input, grouped results, arrows + Enter + Esc, mouse too. */
export function Palette(props: { items: PaletteItem[]; onClose: () => void }) {
  const [step, setStep] = useState<PaletteStep | undefined>();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { input.current?.focus(); }, [step]);

  const items = step?.items ?? props.items;
  const ranked = useMemo(() => {
    const matches = rank(items, query, item => item.label);
    // Grouped in a fixed order; inside a group, best match first (or the given order with an empty query).
    return ORDER.flatMap(group => matches.filter(m => m.item.group === group));
  }, [items, query]);
  useEffect(() => { setActive(0); }, [query, step]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  async function choose(item: PaletteItem) {
    if (busy) return;
    setBusy(true);
    try {
      const next = await item.run();
      if (next) { setStep(next); setQuery(''); } else props.onClose();
    } finally { setBusy(false); }
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(ranked.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const hit = ranked[active]; if (hit) void choose(hit.item); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); props.onClose(); }
  };

  let lastGroup: Group | undefined;
  return (
    <div className="palette-scrim" onMouseDown={e => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="palette">
        <label htmlFor="palette-input" className="palette-search">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="var(--typedhouse-icon)" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          {step && <span className="palette-step">{step.title}</span>}
          <input id="palette-input" ref={input} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown} aria-label="Search commands"
            role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={ranked[active] ? `palette-${ranked[active]!.item.id}` : undefined}
            placeholder={step ? 'Filter…' : 'Commands, tables, saved queries'} autoComplete="off" spellCheck={false} />
          <span className="kbd">esc</span>
        </label>
        <div id="palette-list" role="listbox" ref={list} className="palette-list">
          {ranked.length === 0 && <div className="palette-empty">{step?.empty && !query ? step.empty : 'No matches.'}</div>}
          {ranked.map(({ item, match }, i) => {
            const header = item.group !== lastGroup ? <div className="eyebrow palette-group">{item.group}</div> : null;
            lastGroup = item.group;
            return (
              <div key={item.id}>
                {header}
                <div id={`palette-${item.id}`} role="option" aria-selected={i === active} className={`palette-item${i === active ? ' on' : ''}`}
                  onMouseMove={() => setActive(i)} onClick={() => void choose(item)}>
                  <Icon kind={item.icon} />
                  <span className={`palette-text${item.mono ? ' mono' : ''}`}>{highlight(item.label, match.indices)}</span>
                  {item.hint && <span className="palette-hint">{item.hint}</span>}
                  {item.kbd && <span className="kbd">{item.kbd}</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="palette-foot">
          <span><span className="kbd">↑↓</span> navigate</span>
          <span><span className="kbd">↵</span> open</span>
          <span><span className="kbd">esc</span> close</span>
        </div>
      </div>
    </div>
  );
}
