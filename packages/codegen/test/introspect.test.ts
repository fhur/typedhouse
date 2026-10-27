import { describe, it, expect, vi } from 'vitest';
import type { ClickHouseClient } from '@clickhouse/client';
import { introspect, splitKey } from '../src/introspect.js';

describe('key expressions', () => {
  it.each([
    ['', []], ['tenantId, entityId', ['tenantId', 'entityId']],
    ["id, cityHash64(`a,b`, 'x,)', [1, 2])", ['id', "cityHash64(`a,b`, 'x,)', [1, 2])"]],
    ["f('it\\'s,ok'), `a``b,c`", ["f('it\\'s,ok')", '`a``b,c`']],
  ])('splits %s', (text, expected) => expect(splitKey(text)).toEqual(expected));
});
for (const available of [false, true]) {
  it(`probes deterministic availability: ${available}`, async () => {
    const rows = ['ALIAS', 'DEFAULT', 'MATERIALIZED'].map((kind, i) => ({ table: 'x', name: `nested.${i}`, type: 'UInt64', position: i + 1, default_kind: kind, comment: 'comment', engine: 'View', sorting_key: '', partition_key: '', primary_key: '' }));
    const query = vi.fn().mockResolvedValueOnce({ json: async () => rows }).mockResolvedValueOnce({ json: async () => available ? [{ name: 'deterministic' }] : [] }).mockResolvedValueOnce({ json: async () => [{ name: '__proto__', is_aggregate: 1, deterministic: available ? 0 : null, alias_to: 'sum' }] });
    const result = await introspect({ query } as unknown as ClickHouseClient, "db' hostile", { skipAlias: true });
    expect(query.mock.calls[0]![0].query_params).toEqual({ db: "db' hostile" });
    expect(query.mock.calls[2]![0].query).toContain(available ? ', deterministic,' : 'NULL AS deterministic');
    expect(result.tables[0]!.columns.map(c => c.name)).toEqual(['nested.1', 'nested.2']);
    expect(result.functions).toEqual([{ name: '__proto__', isAggregate: true, deterministic: available ? false : null, aliasTo: 'sum' }]);
  });
}
