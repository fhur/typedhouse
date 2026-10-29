import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatTypeScriptExample } from './example-format.mjs';

test('wraps TypeScript and prose comments to 60 columns, idempotently', async () => {
  const source = `const query = input.where(row => row.active.eq(true)).map(row => ({ id: row.id, name: row.name }));
// This is a long prose comment that should wrap without changing the TypeScript expression above it.
const example = {
  value: 1,
  // This comment follows the last property and must also wrap before the closing object token.
};`;
  const formatted = await formatTypeScriptExample(source);
  assert.ok(formatted.split('\n').every(line => line.length <= 60));
  assert.equal(await formatTypeScriptExample(formatted), formatted);
});

test('preserves long literal values and comment-like template contents', async () => {
  const value = '// This is string content, not a comment to wrap even when it exceeds the requested display width.';
  const formatted = await formatTypeScriptExample(`const text = \`${value}\`;`);
  assert.ok(formatted.includes(value));
});

test('preserves compiler directive comments', async () => {
  const directive = '// @ts-expect-error This directive and its attached explanation must stay on one line for tooling.';
  const formatted = await formatTypeScriptExample(`${directive}\nconst item: number = 'string';`);
  assert.ok(formatted.includes(directive));
});
