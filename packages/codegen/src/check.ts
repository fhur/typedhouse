import type { DatabaseSchema } from './introspect.js';

/** Slice 4f: reads the column names (declared and `hiddenColumns`) of every `table(...)` call in a schema.ts written by
 * `renderSchema`. Only that layout is understood: one `const x = table("name", {` line, one `  key: col…` line per column,
 * and the metadata object on the closing `}, { … });` line. Anything else is ignored (no descriptor for that table). */
export function declaredColumns(source: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const lines = source.split('\n');
  const string = '"(?:[^"\\\\]|\\\\.)*"';
  const header = new RegExp(`^const [^ ]+ = table\\((${string}), \\{$`);
  const column = new RegExp(`^  (?:\\[(${string})\\]|(${string})|([A-Za-z_$][\\w$]*)): col\\.`);
  for (let i = 0; i < lines.length; i++) {
    const head = header.exec(lines[i]!);
    if (!head) continue;
    const names = new Set<string>();
    for (i++; i < lines.length && !lines[i]!.startsWith('}, {'); i++) {
      const m = column.exec(lines[i]!);
      const name = m && (m[3] ?? parseString(m[1] ?? m[2]!));
      if (name !== undefined && name !== null) names.add(name);
    }
    for (const name of hiddenList(lines[i] ?? '')) names.add(name);
    // Fix round 1 (Tester D3): a hand edit can hold a valid JS escape that is invalid JSON (`"a\q"`, `"\u{1F600}"`);
    // such an entry is ignored, never thrown, so `check` still reports staleness and compares functions.ts.
    const table = parseString(head[1]!);
    if (table !== undefined) tables.set(table, names);
  }
  return tables;
}

const parseString = (literal: string): string | undefined => { try { const v = JSON.parse(literal) as unknown; return typeof v === 'string' ? v : undefined; } catch { return undefined; } };

/** The `hiddenColumns: [...]` array at the top level of the metadata object on the `}, { … });` line, skipping strings. */
function hiddenList(line: string): string[] {
  if (!line.startsWith('}, {')) return [];
  const skipString = (i: number) => { for (i++; i < line.length && line[i] !== '"'; i++) if (line[i] === '\\') i++; return i; };
  for (let i = 4, depth = 1; i < line.length && depth > 0; i++) {
    const c = line[i]!;
    if (c === '"') i = skipString(i);
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    else if (depth === 1 && line[i - 1] === ' ' && line.startsWith('hiddenColumns: [', i)) {
      const start = i + 'hiddenColumns: '.length;
      let end = start + 1;
      for (; end < line.length && line[end] !== ']'; end++) if (line[end] === '"') end = skipString(end);
      try { const list = JSON.parse(line.slice(start, end + 1)) as unknown; return Array.isArray(list) ? list.filter((n): n is string => typeof n === 'string') : []; } catch { return []; }
    }
  }
  return [];
}

/** Slice 4f: live columns (declared or skipped) that the existing descriptor of the same table neither declares nor
 * hides. Such a column is resolvable by name on the server, so an output alias equal to it can capture it. */
export function undeclaredColumns(schema: DatabaseSchema, source: string): { table: string; columns: string[] }[] {
  const declared = declaredColumns(source);
  const out: { table: string; columns: string[] }[] = [];
  for (const table of schema.tables) {
    const names = declared.get(table.name);
    if (!names) continue;
    const missing = [...table.columns.map(c => c.name), ...table.hiddenColumns ?? []].filter(name => !names.has(name));
    if (missing.length) out.push({ table: table.name, columns: missing });
  }
  return out;
}
