import { print, type ExprNode, type OutputSchema, type Rel } from '@typedhouse/core';
import { formatExpression } from './format-expression.js';

export interface DataflowColumn {
  readonly path: readonly string[];
  /** null means the raw relation has not declared a type. */
  readonly type: string | null;
}

export interface DataflowNode {
  /** Graph-local ID; identity, not structural equality, determines sharing. */
  readonly id: string;
  readonly irId: number;
  readonly kind: Rel['kind'];
  readonly label: string;
  readonly columns: readonly DataflowColumn[];
}

export interface DataflowEdge {
  /** Data producer → consuming operator. Parallel edges retain repeated uses. */
  readonly source: string;
  readonly target: string;
  readonly kind: 'input' | 'scalar' | 'in';
  /** Field/index path on the consumer IR; join aliases are preserved verbatim. */
  readonly path: readonly (string | number)[];
}

export interface DataflowGraph {
  readonly root: string;
  readonly nodes: readonly DataflowNode[];
  readonly edges: readonly DataflowEdge[];
}

type Path = readonly (string | number)[];

function columns(output: OutputSchema): DataflowColumn[] {
  const result: DataflowColumn[] = [];
  const pending: { output: OutputSchema; path: readonly string[] }[] = [{ output, path: [] }];

  while (pending.length) {
    const item = pending.pop()!;

    if (item.output.shape === 'flat') {
      for (const name of item.output.order)
        result.push({ path: [...item.path, name], type: print(item.output.columns[name]!) });
    } else if (item.output.shape === 'deferred') {
      for (const name of item.output.declaredNames)
        result.push({ path: [...item.path, name], type: null });
    } else {
      if (item.output.fields) pending.push({ output: item.output.fields, path: item.path });

      for (const [name, child] of [...item.output.inputs].reverse())
        pending.push({ output: child, path: [...item.path, name] });
    }
  }

  return result;
}

function label(rel: Rel): string {
  switch (rel.kind) {
    case 'Scan':
      return `Scan ${rel.table.name}${rel.final ? ' FINAL' : ''}${rel.sample === undefined ? '' : ` SAMPLE ${rel.sample}`}`;
    case 'RawRel':
      return rel.provenance.label ? `RawRel ${rel.provenance.label}` : 'RawRel';
    case 'Filter':
      return `Filter ${formatExpression(rel.pred)}`;
    case 'Prewhere':
      return `Prewhere ${formatExpression(rel.pred)}`;
    case 'Sort':
      return `Sort ${rel.keys.map(key => `${formatExpression(key.expr)} ${key.dir.toUpperCase()}${key.nulls ? ` NULLS ${key.nulls.toUpperCase()}` : ''}`).join(', ')}`;
    case 'Join':
      return `${rel.joinKind} Join`;
    case 'Union':
      return rel.all ? 'Union ALL' : 'Union DISTINCT';
    case 'ArrayJoin':
      return `${rel.left ? 'Left ' : ''}ArrayJoin ${rel.alias}`;
    case 'LimitBy':
      return `LimitBy ${rel.n}${rel.offset === undefined ? '' : ` OFFSET ${rel.offset}`} BY ${rel.keys.map(formatExpression).join(', ')}`;
    case 'Limit':
      return `Limit ${rel.n}${rel.offset === undefined ? '' : ` OFFSET ${rel.offset}`}`;
    default:
      return rel.kind;
  }
}

/**
 * Inspect relational dataflow without compiling or executing a query.
 *
 * Nodes represent relational operators, not individual scalar expressions.
 * Edges point from producers to consumers; expression subqueries are included
 * and labelled scalar/in. Shared relations appear once, with one edge per use.
 * IDs are deterministic within a traversal (root is n0), not persistent IDs.
 * The detached result is JSON-friendly. Filter labels include parameter values;
 * raw SQL text is omitted. Treat exported graphs as potentially sensitive.
 * This accepts trusted IR and is not an IR validator or a physical query plan.
 *
 * @example
 * ```ts
 * const query = from(offers).groupBy(x => x.origin).count();
 * const graph = toDataflowGraph(query.ir);
 * console.table(graph.nodes);
 * console.table(graph.edges);
 * console.log(JSON.stringify(graph, null, 2));
 * ```
 */
