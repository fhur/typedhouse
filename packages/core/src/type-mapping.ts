import type { CHType } from './ch-type.js';
/** Output requires type imports Decimal, UUID, IPv4, IPv6, AggregateState from @chql/core. */
export function toTypeScript(t: CHType): string {
  switch (t.kind) {
    case 'scalar': {
      if (/^(U?Int)(64|128|256)$/.test(t.name)) return 'bigint';
      if (/^(U?Int)(8|16|32)$/.test(t.name) || t.name === 'Float32' || t.name === 'Float64') return 'number';
      switch (t.name) {
        case 'String': return 'string'; case 'Bool': return 'boolean';
        case 'UUID': case 'IPv4': case 'IPv6': return t.name;
        case 'Date': case 'Date32': case 'DateTime': return 'Date';
        case 'Nothing': return 'never'; default: return 'unknown';
      }
    }
    case 'FixedString': return 'string';
    case 'DateTime': return 'Date';
    case 'DateTime64': return t.precision <= 3 ? 'Date' : 'string';
    case 'Decimal': return `Decimal<${t.precision}, ${t.scale}>`;
    case 'Enum': return t.values.map(v => JSON.stringify(v.name)).join(' | ') || 'never';
    case 'Nullable': return `(${toTypeScript(t.inner)}) | null`;
    case 'LowCardinality': case 'SimpleAggregateFunction': return toTypeScript(t.inner);
    case 'Array': return `Array<${toTypeScript(t.inner)}>`;
    case 'Map': return stringKey(t.key) ? `Record<${toTypeScript(t.key)}, ${toTypeScript(t.value)}>` : `Array<[${toTypeScript(t.key)}, ${toTypeScript(t.value)}]>`;
    case 'Tuple': return t.items.length && t.items.every(i => i.name !== undefined) ? `{ ${t.items.map(i => `${JSON.stringify(i.name)}: ${toTypeScript(i.type)}`).join('; ')} }` : `readonly [${t.items.map(i => toTypeScript(i.type)).join(', ')}]`;
    case 'AggregateFunction': return `AggregateState<${JSON.stringify(t.fn)}>`;
    default: return 'unknown';
  }
}
function stringKey(t: CHType): boolean {
  return t.kind === 'FixedString' || t.kind === 'Enum' || (t.kind === 'scalar' && ['String', 'UUID', 'IPv4', 'IPv6'].includes(t.name)) || (t.kind === 'LowCardinality' && stringKey(t.inner));
}
