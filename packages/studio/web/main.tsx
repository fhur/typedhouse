import { StrictMode, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createTRPCClient, httpBatchLink, httpLink, splitLink } from '@trpc/client';
import type { inferRouterOutputs } from '@trpc/server';
import superjson from 'superjson';
import type { AppRouter } from '../server/server.js';
import type { EditorView } from '@codemirror/view';
import { Chart } from './chart.js';
import { chartSample, toChartData } from './chart-data.js';
import { Editor, replaceDocument, type Language } from './editor.js';
import { Palette, type PaletteItem, type PaletteStep } from './palette.js';
import { canLoadAttempt, chartHeading, versionInEditor, viewAfterReply, type View } from './rules.js';
import { Thread, type ChatTurn, type TurnAction, type UserTurn } from './thread.js';
import { globalKeys, IGNORES_REPEAT, isMac, keyGroups, matchShortcut, zoneHints, type Action, type Zone } from './keymap.js';
import './styles.css';

/** The editor's TypeScript service (R12), on the server. */
const language: Language = {
  diagnostics: source => api.types.diagnostics.mutate({ source }),
  completions: (source, pos) => api.types.completions.mutate({ source, pos }),
  hover: (source, pos) => api.types.hover.mutate({ source, pos }),
};
// A batch answers when its slowest call ends: a send lasts minutes and a run can be slow, and neither may hold up type checks or a stop.
const api = createTRPCClient<AppRouter>({
  links: [splitLink({
    condition: op => op.path === 'chat.send' || op.path === 'query.run',
    true: httpLink({ url: '/trpc', transformer: superjson }),
    false: httpBatchLink({ url: '/trpc', transformer: superjson }),
  })],
});
type Outputs = inferRouterOutputs<AppRouter>;
type Meta = Outputs['meta']['get'];
type RunResult = Outputs['query']['run'];
type Success = Extract<RunResult, { ok: true }>;
type ChatSummary = Outputs['chat']['list'][number];
type ChatDetail = NonNullable<Outputs['chat']['get']>;
type Version = Extract<ChatTurn, { kind: 'version' }>;
type Spec = Record<string, unknown>;
type Saved = Extract<Outputs['saved']['list'], { ok: true }>['queries'][number];

const MOD = isMac(navigator.platform) ? '⌘' : 'Ctrl+';
const SOURCE_KEY = 'typedhouse-studio:source';
const LIMIT_KEY = 'typedhouse-studio:auto-limit';
const CHART_SPEC_KEY = 'typedhouse-studio:chart-spec';
const CHAT_KEY = 'typedhouse-studio:chat';
/** A send in flight, so a reload can apply its reply: `{ chatId, after, at }`. */
const PENDING_KEY = 'typedhouse-studio:pending';
const draftKey = (chat: string | null) => `typedhouse-studio:draft:${chat ?? 'new'}`;
const editorKey = (chat: string) => `typedhouse-studio:editor:${chat}`;
const chartKey = (chat: string) => `typedhouse-studio:chart:${chat}`;
const parseSpec = (text: string | null): Spec | undefined => { try { return JSON.parse(text ?? 'null') ?? undefined; } catch { return undefined; } };
const loadSpec = () => parseSpec(store.get(CHART_SPEC_KEY));
const store = {
  get(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* private mode */ } },
  remove(key: string) { try { localStorage.removeItem(key); } catch { /* private mode */ } },
};
/**
 * Edits in progress, per chat. The words being written live in that chat's draft and editor keys like any others, so an
 * edit only needs its turn, what it started from, and what it put aside for an esc. Everything read back is shape-checked.
 */
const EDIT_KEY = 'typedhouse-studio:edit';
type EditState = { turn: number; text: string; source: string; aside: { source: string | null; chart: Spec | null; draft: string } };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function isEditState(value: unknown): value is EditState {
  if (!isRecord(value) || !Number.isInteger(value['turn']) || typeof value['text'] !== 'string' || typeof value['source'] !== 'string' || !isRecord(value['aside'])) return false;
  const { source, chart, draft } = value['aside'];
  return (source === null || typeof source === 'string') && (chart === null || isRecord(chart)) && typeof draft === 'string';
}
function readEdits(): Record<string, EditState> {
  let parsed: unknown;
  try { parsed = JSON.parse(store.get(EDIT_KEY) ?? 'null'); } catch { return {}; }
  return isRecord(parsed) ? Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, EditState] => isEditState(entry[1]))) : {};
}
function writeEdits(edits: Record<string, EditState>) {
  if (Object.keys(edits).length) store.set(EDIT_KEY, JSON.stringify(edits)); else store.remove(EDIT_KEY);
}
function saveEdit(chat: string, edit: EditState | undefined) {
  const { [chat]: _old, ...others } = readEdits();
  writeEdits(edit ? { ...others, [chat]: edit } : others);
}
/** A reload: an edit with words of its own stays, to be picked up where it was. One with nothing typed goes back as if never started. */
function settleEdits() {
  const edits = readEdits();
  const open = store.get(CHAT_KEY);
  for (const [chat, edit] of Object.entries(edits)) {
    if (store.get(draftKey(chat)) !== edit.text || store.get(editorKey(chat)) !== edit.source) continue;
    delete edits[chat];
    const { source, chart, draft } = edit.aside;
    if (source !== null) { store.set(editorKey(chat), source); if (chat === open) store.set(SOURCE_KEY, source); }
    for (const key of [chartKey(chat), ...(chat === open ? [CHART_SPEC_KEY] : [])]) { if (chart) store.set(key, JSON.stringify(chart)); else store.remove(key); }
    if (draft) store.set(draftKey(chat), draft); else store.remove(draftKey(chat));
  }
  writeEdits(edits);
}
settleEdits();
// The prompt boxes these belonged to are gone.
store.remove('typedhouse-studio:prompt');
store.remove('typedhouse-studio:chart-prompt');

function starter(meta: Meta | undefined): string {
  const first = meta?.tables[0]?.name;
  const binding = first && /^[A-Za-z_$][\w$]*$/.test(first) ? first : 'my_table';
  return `// Introspected tables and @typedhouse/core are in scope; no imports needed.\n// ${MOD}↵ runs · ${MOD}/ toggles the 100-row auto-limit\nconst query = from(${binding})\n\nexport default query\n`;
}

/**
 * SQL formatting is display-only, so sql-formatter is loaded on first use of the SQL tab (F12): the raw SQL
 * shows until the chunk arrives, and stays if it fails to load.
 */