export function toDataflowGraph(root: Rel): DataflowGraph {
  const ids = new Map<Rel, string>();
  const pending: Rel[] = [];
  const nodes: DataflowNode[] = [];
  const edges: DataflowEdge[] = [];

  function identify(rel: Rel): string {
    const found = ids.get(rel);
    if (found !== undefined) return found;
    const id = `n${ids.size}`;
    ids.set(rel, id);
    pending.push(rel);
    return id;
  }

  const rootId = identify(root);

  for (let index = 0; index < pending.length; index++) {
    const rel = pending[index]!;
    const target = ids.get(rel)!;

    nodes.push({
      id: target,
      irId: rel.id,
      kind: rel.kind,
      label: label(rel),
      columns: columns(rel.output),
    });

    const connect = (input: Rel, path: Path, kind: DataflowEdge['kind'] = 'input') => {
      edges.push({ source: identify(input), target, kind, path: [...path] });
    };

    const expression = (rootExpr: ExprNode, rootPath: Path) => {
      // Track ancestors, not all visited expressions: shared occurrences each
      // contribute an edge, but malformed expression cycles must not loop.
      const active = new Set<ExprNode>();

      const stack: { expr: ExprNode; path: Path; exit?: boolean }[] = [
        { expr: rootExpr, path: rootPath },
      ];

      while (stack.length) {
        const { expr, path, exit } = stack.pop()!;

        if (exit) {
          active.delete(expr);
          continue;
        }

        if (active.has(expr)) throw new Error('cyclic_ir');
        active.add(expr);
        stack.push({ expr, path, exit: true });
        const children: { expr: ExprNode; path: Path }[] = [];

        const child = (e: ExprNode, ...suffix: (string | number)[]) =>
          children.push({ expr: e, path: [...path, ...suffix] });

        switch (expr.kind) {
          case 'Subquery':
            connect(expr.rel, [...path, 'rel'], expr.usage);
            break;
          case 'Call':
          case 'Raw':
            expr.args.forEach((e, i) => child(e, 'args', i));
            break;
          case 'Agg':
            expr.args.forEach((e, i) => child(e, 'args', i));
            expr.params.forEach((e, i) => child(e, 'params', i));
            break;
          case 'Cast':
            child(expr.expr, 'expr');
            break;
          case 'Case':
            expr.branches.forEach((b, i) => {
              child(b.when, 'branches', i, 'when');
              child(b.then, 'branches', i, 'then');
            });

            child(expr.otherwise, 'otherwise');
            break;
          case 'ColumnRef':
          case 'Param':
          case 'Literal':
            break;

          default: {
            const unreachable: never = expr;
            throw new Error(`unknown_expression: ${String(unreachable)}`);
          }
        }

        stack.push(...children.reverse());
      }
    };

    if ('input' in rel) connect(rel.input, ['input']);

    switch (rel.kind) {
      case 'Scan':
      case 'Limit':
      case 'Distinct':
      case 'Materialize':
        break;
      case 'RawRel':
        rel.args.forEach((e, i) => expression(e, ['args', i]));
        break;
      case 'Filter':
      case 'Prewhere':
        expression(rel.pred, ['pred']);
        break;
      case 'Project':
        for (const name of rel.output.order) expression(rel.exprs[name]!, ['exprs', name]);
        break;
      case 'Aggregate':
        for (const name of rel.output.order) {
          if (Object.hasOwn(rel.keys, name)) expression(rel.keys[name]!, ['keys', name]);
          if (Object.hasOwn(rel.aggs, name)) expression(rel.aggs[name]!, ['aggs', name]);
        }

        break;
      case 'Join':
        rel.inputs.forEach(([alias, input], i) => connect(input, ['inputs', i, alias]));
        rel.on.forEach((e, i) => expression(e, ['on', i]));
        break;
      case 'ArrayJoin':
        expression(rel.expr, ['expr']);
        break;
      case 'Sort':
        rel.keys.forEach((key, i) => expression(key.expr, ['keys', i, 'expr']));
        break;
      case 'LimitBy':
        rel.keys.forEach((key, i) => expression(key, ['keys', i]));
        break;
      case 'Union':
        rel.inputs.forEach((input, i) => connect(input, ['inputs', i]));
        break;

      default: {
        const unreachable: never = rel;
        throw new Error(`unknown_relation: ${String(unreachable)}`);
      }
    }
  }

  return { root: rootId, nodes, edges };
}
