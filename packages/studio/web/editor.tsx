import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

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

export function Editor(props: { value: string; onChange: (value: string) => void; viewRef?: { current: EditorView | null } }) {
  const host = useRef<HTMLDivElement>(null);
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;
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
