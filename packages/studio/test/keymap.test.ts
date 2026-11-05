// The key tables behind the footers, the ? dialog, the palette and the sidebar: pure, so the ⌘ labels can be checked on any machine.
import { describe, expect, it } from 'vitest';
import { globalKeys, IGNORES_REPEAT, isMac, keyGroups, matchShortcut, zoneHints, type Action } from '../web/keymap.js';

const press = (key: string, mods: Partial<{ meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }> = {}) => matchShortcut({ key, metaKey: !!mods.meta, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift });
const labels = (hints: { key: string; label: string }[]) => hints.map(h => `${h.key} ${h.label}`);

describe('isMac', () => {
  it.each([['MacIntel', true], ['Macintosh', true], ['iPhone', true], ['iPad', true], ['Linux x86_64', false], ['Win32', false], ['', false]])('%s is %s', (platform, expected) => {
    expect(isMac(platform)).toBe(expected);
  });
});

describe('matchShortcut', () => {
  it.each<[string, Action]>([['Enter', 'run'], ['/', 'toggleLimit'], ['l', 'focusPrompt'], ['e', 'focusEditor'], ['k', 'palette'], ['s', 'save'], ['1', 'tabTable'], ['2', 'tabChart'], ['3', 'tabSql']])('%s with ⌘ or Ctrl is %s', (key, action) => {
    expect(press(key, { meta: true })).toBe(action);
    expect(press(key, { ctrl: true })).toBe(action);
  });
  it('⌘⇧L is a new chat and ⌘L is the message box, in either case', () => {
    expect(press('L', { meta: true, shift: true })).toBe('newChat');
    expect(press('l', { ctrl: true, shift: true })).toBe('newChat');
    expect(press('l', { meta: true })).toBe('focusPrompt');
    expect(press('L', { ctrl: true })).toBe('focusPrompt');
  });
  it('other ⌘⇧ letters are the browser\'s, and ⌘/ works where / needs Shift', () => {
    for (const key of ['K', 'S', 'E']) expect(press(key, { meta: true, shift: true })).toBeUndefined();
    expect(press('/', { ctrl: true, shift: true })).toBe('toggleLimit');
  });
  it('no modifier, or Alt, is never a shortcut', () => {
    for (const key of ['l', 'e', 'k', 's', 'Enter', '1', '/']) {
      expect(press(key)).toBeUndefined();
      expect(press(key, { ctrl: true, alt: true })).toBeUndefined();
      expect(press(key, { alt: true })).toBeUndefined();
    }
  });
  it('⌘G and the old chart prompt are gone', () => {
    expect(press('g', { meta: true })).toBeUndefined();
  });
});

describe('globalKeys', () => {
  it('uses ⌘ on a Mac, with ⇧⌥M for Tab', () => {
    expect(globalKeys('⌘')).toEqual({ run: '⌘↵', messageBox: '⌘L', newChat: '⌘⇧L', editor: '⌘E', palette: '⌘K', tabs: '⌘1–3', limit: '⌘/', save: '⌘S', tabFocus: '⇧⌥M' });
  });
  it('uses Ctrl+ elsewhere, with Ctrl+M for Tab', () => {
    expect(globalKeys('Ctrl+')).toEqual({ run: 'Ctrl+↵', messageBox: 'Ctrl+L', newChat: 'Ctrl+⇧L', editor: 'Ctrl+E', palette: 'Ctrl+K', tabs: 'Ctrl+1–3', limit: 'Ctrl+/', save: 'Ctrl+S', tabFocus: 'Ctrl+M' });
  });
});

