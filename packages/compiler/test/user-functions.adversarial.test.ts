import { expect, it } from 'vitest';
import { aggregateDefinitions, col, defineFunction, from, functionCatalog, table, type ExprNode } from '@chql/core';
import { compile, emitNaive, ValidationError } from '../src/index.js';

const source = from(table('parts', { n: col.UInt64 }, {
  engine: 'Memory', sortingKey: [], partitionKey: [],
}));

it.each([compile, emitNaive])('rejects final-newline SQL names before they bypass reserved aggregate names (%s)', emit => {
  const disguisedSum = defineFunction({
    name: 'sum\n', args: [col.UInt64], returns: col.UInt64, deterministic: true,
  });
  const query = source.map(row => ({ value: disguisedSum(row.n) }));
  expect(() => emit(query.ir)).toThrow(/invalid_function_name|duplicate_function/);
});

it.each([compile, emitNaive])('reserves case-insensitive native aggregate names and SQL aliases (%s)', emit => {
  for (const name of ['sum', 'SUM', 'SuM', 'CoUnT', 'AvG', 'MaX', 'sUmIf', 'Eq', 'EqUaLs', 'DaTeDiFf', 'GrEaTeSt']) {
    for (const naming of [{ name }, { name: 'applicationSum', sqlName: name }]) {
    const disguisedSum = defineFunction({
      ...naming, args: [col.UInt64], returns: col.UInt64, deterministic: true,
    });
    const query = source.map(row => ({ value: disguisedSum(row.n) }));
      expect(() => emit(query.ir)).toThrow('duplicate_function');
    }
  }
});

const reservedNames = [...new Set([
  ...functionCatalog.flatMap(d => [d.name, ...(d.sqlName === undefined ? [] : [d.sqlName])]),
  ...aggregateDefinitions.flatMap(d => [d.name, `${d.name}If`, ...(d.sqlName === undefined ? [] : [d.sqlName, `${d.sqlName}If`])]),
])];
const mixedCase = (name: string) => [...name].map((c, i) => i % 2 ? c.toLowerCase() : c.toUpperCase()).join('');

it.each([compile, emitNaive])('rejects forged matching evidence for every authoritative reserved name and alias (%s)', emit => {
  const ordinary = defineFunction({ name: 'applicationValue', args: [col.UInt64], returns: col.UInt64, deterministic: true });
  const query = source.map(row => ({ value: ordinary(row.n) })).ir;
  if (query.kind !== 'Project') throw new Error('expected projection');
  const call = query.exprs.value as Extract<ExprNode, { kind: 'Call' }>;
  for (const reserved of reservedNames) {
    for (const name of [reserved, reserved.toUpperCase(), mixedCase(reserved)]) {
      for (const naming of [{ name }, { sqlName: name }]) {
        const forged = { ...call, fn: { ...call.fn, ...naming, user: { ...call.fn.user!, ...naming } } };
        expect(() => emit({ ...query, exprs: { value: forged } })).toThrow('duplicate_function');
        try { emit({ ...query, exprs: { value: forged } }); }
        catch (error) {
          expect(error).toBeInstanceOf(ValidationError);
          expect(String(error)).toContain('root');
        }
      }
    }
  }
});

it.each([compile, emitNaive])('preserves unreserved spelling without registration or server-name autodetection (%s)', emit => {
  for (const name of ['editDistance', 'ApplicationValue', 'aPpLiCaTiOnValue']) {
    for (const naming of [{ name }, { name: 'applicationAlias', sqlName: name }]) {
      const ordinary = defineFunction({ ...naming, args: [col.UInt64], returns: col.UInt64, deterministic: true });
      expect(emit(source.map(row => ({ value: ordinary(row.n) })).ir).sql).toContain(`${name}(`);
    }
  }
});
