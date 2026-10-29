import { useMemo, type ReactNode } from 'react';
import { sql } from '@codemirror/lang-sql';
import { classHighlighter, highlightTree } from '@lezer/highlight';

// Syntax coloring only; compilation and formatting use the ClickHouse-aware pipeline.
const parser = sql().language.parser;

export default function SqlPreview({ value }: { value: string }) {
  const tokens = useMemo(() => {
    const nodes: ReactNode[] = [];
    let end = 0;
    highlightTree(parser.parse(value), classHighlighter, (from, to, classes) => {
      if (from > end) nodes.push(value.slice(end, from));
      nodes.push(<span key={from} className={classes}>{value.slice(from, to)}</span>);
      end = to;
    });
    if (end < value.length) nodes.push(value.slice(end));
    return nodes;
  }, [value]);

  return <pre aria-label="Generated SQL" tabIndex={0}><code>{tokens}</code></pre>;
}
