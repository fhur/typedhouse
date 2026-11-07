import { describe, expect, it } from 'vitest';
import {
  col,
  from,
  fullJoin,
  leftJoin,
  print,
  rightJoin,
  table,
  type CHType,
} from '@typedhouse/core';
import { compile, emitNaive } from '@typedhouse/compiler';

/** D21 Tester: the type text is a SQL string literal. Read back with ClickHouse's own unescaping, every
 * literal must be exactly the printed descriptor, so nothing in a name, label or forged raw text can end
 * the literal early or reach SQL as code. */
const opts = { engine: 'MergeTree', sortingKey: ['k'], partitionKey: [] } as const;

/** ClickHouse string literal unescaping, for the escapes quoteString writes. */
function unescape(body: string): string {
  const map: Record<string, string> = { n: '\n', r: '\r', t: '\t', '0': '\0', b: '\b', f: '\f' };
  return body.replace(/\\(.)/gs, (_, ch: string) => map[ch] ?? ch);
}

/** Every literal argument of defaultValueOfTypeName, scanned as the server lexes a quoted string. */
function literals(sql: string): string[] {
  const out: string[] = [];
  const marker = "defaultValueOfTypeName('";
  let at = sql.indexOf(marker);

  while (at >= 0) {
    let i = at + marker.length;
    let body = '';

    for (; i < sql.length && sql[i] !== "'"; i++) {
      if (sql[i] === '\\') body += sql[i++]!;
      body += sql[i]!;
    }

    // The literal must close directly into the call's closing parenthesis.
    expect(sql.slice(i, i + 2)).toBe("')");
    out.push(unescape(body));
    at = sql.indexOf(marker, i);
  }

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
  ] as const)('%s: each literal reads back as the printed type, on both emitters', (_, f) => {
    // `q` is the null-extended input in each kind: rightJoin takes it first.
    const sides =
      f === rightJoin ? [{ q: from(r) }, { t: from(l) }] : [{ t: from(l) }, { q: from(r) }];

    const q = (f as any)(...sides)
      .on((x: any) => x.t.k.eq(x.q.k))
      .map((x: any) => ({ k: x.t.k, h: x.q.h }));

    for (const emit of [compile, emitNaive]) {
      const { sql, params } = emit(q.ir);
      const found = literals(sql);
      expect(found.length).toBeGreaterThan(0);
      for (const literal of found) expect(literal).toBe(print(type));
      // No parameter is created from the type text.
      expect(Object.values(params).some(v => String(v).includes('Tuple('))).toBe(false);
    }
  });
});
