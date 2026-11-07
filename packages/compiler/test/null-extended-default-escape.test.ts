import { describe, expect, it } from 'vitest';
import {
  col,
  from,
  fullJoin,
  leftJoin,
  print,
  quoteName,
  quoteString,
  rightJoin,
  table,
  type CHType,
} from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';

/** D21 Tester, second form. The wrapper takes the type from the column, `toTypeName(c)`, so no text of
 * the descriptor may reach the SQL, however hostile its names, labels, zones or forged raw text. The only
 * literals the wrapper writes are its two fixed regex arguments. */
const opts = { engine: 'MergeTree', sortingKey: ['k'], partitionKey: [] } as const;

const FIXED_PATTERN = String.raw`(?s)^Nullable\\((.*)\\)$`;

const FIXED_GROUP = String.raw`\\1`;

/** Every single-quoted literal in the SQL, as written (escapes kept), lexed as the server reads them. */
function literals(sql: string): string[] {
  const out: string[] = [];

  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === '`') {
      for (i++; i < sql.length && sql[i] !== '`'; i++) if (sql[i] === '\\') i++;
      continue;
    }

    if (sql[i] !== "'") continue;
    let body = '';

    for (i++; i < sql.length && sql[i] !== "'"; i++) {
      if (sql[i] === '\\') body += sql[i++]!;
      body += sql[i]!;
    }

    out.push(body);
  }

  return out;
}

/** Hostile pieces of a descriptor, raw and in each spelling print or quoteString would give them. */
function fragments(t: CHType): string[] {
  const out: string[] = [];

  const add = (s: string) => {
    if (s.length > 2) out.push(s, quoteString(s), quoteName(s));
  };

  const walk = (x: CHType) => {
    if (x.kind === 'Tuple')
      for (const item of x.items) {
        if (item.name !== undefined) add(item.name);
        walk(item.type);
      }
    else if (x.kind === 'Enum') for (const v of x.values) add(v.name);
    else if ((x.kind === 'DateTime' || x.kind === 'DateTime64') && x.tz) add(x.tz);
    else if (x.kind === 'Unknown') add(x.raw);
    else if (x.kind === 'Nullable' || x.kind === 'LowCardinality' || x.kind === 'Array')
      walk(x.inner);
  };

  walk(t);
  return out;
}

const hostileNames = [
  "it's",
  'a`b',
  'x\\y',
  'n\nl',
  '{p0:String}',
  "')",
  "'); DROP TABLE x; --",
  '\0\b\f\t\r',
];

const hostileTypes: Record<string, CHType> = {
  'names and an Enum': col.Tuple({
    ...Object.fromEntries(hostileNames.map(n => [n, col.UInt8])),
    e: col.Enum8(Object.fromEntries(hostileNames.map((n, i) => [n, i + 1]))),
  }).type,
  'a forged Unknown member': col.Tuple({
    a: col.Unknown("UInt8')), 1) AS x, (SELECT 1) AS y -- \\' \n"),
  }).type,
  'a nested zoned DateTime and Nullable member': col.Tuple({
    i: col.Tuple({ "z'": col.DateTime("Asia/Tok'yo"), n: col.Nullable(col.UInt32) }),
  }).type,
};

describe.each(Object.keys(hostileTypes))('%s', name => {
  const type = hostileTypes[name]!;
  const l = table('l', { k: col.UInt8 }, opts);
  const r = table('r', { k: col.UInt8, h: { type } as never }, opts) as any;

  it.each([
    ['leftJoin', leftJoin],
    ['rightJoin', rightJoin],
    ['fullJoin', fullJoin],
  ] as const)(
    '%s: no descriptor text, and only the two fixed literals, on both emitters',
    (_, f) => {
      // `q` is the null-extended input in each kind: rightJoin takes it first.
      const sides =
        f === rightJoin ? [{ q: from(r) }, { t: from(l) }] : [{ t: from(l) }, { q: from(r) }];

      const q = (f as any)(...sides)
        .on((x: any) => x.t.k.eq(x.q.k))
        .map((x: any) => ({ k: x.t.k, h: x.q.h }));

      for (const emit of [compile, emitNaive]) {
        const { sql, params } = emit(q.ir);
        expect(sql).toContain('CAST(ifNull(');

        // No part of the printed descriptor: the whole text, each hostile name and label, the zone, the
        // forged raw text, in any of the spellings print or quoteString would give them.
        expect(sql).not.toContain(print(type));
        for (const fragment of fragments(type)) expect(sql, fragment).not.toContain(fragment);

        // The only string literals in the query are the wrapper's two fixed ones, once per read.
        expect([...new Set(literals(sql))].sort()).toEqual([FIXED_GROUP, FIXED_PATTERN].sort());
        expect(Object.values(params).some(v => String(v).includes('Tuple('))).toBe(false);
      }
    },
  );
});
