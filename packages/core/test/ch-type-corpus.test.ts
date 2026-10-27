import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import records from '../../compiler/test/fixtures/columns.json';
import provenance from '../../compiler/test/fixtures/columns.provenance.json';
import { parseCHType, print, toTypeScript } from '../src/index.js';
// Independent expectations in DDL column order; never generated using the mapper under test.
const mappings = [
  'number', 'number', 'number', 'bigint', 'bigint', 'bigint',
  'number', 'number', 'number', 'bigint', 'bigint', 'bigint',
  'number', 'number', 'boolean', 'string', 'string', 'UUID', 'IPv4', 'IPv6',
  'Date', 'Date', 'Date', 'Date', 'Date', 'Date', 'Date', 'Date', 'string', 'string',
  'Decimal<9, 2>', 'Decimal<18, 4>', 'Decimal<38, 10>', 'Decimal<76, 20>',
  '"a b" | "comma,(paren)" | "quote\'slash\\\\"', '"low" | "high"',
  '(bigint) | null', 'string', '(string) | null', 'Array<string>', 'Array<(bigint) | null>', 'Array<Array<number>>',
  'Record<string, bigint>', 'Array<[bigint, Array<string>]>', 'Record<UUID, (number) | null>',
  'readonly [string, bigint]', '{ "id": string; "mpn": (string) | null }',
  'Array<{ "id": string; "mpn": (string) | null; "manufacturer": (string) | null }>',
  '{ "a.b": string; "with space": number }', 'AggregateState<"sum">', 'AggregateState<"quantiles(0.5, 0.9)">', 'bigint', '(number) | null',
  'Record<string, { "a": number; "b": Array<string> }>',
];
it('has 200+ genuine captured records with verifiable provenance', () => {
  expect(records.length).toBeGreaterThanOrEqual(200); expect(records.length).toBe(provenance.count);
  expect(new Set(records.map(r => r.type)).size).toBe(provenance.distinctTypes);
  expect(provenance.image).toBe('clickhouse/clickhouse-server:24.8'); expect(provenance.serverVersion).toMatch(/^24\.8\./);
  expect(provenance.repoDigests[0]).toMatch(/@sha256:[a-f0-9]{64}$/);
  const hash = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
  expect(hash('packages/compiler/test/fixtures/columns.json')).toBe(provenance.sha256);
  expect(hash(provenance.fixture)).toBe(provenance.fixtureSha256);
  expect(new Set(records.map(r => `${r.database}.${r.table}.${r.name}`)).size).toBe(records.length);
});
it.each(records)('$table.$name: $type parses, prints exactly and maps', record => {
  const ast = parseCHType(record.type);
  expect(ast.kind).not.toBe('Unknown'); expect(print(ast)).toBe(record.type); expect(parseCHType(print(ast))).toEqual(ast);
  expect(toTypeScript(ast)).toBe(mappings[Number(record.name.slice(1)) - 1]);
});
