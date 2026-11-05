/** Studio shortcuts. ⌘ on macOS, Ctrl elsewhere (either modifier is accepted). DOM-free so it unit-tests. */
export type Action = 'run' | 'toggleLimit' | 'focusPrompt' | 'newChat' | 'focusEditor' | 'tabTable' | 'tabChart' | 'tabSql' | 'palette' | 'save';

export interface KeyLike { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }

const bindings: Record<string, Action> = {
  Enter: 'run',
  '/': 'toggleLimit',
  l: 'focusPrompt',
  e: 'focusEditor',
  k: 'palette',
  s: 'save',
  '1': 'tabTable',
  '2': 'tabChart',
  '3': 'tabSql',
};

/**
 * The global shortcut for a key press. Shift matters for letters only: ⌘⇧L is its own action and any other ⌘⇧letter is left to
 * the browser, while ⌘/ still works where `/` needs Shift.
 */
export function matchShortcut(event: KeyLike): Action | undefined {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return undefined;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (event.shiftKey && /^[a-z]$/.test(key)) return key === 'l' ? 'newChat' : undefined;
  return bindings[key];
}

/** Held, these would flip or fire over and over. Going to a tab or to a zone is the same every time, so those may repeat. */
export const IGNORES_REPEAT: ReadonlySet<Action> = new Set<Action>(['run', 'toggleLimit', 'newChat', 'palette', 'save']);

export const isMac = (platform: string) => /mac|iphone|ipad/i.test(platform);

export type Zone = 'box' | 'thread' | 'editor';
export interface KeyHint { key: string; label: string }
export interface KeyGroup { title: string; items: KeyHint[] }

/** The label of every global key, from one place: the dialog, the footers, the palette and the sidebar all read these. */
export const globalKeys = (mod: string) => ({
  run: `${mod}↵`, messageBox: `${mod}L`, newChat: `${mod}⇧L`, editor: `${mod}E`, palette: `${mod}K`, tabs: `${mod}1–3`, limit: `${mod}/`, save: `${mod}S`,
  // CodeMirror's own binding, which isn't ⌘ on a Mac.
  tabFocus: mod === '⌘' ? '⇧⌥M' : 'Ctrl+M',
});

/** Everything in the `?` dialog. */
export function keyGroups(mod: string): KeyGroup[] {
  const keys = globalKeys(mod);
  return [
    { title: 'Message', items: [
      { label: 'Send', key: '↵' }, { label: 'New line', key: '⇧↵' }, { label: 'Stop generating', key: 'esc' }, { label: 'Cancel an edit', key: 'esc' }, { label: 'Earlier turns', key: '↑ or esc' },
    ] },
    { title: 'Conversation', items: [
      { label: 'Move between turns', key: '↑↓ or j k' }, { label: 'Restore version and run', key: '↵' }, { label: 'Load last attempt', key: '↵' }, { label: 'Edit prompt and resend', key: '↵ or e' },
      { label: 'Retry', key: 'r' }, { label: 'Copy', key: 'y' }, { label: 'Stop generating', key: 'esc' }, { label: 'Back to message', key: 'esc or i' },
    ] },
    { title: 'Go to', items: [
      { label: 'Message box', key: keys.messageBox }, { label: 'New chat', key: keys.newChat }, { label: 'Editor', key: keys.editor }, { label: 'Back to message, from the editor', key: 'esc' },
      { label: 'In the editor: Tab moves focus, or indents', key: keys.tabFocus },
      { label: 'Command palette', key: keys.palette }, { label: 'All shortcuts', key: '?' },
    ] },
    { title: 'Query', items: [
      { label: 'Run', key: keys.run }, { label: 'Table, Chart, SQL', key: keys.tabs }, { label: 'Toggle auto-limit', key: keys.limit }, { label: 'Save query', key: keys.save },
    ] },
  ];
}

/** The footer's hints for where focus is. The editor's omit `?`, which types there. */
export function zoneHints(zone: Zone, mod: string, state: { generating: boolean; editing: boolean }): KeyHint[] {
  const keys = globalKeys(mod);
  const stop = { key: 'esc', label: 'stop' };
  if (zone === 'thread') return [{ key: '↑↓', label: 'move' }, state.generating ? stop : { key: 'esc', label: 'back to message' }, { key: '?', label: 'all shortcuts' }];
  if (zone === 'editor') return [{ key: keys.run, label: 'run' }, state.generating ? stop : { key: 'esc', label: 'back to chat' }];
  return [
    ...(state.generating ? [stop] : state.editing ? [{ key: 'esc', label: 'cancel' }] : []),
    { key: '↵', label: 'send' }, { key: '⇧↵', label: 'new line' }, { key: '↑', label: 'earlier turns' }, { key: keys.editor, label: 'editor' }, { key: keys.run, label: 'run' },
  ];
}
