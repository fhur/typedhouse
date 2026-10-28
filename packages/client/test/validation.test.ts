import { beforeEach, expect, it, vi } from 'vitest';
import { ValidationError } from '@chql/compiler';
import { createClickHouseBackend, createClientFromBackend, QueryError } from '../src/index.js';
import { categories, mutation } from '../../compiler/test/validation-arbitrary.js';
const driver = vi.hoisted(() => ({ query: vi.fn(), close: vi.fn(async () => {}) }));
vi.mock('@clickhouse/client', () => ({ createClient: () => driver }));
beforeEach(() => vi.clearAllMocks());
for (const mode of ['clickhouse', 'clickhouse-naive'] as const) {
  it(`${mode}: every malformed category fails preparation before official driver IO`, async () => {
    const backend = createClickHouseBackend({}, mode);
    const client = createClientFromBackend(backend);
    for (const category of categories) {
      const { root, code, path } = mutation({ category, wrappers: ['limit'], value: 2 });
      expect(() => backend.compile(root)).toThrowError(expect.objectContaining({ code, path }));
      const query = { ir: root, caps: { live: false }, _rowType: undefined };
      for (const result of [client.run(query), client.stream(query).next()]) {
        await expect(result).rejects.toBeInstanceOf(ValidationError);
        await expect(result).rejects.not.toBeInstanceOf(QueryError);
        await expect(result).rejects.toMatchObject({ code, path });
      }
      expect(driver.query).not.toHaveBeenCalled();
    }
    await backend.close();
    expect(driver.close).toHaveBeenCalledTimes(1);
  });
}
