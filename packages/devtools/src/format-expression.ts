import { print, type ExprNode } from '@typedhouse/core';

const infix: Readonly<Record<string, string>> = {
  eq: '=', ne: '!=', gt: '>', ge: '>=', lt: '<', le: '<=',
  and: 'AND', or: 'OR', plus: '+', minus: '-', multiply: '*', divide: '/',
  in: 'IN', notIn: 'NOT IN',
};

function valueLabel(value: unknown): string {
  if (value === null) return 'NULL';
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? `'${value.toISOString()}'` : 'Invalid Date';
  if (typeof value === 'string') {
    const short = value.length > 80 ? `${value.slice(0, 80)}…` : value;
    return `'${short.replaceAll("'", "''").replaceAll('\n', '\\n').replaceAll('\r', '\\r')}'`;
  }
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return `[${value.slice(0, 5).map(v => Array.isArray(v) ? '[…]' : valueLabel(v)).join(', ')}${value.length > 5 ? ', …' : ''}]`;
  }
  return '?';
}

/** Human-readable predicate summary, not executable SQL. Bounded for large IR. */
export function formatExpression(root: ExprNode): string {
  let remaining = 128;
  function format(expr: ExprNode, depth = 0): string {
    if (depth >= 24 || remaining-- <= 0) return '…';
    const child = (e: ExprNode) => format(e, depth + 1);
    switch (expr.kind) {
      case 'ColumnRef': return expr.path.map(p => /^[A-Za-z_][A-Za-z0-9_]*$/.test(p) ? p : `\`${p.replaceAll('`', '``')}\``).join('.');
      case 'Param': case 'Literal': return valueLabel(expr.value);
      case 'Subquery': return `${expr.usage === 'in' ? 'SET' : 'SCALAR'} SUBQUERY`;
      case 'Raw': return '[raw expression]';
      case 'Cast': return `CAST(${child(expr.expr)} AS ${print(expr.to)})`;
      case 'Case': return `CASE ${expr.branches.map(b => `WHEN ${child(b.when)} THEN ${child(b.then)}`).join(' ')} ELSE ${child(expr.otherwise)} END`;
      case 'Call': case 'Agg': {
        const args = expr.args.map(child);
        const name = expr.fn.name;
        if (expr.kind === 'Call' && expr.fn.origin === 'typed') {
          if (Object.hasOwn(infix, name) && args.length === 2) return `(${args[0]} ${infix[name]} ${args[1]})`;
          if (name === 'not' && args.length === 1) return `(NOT ${args[0]})`;
          if ((name === 'isNull' || name === 'isNotNull') && args.length === 1) return `(${args[0]} IS ${name === 'isNotNull' ? 'NOT ' : ''}NULL)`;
          if (name === 'between' && args.length === 3) return `(${args[0]} BETWEEN ${args[1]} AND ${args[2]})`;
        }
        const params = expr.kind === 'Agg' && expr.params.length ? `(${expr.params.map(child).join(', ')})` : '';
        return `${name}${params}(${args.join(', ')})`;
      }
    }
  }
  const result = format(root);
  return result.length > 500 ? `${result.slice(0, 500)}…` : result;
}
