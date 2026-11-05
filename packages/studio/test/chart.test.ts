import { describe, expect, it } from 'vitest';
import { checkChartSpec } from '../server/chart.js';
import { toChartData } from '../web/chart-data.js';

const columns = [{ name: 'country', type: 'LowCardinality(String)' }, { name: 'revenue', type: 'Float64' }, { name: 'day', type: 'Date' }];
const good = { mark: 'bar', encoding: { x: { field: 'country', type: 'nominal', sort: '-y' }, y: { field: 'revenue', type: 'quantitative' } } };
const unknownField = { mark: 'bar', encoding: { x: { field: 'nation', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } };
const inlined = { ...good, data: { values: [{ country: 'DE', revenue: 1e9 }] } };

describe('checkChartSpec', () => {
  it('accepts result columns and binds the studio data', () => {
    expect(checkChartSpec(good, columns)).toEqual({ ok: true, spec: { ...good, data: { name: 'table' } } });
    expect(checkChartSpec(JSON.stringify(good), columns).ok).toBe(true);
    expect(checkChartSpec({ ...good, data: { name: 'table' } }, columns).ok).toBe(true);
  });

  it('accepts names created by transforms, in order', () => {
    const spec = {
      transform: [{ calculate: 'datum.revenue / 1000', as: 'k' }, { aggregate: [{ op: 'sum', field: 'k', as: 'total' }], groupby: ['country'] }],
      mark: 'bar', encoding: { x: { field: 'country', type: 'nominal' }, y: { field: 'total', type: 'quantitative' }, tooltip: [{ field: 'total' }] },
    };
    expect(checkChartSpec(spec, columns).ok).toBe(true);
    // A name used before the transform that creates it is unknown.
    const early = { transform: [{ aggregate: [{ op: 'sum', field: 'k', as: 'total' }], groupby: ['country'] }, { calculate: '1', as: 'k' }], mark: 'bar' };
    expect(checkChartSpec(early, columns)).toMatchObject({ ok: false, message: expect.stringMatching(/Unknown field\(s\): k/) });
  });

  it('rejects inlined, url and named data at any depth, and non-object specs', () => {
    expect(checkChartSpec(inlined, columns)).toMatchObject({ ok: false, message: expect.stringMatching(/do not set data/) });
    expect(checkChartSpec({ ...good, data: { url: 'https://evil.example/x.json' } }, columns).ok).toBe(false);
    expect(checkChartSpec({ layer: [{ ...good, data: { name: 'other' } }] }, columns).ok).toBe(false);
    expect(checkChartSpec({ ...good, datasets: { a: [] } }, columns).ok).toBe(false);
    expect(checkChartSpec('{not json', columns)).toMatchObject({ ok: false, message: expect.stringMatching(/not valid JSON/) });
    expect(checkChartSpec([good], columns).ok).toBe(false);
  });

  it('names unknown fields and lists the columns, also in sort, tooltip and layers', () => {
    const result = checkChartSpec(unknownField, columns);
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/Unknown field\(s\): nation\. Result columns: country \(LowCardinality\(String\)\), revenue/) });
    expect(checkChartSpec({ layer: [{ mark: 'line', encoding: { x: { field: 'day' }, tooltip: [{ field: 'secret' }] } }] }, columns).ok).toBe(false);
    expect(checkChartSpec({ mark: 'bar', encoding: { x: { field: 'country', sort: { field: 'nope' } } } }, columns).ok).toBe(false);
  });
});

describe('toChartData', () => {
  it('turns bigint and numeric strings into numbers, keeps Date and null, JSON-encodes complex values, flattens paths', () => {
    const at = new Date('2024-02-29T12:34:56Z');
    const rows = [
      { id: 18446744073709551615n, amount: '-12345.6789', big: '42', label: 'x', at, note: null, tags: { k: 1n }, arr: [1n, 2n], pair: ['t', 255], e: { name: 'join-side' } },
      { id: 1n, amount: null, big: '7', label: '12', at, note: 'n', tags: {}, arr: [], pair: ['u', 1], e: { name: 'other' } },
    ];
    const cols = [
      { name: 'id', path: ['id'], type: 'UInt64' }, { name: 'amount', path: ['amount'], type: 'Nullable(Decimal(18, 4))' },
      { name: 'big', path: ['big'], type: 'Int128' }, { name: 'label', path: ['label'], type: 'String' },
      { name: 'at', path: ['at'], type: 'DateTime' }, { name: 'note', path: ['note'], type: 'Nullable(String)' },
      { name: 'tags', path: ['tags'], type: 'Map(String, UInt64)' }, { name: 'arr', path: ['arr'], type: 'Array(UInt64)' },
      { name: 'pair', path: ['pair'], type: 'Tuple(String, UInt8)' }, { name: 'e.name', path: ['e', 'name'], type: 'String' },
    ];
    expect(toChartData(rows, cols)).toEqual([
      { id: 18446744073709552000, amount: -12345.6789, big: 42, label: 'x', at, note: null, tags: '{"k":"1"}', arr: '["1","2"]', pair: '["t",255]', 'e.name': 'join-side' },
      { id: 1, amount: null, big: 7, label: '12', at, note: 'n', tags: '{}', arr: '[]', pair: '["u",1]', 'e.name': 'other' },
    ]);
  });
});
