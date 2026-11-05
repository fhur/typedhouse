import { compile } from '@typedhouse/compiler';
import { toTypeScript, type Rel } from '@typedhouse/core';
import { format } from 'sql-formatter';
import { encodeShare } from '../playground/sharing';
import { withBase } from './urls';

/** A self-contained example module plus the prose shown next to it. */
export interface ExampleDefinition {
  readonly id: string;
  readonly label: string;
  readonly filename: string;
  readonly query: { readonly ir: Rel };
  /** The module's exact source (import it with `?raw`). */
  readonly source: string;
  readonly lead?: string;
  readonly note?: string;
}

/** Everything a page needs to render an example, all computed at build time from the real compiler. */
export interface CompiledExample extends Omit<ExampleDefinition, 'query'> {
  /** The part of the source between `// #region example` and `// #endregion`, or the whole file. */
  readonly snippet: string;
  readonly sql: string;
  readonly params: string;
  readonly rowType: string | undefined;
  readonly playgroundHref: string;
}

const REGION_START = /^\s*\/\/ #region example\s*$/m;

const REGION_END = /^\s*\/\/ #endregion\s*$/m;

export function exampleSnippet(source: string): string {
  const start = REGION_START.exec(source);
  if (!start) return source.trim();
  const rest = source.slice(start.index + start[0].length);
  const end = REGION_END.exec(rest);
  return (end ? rest.slice(0, end.index) : rest).replace(/^\n+|\s+$/g, '');
}

export function rowTypeOf(rel: Rel): string | undefined {
  const output = rel.output;
  if (output.shape !== 'flat') return undefined;
  return `{ ${output.order.map(name => `${name}: ${toTypeScript(output.columns[name]!)}`).join('; ')} }`;
}

export async function compileExample(definition: ExampleDefinition): Promise<CompiledExample> {
  const { query, ...rest } = definition;
  const compiled = compile(query.ir);

  return {
    ...rest,
    snippet: exampleSnippet(definition.source),
    sql: format(compiled.sql, { language: 'clickhouse' }),
    params: JSON.stringify(compiled.params),
    rowType: rowTypeOf(query.ir),
    playgroundHref: `${withBase('/playground/')}#${await encodeShare(definition.source)}`,
  };
}
