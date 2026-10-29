import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { EditorView, keymap } from '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { basicSetup } from 'codemirror';
import { indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { autocompletion } from '@codemirror/autocomplete';
import { examples, type ExampleName } from '../../playground/examples';
import { compileIsolated, type Compilation } from '../../playground/sandbox';
import { decodeShare, encodeShare } from '../../playground/sharing';
import SqlPreview from './SqlPreview';
import './playground.css';

const STORAGE_KEY = 'chql-playground-v1';
const words = ['from', 'table', 'col', 'count', 'sum', 'join', 'unionAll', 'where', 'map', 'groupBy', 'aggregate', 'orderBy', 'limit'];

export default function Playground({ fullPage = false }: { fullPage?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const panes = useRef<HTMLDivElement>(null);
  const sourcePaneId = useId();
  const [split, setSplit] = useState(50);
  const editor = useRef<EditorView | null>(null);
  const [source, setSource] = useState(examples.composition);
  const [example, setExample] = useState<ExampleName>('composition');
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const [output, setOutput] = useState<Compilation | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    const theme = new Compartment();
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    const isDark = () => document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark' : scheme.matches;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: examples.composition,
        extensions: [basicSetup, javascript({ typescript: true }), keymap.of([indentWithTab]),
          theme.of(isDark() ? oneDark : []),
          EditorView.contentAttributes.of({ 'aria-label': 'chql TypeScript source' }),
          autocompletion({ override: [context => {
            const word = context.matchBefore(/\w*/);
            if (!word || (word.from === word.to && !context.explicit)) return null;
            return { from: word.from, options: words.map(label => ({ label, type: 'function' })) };
          }] }),
          EditorView.updateListener.of(update => { if (update.docChanged) setSource(update.state.doc.toString()); }),
          EditorView.lineWrapping,
        ],
      }),
    });
    editor.current = view;
    const syncTheme = () => view.dispatch({ effects: theme.reconfigure(isDark() ? oneDark : []) });
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    scheme.addEventListener('change', syncTheme);
    let disposed = false;
    void (async () => {
      let initial = examples.composition;
      let trusted = true;
      try {
        if (location.hash) {
          trusted = false;
          initial = await decodeShare(location.hash);
          if (!disposed) setNotice('Shared code loaded. Review it, then select Compile.');
        } else {
          const draft = localStorage.getItem(STORAGE_KEY);
          if (draft && draft.length <= 32_000) {
            initial = draft;
            trusted = false;
            if (!disposed) setNotice('Local draft restored. Select Compile to evaluate it.');
          }
        }
      } catch (error) {
        trusted = false;
        if (!disposed) setNotice(error instanceof Error ? error.message : 'Could not restore source.');
      }
      if (disposed) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: initial } });
      setSource(initial);
      setEnabled(trusted);
      setReady(true);
    })();
    return () => {
      disposed = true;
      observer.disconnect();
      scheme.removeEventListener('change', syncTheme);
      view.destroy();
      editor.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(STORAGE_KEY, source); } catch { /* Storage is optional. */ }
  }, [source, ready]);

  useEffect(() => {
    if (!ready || !enabled) return;
    const controller = new AbortController();
    setOutput(null);
    setError('');
    setBusy(true);
    const timer = window.setTimeout(() => {
      void compileIsolated(source, controller.signal).then(result => {
        if (!controller.signal.aborted) setOutput(result);
      }).catch(error => {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Compilation failed.');
      }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [source, ready, enabled, revision]);

  const selectExample = (name: ExampleName) => {
    if (source !== examples[example] && !window.confirm('Replace your edited draft with this example?')) return;
    setExample(name);
    const view = editor.current;
    view?.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: examples[name] } });
    setEnabled(true);
    setNotice('');
    history.replaceState(null, '', location.pathname + location.search);
  };
  const share = async () => {
    try {
      const fragment = await encodeShare(source);
      const url = new URL(location.href);
      url.hash = fragment;
      history.replaceState(null, '', url);
      await navigator.clipboard.writeText(url.href);
      setNotice('Share link copied. Anyone with the link can read your code.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not copy link.'); }
  };

  const resize = (percent: number) => setSplit(Math.min(70, Math.max(30, Math.round(percent))));

  return <section className={`chql-playground${fullPage ? ' pg-fullpage' : ''}`} aria-label="Interactive chql playground">
    <div className="pg-toolbar">
      <label><span className="pg-label">Example</span> <select value={example} onChange={event => selectExample(event.target.value as ExampleName)}>
        <option value="composition">Reusable queries</option><option value="parameters">Safe parameters</option>
      </select></label>
      <div className="pg-actions">
        <button onClick={() => selectExample(example)} disabled={!ready}>Reset</button>
        <button onClick={() => void share()} disabled={!ready}>Share</button>
        <button className="pg-primary" onClick={() => { setEnabled(true); setRevision(n => n + 1); }} disabled={!ready}>Compile</button>
      </div>
    </div>
    <div className="pg-panes" ref={panes} style={{ '--pg-split': `${split}%` } as CSSProperties}>
      <div className="pg-pane" id={sourcePaneId}><h2><span className="pg-file">query.ts</span><span>Editable · TypeScript</span></h2><div className="pg-editor-host" ref={host} />
        {!ready && <pre className="pg-fallback">{examples.composition}</pre>}
      </div>
      <div className="pg-divider" role="separator" tabIndex={0} aria-label="Resize source and SQL panes"
        aria-orientation="vertical" aria-valuemin={30} aria-valuemax={70} aria-valuenow={split}
        aria-controls={sourcePaneId}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); event.currentTarget.focus(); }}
        onPointerMove={event => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId) || !panes.current) return;
          const bounds = panes.current.getBoundingClientRect();
          resize((event.clientX - bounds.left) / bounds.width * 100);
        }}
        onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          resize(event.key === 'Home' ? 30 : event.key === 'End' ? 70 : split + (event.key === 'ArrowLeft' ? -2 : 2));
        }}
      />
      <div className="pg-pane"><h2><span className="pg-file">Generated SQL</span><button disabled={!output} onClick={() => {
        if (output) void navigator.clipboard.writeText(output.sql).then(() => setNotice('SQL copied.')).catch(() => setNotice('Clipboard unavailable. Select SQL to copy it.'));
      }}>Copy</button></h2>
        {output ? <SqlPreview value={output.sql} /> : <pre className="pg-placeholder" aria-label="Generated SQL">{busy ? 'Compiling…' : 'Select Compile to see the SQL.'}</pre>}
      </div>
    </div>
    <div className="pg-details">
      <p className="pg-status" data-state={error ? 'error' : busy ? 'busy' : output ? 'success' : 'idle'} role="status">{error ? `Compilation error: ${error}` : busy ? 'Compiling in an isolated worker…' : output ? 'Compiled locally. No database connection.' : notice || 'Loading editor…'}</p>
      {notice && (output || error || busy) && <p>{notice}</p>}
      {output && <details open={!fullPage}><summary>Parameters <span className="pg-count">{Object.keys(output.params).length}</span></summary><pre>{JSON.stringify(output.params, null, 2)}</pre></details>}
      {fullPage ? <details className="pg-help"><summary>Usage & safety</summary>
        <p className="pg-hint">Import from @chql/core, define tables inline, and export default one query. Compilation never runs a database query. Highlighting and completions are not TypeScript type checking. Press Escape, then Tab to leave the editor. Do not paste secrets: drafts stay in this browser and shared links contain your source. No external packages or network access.</p>
      </details> : <p className="pg-hint">Highlighting and completions are not TypeScript type checking. Press Escape, then Tab to leave the editor. Do not paste secrets: drafts stay in this browser and shared links contain your source.</p>}
    </div>
  </section>;
}
