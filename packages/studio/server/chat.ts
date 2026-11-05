import { randomUUID } from 'node:crypto';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import type { JsonValue } from '@earendil-works/chord';
import { defineDoc, defineExtension, defineTool, section, type Conversation, type ConversationId, type EntryId, type EntryRecord, type Harness, type Submission } from '@earendil-works/pi-durable';
import type { Message } from '@earendil-works/pi-ai';
import { obj, opt, str } from '@earendil-works/pi-schema';
import { checkChartSpec, type ChartColumn } from './chart.js';
import { MAX_SOURCE } from '../web/rules.js';
import type { Stage } from './eval.js';
import type { ModelRef } from './pi.js';

/** `columns` are the result columns a chart may name. */
export type CheckResult = { ok: true; sql: string; rowType: string; columns?: ChartColumn[] } | { ok: false; stage: Stage; message: string };

// A longer source from the model would reach the editor and then be refused (F30). The web client guards on the same limit.
export { MAX_SOURCE };
export const MAX_SAMPLE_ROWS = 20;
export const json = (value: unknown) => JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v instanceof Date ? v.toISOString() : v));
/** Cuts at a code unit limit without leaving half an emoji behind (F29). */
export const cut = (text: string, limit: number) => (text.length > limit && /[\uD800-\uDBFF]/.test(text[limit - 1]!) ? text.slice(0, limit - 1) : text.slice(0, limit));

// ---- Line diff ----

export type LineChange = { type: 'add' | 'remove'; text: string };
export interface LineDiff {
  /** Only the changed lines, in order: what a version turn shows. */
  changes: LineChange[];
  /** 0-based lines of the new source that were added: what the editor highlights. */
  addedLines: number[];
}

/** Above this many table cells (2 000 x 2 000 changed lines) a diff is "all removed, all added": still true, and bounded (F30). */
const DIFF_CELL_LIMIT = 4_000_000;

/**
 * A longest-common-subsequence line diff over what is left after trimming the common prefix and suffix. An empty source
 * has no lines. A changed line lists its removal before its addition (F33).
 */
export function diffLines(before: string, after: string): LineDiff {
  const a = before === '' ? [] : before.split('\n');
  const b = after === '' ? [] : after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const rows = endA - start, columns = endB - start;

  const changes: LineChange[] = [];
  const addedLines: number[] = [];
  const remove = (i: number) => changes.push({ type: 'remove', text: a[i]! });
  const add = (j: number) => { addedLines.push(j); changes.push({ type: 'add', text: b[j]! }); };
  if (rows * columns > DIFF_CELL_LIMIT) {
    for (let i = start; i < endA; i++) remove(i);
    for (let j = start; j < endB; j++) add(j);
    return { changes, addedLines };
  }
  // lcs[x * width + y]: common lines of the rest of a from start + x and the rest of b from start + y.
  const width = columns + 1;
  const lcs = new Uint32Array((rows + 1) * width);
  for (let x = rows - 1; x >= 0; x--) {
    for (let y = columns - 1; y >= 0; y--) {
      lcs[x * width + y] = a[start + x] === b[start + y] ? lcs[(x + 1) * width + y + 1]! + 1 : Math.max(lcs[(x + 1) * width + y]!, lcs[x * width + y + 1]!);
    }
  }
  let x = 0, y = 0;
  while (x < rows || y < columns) {
    if (x < rows && y < columns && a[start + x] === b[start + y]) { x++; y++; }
    else if (x < rows && (y === columns || lcs[(x + 1) * width + y]! >= lcs[x * width + y + 1]!)) remove(start + x++);
    else add(start + y++);
  }
  return { changes, addedLines };
}

// ---- Reading a run ----

function describeFailure(settled: { readonly reason?: string; readonly detail?: unknown }, maxTurns: number): string {
  if (settled.reason === 'turn_limit') return `turn limit of ${maxTurns} reached`;
  return [settled.reason, typeof settled.detail === 'string' ? settled.detail : settled.detail === undefined ? '' : JSON.stringify(settled.detail)].filter(Boolean).join(': ') || 'no answer';
}

/** The message the model reads: the user's text plus what is in the editor right now (R13.3). */
function withEditorSource(text: string, source: string | undefined): string {
  return source?.trim() ? `${text}\n\nThe editor currently contains (edit it if it helps):\n\`\`\`ts\n${source}\n\`\`\`` : text;
}

