import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { inferRouterOutputs } from '@trpc/server';
import superjson from 'superjson';
import { clickhouse, formatDialect } from 'sql-formatter';
import type { AppRouter } from '../server/server.js';
import type { EditorView } from '@codemirror/view';
import { Chart } from './chart.js';
import { chartSample, toChartData } from './chart-data.js';
import { Editor } from './editor.js';
import { Palette, type PaletteItem, type PaletteStep } from './palette.js';
import { isMac, matchShortcut, type Action } from './keymap.js';
import './styles.css';

const api = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc', transformer: superjson })] });
type Outputs = inferRouterOutputs<AppRouter>;
type Meta = Outputs['meta']['get'];
type RunResult = Outputs['query']['run'];
type Success = Extract<RunResult, { ok: true }>;
type Generated = Outputs['ai']['generateQuery'];
type ChartOutcome = Outputs['ai']['generateChart'];
type Saved = Extract<Outputs['saved']['list'], { ok: true }>['queries'][number];
type View = 'table' | 'chart' | 'sql';

const MOD = isMac(navigator.platform) ? '⌘' : 'Ctrl+';
const SOURCE_KEY = 'typedhouse-studio:source';
const LIMIT_KEY = 'typedhouse-studio:auto-limit';
const PROMPT_KEY = 'typedhouse-studio:prompt';
const CHART_PROMPT_KEY = 'typedhouse-studio:chart-prompt';
const CHART_SPEC_KEY = 'typedhouse-studio:chart-spec';
const loadSpec = (): Record<string, unknown> | undefined => { try { return JSON.parse(store.get(CHART_SPEC_KEY) ?? 'null') ?? undefined; } catch { return undefined; } };
const store = {
  get(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
};

function starter(meta: Meta | undefined): string {
  const first = meta?.tables[0]?.name;
  const binding = first && /^[A-Za-z_$][\w$]*$/.test(first) ? first : 'my_table';
  return `// Introspected tables and @typedhouse/core are in scope; no imports needed.\n// ${MOD}↵ runs · ${MOD}/ toggles the 100-row auto-limit\nconst query = from(${binding})\n\nexport default query\n`;
}

function formatSql(sql: string): string {
  try { return formatDialect(sql, { dialect: clickhouse, tabWidth: 2, keywordCase: 'upper' }); } catch { return sql; }
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString().replace('T', ' ').replace('Z', '');
  if (typeof value === 'object') return JSON.stringify(value, (_k, v: unknown) => typeof v === 'bigint' ? v.toString() : v);
  return String(value);
}
const numericType = (type: string) => /^(Nullable\()?(LowCardinality\()?(U?Int|Float|Decimal)/.test(type);
const valueAt = (row: unknown, path: readonly string[]) => path.reduce<unknown>((v, k) => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), row);

function Kbd(props: { children: ReactNode }) { return <span className="kbd">{props.children}</span>; }

function Logo() {
  return <svg width="26" height="26" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#7c6f9b" /><path d="M12 20h20M22 20v26M39 20v26M53 20v26M39 33h14" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" /></svg>;
}

function ResultsTable(props: { result: Success }) {
  const { columns, rows } = props.result;
  return (
    <div className="table-wrap">
      <table className="mono results-table">
        <thead>
          <tr>
            <th className="index">#</th>
            {columns.map(c => <th key={c.name} className={numericType(c.type) ? 'num' : undefined}>{c.name} <span className="type">{c.type}</span></th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="row">
              <td className="index">{i + 1}</td>
              {columns.map(c => {
                const value = valueAt(row, c.path);
                return <td key={c.name} className={[numericType(c.type) ? 'num' : '', value === null ? 'null' : ''].join(' ')}>{cellText(value)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="empty">No rows.</div>}
    </div>
  );
}

function SqlView(props: { result: Success }) {
  const params = Object.entries(props.result.params);
  return (
    <div className="sql-view">
      <pre className="mono sql">{formatSql(props.result.sql)}</pre>
      <div className="params">
        <div className="eyebrow">Parameters</div>
        {params.length === 0 && <div className="muted small">None.</div>}
        {params.map(([name, value]) => <div key={name} className="mono param"><span>{name}</span><span className="val">{JSON.stringify(value)}</span></div>)}
        <div className="muted small note">Values are always bound as typed parameters, never inlined.</div>
      </div>
    </div>
  );
}

function App() {
  const [meta, setMeta] = useState<Meta>();
  const [metaError, setMetaError] = useState<string>();
  const [source, setSource] = useState<string | null>(() => store.get(SOURCE_KEY));
  const [autoLimit, setAutoLimit] = useState(() => store.get(LIMIT_KEY) !== 'off');
  const [view, setView] = useState<View>('table');
  const [result, setResult] = useState<RunResult>();
  const [running, setRunning] = useState(false);
  const [split, setSplit] = useState(45);
  const [dragging, setDragging] = useState(false);
  const panes = useRef<HTMLElement>(null);
  const prompt = useRef<HTMLInputElement>(null);
  const editor = useRef<EditorView | null>(null);
  const [ask, setAsk] = useState(() => store.get(PROMPT_KEY) ?? '');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<Generated>();
  const chartPrompt = useRef<HTMLInputElement>(null);
  const focusChartPrompt = useRef(false);
  const [chartAsk, setChartAsk] = useState(() => store.get(CHART_PROMPT_KEY) ?? '');
  const [chartSpec, setChartSpec] = useState<Record<string, unknown> | undefined>(loadSpec);
  const [charting, setCharting] = useState(false);
  const [charted, setCharted] = useState<ChartOutcome>();
  const [saved, setSaved] = useState<Saved[]>([]);
  const [savedError, setSavedError] = useState<string>();
  const [loaded, setLoaded] = useState<{ name: string; source: string }>();
  const [saving, setSaving] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const saveInput = useRef<HTMLInputElement>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteReturn = useRef<Element | null>(null);
  const latest = useRef({ source, autoLimit, running, generating, charting, result, paletteOpen, ask, chartSpec });
  latest.current = { source, autoLimit, running, generating, charting, result, paletteOpen, ask, chartSpec };

  useEffect(() => {
    api.meta.get.query().then(m => {
      setMeta(m);
      setSource(s => s ?? starter(m));
    }, (error: unknown) => { setMetaError(String(error)); setSource(s => s ?? starter(undefined)); });
  }, []);

  const refreshSaved = useCallback(async () => {
    try {
      const listed = await api.saved.list.query();
      if (listed.ok) { setSaved(listed.queries); setSavedError(undefined); } else setSavedError(listed.error);
    } catch (error) { setSavedError(String(error)); }
  }, []);
  useEffect(() => { void refreshSaved(); }, [refreshSaved]);

  const run = useCallback(async (override?: string) => {
    const { source: current, autoLimit: limit, running: busy } = latest.current;
    const text = override ?? current;
    if (busy || text === null) return;
    setRunning(true);
    try { setResult(await api.query.run.mutate({ source: text, autoLimit: limit })); }
    catch (error) { setResult({ ok: false, error: { stage: 'clickhouse', message: `Request failed: ${String(error)}` } }); }
    finally { setRunning(false); }
  }, []);

  /** Replace the editor content (undoable in the editor) and keep it as the source of truth. */
  const replaceSource = useCallback((text: string) => {
    const view = editor.current;
    if (view) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    setSource(text);
    store.set(SOURCE_KEY, text);
  }, []);

  const generate = useCallback(async () => {
    const { source: current, generating: busy } = latest.current;
    const text = prompt.current?.value.trim() ?? '';
    if (busy || !text) return;
    setGenerating(true);
    setGenerated(undefined);
    try {
      const outcome = await api.ai.generateQuery.mutate({ prompt: text, ...(current ? { source: current } : {}) });
      setGenerated(outcome);
      if (outcome.ok) {
        replaceSource(outcome.source);
        setView('table');
        void run(outcome.source);
      }
    } catch (error) {
      setGenerated({ ok: false, error: `Request failed: ${String(error)}`, source: null, attempts: 0 });
    } finally {
      setGenerating(false);
    }
  }, [replaceSource, run]);

  const generateChart = useCallback(async () => {
    const { charting: busy, result: current } = latest.current;
    const text = chartPrompt.current?.value.trim() ?? '';
    if (busy || !text || !current?.ok) return;
    setCharting(true);
    setCharted(undefined);
    try {
      const outcome = await api.ai.generateChart.mutate({
        prompt: text,
        columns: current.columns.map(c => ({ name: c.name, type: c.type })),
        sample: chartSample(current.rows, current.columns),
      });
      setCharted(outcome);
      if (outcome.ok) { setChartSpec(outcome.spec); store.set(CHART_SPEC_KEY, JSON.stringify(outcome.spec)); }
    } catch (error) {
      setCharted({ ok: false, error: `Request failed: ${String(error)}`, spec: null, attempts: 0 });
    } finally {
      setCharting(false);
    }
  }, []);

  /** ⌘S: open the inline name field, prefilled from the loaded name, the prompt, or "Untitled". */
  const startSave = useCallback(() => {
    setSaveError(undefined);
    setSaving(loaded?.name ?? (latest.current.ask.trim().slice(0, 100) || 'Untitled'));
    // Already open: just refocus (a fresh field focuses itself on mount).
    saveInput.current?.focus();
  }, [loaded]);

  const doSave = useCallback(async (name: string) => {
    const { source: text, ask: promptText, chartSpec: chart } = latest.current;
    const entry = { name, prompt: promptText, source: text ?? '', chart: chart ?? null };
    let outcome = await api.saved.save.mutate(entry);
    if (!outcome.ok && 'exists' in outcome) {
      if (!window.confirm(`A saved query named "${name.trim()}" exists. Overwrite it?`)) return;
      outcome = await api.saved.save.mutate({ ...entry, overwrite: true });
    }
    if (!outcome.ok) { setSaveError('error' in outcome ? outcome.error : 'Not saved.'); return; }
    setSaving(undefined);
    setLoaded({ name: name.trim(), source: text ?? '' });
    await refreshSaved();
  }, [refreshSaved]);

  const loadSaved = useCallback((query: Saved) => {
    replaceSource(query.source);
    setAsk(query.prompt);
    store.set(PROMPT_KEY, query.prompt);
    const chart = query.chart ?? undefined;
    setChartSpec(chart);
    if (chart) store.set(CHART_SPEC_KEY, JSON.stringify(chart));
    setLoaded({ name: query.name, source: query.source });
    setGenerated(undefined);
  }, [replaceSource]);

  const deleteSaved = useCallback(async (query: Saved) => {
    if (!window.confirm(`Delete the saved query "${query.name}"?`)) return;
    const outcome = await api.saved.delete.mutate({ name: query.name });
    if (!outcome.ok) { setSavedError(outcome.error); return; }
    setLoaded(current => (current?.name === query.name ? undefined : current));
    await refreshSaved();
  }, [refreshSaved]);

  /** Insert at the editor cursor (sidebar table click, palette table result). */
  const insertAtCursor = useCallback((text: string) => {
    const view = editor.current;
    if (!view) return;
    view.dispatch(view.state.replaceSelection(text));
    view.focus();
  }, []);

  const openPalette = useCallback(() => {
    if (latest.current.paletteOpen) return;
    paletteReturn.current = document.activeElement;
    setPaletteOpen(true);
  }, []);
  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    const back = paletteReturn.current;
    requestAnimationFrame(() => { if (back instanceof HTMLElement && document.contains(back)) back.focus(); });
  }, []);

  const toggleLimit = useCallback(() => setAutoLimit(on => { store.set(LIMIT_KEY, on ? 'off' : 'on'); return !on; }), []);

  useEffect(() => {
    const actions: Record<Action, () => void> = {
      run: () => void run(),
      toggleLimit,
      focusPrompt: () => prompt.current?.focus(),
      // The chart prompt lives in the Chart tab: show it, then focus once it is rendered.
      chartPrompt: () => { if (chartPrompt.current) chartPrompt.current.focus(); else { focusChartPrompt.current = true; setView('chart'); } },
      tabTable: () => setView('table'),
      tabChart: () => setView('chart'),
      tabSql: () => setView('sql'),
      palette: openPalette,
      save: startSave,
    };
    // Capture phase: shortcuts win over CodeMirror and browser defaults (⌘S save dialog, ⌘K, ⌘L address bar...).
    const onKey = (event: KeyboardEvent) => {
      const action = matchShortcut(event);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      // While the palette is open only its own keys work (Esc closes it there).
      if (latest.current.paletteOpen) return;
      actions[action]();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [run, toggleLimit, openPalette, startSave]);

  // ⌘G from another tab: focus the chart prompt once the Chart tab has rendered it.
  useEffect(() => {
    if (view === 'chart' && focusChartPrompt.current) { focusChartPrompt.current = false; chartPrompt.current?.focus(); }
  }, [view]);

  const paletteItems = (): PaletteItem[] => {
    const shortcut = (key: string) => `${MOD}${key}`;
    const switchModel = async (): Promise<PaletteStep> => {
      const listed = await api.models.list.query();
      const current = meta?.model.available ? `${meta.model.provider}/${meta.model.modelId}` : '';
      return {
        title: 'Switch model',
        empty: listed.reason ?? 'No models available.',
        items: listed.models.map(m => ({
          id: `model:${m.provider}/${m.modelId}`, group: 'Models' as const, icon: 'model' as const, mono: true,
          label: `${m.provider}/${m.modelId}`, hint: `${m.provider}/${m.modelId}` === current ? 'current' : (m.name !== m.modelId ? m.name : undefined),
          run: async () => {
            const chosen = await api.models.select.mutate({ provider: m.provider, modelId: m.modelId });
            if (chosen.ok) setMeta(await api.meta.get.query());
          },
        })),
      };
    };
    const action = (id: string, label: string, run: PaletteItem['run'], kbd?: string, hint?: string): PaletteItem => ({ id: `action:${id}`, group: 'Actions', icon: 'action', label, run, kbd, hint });
    return [
      action('run', 'Run query', () => void run(), shortcut('↵')),
      action('limit', 'Toggle auto-limit (100 rows)', toggleLimit, shortcut('/')),
      action('table', 'Show Table', () => setView('table'), shortcut('1')),
      action('chart', 'Show Chart', () => setView('chart'), shortcut('2')),
      action('sql', 'Show SQL', () => setView('sql'), shortcut('3')),
      action('ask', 'Ask in English (focus prompt)', () => { paletteReturn.current = prompt.current; }, shortcut('L')),
      action('describe', 'Describe a chart', () => { focusChartPrompt.current = true; paletteReturn.current = null; setView('chart'); if (chartPrompt.current) requestAnimationFrame(() => chartPrompt.current?.focus()); }, shortcut('G')),
      action('save', 'Save query', () => { paletteReturn.current = null; startSave(); }, shortcut('S')),
      action('refresh', 'Refresh schema', async () => { setMeta(await api.schema.refresh.mutate()); }),
      action('model', 'Switch model…', switchModel, undefined, meta?.model.available ? `${meta.model.provider}/${meta.model.modelId}` : 'from pi'),
      ...saved.map(q => ({ id: `saved:${q.name}`, group: 'Saved' as const, icon: 'saved' as const, label: q.name, hint: q.chart ? 'with chart' : undefined, run: () => { paletteReturn.current = editor.current?.contentDOM ?? null; loadSaved(q); } })),
      ...(meta?.tables ?? []).map(t => ({ id: `table:${t.name}`, group: 'Tables' as const, icon: 'table' as const, mono: true, label: t.name, hint: `${t.columns.length} cols`,
        run: () => { paletteReturn.current = null; insertAtCursor(`from(${t.binding})`); } })),
    ];
  };

  const modified = loaded !== undefined && source !== loaded.source;

  const onSourceChange = useCallback((value: string) => { setSource(value); store.set(SOURCE_KEY, value); }, []);

  const clamp = (p: number) => Math.min(68, Math.max(28, p));
  const onDrag = (e: ReactPointerEvent) => {
    if (!dragging || !panes.current) return;
    const r = panes.current.getBoundingClientRect();
    setSplit(clamp(((e.clientX - r.left - 28) / (r.width - 40)) * 100));
  };
  const onSplitKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); setSplit(s => clamp(s - 2)); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setSplit(s => clamp(s + 2)); }
  };

  const ok = result?.ok ? result : undefined;
  const chartData = useMemo(() => (ok ? toChartData(ok.rows, ok.columns) : []), [ok]);
  const status = running ? 'Running…' : ok ? `${ok.rowCount.toLocaleString()} ${ok.rowCount === 1 ? 'row' : 'rows'}${ok.limited ? ' (limited)' : ''} · ${ok.elapsedMs} ms` : '';
  const tabs: [View, string, string][] = [['table', 'Table', `${MOD}1`], ['chart', 'Chart', `${MOD}2`], ['sql', 'SQL', `${MOD}3`]];

  return (
    <div className="app">
      <header className="on-night header">
        <div className="brand"><Logo /><span className="display brand-name">TypedHouse</span><span className="display brand-sub">Studio</span></div>
        <div className="mono chip" title={metaError ?? meta?.schemaError ?? undefined}>
          <span className="dot" style={{ background: meta && !meta.schemaError ? '#8fd8f0' : '#faca60' }} />
          {meta ? `clickhouse · ${meta.connection}` : metaError ? 'server unreachable' : 'connecting…'}
        </div>
        <div className="chip muted-chip model-chip" title={meta && !meta.model.available ? meta.model.reason : undefined}>
          pi durable <span className="mono on">{!meta ? '…' : meta.model.available ? `${meta.model.provider} · ${meta.model.modelId}` : `LLM unavailable: ${meta.model.reason}`}</span>
        </div>
        <div className="spacer" />
        <button className="btn palette-btn" type="button" title="Command palette" onClick={openPalette}>
          <span className="palette-label"><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>Commands, tables, queries</span>
          <Kbd>{MOD}K</Kbd>
        </button>
      </header>

      <div className="shell-row">
        <aside className="shell-side">
          <nav aria-label="Schema" className="side-nav">
            <div className="eyebrow side-title"><span>Tables</span><span>{meta?.tables.length ?? ''}</span></div>
            {meta?.schemaError && <div className="side-error">{meta.schemaError}</div>}
            {meta?.tables.map(t => (
              <div key={t.name} className="row side-row" role="button" tabIndex={0} title={`Insert from(${t.binding})\n\n${t.columns.map(c => `${c.name}: ${c.type}`).join('\n')}`}
                onClick={() => insertAtCursor(`from(${t.binding})`)} onKeyDown={e => { if (e.key === 'Enter') insertAtCursor(`from(${t.binding})`); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="var(--typedhouse-icon)" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 10v10" /></svg>
                <span className="mono side-name">{t.name}</span>
                <span className="mono side-count">{t.columns.length} cols</span>
              </div>
            ))}
          </nav>
          <nav aria-label="Saved queries" className="side-nav">
            <div className="eyebrow side-title">Saved</div>
            {savedError && <div className="side-error">{savedError}</div>}
            {!savedError && saved.length === 0 && <div className="muted small side-empty">No saved queries yet. <Kbd>{MOD}S</Kbd> saves.</div>}
            {saved.map(q => (
              <div key={q.name} className={`row side-row saved-row${loaded?.name === q.name ? ' on' : ''}`}>
                <button type="button" className="saved-load" title={q.prompt || q.name} onClick={() => loadSaved(q)}>{q.name}</button>
                <button type="button" className="saved-delete" aria-label={`Delete ${q.name}`} title="Delete" onClick={() => void deleteSaved(q)}>×</button>
              </div>
            ))}
          </nav>
          <div className="spacer" />
          <div className="hints">
            <div><span>Run</span><Kbd>{MOD}↵</Kbd></div>
            <div><span>Ask in English</span><Kbd>{MOD}L</Kbd></div>
            <div><span>Toggle limit</span><Kbd>{MOD}/</Kbd></div>
            <div><span>Table · Chart · SQL</span><Kbd>{MOD}1–3</Kbd></div>
            <div><span>Save</span><Kbd>{MOD}S</Kbd></div>
            <div><span>Commands</span><Kbd>{MOD}K</Kbd></div>
          </div>
        </aside>

        <main className="panes" ref={panes}>
          <div className="pane-left" style={{ flex: `0 0 ${split}%` }}>
            <label htmlFor="ask" className="ask">
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="var(--typedhouse-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>
              <input id="ask" ref={prompt} value={ask} placeholder="Describe the data you want" aria-label="Describe the data you want" aria-busy={generating}
                onChange={e => { setAsk(e.target.value); store.set(PROMPT_KEY, e.target.value); }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); void generate(); }
                  if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur(); }
                }} />
              {generating ? <span className="muted small generating">Generating…</span> : <><span className="muted small">Generate</span><Kbd>↵</Kbd></>}
            </label>
            {saving !== undefined && (
              <form className="save-bar" onSubmit={e => { e.preventDefault(); void doSave(saving); }}>
                <label htmlFor="save-name" className="small muted">Save as</label>
                <input id="save-name" ref={saveInput} value={saving} maxLength={100} autoFocus onFocus={e => e.currentTarget.select()} onChange={e => setSaving(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setSaving(undefined); } }} />
                <button type="submit" className="btn run-btn small-btn">Save</button>
                <button type="button" className="btn link-btn" onClick={() => setSaving(undefined)}>Cancel</button>
                {saveError && <div className="save-error" role="alert">{saveError}</div>}
              </form>
            )}
            {generated && (generated.ok
              ? <div className="notice" role="status"><div>Generated in {generated.attempts} {generated.attempts === 1 ? 'attempt' : 'attempts'} and ran with auto-limit {autoLimit ? 'on' : 'off'}. It is a proposal: edit it and press <Kbd>{MOD}↵</Kbd> to rerun.</div></div>
              : <div className="notice notice-error" role="alert">
                  <div><strong>Could not generate a query.</strong> {generated.error}</div>
                  {generated.source && <button type="button" className="btn link-btn" onClick={() => { replaceSource(generated.source!); setGenerated(undefined); }}>Load the last attempt (it does not compile)</button>}
                </div>)}

            <section aria-label="Query editor" className="on-night editor-card">
              <div className="editor-head">
                <span className="mono">{loaded ? loaded.name : 'query.ts'}{modified && <span className="modified" title="Edited since loading" aria-label="modified"> ●</span>}</span>
                {ok && <span className="mono row-type" title={ok.rowType}>→ {ok.rowType}</span>}
                <div className="spacer" />
                {result && (result.ok
                  ? <span className="compiles"><svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M5 12l5 5L20 7" /></svg>Compiles</span>
                  : <span className="fails">{result.error.stage} error</span>)}
              </div>
              <div className="editor-body">
                {source !== null && <Editor value={source} onChange={onSourceChange} viewRef={editor} />}
              </div>
              <div className="editor-foot">
                <button className="btn run-btn" type="button" onClick={() => void run()} disabled={running}>
                  <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M6 4l14 8-14 8z" /></svg>
                  Run <span className="mono run-key">{MOD}↵</span>
                </button>
              </div>
            </section>
          </div>

          <button className="splitter" type="button" data-dragging={dragging} aria-label="Resize panes (arrow keys, double-click to reset)" aria-valuenow={Math.round(split)}
            onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); }}
            onPointerMove={onDrag} onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)}
            onKeyDown={onSplitKey} onDoubleClick={() => setSplit(45)}>
            <span className="splitter-line" /><span className="splitter-grip" />
          </button>

          <section aria-label="Results" className="results">
            <div className="results-head">
              {tabs.map(([id, label, key]) => (
                <button key={id} type="button" className={`tab${view === id ? ' on' : ''}`} aria-pressed={view === id} onClick={() => setView(id)}>{label} <Kbd>{key}</Kbd></button>
              ))}
              <div className="spacer" />
              <span className="mono muted small status">{status}</span>
            </div>
            {result && !result.ok && (
              <div className="error" role="alert"><div className="eyebrow">{result.error.stage} error</div><pre className="mono">{result.error.message}</pre></div>
            )}
            {!result && <div className="empty">Press <Kbd>{MOD}↵</Kbd> to run the query.</div>}
            {ok && view === 'table' && <ResultsTable result={ok} />}
            {view === 'chart' && (
              <div className="chart-pane">
                <label htmlFor="chart-ask" className="ask chart-ask">
                  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="var(--typedhouse-accent)" strokeWidth="2" strokeLinecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
                  <input id="chart-ask" ref={chartPrompt} value={chartAsk} placeholder={ok ? 'Describe a chart of this result' : 'Run a query first, then describe a chart'} aria-label="Describe a chart" aria-busy={charting}
                    onChange={e => { setChartAsk(e.target.value); store.set(CHART_PROMPT_KEY, e.target.value); }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); void generateChart(); }
                      if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur(); }
                    }} />
                  {charting ? <span className="muted small generating">Generating…</span> : <><span className="muted small">Chart</span><Kbd>↵</Kbd></>}
                </label>
                {charted && !charted.ok && <div className="notice notice-error" role="alert"><div><strong>Could not generate a chart.</strong> {charted.error}</div></div>}
                {ok && chartSpec && <Chart spec={chartSpec} data={chartData} />}
                {ok && !chartSpec && <div className="empty">Describe a chart above (<Kbd>{MOD}G</Kbd>); the table stays the default view.</div>}
              </div>
            )}
            {ok && view === 'sql' && <SqlView result={ok} />}
          </section>
        </main>
      </div>

      <footer className="footer">
        <span className="ready"><span className="dot" />{running ? 'Running' : 'Ready'}</span>
        <span>{autoLimit ? 'Auto-limit 100 rows' : 'Auto-limit off'}</span>
        <div className="spacer" />
        <span className="hint"><Kbd>{MOD}/</Kbd> toggle limit</span>
        <span className="hint"><Kbd>{MOD}G</Kbd> visualize</span>
        <span className="hint"><Kbd>{MOD}S</Kbd> save</span>
        <span className="hint"><Kbd>{MOD}K</Kbd> commands</span>
      </footer>
      {paletteOpen && <Palette items={paletteItems()} onClose={closePalette} />}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
