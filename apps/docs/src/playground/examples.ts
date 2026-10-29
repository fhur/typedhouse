export const examples = {
  composition: `import { col, from, table } from '@chql/core';

const products = table('products', {
  id: col.UInt32,
  category: col.String,
  stock: col.UInt32,
}, { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] });

// Reuse the base query without assembling SQL strings.
const available = from(products).where(p => p.stock.gt(0));
export default available
  .where(p => p.category.eq('electronics'))
  .map(p => ({ id: p.id, stock: p.stock }))
  .orderBy(p => p.stock.desc())
  .limit(10);
`,
  parameters: `import { col, from, table } from '@chql/core';

const products = table('products', {
  id: col.UInt32,
  category: col.String,
}, { engine: 'MergeTree', sortingKey: ['id'], partitionKey: [] });

// Input is a value, not SQL syntax. Inspect Parameters below.
const input = "electronics' OR 1=1 --";
export default from(products).where(p => p.category.eq(input));
`,
};
export type ExampleName = keyof typeof examples;