/** The chat's message: always says what is in the editor, so an emptied editor is news too (F32), plus result rows when there are any. */
function chatMessage(text: string, source: string, columns: readonly ChartColumn[] | undefined, sample: readonly unknown[] | undefined): string {
  const editor = source.trim() ? withEditorSource(text, source) : `${text}\n\nThe editor currently contains nothing.`;
  const named = columns?.length ? `${editor}\n\nIts result columns (name: ClickHouse type):\n${columns.map(c => `- ${c.name}: ${c.type}`).join('\n')}` : editor;
  return sample?.length ? `${named}\n\nSample result rows (JSON):\n${sample.slice(0, MAX_SAMPLE_ROWS).map(json).join('\n')}` : named;
}

type RunArgs = { source?: unknown; spec?: unknown; summary?: unknown };
type RunOutcome = { attempts: number; last?: { tool: string; args: RunArgs; passed: boolean; output: string } };
/** What the run came to, across both chat tools: the last result decides. */
function readRun(messages: readonly Message[]): RunOutcome {
  const calls = new Map<string, RunArgs>();
  const out: RunOutcome = { attempts: 0 };
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const block of message.content) if (block.type === 'toolCall') calls.set(block.id, block.arguments as RunArgs);
    } else if (message.role === 'toolResult' && (message.toolName === 'check_query' || message.toolName === 'check_chart')) {
      out.attempts++;
      out.last = { tool: message.toolName, args: calls.get(message.toolCallId) ?? {}, passed: !message.isError, output: message.content.map(c => (c.type === 'text' ? c.text : '')).join('\n') };
    }
  }
  return out;
}

// ---- Stored state ----

/** One chat. A chat points at its current conversation, so edit-and-resend can move it to a fork. */
type ChatRecord = {
  id: string; title: string; conversationId: number; updatedAt: number;
  /** Set in the commit that admits a user turn and cleared in the commit that records its reply: set at open means a kill cut it off. */
  running?: true;
};
type ChatIndex = { chats: ChatRecord[] };
/** Stored in `pi.sqlite`. Old one-shot conversations are not in it, so they are never listed. */
const ChatIndexDoc = defineDoc<ChatIndex>({
  kind: 'studio.chats',
  version: 1,
  scope: 'session',
  initial: () => ({ chats: [] }),
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 50,
});

/** The source sent with the newest user turn: what `check_chart` validates against. A tool has no transcript to read. */
const SentDoc = defineDoc<{ source: string }>({
  kind: 'studio.sent',
  version: 1,
  scope: 'conversation',
  history: 'latest',
  fork: 'initial',
  initial: () => ({ source: '' }),
  checkpointWhen: () => true,
});

const USER_KIND = 'studio.user';
const REPLY_KIND = 'studio.reply';
const NOTE_KIND = 'studio.note';

/** `chart` is a validated Vega-Lite spec, bound to the result rows: this version is a chart turn. */
type VersionData = { type: 'version'; summary: string; source: string; sql: string; rowType: string; chart?: Record<string, unknown>; attempts: number; elapsedMs: number } & LineDiff;
type TextData = { type: 'text'; text: string; attempts: number; elapsedMs: number };
/** `source` is the last attempt: it did not pass, so it never reaches the editor by itself. */
type ErrorData = { type: 'error'; error: string; source: string | null; spec?: unknown; attempts: number; elapsedMs: number };
type ReplyData = VersionData | TextData | ErrorData;

export type UserTurn = { kind: 'user'; id: number; text: string; source: string };
export type VersionTurn = { kind: 'version'; id: number; n: number } & Omit<VersionData, 'type'>;
export type TextTurn = { kind: 'text'; id: number } & Omit<TextData, 'type'>;
export type ErrorTurn = { kind: 'error'; id: number } & Omit<ErrorData, 'type'>;
export type NoteTurn = { kind: 'note'; id: number; text: string };
export type ChatTurn = UserTurn | VersionTurn | TextTurn | ErrorTurn | NoteTurn;

