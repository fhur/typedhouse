import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { linter, type Diagnostic } from '@codemirror/lint';
import { autocompletion, type Completion as CmCompletion, type CompletionContext } from '@codemirror/autocomplete';
import { hoverTooltip } from '@codemirror/view';

/** Server-side TypeScript service calls (R12); the full text goes with every call, so offsets match one-to-one. */
export interface Language {
  /** `null`: superseded by a newer request (the text has moved on). */
  diagnostics(source: string): Promise<{ from: number; to: number; severity: 'error' | 'warning'; message: string; full: string; line: number; column: number }[] | null>;
  completions(source: string, pos: number): Promise<{ from: number; items: { label: string; kind: string; detail?: string; boost: number; apply?: string }[] }>;
  hover(source: string, pos: number): Promise<{ from: number; to: number; text: string } | null>;
}

const KIND: Record<string, string> = { column: 'property', table: 'class', method: 'method', property: 'property', function: 'function', const: 'constant', let: 'variable', var: 'variable', keyword: 'keyword', parameter: 'variable', alias: 'function', class: 'class' };

/** Lint (debounced), completions and hover backed by `language`; `onDiagnostics` feeds the editor badge. */
function intelligence(language: Language, onDiagnostics: (errors: number | undefined) => void) {
  return [
    linter(async view => {
      const source = view.state.doc.toString();
      try {
        const found = await language.diagnostics(source);
        if (found === null || view.state.doc.toString() !== source) return [];
        onDiagnostics(found.filter(d => d.severity === 'error').length);
        const length = view.state.doc.length;
        return found.map((d): Diagnostic => ({
          from: Math.min(d.from, length), to: Math.min(Math.max(d.to, d.from + (d.to === d.from ? 1 : 0)), length), severity: d.severity,
          message: d.message, ...(d.full !== d.message ? { renderMessage: () => { const el = document.createElement('div'); el.className = 'cm-diag'; el.textContent = d.message; const more = document.createElement('details'); more.innerHTML = '<summary>details</summary>'; const pre = document.createElement('pre'); pre.textContent = d.full; more.append(pre); el.append(more); return el; } } : {}),
        }));
      } catch { onDiagnostics(undefined); return []; }
    }, { delay: 300 }),
    autocompletion({
      override: [async (context: CompletionContext) => {
        const word = context.matchBefore(/[\w$]*/);
        const before = context.state.sliceDoc(Math.max(0, context.pos - 1), context.pos);
        // Ask after `.`, `(`, while typing a word, or when explicitly requested (Ctrl+Space).
        if (!context.explicit && !word?.text && before !== '.' && before !== '(') return null;
        const result = await language.completions(context.state.doc.toString(), context.pos);
        if (context.aborted) return null;
        // Filter on the word being typed; an item that replaces from earlier (`.` → `["odd-name"]`) carries its own range.
        const from = word?.from ?? context.pos;
        return {
          from,
          options: result.items.map((item): CmCompletion => {
            const text = item.apply;
            const apply: CmCompletion['apply'] = text === undefined ? undefined
              : result.from === from ? text
              : (view, _completion, _from, to) => view.dispatch({ changes: { from: result.from, to, insert: text }, selection: { anchor: result.from + text.length }, userEvent: 'input.complete' });
            return { label: item.label, type: KIND[item.kind] ?? 'variable', boost: item.boost, ...(item.detail ? { detail: item.detail } : {}), ...(apply ? { apply } : {}) };
          }),
          validFor: /^[\w$]*$/,
        };
      }],
      activateOnTyping: true,
      icons: true,
    }),
    hoverTooltip(async (view, pos) => {
      const hover = await language.hover(view.state.doc.toString(), pos).catch(() => null);
      if (!hover) return null;
      return {
        pos: hover.from, end: hover.to, above: true,
        create: () => { const dom = document.createElement('div'); dom.className = 'cm-type-hover'; dom.textContent = hover.text; return { dom }; },
      };
    }, { hoverTime: 350 }),
  ];
}

// Mirrors apps/docs/src/styles/code-themes.mjs through the --tk-* tokens (the editor sits on night).
const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword], color: 'var(--tk-kw)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.typeName], color: 'var(--tk-fn)' },
  { tag: [tags.string, tags.bool, tags.null, tags.special(tags.string)], color: 'var(--tk-val)' },
  { tag: [tags.number], color: 'var(--tk-num)' },
  { tag: [tags.punctuation, tags.operator, tags.bracket, tags.separator], color: 'var(--tk-punct)' },
  { tag: [tags.comment], color: 'var(--tk-comment)', fontStyle: 'italic' },
  { tag: [tags.variableName, tags.propertyName], color: 'var(--tk-plain)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', background: 'transparent', color: 'var(--tk-plain)', fontSize: '13px' },
  '.cm-content': { fontFamily: 'var(--typedhouse-font-mono)', lineHeight: '22px', padding: '16px 0', caretColor: '#c7a1f9' },
  '.cm-gutters': { background: 'transparent', border: 'none', color: '#6b5d8a', fontFamily: 'var(--typedhouse-font-mono)' },
  '.cm-activeLine, .cm-activeLineGutter': { background: 'rgb(255 255 255 / .04)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: '#c7a1f9', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { background: 'rgb(199 161 249 / .25)' },
  '.cm-scroller': { overflow: 'auto' },
}, { dark: true });

export function Editor(props: { value: string; onChange: (value: string) => void; viewRef?: { current: EditorView | null }; language?: Language; onDiagnostics?: (errors: number | undefined) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;
  const onDiagnostics = useRef(props.onDiagnostics);
  onDiagnostics.current = props.onDiagnostics;
  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          basicSetup, javascript({ typescript: true }), keymap.of([indentWithTab]), theme, syntaxHighlighting(highlight),
          // Wrap long lines (no horizontal scrolling); continuation lines keep the line's indentation visually.
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': 'query.ts' }),
          EditorView.updateListener.of(update => { if (update.docChanged) onChange.current(update.state.doc.toString()); }),
          ...(props.language ? intelligence(props.language, errors => onDiagnostics.current?.(errors)) : []),
        ],
      }),
    });
    if (props.viewRef) props.viewRef.current = view;
    return () => { view.destroy(); if (props.viewRef) props.viewRef.current = null; };
    // The editor owns its document after mount; external replacements go through viewRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={host} className="editor-host" />;
}