type Formatter = (sql: string) => string;
let formatter: Promise<Formatter> | undefined;
function loadFormatter(): Promise<Formatter> {
  formatter ??= import('sql-formatter').then(({ clickhouse, formatDialect }) => (sql: string) => {
    try { return formatDialect(sql, { dialect: clickhouse, tabWidth: 2, keywordCase: 'upper' }); } catch { return sql; }
  });
  return formatter;
}
function useFormattedSql(sql: string): string {
  const [formatted, setFormatted] = useState<{ sql: string; text: string }>();
  useEffect(() => {
    let live = true;
    loadFormatter().then(format => { if (live) setFormatted({ sql, text: format(sql) }); }, () => { formatter = undefined; });
    return () => { live = false; };
  }, [sql]);
  return formatted?.sql === sql ? formatted.text : sql;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString().replace('T', ' ').replace('Z', '');
  if (typeof value === 'object') return JSON.stringify(value, (_k, v: unknown) => typeof v === 'bigint' ? v.toString() : v);
  return String(value);
}
const numericType = (type: string) => /^(Nullable\()?(LowCardinality\()?(U?Int|Float|Decimal)/.test(type);
const valueAt = (row: unknown, path: readonly string[]) => path.reduce<unknown>((v, k) => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), row);

/** The inferred row type with TypeScript types in the function color (Main.dc.html). */
function RowType(props: { text: string }) {
  const parts = props.text.split(/\b(string|number|bigint|boolean|Date|null|unknown|Array|Record|Decimal|UUID)\b/);
  return <>{parts.map((part, i) => (i % 2 ? <span key={i} className="ty">{part}</span> : part))}</>;
}

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

// Display-only SQL highlighting with the code-theme tokens: `identifiers` plain, {pN:Type} as values.
const SQL_TOKEN = /(`(?:[^`\\]|\\.)*`)|(\{[A-Za-z_]\w*:[^}]*\})|('(?:[^'\\]|\\.)*')|\b(SELECT|FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT|OFFSET|AS|AND|OR|NOT|IN|IS|NULL|JOIN|INNER|LEFT|RIGHT|FULL|OUTER|CROSS|ALL|ANY|ON|USING|UNION|DISTINCT|WITH|ARRAY JOIN|DESC|ASC|NULLS|FIRST|LAST|CASE|WHEN|THEN|ELSE|END|BETWEEN|LIKE|SETTINGS)\b|\b([A-Za-z_]\w*)(?=\()|\b(\d+(?:\.\d+)?)\b/g;
function SqlText(props: { sql: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of props.sql.matchAll(SQL_TOKEN)) {
    if (m.index > last) out.push(props.sql.slice(last, m.index));
    const cls = m[1] ? '' : m[2] || m[3] ? 'tk-val' : m[4] ? 'tk-kw' : m[5] ? 'tk-fn' : 'tk-num';
    out.push(cls ? <span key={m.index} className={cls}>{m[0]}</span> : m[0]);
    last = m.index + m[0].length;
  }
  out.push(props.sql.slice(last));
  return <>{out}</>;
}

function SqlView(props: { result: Success }) {
  const params = Object.entries(props.result.params);
  const sql = useFormattedSql(props.result.sql);
  return (
    <div className="sql-view">
      <pre className="mono sql"><SqlText sql={sql} /></pre>
      <div className="params">
        <div className="eyebrow">Parameters</div>
        {params.length === 0 && <div className="muted small">None.</div>}
        {params.map(([name, value]) => <div key={name} className="mono param"><span>{name}</span><span className="val">{JSON.stringify(value)}</span></div>)}
        <div className="muted small note">Values are always bound as typed parameters, never inlined.</div>
      </div>
    </div>
  );
}

const KEYS = globalKeys(MOD);
const CHAT_MIN = 30, CHAT_MAX = 75;
/** After the key press that asked for it: the character of that press can't land in what gets focus. */
const focusSoon = (element: { focus(): void } | null | undefined) => {
  const from = document.activeElement;
  setTimeout(() => {
    // Focus has gone somewhere on purpose meanwhile, such as a palette opened right away: that wins.
    const now = document.activeElement;
    if (now === from || now === null || now === document.body) element?.focus();
  }, 0);
};
const isTextField = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.tagName === 'SELECT');
const newestChart = (turns: readonly ChatTurn[]): Spec | undefined => turns.filter((t): t is Version => t.kind === 'version').at(-1)?.chart;
const newestVersion = (turns: readonly ChatTurn[]) => turns.filter((t): t is Version => t.kind === 'version').at(-1);
const lastId = (turns: readonly ChatTurn[]) => turns.at(-1)?.id ?? 0;

function App() {
  const [meta, setMeta] = useState<Meta>();
  const [metaError, setMetaError] = useState<string>();
  const [source, setSource] = useState<string | null>(() => store.get(SOURCE_KEY));
  const [autoLimit, setAutoLimit] = useState(() => store.get(LIMIT_KEY) !== 'off');
  const [view, setView] = useState<View>('table');
  const [result, setResult] = useState<RunResult>();
  const [running, setRunning] = useState(false);
  const [split, setSplit] = useState(44);
  const [dragging, setDragging] = useState(false);
  const [chatSplit, setChatSplit] = useState(56);
  const [draggingChat, setDraggingChat] = useState(false);
  const panes = useRef<HTMLElement>(null);
  const leftPane = useRef<HTMLDivElement>(null);
  const panesDivider = useRef<HTMLButtonElement>(null);
  const chatDivider = useRef<HTMLButtonElement>(null);
  /** Tab leaves the editor instead of indenting (CodeMirror's Ctrl+M), shown because nothing else tells. */
  const [tabMoves, setTabMoves] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const threadEl = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);

  // The open chat. A new chat is created just before its first send, so it can be followed live.
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatId, setChatIdState] = useState<string | null>(() => store.get(CHAT_KEY));
  const [detail, setDetail] = useState<ChatDetail>();
  const [draft, setDraftState] = useState(() => store.get(draftKey(store.get(CHAT_KEY))) ?? '');
  const [pendingText, setPendingText] = useState<string>();
  /** The chat a send of this page is waiting on; `null` a new chat whose id isn't known yet, `undefined` none. */
  const [sendingChat, setSendingChat] = useState<string | null | undefined>();
  const [stopping, setStopping] = useState(false);
  const [chatError, setChatError] = useState<string>();
  /** Edit-and-resend: later turns hide locally until the send. Esc brings them back; a reload or a switch leaves the edit waiting, if anything was typed. */
  const [editing, setEditing] = useState<EditState | undefined>(() => { const open = store.get(CHAT_KEY); return open ? readEdits()[open] : undefined; });
  /** The selected turn; a later keyboard map moves this. */
  const [selected, setSelected] = useState<number>();
  /** Where focus is; `other` is a button, a divider or nowhere. */
  const [zone, setZone] = useState<Zone | 'other'>('other');
  const [helpOpen, setHelpOpen] = useState(false);
  /**
   * Keys that are down, and where focus was when each went down. A repeat of one after focus has moved, by whatever moved it, is
   * swallowed. Only repeats: a real press always goes through, so a keyup lost with the window can't leave a key stuck.
   */
  const keysDown = useRef(new Map<string, Element | null>());
  const helpReturn = useRef<Element | null>(null);
  const helpDialog = useRef<HTMLDivElement>(null);
  /** "Copied v2", briefly. */
  const [copied, setCopied] = useState<string>();
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [chartSpec, setChartSpec] = useState<Spec | undefined>(loadSpec);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [savedError, setSavedError] = useState<string>();
  const [loaded, setLoaded] = useState<{ name: string; source: string }>();
  const [saving, setSaving] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const saveInput = useRef<HTMLInputElement>(null);
  const saveReturn = useRef<Element | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [typeErrors, setTypeErrors] = useState<number>();
  const paletteReturn = useRef<Element | null>(null);

  const chatRef = useRef(chatId);
  /** The starter text as this page would write it: replacing it untouched is not a change. */
  const starterText = useRef<string | undefined>(undefined);
  starterText.current = meta ? starter(meta) : undefined;
  /** A send is under way: read at the moment of sending, so two quick sends can't both pass. */
  const sendingRef = useRef(false);
  const stopWanted = useRef(false);
  const runningRef = useRef(false);
  /** Results belong to who asked: a run from before a switch of chat or a loaded query is left to finish unseen. */
  const runOwner = useRef(0);
  /** A run that must happen once the current one ends: a reply's auto-run is never dropped. */
  const queuedRun = useRef<string | undefined>(undefined);
  /** The source of the last successful run: rows are only ever sent as a sample of that source. */
  const ranSource = useRef<string | undefined>(undefined);
  const latest = useRef({ source, autoLimit, result, paletteOpen, helpOpen, chartSpec, draft, detail, editing, selected, generating: false, visible: [] as readonly ChatTurn[] });
  const openGenerating = sendingChat === chatId && sendingChat !== undefined ? true : detail?.generating === true && detail.id === chatId;
  latest.current = { source, autoLimit, result, paletteOpen, helpOpen, chartSpec, draft, detail, editing, selected, generating: openGenerating, visible: (detail?.turns ?? []).filter(t => !editing || t.id <= editing.turn) };

  const setChatId = useCallback((id: string | null) => {
    chatRef.current = id;
    setChatIdState(id);
    if (id) store.set(CHAT_KEY, id); else store.remove(CHAT_KEY);
  }, []);
  const setDraft = useCallback((text: string) => {
    setDraftState(text);
    if (text) store.set(draftKey(chatRef.current), text); else store.remove(draftKey(chatRef.current));
  }, []);
  const setChart = useCallback((spec: Spec | undefined) => {
    setChartSpec(spec);
    // A chart-less version or saved query also clears the persisted chart, so a reload shows none (F14).
    if (spec) store.set(CHART_SPEC_KEY, JSON.stringify(spec)); else store.remove(CHART_SPEC_KEY);
    const chat = chatRef.current;
    if (chat) { if (spec) store.set(chartKey(chat), JSON.stringify(spec)); else store.remove(chartKey(chat)); }
  }, []);
  const rememberSource = useCallback((text: string) => {
    setSource(text);
    store.set(SOURCE_KEY, text);
    if (chatRef.current) store.set(editorKey(chatRef.current), text);
  }, []);

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
    if (runningRef.current) {
      // A manual run while one is in flight is dropped, as the Run button is disabled; a reply's run waits its turn.
      if (override !== undefined) queuedRun.current = override;
      return;
    }
    let text: string | undefined = override ?? latest.current.source ?? undefined;
    if (text === undefined) return;
    const owner = runOwner.current;
    runningRef.current = true;
    setRunning(true);
    while (text !== undefined) {
      const ran: string = text;
      let outcome: RunResult;
      try { outcome = await api.query.run.mutate({ source: ran, autoLimit: latest.current.autoLimit }); }
      catch (error) { outcome = { ok: false, error: { stage: 'clickhouse', message: `Request failed: ${String(error)}` } }; }
      if (runOwner.current !== owner) return;
      ranSource.current = outcome.ok ? ran : undefined;
      setResult(outcome);
      text = queuedRun.current as string | undefined;
      queuedRun.current = undefined;
    }
    runningRef.current = false;
    setRunning(false);
  }, []);
  /** Whatever is running or queued no longer counts. */
  const disownRuns = useCallback(() => {
    runOwner.current++;
    queuedRun.current = undefined;
    runningRef.current = false;
    setRunning(false);
  }, []);

  /** Replace the editor content (undoable in the editor) and keep it as the source of truth. */
  const replaceSource = useCallback((text: string, added?: readonly number[]) => {
    if (editor.current) replaceDocument(editor.current, text, added);
    rememberSource(text);
  }, [rememberSource]);

  const refreshChats = useCallback(async () => {
    try { setChats(await api.chat.list.query()); } catch { /* the thread reports a lost server */ }
  }, []);

  const detailRead = useRef(0);
  const sentAfter = useRef(0);
  /** Reads the open chat from the server; a newer read supersedes an older response. */
  const refreshDetail = useCallback(async (id: string | null): Promise<ChatDetail | null> => {
    const read = ++detailRead.current;
    if (id === null) { setDetail(undefined); return null; }
    const found = await api.chat.get.query({ id });
    if (read !== detailRead.current) return null;
    if (chatRef.current === id) setDetail(found ?? undefined);
    if (found) setChats(current => current.map(chat => chat.id === found.id
      ? { id: found.id, title: found.title, conversationId: found.conversationId, updatedAt: found.updatedAt, generating: found.generating }
      : chat));
    return found;
  }, []);

  /** A reply came in. What the open chat shows follows at once; a chat left meanwhile finds it when reopened. */
  const applyReply = useCallback((chat: string, turn: ChatTurn | undefined) => {
    if (turn?.kind !== 'version') return;
    if (chatRef.current !== chat) {
      store.set(editorKey(chat), turn.source);
      if (turn.chart) store.set(chartKey(chat), JSON.stringify(turn.chart)); else store.remove(chartKey(chat));
      return;
    }
    const current = latest.current;
    const unchanged = current.source === turn.source;
    const hasRows = current.result?.ok === true && ranSource.current === turn.source;
    if (!unchanged) replaceSource(turn.source, current.source === starterText.current ? [] : turn.addedLines);
    setChart(turn.chart);
    setView(v => viewAfterReply(v, turn.chart ? 'chart' : 'query'));
    // A chart over what is already showing needs no new rows.
    if (!turn.chart || !hasRows) void run(turn.source);
  }, [replaceSource, run, setChart]);

  /** An edit whose message isn't in the chat any more has nothing to resend; its words stay in the box as a plain draft. */
  const checkEdit = useCallback((found: ChatDetail) => {
    const edit = readEdits()[found.id];
    if (!edit || found.turns.some(t => t.id === edit.turn && t.kind === 'user')) return;
    saveEdit(found.id, undefined);
    if (chatRef.current === found.id) setEditing(undefined);
  }, []);

  /** A reply this page never saw arrive, because it reloaded while it was on its way. */
  const applyPending = useCallback((found: ChatDetail) => {
    if (found.generating || sendingRef.current) return;
    const pending = parsePending(store.get(PENDING_KEY));
    if (pending?.chatId !== found.id) return;
    store.remove(PENDING_KEY);
    // A resend that never arrived: the message it replaces is still there, and the turns after it are old ones, not its reply.
    if (pending.replaced !== undefined && found.turns.some(t => t.id === pending.replaced)) return;
    applyReply(found.id, found.turns.filter(t => t.id > pending.after && t.kind !== 'user').at(-1));
  }, [applyReply]);

  // The chat from before the reload.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const listed = await api.chat.list.query();
        if (!live) return;
        setChats(listed);
        const pending = parsePending(store.get(PENDING_KEY));
        // Reloaded right after a first send: the chat it made is the one to open.
        if (pending && pending.chatId === null) {
          const made = listed.find(c => c.updatedAt >= pending.at);
          if (made) { store.set(PENDING_KEY, JSON.stringify({ ...pending, chatId: made.id })); setChatId(made.id); }
          else store.remove(PENDING_KEY);
        }
        const found = await refreshDetail(chatRef.current);
        if (!live) return;
        // Forgotten only if the server is up and says so; without credentials the list is empty and the chat comes back later (F27).
        if (chatRef.current && !found && listed.length > 0) {
          saveEdit(chatRef.current, undefined);
          setEditing(undefined);
          setChatId(null);
        }
        if (found) { applyPending(found); checkEdit(found); }
      } catch (error) { if (live) setChatError(`Could not load chats: ${String(error)}`); }
    })();
    return () => { live = false; };
  }, [applyPending, checkEdit, refreshDetail, setChatId]);

  // Follow both our own send and a generation recovered after reload. Only the send
  // callback applies our reply; polling is observational while that callback owns it.
  const following = openGenerating && chatId !== null;
  useEffect(() => {
    if (!following || chatId === null) return;
    const id = chatId;
    let reading = false;
    const timer = setInterval(() => {
      if (reading) return;
      reading = true;
      refreshDetail(id).then(found => {
        if (found?.generating && stopWanted.current) {
          stopWanted.current = false;
          void api.chat.stop.mutate({ id }).catch(error => setChatError(`Could not stop: ${String(error)}`));
        }
        if (found && !found.generating) { applyPending(found); void refreshChats(); }
      }, () => undefined).finally(() => { reading = false; });
    }, 500);
    return () => { clearInterval(timer); };
  }, [following, chatId, refreshDetail, applyPending, refreshChats]);

  // A generation ended, however it ended: the sidebar's marker goes with it.
  useEffect(() => { if (!openGenerating) void refreshChats(); }, [openGenerating, refreshChats]);

  // Another chat generating that this page isn't waiting on: watch for the end, so the line by the message box goes away.
  const otherFollowing = (sendingChat !== undefined && sendingChat !== chatId) || chats.some(c => c.generating && c.id !== chatId);
  useEffect(() => {
    if (!otherFollowing) return;
    const timer = setInterval(() => void refreshChats(), 1_000);
    return () => clearInterval(timer);
  }, [otherFollowing, refreshChats]);

  /** Sends. `options.source` is what goes with it when that isn't the editor text as it is now (a retry). */
  const send = useCallback(async (text: string, options: { replaceFrom?: number; source?: string } = {}) => {
    const message = text.trim();
    const current = latest.current;
    if (!message || sendingRef.current || current.generating) return;
    sendingRef.current = true;
    const chat = chatRef.current;
    const sent = options.source ?? current.source ?? '';
    const ok = current.result?.ok ? current.result : undefined;
    // Rows only as a sample of exactly this query, never from an older one as if they were current.
    const sample = ok && ranSource.current === sent ? chartSample(ok.rows, ok.columns) : undefined;
    const edit = current.editing;
    const replaceFrom = options.replaceFrom ?? edit?.turn;
    const keptTurns = replaceFrom === undefined ? current.detail?.turns ?? [] : (current.detail?.turns ?? []).filter(t => t.id < replaceFrom);
    ++detailRead.current;
    sentAfter.current = lastId(keptTurns);
    if (chat && current.detail) setDetail({ ...current.detail, turns: keptTurns });
    setEditing(undefined);
    if (edit && chat) saveEdit(chat, undefined);
    setSelected(undefined);
    setChatError(undefined);
    setPendingText(message);
    setSendingChat(chat);
    stopWanted.current = false;
    setDraft('');
    store.set(PENDING_KEY, JSON.stringify({ chatId: chat, after: lastId(keptTurns), at: Date.now(), ...(replaceFrom === undefined ? {} : { replaced: replaceFrom }) }));

    const known = { id: chat };

    /** Nothing was recorded as far as this page knows: the words go back in the box of their chat, and a resend stays one. */
    const giveBack = () => {
      const home = known.id ?? chat;
      if (chatRef.current === home) setDraft(latest.current.draft ? `${latest.current.draft}\n${text}` : text);
      else { const other = store.get(draftKey(home)); store.set(draftKey(home), other ? `${other}\n${text}` : text); }
      if (!chat) return;
      if (edit) saveEdit(chat, edit);
      if (chatRef.current !== chat) return;
      if (edit) setEditing(edit);
      if (current.detail) setDetail(current.detail);
      // What the server has, if it can still say. A stored resend ends the edit; its words stay in the box.
      void refreshDetail(chat).then(found => { if (found) checkEdit(found); }, () => undefined);
    };

    try {
      if (known.id === null) {
        const made = await api.chat.create.mutate();
        known.id = made.id;
        setSendingChat(made.id);
        store.set(PENDING_KEY, JSON.stringify({ chatId: made.id, after: 0, at: Date.now() }));
        if (chatRef.current === null) {
          store.set(editorKey(made.id), latest.current.source ?? '');
          store.set(draftKey(made.id), latest.current.draft);
          store.remove(draftKey(null));
          setChatId(made.id);
        }
        void refreshChats();
      }
      const outcome = await api.chat.send.mutate({ chatId: known.id, text: message, source: sent, ...(sample ? { sample } : {}), ...(replaceFrom === undefined ? {} : { replaceFrom }) });
      const id = outcome.chatId ?? known.id;
      // Refused before anything was recorded: nothing happened, so the message goes back in the box.
      if (!outcome.ok && !outcome.turn) {
        setChatError(outcome.error);
        store.remove(PENDING_KEY);
        giveBack();
      } else if (id) {
        store.remove(PENDING_KEY);
        store.remove(draftKey(null));
        const reply = outcome.turn as ChatTurn | undefined;
        if (chatRef.current === id && !store.get(editorKey(id))) store.set(editorKey(id), latest.current.source ?? '');
        applyReply(id, reply);
        await refreshDetail(chatRef.current);
      }
    } catch (error) {
      sendingRef.current = false;
      // No answer. The turn may be stored all the same, and then the words show twice, which beats losing them. The pending
      // mark stays, so a reply the server still gets to is found by a reload.
      setChatError(`Lost the server: ${error instanceof Error ? error.message : String(error)}`);
      giveBack();
    } finally {
      sendingRef.current = false;
      setPendingText(undefined);
      setSendingChat(undefined);
      setStopping(false);
      void refreshChats();
    }
  }, [applyReply, checkEdit, refreshChats, refreshDetail, setChatId, setDraft]);

  const stop = useCallback(async () => {
    if (!latest.current.generating) return;
    setStopping(true);
    const id = chatRef.current;
    if (id === null) { stopWanted.current = true; return; }
    try {
      const outcome = await api.chat.stop.mutate({ id });
      if (!outcome.stopped && sendingRef.current) stopWanted.current = true;
      // A send of this page finishes by itself; following one, the next read shows the note.
      if (!sendingRef.current) await refreshDetail(id);
    } catch (error) { setChatError(`Could not stop: ${String(error)}`); }
    finally { if (!sendingRef.current) setStopping(false); }
  }, [refreshDetail]);

  /** Puts the editor and chart back from before an edit-and-resend that won't happen. */
  const cancelEdit = useCallback(() => {
    const { editing: edit } = latest.current;
    if (!edit) return;
    setEditing(undefined);
    if (chatRef.current) saveEdit(chatRef.current, undefined);
    if (edit.aside.source !== null) replaceSource(edit.aside.source);
    setChart(edit.aside.chart ?? undefined);
    setDraft(edit.aside.draft);
  }, [replaceSource, setChart, setDraft]);

  /** Leaving the chat: an edit with words of its own waits there, stored; one with nothing typed is simply cancelled. */
  const leaveEdit = useCallback(() => {
    const { editing: edit, draft: box, source: text } = latest.current;
    if (!edit) return;
    if (box === edit.text && text === edit.source) cancelEdit(); else setEditing(undefined);
  }, [cancelEdit]);

  /** The chat's editor text and chart: its draft in this browser, else its newest version. Doesn't run anything. */
  const openChat = useCallback(async (id: string) => {
    if (id === chatRef.current) return;
    leaveEdit();
    setChatId(id);
    setEditing(readEdits()[id]);
    setDetail(undefined);
    setSelected(undefined);
    setChatError(undefined);
    setDraftState(store.get(draftKey(id)) ?? '');
    setLoaded(undefined);
    disownRuns();
    setResult(undefined);
    ranSource.current = undefined;
    const found = await refreshDetail(id).catch(() => null);
    if (chatRef.current !== id) return;
    const turns = found?.turns ?? [];
    const text = store.get(editorKey(id)) ?? newestVersion(turns)?.source;
    if (text !== undefined) replaceSource(text);
    setChart(parseSpec(store.get(chartKey(id))) ?? newestChart(turns));
    if (found) { applyPending(found); checkEdit(found); }
  }, [applyPending, checkEdit, disownRuns, leaveEdit, refreshDetail, replaceSource, setChart, setChatId]);

  /** A new chat keeps the editor and the results as they are. */
  const newChat = useCallback(() => {
    leaveEdit();
    setChatId(null);
    setDetail(undefined);
    setSelected(undefined);
    setChatError(undefined);
    setDraftState(store.get(draftKey(null)) ?? '');
    focusSoon(composer.current);
  }, [leaveEdit, setChatId]);

  const userTurnOf = useCallback((turn: ChatTurn): UserTurn | undefined => {
    const turns = latest.current.detail?.turns ?? [];
    return turns.slice(0, turns.findIndex(t => t.id === turn.id) + 1).reverse().find((t): t is UserTurn => t.kind === 'user');
  }, []);

  /** Edit a message: later turns hide, the box has its text, and the editor goes back to the source sent with it (R13.3). */
  const editTurn = useCallback((turn: ChatTurn) => {
    const user = userTurnOf(turn);
    if (!user || latest.current.generating) return;
    const { source: currentSource, chartSpec: currentChart, editing: edit, detail: open, draft: currentDraft } = latest.current;
    const aside = edit?.aside ?? { source: currentSource, chart: currentChart ?? null, draft: currentDraft };
    const started: EditState = { turn: user.id, text: user.text, source: user.source, aside };
    setEditing(started);
    if (chatRef.current) saveEdit(chatRef.current, started);
    setDraft(user.text);
    setSelected(undefined);
    replaceSource(user.source);
    setChart(newestChart((open?.turns ?? []).filter(t => t.id < user.id)));
    focusSoon(composer.current);
  }, [replaceSource, setChart, setDraft, userTurnOf]);

  const retryTurn = useCallback((turn: ChatTurn) => {
    const user = userTurnOf(turn);
    // Checked before anything changes: a retry that can't go must leave the editor alone.
    if (!user || latest.current.generating || sendingRef.current) return;
    replaceSource(user.source);
    setChart(newestChart((latest.current.detail?.turns ?? []).filter(t => t.id < user.id)));
    void send(user.text, { replaceFrom: user.id, source: user.source });
    focusSoon(composer.current);
  }, [replaceSource, send, setChart, userTurnOf]);

  const restoreVersion = useCallback(async (turn: Version) => {
    if (latest.current.source !== turn.source) replaceSource(turn.source);
    setChart(turn.chart);
    setView(v => viewAfterReply(v, turn.chart ? 'chart' : 'query'));
    void run(turn.source);
    const id = chatRef.current;
    if (id) {
      const noted = await api.chat.note.mutate({ id, text: `Restored v${turn.n} to the editor and ran it. Your next message continues from here.` }).catch(() => undefined);
      await refreshDetail(id).catch(() => null);
      if (noted?.ok) setSelected(noted.turn.id);
    }
  }, [refreshDetail, replaceSource, run, setChart]);

  /** A failed attempt goes into the editor by hand only, and doesn't run. */
  const loadAttempt = useCallback((text: string) => { replaceSource(text); }, [replaceSource]);

  const copy = useCallback((text: string, done: string) => {
    const say = (message: string) => {
      setCopied(message);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(undefined), 1_400);
    };
    (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('no clipboard'))).then(() => say(done), () => say('The browser refused the clipboard'));
  }, []);

  /** What a selected turn offers, and the only table its keys read: a key does what its hint shows, and nothing otherwise. */
  const actionsFor = (turn: ChatTurn): readonly TurnAction[] => {
    if (turn.kind === 'note') return [];
    const copyAction: TurnAction = turn.kind === 'version' ? { key: 'y', label: 'copy query', run: () => copy(turn.source, `Copied v${turn.n}`) }
      : turn.kind === 'error' ? { key: 'y', label: turn.source === null ? 'copy error' : 'copy last attempt', run: () => copy(turn.source ?? turn.error, turn.source === null ? 'Copied error' : 'Copied last attempt') }
      : { key: 'y', label: 'copy', run: () => copy(turn.text, 'Copied message') };
    if (openGenerating) return [copyAction];
    if (editing?.turn === turn.id) return [{ key: '↵', label: 'back to message', run: () => focusSoon(composer.current) }, copyAction];
    const edit: TurnAction = { key: 'e', label: 'edit prompt', run: () => editTurn(turn) };
    // A retry would throw an open rewrite away: esc first. While another chat generates it can't go, as the line by the box says.
    const retry: TurnAction[] = editing || elsewhere ? [] : [{ key: 'r', label: 'retry', run: () => retryTurn(turn) }];
    if (turn.kind === 'user') return [{ key: '↵', also: 'e', label: 'edit & resend', run: () => editTurn(turn) }, ...retry, copyAction];
    if (turn.kind === 'version') return [{ key: '↵', label: 'restore & run', run: () => void restoreVersion(turn) }, edit, ...retry, copyAction];
    if (turn.kind === 'error' && canLoadAttempt(turn.source)) return [{ key: '↵', label: 'load last attempt', run: () => loadAttempt(turn.source as string) }, edit, ...retry, copyAction];
    return [edit, ...retry, copyAction];
  };
  const actionsRef = useRef(actionsFor);
  actionsRef.current = actionsFor;

  const visibleTurns = useMemo(() => {
    const turns = detail?.turns ?? [];
    return editing ? turns.filter(t => t.id <= editing.turn) : turns;
  }, [detail, editing]);
  const visibleActivity = useMemo(() => (detail?.activity ?? []).filter(item =>
    visibleTurns.some(turn => turn.kind === 'user' && turn.id === item.afterUserId) &&
    (editing === undefined || item.afterUserId < editing.turn)), [detail?.activity, visibleTurns, editing]);
  // A selected turn that went away: the last one takes over, if the thread has focus.
  useEffect(() => {
    if (selected === undefined || visibleTurns.some(t => t.id === selected)) return;
    setSelected(threadEl.current?.contains(document.activeElement) ? visibleTurns.at(-1)?.id : undefined);
  }, [selected, visibleTurns]);
  const lastUserText = useCallback(() => latest.current.detail?.turns.filter((t): t is UserTurn => t.kind === 'user').at(-1)?.text ?? '', []);

  // The newest turn stays in view.
  const lastVisible = visibleTurns.at(-1);
  const pendingRecorded = visibleTurns.some(turn => turn.kind === 'user' && turn.id > sentAfter.current && turn.text === pendingText);
  const pendingShown = sendingChat === chatId && !pendingRecorded ? pendingText : undefined;
  // Keyed on what is at the end, not on a count: a reply swaps pending + generating for user + reply.
  const activityEnd = visibleActivity.map(item => `${item.id}:${item.status}:${item.kind === 'toolCall' ? item.arguments.length : item.text.length}`).join('|');
  const threadEnd = `${lastVisible?.id}:${pendingShown ?? ''}:${openGenerating}:${activityEnd}`;
  const threadAtBottom = useRef(true);
  const trackThreadScroll = () => {
    const el = threadEl.current;
    if (el) threadAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  useEffect(() => { threadAtBottom.current = true; }, [chatId]);
  useEffect(() => {
    const el = threadEl.current;
    // Someone reading the thread with the keyboard keeps their place.
    if (el && threadAtBottom.current && !el.contains(document.activeElement)) el.scrollTop = el.scrollHeight;
  }, [threadEnd]);

  useEffect(() => {
    if (selected !== undefined) threadEl.current?.querySelector('[data-sel="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  /** ⌘S: open the inline name field, prefilled from the loaded name, the last message, or "Untitled". */
  const closeSave = useCallback(() => {
    setSaving(undefined);
    // At once, while the field is still there: no moment with focus nowhere.
    const back = saveReturn.current;
    (back instanceof HTMLElement && document.contains(back) ? back : composer.current)?.focus();
  }, []);
  const startSave = useCallback(() => {
    if (document.activeElement !== saveInput.current) saveReturn.current = document.activeElement;
    setSaveError(undefined);
    setSaving(loaded?.name ?? ((lastUserText() || latest.current.draft).trim().slice(0, 100) || 'Untitled'));
    // Already open: just refocus (a fresh field focuses itself on mount).
    saveInput.current?.focus();
  }, [lastUserText, loaded]);

  const doSave = useCallback(async (name: string) => {
    const { source: text, draft: box, chartSpec: chart } = latest.current;
    const entry = { name, prompt: lastUserText() || box, source: text ?? '', chart: chart ?? null };
    let outcome = await api.saved.save.mutate(entry);
    if (!outcome.ok && 'exists' in outcome) {
      if (!window.confirm(`A saved query named "${name.trim()}" exists. Overwrite it?`)) return;
      outcome = await api.saved.save.mutate({ ...entry, overwrite: true });
    }
    if (!outcome.ok) { setSaveError('error' in outcome ? outcome.error : 'Not saved.'); return; }
    closeSave();
    setLoaded({ name: name.trim(), source: text ?? '' });
    await refreshSaved();
  }, [closeSave, lastUserText, refreshSaved]);

  /** Changes the editor and chart only; the open chat is left alone (R13.10). */
  const loadSaved = useCallback((query: Saved) => {
    disownRuns();
    replaceSource(query.source);
    setChart(query.chart ?? undefined);
    setLoaded({ name: query.name, source: query.source });
  }, [disownRuns, replaceSource, setChart]);

  const deleteSaved = useCallback(async (query: Saved) => {
    if (!window.confirm(`Delete the saved query "${query.name}"?`)) return;
    const outcome = await api.saved.delete.mutate({ name: query.name });
    if (!outcome.ok) { setSavedError(outcome.error); return; }
    setLoaded(current => (current?.name === query.name ? undefined : current));
    // Its row, which may have focus, is about to go.
    const active = document.activeElement;
    if (active === document.body || active?.closest('.saved-row')) composer.current?.focus();
    await refreshSaved();
  }, [refreshSaved]);

  /** Insert at the editor cursor (sidebar table click, palette table result). */
  const insertAtCursor = useCallback((text: string) => {
    const view = editor.current;
    if (!view) return;
    view.dispatch({ ...view.state.replaceSelection(text), scrollIntoView: true });
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
    requestAnimationFrame(() => {
      const now = document.activeElement;
      if (back instanceof HTMLElement && document.contains(back) && (now === null || now === document.body)) back.focus();
    });
  }, []);

  const toggleLimit = useCallback(() => setAutoLimit(on => { store.set(LIMIT_KEY, on ? 'off' : 'on'); return !on; }), []);

  const openHelp = useCallback(() => {
    helpReturn.current = document.activeElement;
    setHelpOpen(true);
  }, []);
  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    const back = helpReturn.current;
    focusSoon(back instanceof HTMLElement && document.contains(back) ? back : composer.current);
  }, []);
  useEffect(() => { if (helpOpen) helpDialog.current?.focus(); }, [helpOpen]);

  // Where focus is, from focus itself. Leaving the thread drops the selection, as in the prototype.
  useEffect(() => {
    const update = () => setTimeout(() => {
      const active = document.activeElement;
      setZone(active === composer.current ? 'box' : threadEl.current?.contains(active) ? 'thread' : editor.current?.dom.contains(active) ? 'editor' : 'other');
    }, 0);
    window.addEventListener('focusin', update);
    window.addEventListener('focusout', update);
    return () => { window.removeEventListener('focusin', update); window.removeEventListener('focusout', update); };
  }, []);
  const previousZone = useRef(zone);
  useEffect(() => {
    if (previousZone.current === 'thread' && zone !== 'thread') setSelected(undefined);
    previousZone.current = zone;
  }, [zone]);

  /** To the thread, on its last turn. */
  const enterThread = useCallback(() => {
    const last = latest.current.visible.at(-1);
    if (!last) return false;
    setSelected(last.id);
    focusSoon(threadEl.current);
    return true;
  }, []);
  /** Esc anywhere but the box: stop what generates here, or go to the box. An open edit stays open. */
  const escapeToBox = useCallback(() => {
    if (latest.current.generating) void stop(); else focusSoon(composer.current);
  }, [stop]);

  useEffect(() => {
    const actions: Record<Action, () => void> = {
      run: () => void run(),
      toggleLimit,
      focusPrompt: () => focusSoon(composer.current),
      newChat,
      focusEditor: () => focusSoon(editor.current),
      tabTable: () => setView('table'),
      tabChart: () => setView('chart'),
      tabSql: () => setView('sql'),
      palette: openPalette,
      save: startSave,
    };
    const onThreadKey = (event: KeyboardEvent): boolean => {
      const { visible, selected: current } = latest.current;
      const at = visible.findIndex(t => t.id === current);
      if (event.key === 'ArrowUp' || event.key === 'k') { if (visible.length) setSelected(visible[Math.max(0, at === -1 ? visible.length - 1 : at - 1)]!.id); return true; }
      if (event.key === 'ArrowDown' || event.key === 'j') {
        if (at === -1 || at >= visible.length - 1) focusSoon(composer.current); else setSelected(visible[at + 1]!.id);
        return true;
      }
      if (event.key === 'i') { focusSoon(composer.current); return true; }
      const pressed = event.key === 'Enter' ? '↵' : event.key.toLowerCase();
      if (pressed !== '↵' && !/^[a-z]$/.test(pressed)) return false;
      // On a button inside the thread, Enter is that button's.
      if (pressed === '↵' && event.target instanceof HTMLButtonElement) return false;
      const turn = visible[at];
      const action = turn && actionsRef.current(turn).find(a => a.key === pressed || a.also === pressed);
      if (action && !event.repeat) action.run();
      return action !== undefined;
    };
    // Capture phase: shortcuts win over CodeMirror and browser defaults (⌘S save dialog, ⌘K, ⌘L address bar...).
    const onKey = (event: KeyboardEvent) => {
      const claim = () => { event.preventDefault(); event.stopPropagation(); };
      const pressed = event.key.toLowerCase();
      const down = keysDown.current;
      if (!event.repeat) { if (!down.has(pressed)) down.set(pressed, document.activeElement); }
      // A held key can't act where it didn't start (letters in the box, a send, lines in the editor), and esc never acts twice:
      // its next step is a different thing, such as cancelling an edit.
      else if (event.key === 'Escape' || (down.has(pressed) && down.get(pressed) !== document.activeElement)) { claim(); return; }
      // A dialog takes everything that would act behind it.
      if (latest.current.paletteOpen) { if (matchShortcut(event)) claim(); return; }
      if (latest.current.helpOpen) {
        if (event.key === 'Escape' || event.key === '?') closeHelp();
        if (event.key !== 'Shift') claim();
        return;
      }
      const action = matchShortcut(event);
      if (action) { claim(); if (!event.repeat || !IGNORES_REPEAT.has(action)) actions[action](); return; }
      // From here on: keys of no text field, with no modifier, so typing is never taken.
      if (isTextField(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      // Focus in one of CodeMirror's panels: its keys are CodeMirror's, and esc closes the panel before anything else.
      if (event.target instanceof Node && editor.current?.dom.contains(event.target)) return;
      if (event.key === '?') { claim(); openHelp(); return; }
      if (event.key === 'Escape') { claim(); escapeToBox(); return; }
      if (event.shiftKey) return;
      // Native disclosure keyboard behavior belongs to activity, not the selected turn.
      if (event.target instanceof Element && event.target.closest('[data-activity]')) return;
      if (event.target instanceof Node && threadEl.current?.contains(event.target) && onThreadKey(event)) claim();
    };
    const release = (event: KeyboardEvent) => { keysDown.current.delete(event.key.toLowerCase()); };
    const releaseAll = () => { keysDown.current.clear(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', release, true);
    window.addEventListener('blur', releaseAll);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', release, true);
      window.removeEventListener('blur', releaseAll);
    };
  }, [run, toggleLimit, openPalette, startSave, newChat, openHelp, closeHelp, escapeToBox]);

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
      action('ask', 'Message box', () => { paletteReturn.current = composer.current; }, shortcut('L')),
      action('new-chat', 'New chat', () => { paletteReturn.current = null; newChat(); }, KEYS.newChat),
      action('editor', 'Editor', () => { paletteReturn.current = editor.current?.contentDOM ?? null; }, KEYS.editor),
      action('resize-panes', 'Resize panes', () => { paletteReturn.current = panesDivider.current; }),
      action('resize-chat', 'Resize chat and editor', () => { paletteReturn.current = chatDivider.current; }),
      action('shortcuts', 'Keyboard shortcuts', () => { paletteReturn.current = null; openHelp(); }, '?'),
      action('save', 'Save query', () => { paletteReturn.current = null; startSave(); }, shortcut('S')),
      action('refresh', 'Refresh schema', async () => { setMeta(await api.schema.refresh.mutate()); }),
      action('model', 'Switch model…', switchModel, undefined, meta?.model.available ? `${meta.model.provider}/${meta.model.modelId}` : 'from pi'),
      ...chats.map(c => ({ id: `chat:${c.id}`, group: 'Chats' as const, icon: 'chat' as const, label: c.title, hint: c.id === chatId ? 'open' : undefined, run: () => { paletteReturn.current = composer.current; void openChat(c.id); } })),
      ...saved.map(q => ({ id: `saved:${q.name}`, group: 'Saved' as const, icon: 'saved' as const, label: q.name, hint: q.chart ? 'with chart' : undefined, run: () => { paletteReturn.current = editor.current?.contentDOM ?? null; loadSaved(q); } })),
      ...(meta?.tables ?? []).map(t => ({ id: `table:${t.name}`, group: 'Tables' as const, icon: 'table' as const, mono: true, label: t.name, hint: `${t.columns.length} cols`,
        run: () => { paletteReturn.current = null; insertAtCursor(`from(${t.binding})`); } })),
    ];
  };

  /** The palette's first row with typed text: sends it in the open chat, or says why the LLM is off (inert). */
  const askItem = (text: string): PaletteItem => {
    const off = meta && !meta.model.available ? meta.model.reason : undefined;
    return off
      ? { id: 'ask', group: 'Ask', icon: 'ask', label: `Ask: LLM unavailable (${off})`, disabled: true, run: () => undefined }
      : { id: 'ask', group: 'Ask', icon: 'ask', label: `Ask: ${text}`, kbd: '↵', run: () => {
          paletteReturn.current = composer.current;
          // The palette closes either way: while something generates, the words wait in the box, like a send that can't go yet.
          if (sendingRef.current || latest.current.generating) setDraft(latest.current.draft ? `${latest.current.draft}\n${text}` : text);
          else void send(text);
        } };
  };

  /** Tables the editor reads (`from(binding)`), highlighted in the sidebar like the mockup's selected row. */
  const usedTables = useMemo(() => new Set([...(source ?? '').matchAll(/\bfrom\(\s*([A-Za-z_$][\w$]*)/g)].map(m => m[1]!)), [source]);

  const modified = loaded !== undefined && source !== loaded.source;

  const onSourceChange = useCallback((value: string) => { rememberSource(value); }, [rememberSource]);

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
  const clampChat = (p: number) => Math.min(CHAT_MAX, Math.max(CHAT_MIN, p));
  const onDragChat = (e: ReactPointerEvent) => {
    if (!draggingChat || !leftPane.current) return;
    const r = leftPane.current.getBoundingClientRect();
    setChatSplit(clampChat(((e.clientY - r.top) / r.height) * 100));
  };
  const onChatSplitKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); setChatSplit(s => clampChat(s - 2)); }
    if (e.key === 'ArrowDown') { e.preventDefault(); setChatSplit(s => clampChat(s + 2)); }
  };

  const onComposerKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (!e.repeat && draft.trim() && !llmOff) void send(draft);
    } else if (e.key === 'Escape') {
      // First match wins. Only this chat's generation counts; another chat's has its own way to be stopped.
      e.preventDefault();
      if (openGenerating) void stop();
      else if (editing) cancelEdit();
      else enterThread();
    } else if (e.key === 'ArrowUp' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const { selectionStart, selectionEnd } = e.currentTarget;
      if ((draft === '' || (selectionStart === 0 && selectionEnd === 0)) && enterThread()) e.preventDefault();
    }
  };

  const ok = result?.ok ? result : undefined;
  const chartHead = useMemo(() => (chartSpec ? chartHeading(chartSpec) : undefined), [chartSpec]);
  const chartData = useMemo(() => (ok ? toChartData(ok.rows, ok.columns) : []), [ok]);
  const status = running ? 'Running…' : ok ? `${ok.rowCount.toLocaleString()} ${ok.rowCount === 1 ? 'row' : 'rows'}${ok.limited ? ' (limited)' : ''} · ${ok.elapsedMs} ms` : '';
  const tabs: [View, string, string][] = [['table', 'Table', `${MOD}1`], ['chart', 'Chart', `${MOD}2`], ['sql', 'SQL', `${MOD}3`]];
  const llmOff = meta && !meta.model.available ? meta.model.reason : undefined;
  const inEditor = versionInEditor(visibleTurns, source);
  const hasTurns = visibleTurns.length > 0 || pendingShown !== undefined;
  const placeholder = llmOff ? `The chat is off: ${llmOff}` : hasTurns ? 'Refine it…' : 'Describe the data you want';
  const composerRows = Math.min(5, Math.max(1, draft.split('\n').length));
  const footerZone: Zone = zone === 'other' ? 'box' : zone;
  const hints = zoneHints(footerZone, MOD, { generating: openGenerating, editing: editing !== undefined });
  // One generation at a time, across chats: this says where it is, so it can be found and stopped.
  const busyChat = sendingChat !== undefined ? sendingChat : chats.find(c => c.generating)?.id;
  const elsewhere = busyChat !== undefined && busyChat !== chatId;
  const elsewhereTitle = chats.find(c => c.id === busyChat)?.title ?? pendingText ?? 'a new chat';

  return (
    <div className="app">
      <header className="on-night header">
        <div className="brand"><Logo /><span className="display brand-name">TypedHouse</span><span className="display brand-sub">Studio</span></div>
        <div className="mono chip" title={metaError ?? meta?.schemaError ?? meta?.connection}>
          <span className="dot" style={{ background: meta && !meta.schemaError ? '#8fd8f0' : '#faca60' }} />
          {meta ? `clickhouse · ${meta.database}` : metaError ? 'server unreachable' : 'connecting…'}
        </div>
        <div className="chip muted-chip model-chip" title={meta && !meta.model.available ? meta.model.reason : undefined}>
          pi durable <span className="mono on">{!meta ? '…' : meta.model.available ? `${meta.model.provider} · ${meta.model.modelId}` : 'LLM unavailable'}</span>
        </div>
        <div className="spacer" />
        <button className="btn palette-btn" type="button" title="Command palette" onClick={openPalette}>
          <span className="palette-label"><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>Commands, chats, tables</span>
          <Kbd>{MOD}K</Kbd>
        </button>
      </header>

      <div className="shell-row">
        <aside className="shell-side">
          <nav aria-label="Chats" className="side-nav">
            <div className="eyebrow side-title"><span>Chats</span><button type="button" className="side-new" onClick={newChat}><Kbd>{KEYS.newChat} new</Kbd></button></div>
            {chatId === null && <div className="side-row chat-row on" aria-current="true">New chat</div>}
            {chats.map(c => (
              <button key={c.id} type="button" className={`row side-row chat-row${c.id === chatId ? ' on' : ''}`} aria-current={c.id === chatId ? 'true' : undefined} title={c.id === busyChat ? `${c.title} (generating)` : c.title} data-generating={c.id === busyChat} onClick={() => void openChat(c.id)}>{c.id === busyChat && <span className="chat-busy-dot" role="img" aria-label="generating" />}{c.title}</button>
            ))}
          </nav>
          <nav aria-label="Schema" className="side-nav">
            <div className="eyebrow side-title"><span>Tables</span><span>{meta?.tables.length ?? ''}</span></div>
            {meta?.schemaError && <div className="side-error">{meta.schemaError}</div>}
            {meta?.tables.map(t => (
              <div key={t.name} className={`row side-row${usedTables.has(t.binding) ? ' on' : ''}`} role="button" tabIndex={0} title={`Insert from(${t.binding})\n\n${t.columns.map(c => `${c.name}: ${c.type}`).join('\n')}`}
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
        </aside>

        <main className="panes" ref={panes}>
          <div className="pane-left" ref={leftPane} style={{ flex: `0 0 ${split}%` }}>
            <section aria-label="Chat" className="chat-card" style={{ flex: `0 0 ${chatSplit}%` }}>
              <Thread ref={threadEl} turns={visibleTurns} activity={visibleActivity} onScroll={trackThreadScroll} pending={pendingShown} generating={openGenerating} stopping={stopping} selected={selected} inEditor={inEditor} isStarter={text => text === starterText.current} editingTurn={editing?.turn}
                onSelect={id => { setSelected(id); if (!threadEl.current?.contains(document.activeElement)) threadEl.current?.focus({ preventScroll: true }); }}
                onFocusThread={() => setSelected(current => current ?? visibleTurns.at(-1)?.id)} onStop={() => void stop()} onLoadAttempt={loadAttempt} actionsFor={actionsFor} />
              {elsewhere && (
                <div className="chat-busy" role="status" data-testid="generating-elsewhere">
                  <span>Another chat is generating, so this one has to wait.</span>
                  {busyChat !== null && <button type="button" className="btn link-btn" title={elsewhereTitle} onClick={() => void openChat(busyChat)}>Open it to stop it</button>}
                </div>
              )}
              {chatError && <div className="chat-error" role="alert">{chatError}</div>}
              {editing && <div className="chat-editing">Editing an earlier message. Sending drops the turns after it. <button type="button" className="btn link-btn" onClick={cancelEdit}><Kbd>esc</Kbd> cancel</button></div>}
              <div className="composer-row">
                <label htmlFor="composer" className="composer-label">
                  <textarea id="composer" ref={composer} className="composer" rows={composerRows} value={draft} placeholder={placeholder} aria-label="Message" aria-busy={openGenerating} readOnly={llmOff !== undefined}
                    onChange={e => setDraft(e.target.value)} onKeyDown={onComposerKey} />
                </label>
                <span className="composer-send">{openGenerating ? 'Generating' : elsewhere ? 'Waiting' : 'Send'} <Kbd>↵</Kbd></span>
              </div>
            </section>

            <button ref={chatDivider} className="split-h" type="button" data-dragging={draggingChat} aria-label="Resize chat and editor (arrow keys)" aria-valuenow={Math.round(chatSplit)}
              onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setDraggingChat(true); }}
              onPointerMove={onDragChat} onPointerUp={() => setDraggingChat(false)} onPointerCancel={() => setDraggingChat(false)} onKeyDown={onChatSplitKey}>
              <span className="split-h-grip" />
            </button>

            <div className="pane-lower">
              {saving !== undefined && (
                <form className="save-bar" onSubmit={e => { e.preventDefault(); void doSave(saving); }}>
                  <label htmlFor="save-name" className="small muted">Save as</label>
                  <input id="save-name" ref={saveInput} value={saving} maxLength={100} autoFocus onFocus={e => e.currentTarget.select()} onChange={e => setSaving(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Escape') { e.preventDefault(); closeSave(); }
                      // Held: one save, not a second one asking to overwrite the first.
                      if (e.key === 'Enter' && e.repeat) e.preventDefault();
                    }} />
                  <button type="submit" className="btn run-btn small-btn">Save</button>
                  <button type="button" className="btn link-btn" onClick={closeSave}>Cancel</button>
                  {saveError && <div className="save-error" role="alert">{saveError}</div>}
                </form>
              )}
              <section aria-label="Query editor" className="on-night editor-card">
                <div className="editor-head">
                  <span className="mono editor-name">{loaded ? loaded.name : 'query.ts'}{modified && <span className="modified" title="Edited since loading" aria-label="modified"> ●</span>}</span>
                  {inEditor !== undefined && <span className="mono editor-version">v{inEditor}</span>}
                  {ok && <span className="mono row-type" title={ok.rowType}>→ <RowType text={ok.rowType} /></span>}
                  <div className="spacer" />
                  {tabMoves && <span className="tab-moves" role="status">Tab moves focus · <Kbd>{KEYS.tabFocus}</Kbd> to indent</span>}
                  {typeErrors !== undefined && (typeErrors === 0
                    ? <span className="typechecks" title="TypeScript: 0 errors"><svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M5 12l5 5L20 7" /></svg>Typechecks</span>
                    : <span className="type-errors">{typeErrors} type {typeErrors === 1 ? 'error' : 'errors'}</span>)}
                  {result && (result.ok
                    ? <span className="compiles"><svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M5 12l5 5L20 7" /></svg>Compiles</span>
                    : <span className="fails">{result.error.stage} error</span>)}
                </div>
                <div className="editor-body">
                  {source !== null && <Editor value={source} onChange={onSourceChange} viewRef={editor} language={language} onDiagnostics={setTypeErrors} onEscape={escapeToBox} onTabMoves={setTabMoves} />}
                </div>
                <div className="editor-foot">
                  <button className="btn run-btn" type="button" onClick={() => void run()} disabled={running}>
                    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M6 4l14 8-14 8z" /></svg>
                    Run <span className="mono run-key">{MOD}↵</span>
                  </button>
                </div>
              </section>
            </div>
          </div>

          <button ref={panesDivider} className="splitter" type="button" data-dragging={dragging} aria-label="Resize panes (arrow keys, double-click to reset)" aria-valuenow={Math.round(split)}
            onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); }}
            onPointerMove={onDrag} onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)}
            onKeyDown={onSplitKey} onDoubleClick={() => setSplit(44)}>
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
            {view === 'chart' && !chartSpec && result?.ok !== false && <div className="chart-empty">No chart yet. Ask for one in the chat, e.g. “bar chart of revenue”.</div>}
            {view === 'chart' && ok && chartHead && (
              <div className="chart-pane">
                <div className="chart-card">
                  <div className="chart-title">
                    <span className="eyebrow">{chartHead.eyebrow}</span>
                    {chartHead.title && <h2 className="display">{chartHead.title}</h2>}
                    {chartHead.subtitle && <span className="muted small">{chartHead.subtitle}</span>}
                  </div>
                  <Chart spec={chartHead.spec} data={chartData} />
                  <details className="chart-spec">
                    <summary>Vega-Lite spec · validated against result columns</summary>
                    <pre className="mono on-night">{JSON.stringify(chartSpec, null, 2)}</pre>
                  </details>
                </div>
              </div>
            )}
            {ok && view === 'sql' && <SqlView result={ok} />}
          </section>
        </main>
      </div>

      <footer className="footer">
        <span className="ready"><span className="dot" />{openGenerating ? 'Generating' : running ? 'Running' : 'Ready'}</span>
        <span>{autoLimit ? 'Auto-limit 100 rows' : 'Auto-limit off'}</span>
        <span className="mono zone-label" role="status" data-testid="zone">{copied ?? (footerZone === 'thread' ? 'Conversation' : footerZone === 'editor' ? 'Editor' : 'Message')}</span>
        <div className="spacer" />
        {hints.map(hint => <span key={hint.key + hint.label} className="hint"><Kbd>{hint.key}</Kbd> {hint.label}</span>)}
      </footer>
      {paletteOpen && <Palette items={paletteItems()} onClose={closePalette} ask={askItem} />}
      {helpOpen && (
        <div className="palette-scrim help-scrim" onMouseDown={event => { if (event.target === event.currentTarget) closeHelp(); }}>
          <div ref={helpDialog} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="help" tabIndex={-1}>
            {keyGroups(MOD).map(group => (
              <div key={group.title} className="help-group">
                <div className="eyebrow">{group.title}</div>
                {group.items.map(item => <div key={item.label + item.key} className="help-item"><span>{item.label}</span><Kbd>{item.key}</Kbd></div>)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function parsePending(text: string | null): { chatId: string | null; after: number; at: number; replaced?: number } | undefined {
  try { return JSON.parse(text ?? 'null') ?? undefined; } catch { return undefined; }
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