export interface ChatSummary { id: string; title: string; conversationId: number; updatedAt: number }
export interface ChatListItem extends ChatSummary { generating: boolean }
export interface ChatDetail extends ChatSummary { generating: boolean; turns: ChatTurn[] }
/** `replaceFrom`: the first user turn to drop, for edit-and-resend and retry. `sample`: result rows, when there is a result. */
export type ChatSendInput = { chatId: string | null; text: string; source: string; sample?: readonly unknown[]; replaceFrom?: number };
/** `ok: true` is a version or a text reply; a failed generation is `ok: false` with its error turn. */
export type ChatSendResult =
  | { ok: true; chatId: string; turn: VersionTurn | TextTurn }
  | { ok: false; chatId: string | null; error: string; turn?: ErrorTurn }
  | { ok: false; chatId: string; error: string; stopped: true; turn: NoteTurn };

export interface ChatService {
  list(): Promise<ChatListItem[]>;
  /** `null` for an unknown chat. */
  get(id: string): Promise<ChatDetail | null>;
  send(input: ChatSendInput): Promise<ChatSendResult>;
  /** Ends this chat's running send, within the grace period. `stopped: false`: nothing to stop, or already stopped. */
  stop(id: string): Promise<{ stopped: boolean }>;
  /** A note in the thread, which the model does not see. Refused while that chat generates, as a stop may move it to a fork. */
  note(id: string, text: string): Promise<{ ok: true; turn: NoteTurn } | { ok: false; error: string }>;
}

export function unavailableChats(reason: string): ChatService {
  return {
    list: async () => [],
    get: async () => null,
    send: async input => ({ ok: false, chatId: input.chatId, error: `LLM unavailable: ${reason}` }),
    stop: async () => ({ stopped: false }),
    note: async () => ({ ok: false, error: `LLM unavailable: ${reason}` }),
  };
}

// ---- The extension ----

/**
 * The chat's tools and prompt. `check_query` ends the run when it passes, so `summary` travels with the call:
 * there is no later assistant text to read one from. Stored agent choices are names: do not rename the extension or the tool.
 */
export function chatExtension(options: { guide: string; schema: () => string; check: (source: string) => CheckResult | Promise<CheckResult> }) {
  const tooLong = (source: string) => (source.length > MAX_SOURCE ? `The source has ${source.length} characters; the editor takes at most ${MAX_SOURCE}. Make it shorter.` : undefined);
  const refused = (message: string) => ({ output: [{ type: 'text' as const, text: message }], isError: true });
  const checkQuery = defineTool({
    name: 'check_query',
    description: 'Compile the complete TypedHouse source. Returns the ClickHouse SQL and the row type, or the error to fix.',
    parameters: obj({
      source: str({ description: 'The complete query.ts source' }),
      summary: opt(str({ description: 'One line for the user saying what changed' })),
    }),
    execute: async args => {
      const long = tooLong(args.source);
      if (long) return refused(long);
      const result = await options.check(args.source);
      if (result.ok) return { output: [{ type: 'text' as const, text: `OK. Row type: ${result.rowType}\nSQL:\n${result.sql}` }], control: { terminate: true } };
      return refused(`${result.stage} error: ${result.message}`);
    },
  });
  const checkChart = defineTool({
    name: 'check_chart',
    description: 'Validate a complete Vega-Lite spec (a JSON object) against the columns of the query. Pass source only when the chart needs a query change: it is checked first, and the spec against its columns. Returns OK or the error to fix.',
    parameters: {
      type: 'object',
      properties: {
        spec: { type: 'object', description: 'The complete Vega-Lite spec, without data' },
        source: { type: 'string', description: 'The complete query.ts source, only if the query must change' },
        summary: { type: 'string', description: 'One line for the user saying what changed' },
      },
      required: ['spec'],
    } as { type: 'object'; properties: { spec: object; source: object; summary: object }; required: ['spec'] },
    execute: async (raw, api, context) => {
      const args = raw as { spec?: unknown; source?: string };
      const source = args.source ?? (await api.snapshot(SentDoc, api.conversationId, context))?.source ?? '';
      if (!source.trim()) return refused('The editor is empty, so there are no columns to chart: pass source with the query.');
      const long = tooLong(source);
      if (long) return refused(long);
      const result = await options.check(source);
      if (!result.ok) return refused(`The query does not pass. ${result.stage} error: ${result.message}`);
      const chart = checkChartSpec(args.spec, result.columns ?? []);
      if (!chart.ok) return refused(chart.message);
      return { output: [{ type: 'text' as const, text: 'OK. The chart renders over the result rows.' }], control: { terminate: true } };
    },
  });
  return defineExtension({
    name: 'typedhouse-chat',
    tools: [checkQuery, checkChart],
    sections: [
      section('guide', () => options.guide, { tag: false }),
      section('schema', () => `Tables in scope (generated from the database):\n\`\`\`ts\n${options.schema()}\`\`\``),
    ],
  });
}
type ChatExtension = ReturnType<typeof chatExtension>;

