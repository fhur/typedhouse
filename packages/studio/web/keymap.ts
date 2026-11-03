/** Studio shortcuts. ⌘ on macOS, Ctrl elsewhere (either modifier is accepted). DOM-free so it unit-tests. */
export type Action = 'run' | 'toggleLimit' | 'focusPrompt' | 'chartPrompt' | 'tabTable' | 'tabChart' | 'tabSql' | 'palette' | 'save';

export interface KeyLike { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }

const bindings: Record<string, Action> = {
  Enter: 'run',
  '/': 'toggleLimit',
  l: 'focusPrompt',
  g: 'chartPrompt',
  k: 'palette',
  s: 'save',
  '1': 'tabTable',
  '2': 'tabChart',
  '3': 'tabSql',
};

export function matchShortcut(event: KeyLike): Action | undefined {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return undefined;
  return bindings[event.key.length === 1 ? event.key.toLowerCase() : event.key];
}

export const isMac = (platform: string) => /mac|iphone|ipad/i.test(platform);
