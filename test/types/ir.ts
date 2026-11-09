import { expectTypeOf } from 'expect-type';
import {
  col,
  exprNode,
  relNode,
  flatOutput,
  type ExprNode,
  type NodeId,
  type Rel,
  type OutputSchema,
  type CHType,
} from '../../packages/core/src/index.js';

const p = exprNode({ kind: 'Param', value: 1n, type: null });
expectTypeOf(p.kind).toEqualTypeOf<'Param'>();
expectTypeOf(p.type).toEqualTypeOf<CHType | null>();
expectTypeOf(p.id).toEqualTypeOf<NodeId>();
expectTypeOf(p).not.toBeAny();
const ref = exprNode({ kind: 'ColumnRef', rel: p.id, type: col.String.type, path: ['a.b'] });
expectTypeOf(ref.path).toEqualTypeOf<readonly string[]>();
expectTypeOf(ref.rel).toEqualTypeOf<NodeId>();
expectTypeOf(ref).not.toBeAny();

const raw = relNode({
  kind: 'RawRel',
  opaque: true,
  provenance: { origin: 'sql.relation' },
  parts: [],
  args: [],
  output: { shape: 'deferred', reason: 'raw', declaredNames: [] },
});

expectTypeOf(raw.kind).toEqualTypeOf<'RawRel'>();
expectTypeOf(raw.opaque).toEqualTypeOf<true>();
expectTypeOf(raw.output).toEqualTypeOf<OutputSchema>();
expectTypeOf(raw).not.toBeAny();

expectTypeOf<Rel['kind']>().toEqualTypeOf<
  | 'Scan'
  | 'RawRel'
  | 'Prewhere'
  | 'Filter'
  | 'Project'
  | 'Aggregate'
  | 'Join'
  | 'ArrayJoin'
  | 'Sort'
  | 'LimitBy'
  | 'Limit'
  | 'Distinct'
  | 'Union'
  | 'Materialize'
  | 'Settings'
>();

expectTypeOf<ExprNode['kind']>().toEqualTypeOf<
  'ColumnRef' | 'Literal' | 'Param' | 'Call' | 'Agg' | 'Raw' | 'Case' | 'Cast' | 'Subquery'
>();

expectTypeOf(flatOutput([['42', col.String.type]]).shape).toEqualTypeOf<'flat'>();
// @ts-expect-error Node ids are not arbitrary numbers.
const invalid: NodeId = 1;
void invalid;

type CallMetadata = Extract<ExprNode, { kind: 'Call' }>['fn'];

type AggregateMetadata = Extract<ExprNode, { kind: 'Agg' }>['fn'];

expectTypeOf<CallMetadata['js']>().toEqualTypeOf<undefined>();
expectTypeOf<AggregateMetadata['js']>().toEqualTypeOf<undefined>();
const metadata = { name: 'manual', origin: 'typed', deterministic: true } as const;

// @ts-expect-error Function implementations are not valid scalar SQL metadata.
const invalidCall: CallMetadata = { ...metadata, js: () => 1 };

// @ts-expect-error Aggregates cannot supply JavaScript implementations either.
const invalidAggregate: AggregateMetadata = { ...metadata, linear: false, js: () => 1 };
void invalidCall;
void invalidAggregate;