// ---- Recovery at open ----

const INTERRUPTED = 'Interrupted: the server stopped before this reply finished. The query in the editor was not changed.';

/**
 * pi-durable resumes unfinished work on the next `submit`, in any conversation, with nobody waiting for it. So before
 * anything runs, every leftover task is marked aborted. `abortTask` commits the mark without starting the scheduler,
 * which `conversation.abort()` would do, resuming the runs of the conversations not reached yet. With every task marked,
 * resuming only runs abort handlers: no model request. Old one-shot conversations are covered too.
 */
export async function endLeftoverRuns(harness: Harness, graceMs: number): Promise<void> {
  const { tasks, submissions } = await harness.inspect(context);
  for (const task of tasks) await harness.abortTask(task.record.id, context);
  for (const submission of submissions) if (submission.status === 'queued') await harness.abortSubmission(submission.id, context);
  if (tasks.length) await within(graceMs, harness.waitForIdle(context));

  // A chat still marked running was cut off, wherever it was: mid-run, or after the run with its reply unwritten.
  const index = await harness.snapshot(ChatIndexDoc, context);
  for (const { id, conversationId, running } of index?.chats ?? []) {
    const conversation = running ? await harness.conversation(conversationId as ConversationId, context) : undefined;
    if (!conversation) continue;
    await harness.commit(async tx => {
      await conversation.submit(tx, { type: 'write', entry: { kind: NOTE_KIND, data: { text: INTERRUPTED } } });
      const chat = (await tx.doc(ChatIndexDoc)).chats.find(c => c.id === id);
      if (chat) delete chat.running;
    }, context);
  }
}

/** `work` or `undefined` after `ms`, whichever comes first. */
async function within<T>(ms: number, work: Promise<T>): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([work, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), ms); })]); }
  finally { clearTimeout(timer); }
}

// ---- The service ----

async function allEntries(conversation: Conversation, minEntryId?: EntryId): Promise<EntryRecord[]> {
  const out: EntryRecord[] = [];
  let cursor: Parameters<Conversation['entries']>[2];
  do {
    const page = await conversation.entries({ order: 'ascending', ...(minEntryId === undefined ? {} : { minEntryId }) }, 500, cursor, context);
    out.push(...page.items);
    cursor = page.next;
  } while (cursor !== undefined);
  return out;
}

