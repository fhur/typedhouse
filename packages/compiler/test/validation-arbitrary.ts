import fc from 'fast-check';
import {
  cast,
  col,
  count,
  crossJoin,
  dateDiff,
  from,
  join as innerJoin,
  multiIf,
  scalar,
  sql,
  table,
  unionAll,
  val,
  type Rel,
} from '@typedhouse/core';

export const seed = 20261028;

export const source = from(
  table(
    'validation_rows',
    { id: col.UInt64, tags: col.Array(col.String) },
    { engine: 'Memory', sortingKey: [], partitionKey: [] },
  ),
);

export const categories = [
  'input',
  'output',
  'metadata',
  'args',
  'sparseArgs',
  'badArg',
  'relationCycle',
  'expressionCycle',
  'subqueryCycle',
  'outputCycle',
  'descriptorCycle',
  'joinPair',
  'sparsePair',
  'sparseInputs',
  'unionInput',
  'sortExpr',
  'projectExprs',
  'aggregateKeys',
  'aggregateArgs',
  'aggregateParams',
  'outputColumns',
  'outputOrder',
  'outputInputs',
  'outputFields',
  'table',
  'tableColumns',
  'columnPath',
  'castExpr',
  'castTarget',
  'tupleItem',
  'mapValue',
  'variantItem',
  'enumValue',
  'aggregateTypeArg',
  'simpleAggregateInner',
  'rawArgs',
  'caseBranch',
  'unknownRel',
  'unknownExpr',
  'unknownType',
] as const;

export type Category = (typeof categories)[number];

const payloadDescriptors = {
  dynamic: col.Dynamic,
  json: col.JSON,
  decimal: col.Decimal(38, 18),
  tuple: col.Tuple([col.String, col.Nullable(col.UInt64)]),
  map: col.Map(col.String, col.Array(col.UInt64)),
};

export interface Recipe {
  category: Category;
  wrappers: readonly ('distinct' | 'limit')[];
  value: number;
  malformation?: 'missing' | 'wrongContainer' | 'invalidTag' | 'invalidChild';
  payload?: 'none' | keyof typeof payloadDescriptors;
}

export const recipes: fc.Arbitrary<Recipe> = fc.record({
  category: fc.constantFrom(...categories),
  wrappers: fc.array(fc.constantFrom('distinct' as const, 'limit' as const), { maxLength: 6 }),
  value: fc.integer({ min: 0, max: 100 }),
  malformation: fc.constantFrom(
    'missing' as const,
    'wrongContainer' as const,
    'invalidTag' as const,
    'invalidChild' as const,
  ),
  payload: fc.constantFrom('none', 'dynamic', 'json', 'decimal', 'tuple', 'map'),
});

/** All casts/mutations live at this deliberately malformed-IR boundary. A fresh
 * public graph is cloned with identity preservation; every shrink reapplies one
 * corruption, never filters/discards a recipe or turns it back into a valid IR.
 */
const defaultSource = source;

