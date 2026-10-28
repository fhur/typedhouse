// Fixture setup occurs in the parent integration test, outside this consumer heap.
import assert from 'node:assert/strict';
import { createClient } from '../packages/client/dist/index.js';
import { col, from, table } from '../packages/core/dist/index.js';
const client = createClient({ url: process.env.CLICKHOUSE_URL, username: 'fixture', password: 'fixture' });
const query = from(table('stream_budget', { id: col.UInt32 }, { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] }));
const thresholdBytes = 200_000_000;
let count = 0, checksum = 0, peakHeapUsed = process.memoryUsage().heapUsed;
const sample = () => { peakHeapUsed = Math.max(peakHeapUsed, process.memoryUsage().heapUsed); };
const timer = setInterval(sample, 10);
try {
  for await (const row of client.stream(query)) {
    count++; checksum += row.id;
    if (count % 4096 === 0) sample();
  }
  sample();
  const record = { node: process.version, server: process.env.CLICKHOUSE_VERSION, rowShape: '{ id: UInt32 -> number }', count, checksum, peakHeapUsed, thresholdBytes };
  console.log(JSON.stringify(record));
  assert.equal(count, 10_000_000);
  assert.equal(checksum, 49_999_995_000_000);
  assert.ok(peakHeapUsed < thresholdBytes, JSON.stringify(record));
} finally { clearInterval(timer); await client.close(); }
