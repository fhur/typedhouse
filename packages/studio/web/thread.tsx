import { Fragment, forwardRef, type ReactNode, type Ref } from 'react';
import type { ChatActivity, ChatTurn, UserTurn } from '../server/chat.js';
import { activitySummary, groupActivity, type ActivityItem } from './activity.js';
import { attemptsLabel, canLoadAttempt, cappedChanges, chartSummary } from './rules.js';

export type { ChatTurn, UserTurn };

/** What a selected turn offers. One table, so a later keyboard map can bind the same actions by `key`. */
export interface TurnAction { key: string; /** A second key for the same thing. */ also?: string; label: string; run: () => void }

function Kbd(props: { children: ReactNode }) { return <span className="kbd">{props.children}</span>; }

/** The changed lines exactly as the server ordered them; model text stays plain text everywhere in here. */
function Changes(props: { turn: Extract<ChatTurn, { kind: 'version' }> }) {
  const { turn } = props;
  if (turn.chart && turn.changes.length === 0) return <div className="mono turn-change">{chartSummary(turn.chart)}</div>;
  if (turn.changes.length === 0) return null;
  const { shown, more } = cappedChanges(turn.changes);
  return (
    <div className="mono turn-change" data-testid="changes">
      {shown.map((change, i) => <div key={i} className={change.type === 'add' ? 'line-add' : 'line-remove'}>{change.type === 'add' ? '+' : '-'} {change.text}</div>)}
      {more > 0 && <div className="line-more">+{more} more</div>}
    </div>
  );
}

function Reply(props: { turn: Exclude<ChatTurn, UserTurn>; inEditor: number | undefined; overStarter: boolean; onLoadAttempt: (source: string) => void }) {
  const { turn } = props;
  if (turn.kind === 'note') return <div className="turn-note">{turn.text}</div>;
  if (turn.kind === 'text') {
    return (
      <div className="turn-reply">
        <div className="turn-text">{turn.text}</div>
        <div className="turn-meta"><span className="mono">{attemptsLabel(turn.attempts, turn.elapsedMs)}</span></div>
      </div>
    );
  }
  if (turn.kind === 'error') {
    return (
      <div className="turn-reply" role="alert">
        <div className="turn-error">{turn.error}</div>
        <div className="turn-meta">
          <span className="mono chip-error">error</span>
          <span className="mono">{attemptsLabel(turn.attempts, turn.elapsedMs)}</span>
          {canLoadAttempt(turn.source) && <button type="button" className="btn link-btn turn-load" onClick={event => { event.stopPropagation(); props.onLoadAttempt(turn.source as string); }}>Load last attempt (it does not pass)</button>}
          {typeof turn.source === 'string' && !canLoadAttempt(turn.source) && <span className="turn-toolong">The last attempt is too long to load ({turn.source.length.toLocaleString('en-US')} characters).</span>}
        </div>
      </div>
    );
  }
  const current = props.inEditor === turn.n;
  return (
    <div className="turn-reply">
      <div className="turn-text">{turn.summary}</div>
      {!props.overStarter && <Changes turn={turn} />}
      <div className="turn-meta">
        <span className={`mono version-chip${current ? ' on' : ''}`}>v{turn.n}</span>
        <span className="mono">{turn.chart ? 'chart · ' : ''}{attemptsLabel(turn.attempts, turn.elapsedMs)}</span>
        {current && <span>in editor</span>}
      </div>
    </div>
  );
}

function Activity(props: { item: ActivityItem }) {
  const { item } = props;
  const status = item.status === 'success' ? 'completed' : item.status;
  const truncated = item.truncated && <span className="activity-truncated">Truncated — only part of this content is shown.</span>;
  if (item.kind === 'text') return <div className="activity activity-text" data-activity={item.id}><span className="eyebrow">Assistant</span><div>{item.text}</div>{truncated}</div>;
  return (
    <details className="activity activity-tool" data-activity={item.id} data-status={status}>
      <summary><span className="mono">{item.toolName}</span> <span className="activity-status">{status}</span>{(item.truncated || item.results.some(result => result.truncated)) && <span> · truncated</span>}</summary>
      <section aria-label="Inputs"><span className="eyebrow">Inputs</span><pre>{item.arguments}</pre>{truncated}</section>
      {item.results.map(result => <section key={result.id} aria-label="Result" data-status={result.status}>
        <span className="eyebrow">Result</span><pre>{result.text}</pre>
        {result.truncated && <span className="activity-truncated">Truncated — only part of this content is shown.</span>}
      </section>)}
      {item.results.length === 0 && <div className="activity-status">{item.status === 'running' ? 'Waiting for result…' : 'No result recorded.'}</div>}
    </details>
  );
}