/** The thread: only `studio.*` entries, from the fork-aware history, so compaction cannot hide a turn. Versions are numbered by counting. */
function toTurns(entries: readonly EntryRecord[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let versions = 0;
  for (const entry of entries) {
    const id: number = entry.id;
    if (entry.kind === USER_KIND) {
      const { text, source } = entry.data as { text: string; source: string };
      turns.push({ kind: 'user', id, text, source });
    } else if (entry.kind === NOTE_KIND) {
      turns.push({ kind: 'note', id, text: (entry.data as { text: string }).text });
    } else if (entry.kind === REPLY_KIND) {
      const { type, ...data } = entry.data as ReplyData;
      if (type === 'version') turns.push({ kind: 'version', id, n: ++versions, ...(data as Omit<VersionData, 'type'>) });
      else if (type === 'text') turns.push({ kind: 'text', id, ...(data as Omit<TextData, 'type'>) });
      else turns.push({ kind: 'error', id, ...(data as Omit<ErrorData, 'type'>) });
    }
  }
  return turns;
}

const titleOf = (text: string) => cut(text.split('\n').map(line => line.trim()).find(Boolean) ?? 'Chat', 80);
const assistantText = (messages: readonly Message[]) => {
  const answer = messages.filter(m => m.role === 'assistant').at(-1);
  return answer?.role === 'assistant' ? answer.content.map(block => (block.type === 'text' ? block.text : '')).join('').trim() : '';
};
const oneLine = (value: unknown) => (typeof value === 'string' ? cut(value.trim().split('\n')[0]!, 200) : undefined) || undefined;
const summarize = (record: ChatRecord): ChatSummary => ({ id: record.id, title: record.title, conversationId: record.conversationId, updatedAt: record.updatedAt });

const STOPPED = 'Stopped. The query in the editor was not changed.';
/** What `chat.stop` and a timeout give the abort, of the grace period: the rest leaves time to record the outcome inside it. */
const ABORT_SHARE = 0.75;

/** One running send. A stop only requests: the send itself ends the run, and always records the outcome. */
class Run {
  stopped = false;
  /** The outcome is being written: too late to stop. */
  recording = false;
  readonly stopping: Promise<'stop'>;
  readonly finished: Promise<void>;
  #stop!: () => void;
  #finish!: () => void;
  constructor(readonly chatId: string) {
    this.stopping = new Promise(resolve => { this.#stop = () => resolve('stop'); });
    this.finished = new Promise(resolve => { this.#finish = resolve; });
  }
  stop() { this.stopped = true; this.#stop(); }
  finish() { this.#finish(); }
}

export function createChats(harness: Harness, options: {
  extension: ChatExtension; model: () => ModelRef; maxTurns: number; timeoutMs: number; abortGraceMs: number;
  check: (source: string) => CheckResult | Promise<CheckResult>;
  /** One generation at a time, across chats and the one-shot paths. */
  exclusive: <R extends { ok: boolean }>(busy: R, fail: (error: string) => R, work: () => Promise<R>) => Promise<R>;
}): ChatService {
  let active: Run | undefined;
  let lastAccepted: { source: string; columns: ChartColumn[] | undefined } | undefined;
  const records = async () => (await harness.snapshot(ChatIndexDoc, context))?.chats ?? [];
  const conversationOf = (id: number) => harness.conversation(id as ConversationId, context);
  const newConversation = (model: ModelRef) => harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { model, maxTurns: options.maxTurns, extensions: [options.extension] } }, context);
  const abortGrace = options.abortGraceMs * ABORT_SHARE;

  /**
   * The columns of what the editor holds, so the model never has to guess them. Only a help: a source that doesn't pass, a check that
   * throws or one too slow for the grace period just means the message doesn't list any. The user turn is recorded only after this, so
   * the usual case, the version just accepted, reuses that check and doesn't wait.
   */
  async function columnsOf(source: string, run: Run): Promise<ChartColumn[] | undefined> {
    if (!source.trim()) return undefined;
    if (lastAccepted?.source === source) return lastAccepted.columns;
    const result = await within(options.abortGraceMs, Promise.race([(async () => options.check(source))(), run.stopping]).catch(() => undefined));
    return result && result !== 'stop' && result.ok ? result.columns : undefined;
  }

  /**
   * The re-check after a passing run. Never returning must not hold the busy guard (F28), and a stop ends the wait.
   * What reaches the editor is what a run compiles, against the current schema.
   */
  async function recheck(source: string, run: Run): Promise<CheckResult | 'stop' | 'timeout'> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        (async () => options.check(source))(),
        new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), options.timeoutMs); }),
        run.stopping,
      ]);
    } finally { clearTimeout(timer); }
  }

  /** Decides this run's reply, from its own entries only, so an earlier check never counts. `null`: a stop came first. */
  async function decide(run: Run, sent: string, messages: readonly Message[], answered: boolean, why: string, elapsedMs: () => number): Promise<ReplyData | null> {
    const { attempts, last } = readRun(messages);
    const failed = (error: string, source: string | null, spec?: unknown): ErrorData => ({ type: 'error', error, source, ...(spec === undefined ? {} : { spec }), attempts, elapsedMs: elapsedMs() });
    if (last) {
      const argSource = typeof last.args.source === 'string' ? last.args.source : undefined;
      const charting = last.tool === 'check_chart';
      // The stored call is what counts: a value the tool coerced into a passing string was never a source.
      if (typeof last.args.source !== 'string' && (!charting || last.args.source !== undefined)) return failed('The model did not send the source as text.', null);
      if (!last.passed) return failed(`No valid ${charting ? 'chart' : 'query'} after ${attempts} attempts (${why}). Last error: ${last.output}`, argSource ?? null, charting ? last.args.spec : undefined);
      const source = argSource ?? sent;
      const result = await recheck(source, run);
      if (result === 'stop') return null;
      if (result === 'timeout') return failed(`The final check did not finish within ${Math.round(options.timeoutMs / 1000)} s.`, source);
      if (!result.ok) return failed(`${result.stage} error: ${result.message}`, source);
      lastAccepted = { source, columns: result.columns };
      const summary = oneLine(last.args.summary);
      const version = { type: 'version' as const, source, sql: result.sql, rowType: result.rowType, attempts, elapsedMs: elapsedMs(), ...diffLines(sent, source) };
      if (charting) {
        const chart = checkChartSpec(last.args.spec, result.columns ?? []);
        if (!chart.ok) return failed(chart.message, argSource ?? null, last.args.spec);
        return { ...version, summary: summary ?? 'Charted the result.', chart: chart.spec };
      }
      // Same query: nothing to version and nothing to run.
      if (source.trim() === sent.trim()) return { type: 'text', text: summary ?? 'The query already does this, so it was not changed.', attempts, elapsedMs: elapsedMs() };
      return { ...version, summary: summary ?? 'Updated the query.' };
    }
    const text = assistantText(messages);
    if (answered && text) return { type: 'text', text, attempts, elapsedMs: elapsedMs() };
    return failed(answered ? 'The model returned an empty reply.' : `The model stopped (${why}).`, null);
  }

  /**
   * Waits for the run, a timeout or a stop. A timeout or a stop aborts the run; an abort that does not settle in time
   * (a provider or tool that ignores it) leaves the conversation busy for good, so `stuck` says to move on.
   */
  async function waitForRun(run: Run, conversation: Conversation, submission: Submission) {
    let timer: NodeJS.Timeout | undefined;
    const first = await Promise.race([
      submission.wait(context),
      new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), options.timeoutMs); }),
      run.stopping,
    ]);
    clearTimeout(timer);
    if (first !== 'timeout' && first !== 'stop') {
      return { entry: first.entry, stuck: false, why: first.status === 'unanswered' ? describeFailure(first, options.maxTurns) : 'the model stopped checking', answered: first.status === 'done' };
    }
    const settled = await within(abortGrace, conversation.abort(context).then(() => true, () => false));
    const status = await within(abortGrace, submission.status(context));
    return { entry: status?.entry, stuck: settled !== true, why: `timed out after ${Math.round(options.timeoutMs / 1000)} s`, answered: false };
  }

  /** Edit-and-resend: the conversation to continue, without `replaceFrom` and everything after it. */
  async function branch(current: Conversation, replaceFrom: number, model: ModelRef): Promise<{ conversation: Conversation; first: boolean } | undefined> {
    const entries = await allEntries(current);
    const at = entries.findIndex(entry => entry.id === replaceFrom && entry.kind === USER_KIND);
    if (at < 0) return undefined;
    // Nothing before the first turn to fork at.
    if (!entries.slice(0, at).some(entry => entry.kind === USER_KIND)) return { conversation: await newConversation(model), first: true };
    return { conversation: await current.fork(entries[at - 1]!.id, { ownership: { kind: 'ownerless' } }, context), first: false };
  }

  return {
    async list() {
      const generating = active?.chatId;
      return [...await records()].sort((a, b) => b.updatedAt - a.updatedAt).map(record => ({ ...summarize(record), generating: record.id === generating }));
    },
    async get(id) {
      // Read first: seeing no generation then guarantees the reply is in what is read next (F34).
      const generating = active?.chatId === id;
      const record = (await records()).find(c => c.id === id);
      const conversation = record && await conversationOf(record.conversationId);
      if (!record || !conversation) return null;
      return { ...summarize(record), generating, turns: toTurns(await allEntries(conversation)) };
    },
    send(input) {
      const fail = (error: string): ChatSendResult => ({ ok: false, chatId: input.chatId, error });
      return options.exclusive(fail('A generation is already running.'), fail, async () => {
        const started = performance.now();
        const elapsedMs = () => Math.round(performance.now() - started);
        const model = options.model();
        const chatId = input.chatId ?? randomUUID();
        const run = new Run(chatId);
        active = run;
        try {
          let conversation: Conversation;
          let retitle = input.chatId === null;
          if (input.chatId === null) {
            if (input.replaceFrom !== undefined) return fail('There is nothing to replace in a new chat.');
            conversation = await newConversation(model);
          } else {
            const record = (await records()).find(c => c.id === input.chatId);
            const found = record && await conversationOf(record.conversationId);
            if (!found) return fail(`Unknown chat ${input.chatId}.`);
            conversation = found;
            if (input.replaceFrom !== undefined) {
              const branched = await branch(found, input.replaceFrom, model);
              if (!branched) return fail(`Turn ${input.replaceFrom} is not a message of this chat.`);
              conversation = branched.conversation;
              retitle = branched.first;
            }
            // The agent is stored per conversation and a fork inherits it: the running session's model wins.
            await conversation.configure({ model, maxTurns: options.maxTurns }, context);
          }
          const columns = await columnsOf(input.source, run);
          // The user turn and the index change land together: a chat exists from its first send, and a branch replaces the old one at once.
          const submissionId = await harness.commit(async tx => {
            const id = await conversation.submit(tx, {
              type: 'input',
              content: chatMessage(input.text, input.source, columns, input.sample),
              whenBusy: 'reject',
              entry: { kind: USER_KIND, data: { text: input.text, source: input.source } },
            });
            (await tx.doc(SentDoc, conversation.id)).source = input.source;
            const { chats } = await tx.doc(ChatIndexDoc);
            const chat = chats.find(c => c.id === chatId);
            if (chat) {
              chat.updatedAt = Date.now();
              chat.running = true;
              chat.conversationId = conversation.id;
              if (retitle) chat.title = titleOf(input.text);
            } else chats.push({ id: chatId, title: titleOf(input.text), conversationId: conversation.id, updatedAt: Date.now(), running: true });
            return id;
          }, context);

          let target = conversation;
          let data: ReplyData | null;
          try {
            const submission = (await harness.submission(submissionId, context))!;
            const { entry, stuck, why, answered } = await waitForRun(run, conversation, submission);
            const entries = entry === undefined ? [] : await within(abortGrace, allEntries(conversation, entry)) ?? [];
            // The stuck run keeps the old conversation; the chat moves on, with the stopped message, to a fork of its own.
            // Whatever the run does later lands in the abandoned parent, which nothing reads.
            if (stuck && entry !== undefined) target = await conversation.fork(entry, { ownership: { kind: 'ownerless' } }, context);
            data = await decide(run, input.source, entries.flatMap(e => e.model ?? []), answered, why, elapsedMs);
          } catch (error) {
            data = { type: 'error', error: error instanceof Error ? error.message : String(error), source: null, attempts: 0, elapsedMs: elapsedMs() };
          }
          // Stop wins, even over a check that passed at the same moment. From here a stop is too late.
          const stopped = run.stopped;
          run.recording = true;
          const write = stopped || data === null
            ? { kind: NOTE_KIND, data: { text: STOPPED } }
            : { kind: REPLY_KIND, data: data as unknown as JsonValue };
          await harness.commit(async tx => {
            await target.submit(tx, { type: 'write', entry: write });
            const chat = (await tx.doc(ChatIndexDoc)).chats.find(c => c.id === chatId);
            if (chat) { chat.updatedAt = Date.now(); chat.conversationId = target.id; delete chat.running; }
          }, context);
          const turn = toTurns(await allEntries(target)).at(-1) as VersionTurn | TextTurn | ErrorTurn | NoteTurn;
          if (turn.kind === 'note') return { ok: false, chatId, error: 'Stopped.', stopped: true, turn };
          return turn.kind === 'error' ? { ok: false, chatId, error: turn.error, turn } : { ok: true, chatId, turn };
        } finally {
          // Only now: the reply is recorded (F34).
          active = undefined;
          run.finish();
        }
      });
    },
    async stop(id) {
      const run = active;
      if (run?.chatId !== id || run.recording) return { stopped: false };
      const first = !run.stopped;
      run.stop();
      await within(options.abortGraceMs, run.finished);
      return { stopped: first };
    },
    async note(id, text) {
      if (active?.chatId === id) return { ok: false, error: 'This chat is generating.' };
      const record = (await records()).find(c => c.id === id);
      const conversation = record && await conversationOf(record.conversationId);
      if (!conversation) return { ok: false, error: `Unknown chat ${id}.` };
      await harness.commit(async tx => {
        await conversation.submit(tx, { type: 'write', entry: { kind: NOTE_KIND, data: { text } } });
        const chat = (await tx.doc(ChatIndexDoc)).chats.find(c => c.id === id);
        if (chat) chat.updatedAt = Date.now();
      }, context);
      return { ok: true, turn: toTurns(await allEntries(conversation)).at(-1) as NoteTurn };
    },
  };
}