export function mutation(recipe: Recipe): {
  root: Rel;
  path: string;
  code: string;
  offending: unknown;
} {
  // Vary unrelated, valid schema edges while preserving exactly one selected
  // corruption. Descriptor traversal must not depend on a scalar-only schema.
  const source =
    recipe.payload === undefined || recipe.payload === 'none'
      ? defaultSource
      : from(
          table(
            'validation_rows',
            {
              id: col.UInt64,
              tags: col.Array(col.String),
              payload: payloadDescriptors[recipe.payload],
            },
            { engine: 'Memory', sortingKey: [], partitionKey: [] },
          ),
        );

  let query = source.where(r => r.id.gt(BigInt(recipe.value)));
  // Mutable test-only graph, including intentionally absent/wrong fields.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = structuredClone(query.ir);

  let edge = '',
    code = 'invalid_structure';

  const project = () => structuredClone(source.map(r => ({ id: r.id })).ir);
  const aggregate = () => structuredClone(source.aggregate(() => ({ n: count() })).ir);
  const join = () => structuredClone(crossJoin({ a: source, b: source }).ir);
  // Exercise both absent edges and object/array confusion at each shape boundary.
  const missing = recipe.malformation === 'missing' ? undefined : null;
  const wrongRecord = recipe.malformation === 'wrongContainer' ? [] : missing;
  const wrongArray = recipe.malformation === 'wrongContainer' ? {} : missing;
  // Wrapper schema policy: isolate structural faults with the valid source
  // output by default; selected cases propagate node.output for semantic checks.
  let wrapperOutput = source.ir.output;
  // Node identity policy: normally resolve the reported path; a few diagnostics
  // locate a child edge but identify its owning relation instead.
  let diagnosticNodeOverride: unknown;
  // Path policy: malformed pass-through schemas fail at the outermost view,
  // rather than at the wrapped mutation's original edge.
  let reportAtOutermostRoot = false;

  const knownEvidence = (name: string, isAggregate: boolean) => ({
    catalog: { [name]: { isAggregate, deterministic: true, aliasTo: '' } },
    name,
    declaration: { origin: 'as', type: isAggregate ? col.UInt64.type : col.Bool.type },
  });

  const type = (descriptor: unknown) => {
    node = structuredClone(source.ir);
    node.output.columns.id = descriptor;
  };

  const projectStringChoice = () => {
    const choice = multiIf(
      [val(recipe.value % 2 === 0, col.Bool), String(recipe.value)],
      'fallback',
    );

    return structuredClone(source.map(() => ({ id: choice })).ir);
  };

  // Align the expression and both schema declarations to test the result type.
  const setProjectedIdType = (descriptor: unknown) => {
    node.exprs.id.type = descriptor;
    node.columns.id = descriptor;
    node.output.columns.id = descriptor;
  };

  switch (recipe.category) {
    case 'input':
      if (recipe.malformation === 'invalidChild') {
        node = structuredClone(source.arrayJoin(r => r.tags, 'tag').ir);
        const input = node.input;

        node.input = {
          id: input.id,
          kind: 'RawRel',
          output: { shape: 'deferred', reason: 'raw', declaredNames: [...input.output.order] },
          parts: [
            `SELECT ${input.output.order.map((name: string) => '`' + name + '`').join(', ')} FROM \`validation_rows\``,
          ],
          args: [],
          opaque: true,
          provenance: { origin: 'sql' },
        };

        // A known expansion result cannot make its deferred input schema safe.
        wrapperOutput = node.output;
        edge = '';
        code = 'unsupported_output';
      } else {
        // Inheriting a genuine graph marker is not constructor ownership.
        node.input =
          recipe.malformation === 'wrongContainer' ? Object.create(source.ir) : undefined;

        edge = '.input';
      }

      break;
    case 'output':
      if (recipe.malformation === 'invalidTag') {
        node.output = { shape: 'future' };
        edge = '.output.shape';
      } else if (recipe.malformation === 'invalidChild') {
        // Deferred schemas are legal on pass-through operators, but their
        // declared names still form a structural edge even before resolution.
        node.output = { shape: 'deferred', reason: 'raw', declaredNames: null };
        edge = '.output.declaredNames';
      } else {
        node.output = wrongRecord;
        edge = '.output';
      }

      break;
    case 'metadata':
      if (recipe.malformation === 'missing' && recipe.value % 2 === 1) {
        // A valid evidence object does not authorize a typed-origin call.
        // Odd values exercise typed-origin evidence; even values omit metadata.
        node.pred.fn.known = knownEvidence('gt', false);
        edge = '.pred';
        code = 'invalid_function_metadata';
      } else if (recipe.malformation === 'invalidTag' && recipe.value % 2 === 1) {
        // Executable metadata must be rejected before two filters can merge and
        // take ownership of their combined predicate.
        node = structuredClone(
          source.where(r => r.id.ge(0n)).where(r => r.id.gt(BigInt(recipe.value))).ir,
        );

        node.pred.fn.js = () => recipe.value;
        edge = '.pred';
        code = 'invalid_function_metadata';
      } else if (recipe.malformation === 'invalidChild') {
        node.pred.fn = { ...node.pred.fn, deterministic: null, argumentPolicies: [null] };
        edge = '.pred.fn.argumentPolicies[0]';
      } else {
        node.pred.fn =
          recipe.malformation === 'invalidTag' ? { ...node.pred.fn, user: {} } : wrongRecord;

        edge = '.pred.fn';
      }

      break;
    case 'args':
      if (recipe.malformation === 'invalidChild') {
        const value = BigInt(recipe.value);

        node = structuredClone(
          source.where(r => r.id.gt(value).and(cast(r.id, col.Int64).gt(value))).ir,
        );

        // Separate unresolved Params are valid; sharing one identity across
        // UInt64 and Int64 expectations must not silently reuse a wire type.
        node.pred.args[1].args[1] = node.pred.args[0].args[1];
        edge = '.pred.args[1].args[1]';
        code = 'param_incompatible';
      } else {
        node.pred.args = wrongArray;
        edge = '.pred.args';
      }

      break;
    case 'sparseArgs':
      delete node.pred.args[0];
      edge = '.pred.args[0]';
      break;
    case 'badArg':
      if (recipe.malformation === 'missing' && recipe.value % 2 === 1) {
        node = structuredClone(source.where(r => r.id.in([BigInt(recipe.value)])).ir);
        // Non-null values do not make a nullable-element IN set admissible.
        node.pred.args[1].type = col.Array(col.Nullable(col.UInt64)).type;
        edge = '.pred';
        code = 'invalid_set_operand';
      } else if (recipe.malformation === 'invalidChild') {
        // Decoded number[] operands may still have incompatible nested CH
        // descriptors. Start from a valid mixed-width numeric membership call.
        const arrays = val([[recipe.value]], col.Array(col.Array(col.UInt8)));
        const needle = val([recipe.value], col.Array(col.UInt16));
        node = structuredClone(source.map(() => ({ id: arrays.has(needle) })).ir);
        node.exprs.id.args[1].type = col.Array(col.String).type;
        wrapperOutput = node.output;
        edge = '.exprs.id';
        code = 'incompatible_operands';
      } else if (recipe.malformation === 'invalidTag') {
        const days = dateDiff(
          'day',
          val(new Date(0), col.Date),
          val(new Date(recipe.value * 86400000), col.Date),
        );

        node = structuredClone(source.map(() => ({ id: days })).ir);

        if (recipe.payload === 'none' || recipe.payload === 'tuple') {
          node.exprs.id.args[0].value = recipe.value;
        } else {
          node.exprs.id.args[0].type = col.FixedString(3).type;
        }

        wrapperOutput = node.output;
        edge = '.exprs.id';
        code = 'incompatible_operands';
      } else {
        node.pred.args[1] = null;
        edge = '.pred.args[1]';
      }

      break;
    case 'relationCycle':
      node.input = node;
      edge = '.input';
      code = 'cyclic_ir';
      break;
    case 'expressionCycle':
      node.pred.args[0] = node.pred;
      edge = '.pred.args[0]';
      code = 'cyclic_ir';
      break;
    case 'subqueryCycle':
      node = structuredClone(
        source.map(() => ({ n: scalar(source.aggregate(() => ({ n: count() }))) })).ir,
      );

      node.exprs.n.rel = node;
      edge = '.exprs.n.rel';
      code = 'cyclic_ir';
      break;
    case 'outputCycle':
      node = join();
      node.output.inputs[0][1] = node.output;
      edge = '.output.inputs[0][1]';
      code = 'cyclic_ir';
      break;

    case 'descriptorCycle': {
      const descriptor = { kind: 'Array', inner: null as unknown };
      descriptor.inner = descriptor;
      type(descriptor);
      edge = '.output.columns.id.inner';
      code = 'cyclic_ir';
      break;
    }

    case 'joinPair':
      if (recipe.malformation === 'invalidChild') {
        node = structuredClone(innerJoin({ a: source, b: source }).on(r => r.a.id.eq(r.b.id)).ir);
        const ref = node.on[0].args[0];

        // Cast is a valid scalar AST node, but is outside the bounded join-key
        // grammar. Replacing only this edge must not bypass ON validation.
        node.on[0].args[0] = {
          id: val(0).ir.id,
          kind: 'Cast',
          expr: ref,
          type: col.UInt64.type,
          to: col.UInt64.type,
        };

        wrapperOutput = node.output;
        edge = '.on[0].args[0]';
        code = 'join_condition_arity';
      } else {
        node = join();
        node.inputs[0] = recipe.malformation === 'wrongContainer' ? [] : {};
        edge = '.inputs[0]';
      }

      break;
    case 'sparsePair':
      node = join();
      delete node.inputs[0][1];
      edge = '.inputs[0][1]';
      break;
    case 'sparseInputs':
      node = join();
      delete node.inputs[0];
      edge = '.inputs[0]';
      break;
    case 'unionInput':
      node = structuredClone(unionAll(source, source).ir);

      if (recipe.malformation === 'invalidChild') {
        // Equal-width branches can still disagree on logical column paths.
        const renamed = source.map(({ id, ...rest }) => ({ renamed: id, ...rest }));
        node.inputs[1] = structuredClone(renamed.ir);
        edge = '.inputs[1].output';
        code = 'union_schema_mismatch';
        // Union diagnostics identify the union node while locating the child's
        // schema; the property checks both identities exactly.
        diagnosticNodeOverride = node;
      } else {
        node.inputs[1] = null;
        edge = '.inputs[1]';
      }

      break;
    case 'sortExpr':
      node = structuredClone(source.orderBy(r => r.id).ir);
      node.keys[0].expr = null;
      edge = '.keys[0].expr';
      break;
    case 'projectExprs':
      node = project();

      if (recipe.malformation === 'invalidChild' || recipe.malformation === 'invalidTag') {
        wrapperOutput = node.output;
        code = 'nested_projection';

        if (recipe.malformation === 'invalidChild') {
          node.exprs = {};
          edge = '';
        } else {
          node.exprs = { renamed: node.exprs.id };
          edge = '.exprs.id';
          diagnosticNodeOverride = node;
        }
      } else {
        node.exprs = wrongRecord;
        edge = '.exprs';
      }

      break;
    case 'aggregateKeys':
      node = aggregate();

      if (recipe.malformation === 'invalidChild') {
        // A new grouping key must also appear in the declared output order.
        node.keys.group = val(BigInt(recipe.value), col.UInt64).ir;
        wrapperOutput = node.output;
        edge = '';
        code = 'invalid_output';
      } else {
        node.keys = wrongRecord;
        edge = '.keys';
      }

      break;
    case 'aggregateArgs':
      node = aggregate();

      if (recipe.malformation === 'invalidTag') {
        node.aggs.n.fn.known = knownEvidence('count', true);
        edge = '.aggs.n';
        code = 'invalid_function_metadata';
        wrapperOutput = node.output;
      } else {
        node.aggs.n.args = wrongArray;
        edge = '.aggs.n.args';
      }

      break;
    case 'aggregateParams':
      node = aggregate();
      node.aggs.n.params = wrongArray;
      edge = '.aggs.n.params';
      break;
    case 'outputColumns':
      if (recipe.malformation === 'invalidTag') {
        node = aggregate();
        // Do not mutate the shared valid output descriptor: specifically make
        // the aggregate's parallel column declaration disagree with it.
        node.columns = { ...node.columns, n: col.String.type };
        wrapperOutput = node.output;
        edge = '';
        code = 'invalid_output';
      } else if (recipe.malformation === 'invalidChild') {
        node = projectStringChoice();
        // Keep the published output and Expr descriptor consistent with each
        // other, but inconsistent with multiIf's authoritative String result.
        setProjectedIdType(col.UInt64.type);
        wrapperOutput = node.output;
        edge = '.exprs.id';
        code = 'invalid_expression_type';
      } else {
        node.output.columns = wrongRecord;
        edge = '.output.columns';
      }

      break;
    case 'outputOrder':
      if (recipe.malformation === 'invalidChild') {
        node.output.order = [];
        wrapperOutput = node.output;
        reportAtOutermostRoot = true;
        edge = '';
        code = 'invalid_ir';
      } else {
        node.output.order = wrongArray;
        edge = '.output.order';
      }

      break;
    case 'outputInputs':
      node = join();

      if (recipe.malformation === 'invalidChild' || recipe.malformation === 'invalidTag') {
        if (recipe.malformation === 'invalidChild') {
          if (recipe.value % 2) {
            const fields = node.output.inputs[0][1];

            // Stale typed fields must not override a deferred schema's tag.
            node.output.inputs[0][1] = {
              ...fields,
              shape: 'deferred',
              reason: 'raw',
              declaredNames: [...fields.order],
            };
          } else node.output.inputs = [];
        } else node.output.inputs[0][0] = `a\u0000${recipe.value}`;

        wrapperOutput = node.output;
        reportAtOutermostRoot = true;
        edge = '';
        code = 'invalid_ir';
      } else {
        node.output.inputs = wrongArray;
        edge = '.output.inputs';
      }

      break;
    case 'outputFields':
      node = join();

      if (recipe.malformation === 'invalidChild') {
        // Top-level fields and nested relation aliases share one namespace.
        node.output.fields = { shape: 'flat', columns: { a: col.UInt64.type }, order: ['a'] };
        wrapperOutput = node.output;
        reportAtOutermostRoot = true;
        edge = '';
        code = 'invalid_ir';
      } else {
        node.output.fields = false;
        edge = '.output.fields';
      }

      break;
    case 'table':
      node = structuredClone(source.ir);

      if (recipe.malformation === 'invalidChild') {
        // Structurally a string, but never a valid quoted SQL identifier. The
        // emitter must reject it and normalize the boundary error to this Scan.
        node.table.name = `validation\u0000rows_${recipe.value}`;
        edge = '';
        code = 'invalid_ir';
      } else {
        node.table = wrongRecord;
        edge = '.table';
      }

      break;
    case 'tableColumns':
      node = structuredClone(source.ir);

      if (recipe.malformation === 'invalidChild') {
        // A Scan's advertised output must agree with its table declaration,
        // even when both maps individually satisfy the structural grammar.
        node.table.columns = { ...node.table.columns };

        if (recipe.value % 2) delete node.table.columns.id;
        else node.table.columns.id = col.String.type;

        edge = '';
        code = 'invalid_output';
      } else {
        node.table.columns = wrongRecord;
        edge = '.table.columns';
      }

      break;
    case 'columnPath':
      if (recipe.malformation === 'invalidChild') {
        const array = val([BigInt(recipe.value)], col.Array(col.UInt64));
        node = structuredClone(source.map(() => ({ id: array.arrayElement(1) })).ir);
        // Numeric is not sufficient for indexing: even integral Float64 values
        // must be rejected before their parameter can reach ClickHouse.
        node.exprs.id.args[1].type = col.Float64.type;
        wrapperOutput = node.output;
        edge = '.exprs.id';
        code = 'invalid_array_index';
      } else {
        node.pred.args[0].path = [null];
        edge = '.pred.args[0].path[0]';
      }

      break;
    case 'castExpr':
      if (recipe.malformation === 'invalidChild') {
        // These are structurally numeric descriptors, but semantically invalid
        // Decimal sources. Keep the cast result and all unrelated columns valid.
        const faults = [
          { precision: recipe.value + 0.5, scale: 0 },
          { precision: -recipe.value, scale: 0 },
          { precision: 77 + recipe.value, scale: 0 },
          { precision: 18, scale: recipe.value + 0.5 },
          { precision: 18, scale: -recipe.value - 1 },
          { precision: 18, scale: 19 + recipe.value },
        ];

        node = structuredClone(source.map(r => ({ ...r })).ir);

        node.exprs.id = {
          ...node.exprs.id,
          kind: 'Cast',
          expr: {
            ...val('0').ir,
            type: { kind: 'Decimal', ...faults[recipe.value % faults.length] },
          },
          to: col.UInt64.type,
        };

        edge = '.exprs.id';
        code = 'unsupported_cast_type';
      } else if (recipe.malformation === 'invalidTag') {
        const low = BigInt(recipe.value);

        node = structuredClone(
          source.where(r => cast(r.id, col.UInt64).between(low, low + 10n)).ir,
        );

        const opaque = sql`${source.row.id}`.as(col.UInt64);
        node.pred.args[0].expr = structuredClone(opaque.ir);
        edge = '.pred';
        code = 'unsupported_between_receiver';
      } else {
        node.pred.args[0] = { ...node.pred.args[0], kind: 'Cast', expr: null, to: col.UInt64.type };
        edge = '.pred.args[0].expr';
      }

      break;
    case 'castTarget':
      node.pred.args[0] = { ...node.pred.args[0], kind: 'Cast', expr: node.pred.args[0], to: null };
      edge = '.pred.args[0].to';
      code = 'unsupported_cast_type';
      break;
    case 'tupleItem':
      if (recipe.malformation === 'invalidChild') {
        const tuple = val({ key: BigInt(recipe.value) }, col.NamedTuple([['key', col.UInt64]]));
        node = structuredClone(source.map(() => ({ id: tuple.element('key') })).ir);
        node.exprs.id.args[1].value = recipe.value;
        wrapperOutput = node.output;
        edge = '.exprs.id';
        code = 'invalid_tuple_selector';
      } else {
        type({ kind: 'Tuple', items: [null] });
        edge = '.output.columns.id.items[0]';
      }

      break;
    case 'mapValue':
      type({ kind: 'Map', key: col.String.type, value: null });
      edge = '.output.columns.id.value';
      break;
    case 'variantItem':
      type({ kind: 'Variant', items: [null] });
      edge = '.output.columns.id.items[0]';
      break;
    case 'enumValue':
      type({ kind: 'Enum', bits: 8, values: [{ name: 'a', value: null }] });
      edge = '.output.columns.id.values[0].value';
      break;
    case 'aggregateTypeArg':
      type({ kind: 'AggregateFunction', fn: 'count', args: [null] });
      edge = '.output.columns.id.args[0]';
      break;
    case 'simpleAggregateInner':
      type({ kind: 'SimpleAggregateFunction', fn: 'sum', inner: null });
      edge = '.output.columns.id.inner';
      break;
    case 'rawArgs':
      if (recipe.malformation === 'invalidChild' || recipe.malformation === 'invalidTag') {
        const width = recipe.value + 1;

        const fixed = sql`toFixedString(${val('x', col.String)}, ${val(width, col.UInt32)})`.as(
          col.FixedString(width),
        );

        const expression =
          recipe.malformation === 'invalidTag' || recipe.value % 3 === 0
            ? fixed
            : recipe.value % 3 === 1
              ? sql`toDateTime(${val(0, col.Int32)})`.as(col.DateTime())
              : sql`toDateTime(${val(0, col.Int32)}, ${val('UTC', col.String)})`.as(
                  col.DateTime('UTC'),
                );

        node = structuredClone(source.map(() => ({ id: expression })).ir);

        if (recipe.malformation === 'invalidChild') {
          // Raw SQL cannot infer an undeclared interpolation type from siblings.
          node.exprs.id.args[0].type = null;
          code = 'param_untyped';
        } else {
          // Share one corrupt declared descriptor across the expression/schema.
          const descriptor =
            recipe.payload === 'dynamic' ||
            recipe.payload === 'json' ||
            recipe.payload === 'decimal' ||
            recipe.payload === 'map'
              ? payloadDescriptors[recipe.payload].type
              : { kind: 'FixedString', n: recipe.value % 2 ? -width : width + 0.5 };

          setProjectedIdType(descriptor);
          code = 'unsupported_raw_result';
        }

        wrapperOutput = node.output;
        edge = '.exprs.id';
      } else {
        node.pred = {
          ...node.pred,
          kind: 'Raw',
          opaque: true,
          resolution: 'declared',
          provenance: { origin: 'sql' },
          parts: [''],
          args: null,
        };

        edge = '.pred.args';
      }

      break;
    case 'caseBranch':
      if (recipe.malformation === 'invalidChild') {
        node = projectStringChoice();
        node.exprs.id.args[0].type = null;
        wrapperOutput = node.output;
        edge = '.exprs.id';
        code = 'invalid_predicate';
      } else {
        node.pred = {
          ...node.pred,
          kind: 'Case',
          branches: [{ when: node.pred, then: null }],
          otherwise: val(true).ir,
        };

        edge = '.pred.branches[0].then';
      }

      break;
    case 'unknownRel':
      node.kind = 'Oops';
      edge = '.kind';
      break;
    case 'unknownExpr':
      node.pred.kind = 'Oops';
      edge = '.pred.kind';
      break;
    case 'unknownType':
      type({ kind: 'Oops' });
      edge = '.output.columns.id.kind';
      break;
  }

  let root = node;

  // Build wrapper topology publicly before attaching the malformed child, so no
  // builder ever traverses the corruption; wrapper shrink always remains valid.
  for (const wrapper of recipe.wrappers) {
    query = wrapper === 'distinct' ? query.distinct() : query.limit(recipe.value);
    root = { ...query.ir, input: root, output: root.output };
    edge = '.input' + edge;
  }

  // Apply the selected wrapper schema policy. Structural cases retain a valid
  // schema to reach the selected edge; others intentionally propagate malformed
  // output so semantic diagnostics can arise at the consuming wrapper.
  let cursor = root;

  for (let i = 0; i < recipe.wrappers.length; i++) {
    cursor.output = wrapperOutput;
    cursor = cursor.input;
  }

  // A malformed pass-through output is first consumed at the outermost view.
  const path = reportAtOutermostRoot ? 'root' : 'root' + edge;

  const offending = path
    .slice(5)
    .replaceAll('[', '.')
    .replaceAll(']', '')
    .split('.')
    .filter(Boolean)
    .reduce((o, key) => o?.[key], root);

  return { root: root as Rel, path, code, offending: diagnosticNodeOverride ?? offending };
}