function ActivityRow(props: { activity: readonly ChatActivity[]; userId: number | undefined; live: boolean; stopping: boolean; onStop: () => void }) {
  const summary = activitySummary(props.activity, props.userId, props.live);
  if (!props.live && summary.items.length === 0) return null;
  return (
    <div className="activity-row" data-testid={props.live ? 'generating' : undefined}>
      <details className="activity-log">
        <summary>
          {props.live && <span className="activity-spinner" aria-hidden="true" />}
          <span className={props.live ? 'activity-label activity-label-live' : 'activity-label'}>{props.live && props.stopping ? 'Stopping…' : summary.label}</span>{' '}
          <span aria-label={props.live && summary.earlier > 0 ? `${summary.earlier} earlier tool calls; show activity` : 'Show activity'}>[{summary.disclosure}]</span>
          {summary.hints && <span className="activity-status"> · {summary.hints}</span>}
        </summary>
        {summary.items.length === 0 ? <div className="activity">No tool activity yet.</div> : groupActivity(summary.items).map(item => <Activity key={item.id} item={item} />)}
      </details>
      {props.live && <button type="button" className="gen-stop" onClick={props.onStop}><Kbd>esc</Kbd> stop</button>}
    </div>
  );
}

export const Thread = forwardRef(function Thread(props: {
  turns: readonly ChatTurn[];
  activity: readonly ChatActivity[];
  onScroll: () => void;
  /** The message just sent, until the server has it. */
  pending: string | undefined;
  generating: boolean;
  stopping: boolean;
  selected: number | undefined;
  inEditor: number | undefined;
  /** The message being rewritten, which stays in view while the turns after it are hidden. */
  editingTurn: number | undefined;
  /** The untouched starter text: replacing it is not a change worth listing (prototype v1). */
  isStarter: (source: string) => boolean;
  onSelect: (id: number) => void;
  /** Focus reached the thread itself, not by a click on a turn. */
  onFocusThread: () => void;
  onStop: () => void;
  onLoadAttempt: (source: string) => void;
  actionsFor: (turn: ChatTurn) => readonly TurnAction[];
}, ref: Ref<HTMLDivElement>) {
  const latestUser = props.turns.filter(turn => turn.kind === 'user').at(-1)?.id;
  const liveUser = props.pending === undefined ? latestUser : undefined;
  const empty = props.turns.length === 0 && props.pending === undefined && !props.generating;
  return (
    <div ref={ref} onScroll={props.onScroll} className="thread" role="log" aria-label="Conversation" aria-live="polite" tabIndex={props.turns.length ? 0 : -1}
      aria-activedescendant={props.selected === undefined ? undefined : `turn-${props.selected}`} onFocus={event => { if (event.target === event.currentTarget) props.onFocusThread(); }}>
      {empty && (
        <div className="thread-empty">
          <div className="display thread-empty-title">What do you want to know?</div>
          Describe the data. Then keep talking to refine it.
        </div>
      )}
      {props.turns.map((turn, index) => {
        const selected = props.selected === turn.id;
        const sentWith = props.turns.slice(0, index).filter((t): t is UserTurn => t.kind === 'user').at(-1)?.source;
        return (
          <Fragment key={turn.id}><div id={`turn-${turn.id}`}  aria-current={selected || undefined} className={`turn${turn.kind === 'version' ? ' turn-version' : ''}`} data-turn={turn.id} data-kind={turn.kind} data-sel={selected} data-editing={props.editingTurn === turn.id || undefined} onClick={() => props.onSelect(turn.id)}>
            {turn.kind === 'user'
              ? <div className="turn-user"><span className="eyebrow turn-you">You</span><div className="turn-user-text">{turn.text}</div></div>
              : <Reply turn={turn} inEditor={props.inEditor} overStarter={sentWith !== undefined && props.isStarter(sentWith)} onLoadAttempt={props.onLoadAttempt} />}
            {selected && props.actionsFor(turn).length > 0 && (
              <div className="turn-actions">
                {props.actionsFor(turn).map(action => (
                  <button key={action.key} type="button" className="turn-action" onClick={event => { event.stopPropagation(); action.run(); }}><Kbd>{action.key}</Kbd>{action.also && <Kbd>{action.also}</Kbd>} {action.label}</button>
                ))}
              </div>
            )}
          </div>
          {turn.kind === 'user' && (props.editingTurn === undefined || turn.id < props.editingTurn) && <ActivityRow activity={props.activity} userId={turn.id} live={props.generating && liveUser === turn.id} stopping={props.stopping} onStop={props.onStop} />}
          </Fragment>
        );
      })}
      {props.pending !== undefined && (
        <div className="turn turn-user-pending" data-kind="user"><div className="turn-user"><span className="eyebrow turn-you">You</span><div className="turn-user-text">{props.pending}</div></div></div>
      )}
      {props.generating && liveUser === undefined && props.editingTurn === undefined && <ActivityRow activity={[]} userId={undefined} live stopping={props.stopping} onStop={props.onStop} />}
    </div>
  );
});