describe('keyGroups', () => {
  const rows = (mod: string) => keyGroups(mod).flatMap(group => group.items.map(item => `${item.label}=${item.key}`));
  it('has the prototype\'s four groups, in order', () => {
    expect(keyGroups('⌘').map(g => g.title)).toEqual(['Message', 'Conversation', 'Go to', 'Query']);
  });
  it.each([
    ['⌘', ['Message box=⌘L', 'New chat=⌘⇧L', 'Editor=⌘E', 'Command palette=⌘K', 'Run=⌘↵', 'Table, Chart, SQL=⌘1–3', 'Toggle auto-limit=⌘/', 'Save query=⌘S', 'In the editor: Tab moves focus, or indents=⇧⌥M']],
    ['Ctrl+', ['Message box=Ctrl+L', 'New chat=Ctrl+⇧L', 'Editor=Ctrl+E', 'Command palette=Ctrl+K', 'Run=Ctrl+↵', 'Table, Chart, SQL=Ctrl+1–3', 'Toggle auto-limit=Ctrl+/', 'Save query=Ctrl+S', 'In the editor: Tab moves focus, or indents=Ctrl+M']],
  ])('lists every global key with %s', (mod, expected) => {
    expect(rows(mod)).toEqual(expect.arrayContaining(expected));
  });
  it('lists every key of the box and the thread, and no ⌘ on a non-Mac', () => {
    expect(rows('Ctrl+')).toEqual(expect.arrayContaining(['Send=↵', 'New line=⇧↵', 'Stop generating=esc', 'Cancel an edit=esc', 'Earlier turns=↑ or esc', 'Move between turns=↑↓ or j k', 'Restore version and run=↵', 'Load last attempt=↵', 'Edit prompt and resend=↵ or e', 'Retry=r', 'Copy=y', 'Back to message=esc or i', 'Back to message, from the editor=esc', 'All shortcuts=?']));
    expect(rows('Ctrl+').join('\n')).not.toContain('⌘');
    expect(rows('⌘').join('\n')).not.toContain('Ctrl');
  });
});

describe('zoneHints', () => {
  const idle = { generating: false, editing: false };
  it('the box', () => {
    expect(labels(zoneHints('box', '⌘', idle))).toEqual(['↵ send', '⇧↵ new line', '↑ earlier turns', '⌘E editor', '⌘↵ run']);
    expect(labels(zoneHints('box', 'Ctrl+', idle))).toEqual(['↵ send', '⇧↵ new line', '↑ earlier turns', 'Ctrl+E editor', 'Ctrl+↵ run']);
  });
  it('the box: stop comes first while generating, cancel during an edit, and stop wins over cancel', () => {
    expect(labels(zoneHints('box', '⌘', { generating: true, editing: false }))[0]).toBe('esc stop');
    expect(labels(zoneHints('box', '⌘', { generating: false, editing: true }))[0]).toBe('esc cancel');
    const both = labels(zoneHints('box', '⌘', { generating: true, editing: true }));
    expect(both[0]).toBe('esc stop');
    expect(both).not.toContain('esc cancel');
  });
  it('the thread', () => {
    expect(labels(zoneHints('thread', '⌘', idle))).toEqual(['↑↓ move', 'esc back to message', '? all shortcuts']);
    expect(labels(zoneHints('thread', '⌘', { generating: true, editing: false }))).toEqual(['↑↓ move', 'esc stop', '? all shortcuts']);
    expect(labels(zoneHints('thread', '⌘', { generating: false, editing: true }))).toEqual(['↑↓ move', 'esc back to message', '? all shortcuts']);
  });
  it('the editor, which omits ?', () => {
    expect(labels(zoneHints('editor', '⌘', idle))).toEqual(['⌘↵ run', 'esc back to chat']);
    expect(labels(zoneHints('editor', 'Ctrl+', idle))).toEqual(['Ctrl+↵ run', 'esc back to chat']);
    expect(labels(zoneHints('editor', '⌘', { generating: true, editing: false }))).toEqual(['⌘↵ run', 'esc stop']);
    expect(labels(zoneHints('editor', '⌘', { generating: false, editing: true }))).toEqual(['⌘↵ run', 'esc back to chat']);
  });
});

describe('IGNORES_REPEAT', () => {
  it('holds what would act again on a held key, and not what only moves or shows', () => {
    expect([...IGNORES_REPEAT].sort()).toEqual(['newChat', 'palette', 'run', 'save', 'toggleLimit']);
    for (const action of ['focusPrompt', 'focusEditor', 'tabTable', 'tabChart', 'tabSql'] as const) expect(IGNORES_REPEAT.has(action)).toBe(false);
  });
});
