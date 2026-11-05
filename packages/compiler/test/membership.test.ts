import { expect, it } from 'vitest';
import {
  Expr,
  col,
  table,
  from,
  val,
  countIf,
  scalar,
  count,
  exprNode,
  relNode,
  flatOutput,
  type ExprNode,
  type Query,
} from '@typedhouse/core';
import { compile, emitNaive } from '../src/index.js';

const q = from(
  table(
    'membership',
    { id: col.String, n: col.Nullable(col.Int64) },
    { engine: 'Memory', sortingKey: [], partitionKey: [] },
  ),
);

function fields<T extends { readonly id: unknown }>(n: T): Omit<T, 'id'> {
  const { id: _id, ...f } = n;
  return f;
}

function project(e: ExprNode) {
  const output = flatOutput([['result', e.type!]]);

  return relNode({
    kind: 'Project',
    input: q.ir,
    exprs: { result: e },
    output,
    columns: output.columns,
  });
}

it('supports nullable UUID subqueries without coercing String sets', () => {
  const ids = from(
    table(
      'ids',
      { id: col.UUID, maybe: col.Nullable(col.UUID) },
      { engine: 'Memory', sortingKey: [], partitionKey: [] },
    ),
  );

  for (const emit of [compile, emitNaive]) {
    const plan = emit(
      ids.map(r => ({
        member: r.id.in(ids.map(r => r.maybe)),
        set: r.maybe.notIn(ids.map(r => r.id).distinct()),
      })).ir,
    );

    expect(plan.columns).toEqual({ member: col.Bool.type, set: col.Nullable(col.Bool).type });

    // @ts-expect-error UUID membership rejects unbranded String sets statically too.
    expect(() => emit(ids.where(r => r.id.in(q.map(r => r.id))).ir)).toThrow(
      'incompatible_operands',
    );

    // @ts-expect-error A plain string is not a UUID.
    expect(() => emit(ids.where(r => r.id.in(['not-a-uuid'])).ir)).toThrow('param_incompatible');
  }
});

it('adversarial Date lists reject hostile payloads and forged temporal array evidence in both emitters', () => {
  const dates = from(
    table('dates', { day: col.Date }, { engine: 'Memory', sortingKey: [], partitionKey: [] }),
  );

  const member = dates.row.day.in([]).ir;
  if (member.kind !== 'Call') throw new Error('fixture');

  const projectDate = (operand: ExprNode) => {
    const output = flatOutput([['result', col.Bool.type]]);

    return relNode({
      kind: 'Project',
      input: dates.ir,
      exprs: { result: exprNode({ ...fields(member), args: [member.args[0]!, operand] }) },
      output,
      columns: output.columns,
    });
  };

  for (const emitter of [compile, emitNaive]) {
    for (const value of [
      ["2024-02-29') OR 1 --"],
      [0],
      [null],
      [[new Date('2024-02-29')]],
      [new Date('1969-12-31T23:59:59.999Z')],
      [new Date('2149-06-07T00:00:00Z')],
    ]) {
      expect(() => emitter(projectDate(exprNode({ kind: 'Param', type: null, value })))).toThrow(
        /param_incompatible.*root.exprs.result.args\[1\]/,
      );
    }

    for (const type of [
      col.Array(col.Date32),
      col.Array(col.DateTime()),
      col.Array(col.DateTime64(3)),
      col.Array(col.Nullable(col.Date)),
    ]) {
      expect(() =>
        emitter(
          projectDate(
            exprNode({ kind: 'Param', type: type.type, value: [new Date('2024-02-29')] }),
          ),
        ),
      ).toThrow(/(unsupported_membership_type|invalid_set_operand).*root.exprs.result/);
    }
  }
});

it('bounds Date membership descriptors, transport, settings and parameter identity', () => {
  const dates = from(
    table(
      'dates',
      { day: col.Date, maybe: col.Nullable(col.Date) },
      { engine: 'Memory', sortingKey: [], partitionKey: [] },
    ),
  );

  const days = [
    new Date('1970-01-01T23:00:00Z'),
    new Date('2024-02-29T12:00:00Z'),
    new Date('2149-06-06'),
  ];

  const shared = dates.row.day.in(days);

  const query = dates.map(r => ({
    shared,
    again: shared,
    equal: r.day.in(days),
    nullable: r.maybe.notIn(dates.map(r => r.day)),
  }));

  const snapshot = JSON.stringify(query.ir);

  for (const emitter of [emitNaive, compile]) {
    const plan = emitter(query.ir);
    expect(plan.sql).toContain('SETTINGS transform_null_in = 0');
    expect(plan.sql.match(/\{p0:Array\(Date\)\}/g)).toHaveLength(2);

    expect(plan.params).toEqual({
      p0: "['1970-01-01','2024-02-29','2149-06-06']",
      p1: "['1970-01-01','2024-02-29','2149-06-06']",
    });

    expect(JSON.stringify(query.ir)).toBe(snapshot);

    for (const bad of [new Date(NaN), new Date('1969-12-31'), new Date('2149-06-07')]) {
      expect(() => emitter(dates.map(r => r.day.in([bad])).ir)).toThrow(
        /param_incompatible.*root.exprs.day.args\[1\]/,
      );
    }

    expect(emitter(q.map(r => r.id.in([])).ir).sql).not.toContain('transform_null_in');
  }

  const member = dates.row.day.in([]).ir;
  if (member.kind !== 'Call') throw new Error('fixture');

  for (const descriptor of [
    col.Date32,
    col.DateTime(),
    col.DateTime64(3),
    col.DateTime64(9),
    col.LowCardinality(col.Date),
    col.String,
    col.UInt16,
  ]) {
    const bad = from(
      table(
        'other_dates',
        { day: descriptor },
        { engine: 'Memory', sortingKey: [], partitionKey: [] },
      ),
    );

    const operand = exprNode({ kind: 'Subquery', rel: bad.ir, usage: 'in', type: descriptor.type });
    const call = exprNode({ ...fields(member), args: [dates.row.day.ir, operand] });
    const output = flatOutput([['result', col.Bool.type]]);

    const rel = relNode({
      kind: 'Project',
      input: dates.ir,
      exprs: { result: call },
      output,
      columns: output.columns,
    });

    expect(() => emitNaive(rel)).toThrow(
      /(unsupported_membership_type|incompatible_operands).*root.exprs.result/,
    );
  }
});

it('rejects forged Date membership schemas, usage, results, metadata and captured modes', () => {
  const dates = from(
    table('dates', { day: col.Date }, { engine: 'Memory', sortingKey: [], partitionKey: [] }),
  );

  const member = dates.row.day.in(dates).ir;
  if (member.kind !== 'Call' || member.args[1]?.kind !== 'Subquery') throw new Error('fixture');
  const set = member.args[1];

  const emit = (node: ExprNode) => {
    const output = flatOutput([['result', node.type!]]);

    return emitNaive(
      relNode({
        kind: 'Project',
        input: dates.ir,
        exprs: { result: node },
        output,
        columns: output.columns,
      }),
    );
  };

  for (const [node, error] of [
    [exprNode({ ...fields(member), type: col.Nullable(col.Bool).type }), 'invalid_expression_type'],
    [
      exprNode({ ...fields(member), fn: { ...member.fn, deterministic: false } }),
      'invalid_function_metadata',
    ],
    [
      exprNode({
        ...fields(member),
        args: [member.args[0]!, exprNode({ ...fields(set), usage: 'scalar' })],
      }),
      'invalid_subquery_usage',
    ],
    [
      exprNode({
        ...fields(member),
        args: [member.args[0]!, exprNode({ ...fields(set), type: col.Date32.type })],
      }),
      'invalid_expression_type',
    ],
  ] as const)
    expect(() => emit(node)).toThrow(`${error} at root.exprs.result`);

  const selected = dates.map(r => r.day);

  expect(() =>
    emitNaive(
      dates.where(r => r.day.in(selected.where(() => dates.row.day.eq(new Date('2024-02-29'))))).ir,
    ),
  ).toThrow(/unbound_column.*\.rel.pred/);

  dates.aggregate(g => {
    expect(() => emit(g.day.in(dates).ir)).toThrow('invalid_expression_mode');
    return countIf(g.day.in(dates));
  });

  if (dates.ir.kind !== 'Scan') throw new Error('fixture');
  const output = flatOutput([['day', col.Date32.type]]);
  const forged = relNode({ ...fields(dates.ir), output, columns: output.columns });
  const fakeSet = exprNode({ ...fields(set), rel: forged });

  expect(() => emit(exprNode({ ...fields(member), args: [member.args[0]!, fakeSet] }))).toThrow(
    /unsupported_membership_type.*root.exprs.result/,
  );
});

it('adversarial validation rejects nested captures and non-set positions without allocating parameters', () => {
  const inner = q.map(r => r.id);
  const captured = inner.map(() => ({ id: q.row.id }));

  expect(() => emitNaive(q.map(r => r.id.in(captured).not()).ir)).toThrow(
    /unbound_column.*args\[0\].args\[1\].rel.exprs.id/,
  );

  const member = q.row.id.in(inner).ir;
  if (member.kind !== 'Call') throw new Error('fixture');
  const set = member.args[1]!;
  const equality = q.row.id.eq('x').ir;
  if (equality.kind !== 'Call') throw new Error('fixture');

  expect(() =>
    emitNaive(project(exprNode({ ...fields(equality), args: [q.row.id.ir, set] }))),
  ).toThrow('invalid_subquery_usage');

  const boolSet = q.map(r => r.id.in(inner));
  expect(() => emitNaive(q.map(r => r.id.eq('x').in(boolSet)).ir)).not.toThrow();

  const wrong = exprNode({
    ...fields(member),
    args: [
      q.row.id.ir,
      exprNode({ kind: 'Param', value: ['x'], type: col.Array(col.Nullable(col.String)).type }),
    ],
  });

  expect(() => emitNaive(project(wrong))).toThrow('invalid_set_operand');

  q.aggregate(g => {
    const capturedGrouped = inner.map(() => ({ id: new Expr<string, 'id'>(g.id.ir, 'id', 'row') }));

    expect(() => emitNaive(q.map(r => r.id.in(capturedGrouped)).ir)).toThrow(
      'invalid_expression_mode',
    );

    return countIf(g.id.in(inner));
  });
});

it('parameterizes empty/duplicate arrays and independently scoped sets with shared/equal Params', () => {
  const p = val("hostile'`{p8:String}", col.String);

  const inner = q
    .where(r => r.id.eq(p))
    .map(r => r.id)
    .distinct()
    .orderBy(r => r.id)
    .limit(2, 1);

  const result = q.map(r => ({
    a: r.id.in(inner),
    b: r.n.notIn([]),
    p,
    equal: val("hostile'`{p8:String}", col.String),
  }));

  const before = JSON.stringify(result.ir);
  const plan = emitNaive(result.ir);
  expect(plan.sql).toContain('in(');
  expect(plan.sql).toContain('LIMIT 2 OFFSET 1');
  expect(plan.sql).not.toContain('LIMIT 1');
  expect(plan.params).toEqual({ p0: "hostile'`{p8:String}", p1: '[]', p2: "hostile'`{p8:String}" });
  expect(plan.sql.match(/\{p0:String\}/g)).toHaveLength(2);
  expect(JSON.stringify(result.ir)).toBe(before);
  expect(emitNaive(q.aggregate(g => countIf(g.id.in(inner))).ir).sql).toContain('countIf(in(');
  expect(emitNaive(q.map(r => r.n.in([2n, 2n])).ir).params).toEqual({ p0: '[2,2]' });
});

it('rejects cycles, forged set schemas, unsupported descriptors and grouped receiver captures', () => {
  const inner = q.map(r => r.id).ir;
  if (inner.kind !== 'Project') throw new Error('fixture');
  const member = q.row.id.in(q.map(r => r.id)).ir;
  if (member.kind !== 'Call') throw new Error('fixture');
  const set = member.args[1]!;
  if (set.kind !== 'Subquery') throw new Error('fixture');
  const output = flatOutput([['id', col.Int64.type]]);
  const forged = relNode({ ...fields(inner), output, columns: output.columns });

  const wrong = exprNode({
    ...fields(member),
    args: [q.row.n.ir, exprNode({ ...fields(set), rel: forged, type: col.Int64.type })],
    type: col.Nullable(col.Bool).type,
  });

  expect(() => emitNaive(project(wrong))).toThrow(
    'nested_projection at root.exprs.result.args[1].rel.exprs.id',
  );

  const cyclic = { ...inner };
  const cycleSet = { ...set, rel: cyclic, type: col.Bool.type };
  const cycleCall = { ...member, args: [q.row.id.ir, cycleSet] };
  // Keep valid local descriptors so traversal, not a shape mismatch, finds the cycle.
  const cyclicMember = { ...cycleCall, args: [q.row.id.eq('x').ir, cycleSet] };
  cyclic.exprs = { id: cyclicMember };
  cyclic.output = flatOutput([['id', col.Bool.type]]);
  cyclic.columns = cyclic.output.columns;
  expect(() => emitNaive(cyclic)).toThrow('cyclic_ir');

  const unsupported = from(
    table(
      'unsupported',
      { date: col.DateTime64(9) },
      { engine: 'Memory', sortingKey: [], partitionKey: [] },
    ),
  );

  expect(() =>
    emitNaive((unsupported as unknown as Query<{ date: string }>).map(r => r.date.in(['x'])).ir),
  ).toThrow('unsupported_membership_type');

  q.aggregate(g => {
    expect(() => emitNaive(project(g.id.in(['x']).ir))).toThrow('invalid_expression_mode');
    return countIf(g.id.in(['x']));
  });
});

it('accepts LowCardinality receivers and sets, binding lists to the inner type and keeping nullability', () => {
  const lc = from(
    table(
      'lc',
      {
        kind: col.LowCardinality(col.String),
        maybe: col.LowCardinality(col.Nullable(col.String)),
        plain: col.String,
        count: col.LowCardinality(col.UInt32),
      },
      { engine: 'Memory', sortingKey: [], partitionKey: [] },
    ),
  );

  for (const emitter of [emitNaive, compile]) {
    const list = emitter(lc.where(r => r.kind.in(['dog', 'cat'])).ir);
    expect(list.sql).toContain('{p0:Array(String)}');
    expect(list.params).toEqual({ p0: "['dog','cat']" });

    expect(
      emitter(lc.map(r => ({ a: r.kind.notIn([]), b: r.count.in([1]), c: r.maybe.in(['x']) })).ir)
        .sql,
    ).toContain('notIn(');

    const sets = lc.map(r => ({
      a: r.plain.in(lc.map(s => s.kind)),
      b: r.kind.in(lc.map(s => s.plain)),
      c: r.kind.in(lc.map(s => s.maybe)),
    }));

    expect(emitter(sets.ir).sql).toContain('in(');
  }

  expect(lc.row.kind.in([]).ir.type).toEqual(col.Bool.type);
  expect(lc.row.maybe.in([]).ir.type).toEqual(col.Nullable(col.Bool).type);

  // A value from another family stays rejected through the wrapper.
  expect(() =>
    emitNaive(
      lc.map(r => ({ bad: (r.count as unknown as typeof r.kind).in(lc.map(s => s.plain)) })).ir,
    ),
  ).toThrow(/incompatible_operands/);

  const stale = lc.row.maybe.in([]).ir;
  if (stale.kind !== 'Call') throw new Error('fixture');
  const output = flatOutput([['result', col.Bool.type]]);

  expect(() =>
    emitNaive(
      relNode({
        kind: 'Project',
        input: lc.ir,
        exprs: { result: exprNode({ ...fields(stale), type: col.Bool.type }) },
        output,
        columns: output.columns,
      }),
    ),
  ).toThrow(/invalid_expression_type/);

  for (const descriptor of [
    col.LowCardinality(col.Date),
    col.LowCardinality(col.Enum8({ a: 1 })),
    col.DateTime64(9),
    col.Nullable(col.DateTime64(6)),
  ]) {
    const bad = from(
      table(
        'bad_lc',
        { value: descriptor },
        { engine: 'Memory', sortingKey: [], partitionKey: [] },
      ),
    ) as unknown as Query<{ value: string }>;

    expect(() => emitNaive(bad.map(r => ({ result: r.value.in(['x']) })).ir)).toThrow(
      /unsupported_membership_type/,
    );
  }
});

it('binds FixedString, Enum and LowCardinality(UUID) lists to their own descriptors and checks set families', () => {
  const hostile = col.Enum8({ "o'x": 1, 'y\\z': 2 });
  const u = '123e4567-e89b-12d3-a456-426614174000' as never;

  const s = from(
    table(
      'strings',
      {
        fixed: col.FixedString(3),
        other: col.FixedString(4),
        en: col.Enum8({ a: 1, b: 2 }),
        en16: col.Enum16({ a: 1, b: 2 }),
        hostile,
        text: col.String,
        lcFixed: col.LowCardinality(col.FixedString(3)),
        maybeFixed: col.Nullable(col.FixedString(3)),
        maybeEn: col.Nullable(col.Enum8({ a: 1, b: 2 })),
        lcUuid: col.LowCardinality(col.UUID),
      },
      { engine: 'Memory', sortingKey: [], partitionKey: [] },
    ),
  );

  for (const emitter of [emitNaive, compile]) {
    expect(emitter(s.where(r => r.fixed.in(['abc'])).ir).sql).toContain(
      '{p0:Array(FixedString(3))}',
    );

    expect(emitter(s.where(r => r.lcFixed.in(['abc'])).ir).sql).toContain(
      '{p0:Array(FixedString(3))}',
    );

    expect(emitter(s.where(r => r.lcUuid.in([u])).ir).sql).toContain('{p0:Array(UUID)}');
    const en = emitter(s.where(r => r.en.in(['a'])).ir);
    expect(en.sql).toContain("{p0:Array(Enum8('a' = 1, 'b' = 2))}");
    expect(en.params).toEqual({ p0: "['a']" });

    expect(emitter(s.where(r => r.hostile.in(["o'x", 'y\\z'])).ir).params).toEqual({
      p0: "['o\\'x','y\\\\z']",
    });

    // Compatible server sets: FixedString with String and other widths, and any Enum with any Enum.
    expect(() =>
      emitter(
        s.map(r => ({
          a: r.fixed.in(s.map(x => x.text)),
          b: r.text.in(s.map(x => x.fixed)),
          c: r.fixed.in(s.map(x => x.other)),
          d: r.en.in(s.map(x => x.en16)),
          e: r.maybeEn.in(s.map(x => x.en)),
        })).ir,
      ),
    ).not.toThrow();
  }

  expect(s.row.fixed.in([]).ir.type).toEqual(col.Bool.type);
  expect(s.row.maybeFixed.in([]).ir.type).toEqual(col.Nullable(col.Bool).type);
  expect(s.row.maybeEn.in([]).ir.type).toEqual(col.Nullable(col.Bool).type);
  // Enum names stay validated before reaching the server.
  expect(() => emitNaive(s.where(r => r.en.in(['zzz' as 'a'])).ir)).toThrow(/param_incompatible/);
  // The server rejects these mixes, or never matches them, so they fail at compile time.
  const loose = s as unknown as Query<{ text: string; en: string; fixed: string; other: string }>;

  expect(() => emitNaive(loose.map(r => ({ x: r.text.in(loose.map(x => x.en)) })).ir)).toThrow(
    /incompatible_operands/,
  );

  expect(() => emitNaive(loose.map(r => ({ x: r.en.in(loose.map(x => x.text)) })).ir)).toThrow(
    /incompatible_operands/,
  );

  expect(() => emitNaive(loose.map(r => ({ x: r.fixed.in(loose.map(x => x.en)) })).ir)).toThrow(
    /incompatible_operands/,
  );
});

it('rejects standalone set usage, scalar-in-set position, bad shape/type/metadata and inner scope', () => {
  const member = q.row.id.in(q.map(r => r.id)).ir;
  if (member.kind !== 'Call') throw new Error('fixture');
  const set = member.args[1]!;
  if (set.kind !== 'Subquery') throw new Error('fixture');
  expect(() => emitNaive(project(set))).toThrow('invalid_subquery_usage');

  expect(() =>
    emitNaive(
      project(
        exprNode({
          ...fields(member),
          args: [member.args[0]!, scalar(q.aggregate(() => count())).ir],
        }),
      ),
    ),
  ).toThrow('invalid_subquery_usage');

  expect(() =>
    emitNaive(
      project(
        exprNode({
          ...fields(member),
          args: [member.args[0]!, exprNode({ ...fields(set), rel: q.ir })],
        }),
      ),
    ),
  ).toThrow('set_column_count');

  expect(() =>
    emitNaive(
      project(
        exprNode({
          ...fields(member),
          args: [member.args[0]!, exprNode({ ...fields(set), type: col.Int64.type })],
        }),
      ),
    ),
  ).toThrow('invalid_expression_type');

  expect(() =>
    emitNaive(project(exprNode({ ...fields(member), fn: { ...member.fn, argumentPolicies: [] } }))),
  ).toThrow('invalid_function_metadata');

  expect(() =>
    emitNaive(
      project(
        exprNode({
          ...fields(member),
          args: [member.args[0]!, exprNode({ kind: 'Param', value: [null], type: null })],
        }),
      ),
    ),
  ).toThrow('param_incompatible');

  const other = q.map(r => r.id);
  const captured = other.where(() => q.row.id.eq('x'));
  expect(() => emitNaive(q.map(r => r.id.in(captured)).ir)).toThrow(/unbound_column.*\.rel.pred/);
  const numeric = q.row.n.in([1n]).ir;
  if (numeric.kind !== 'Call') throw new Error('fixture');

  expect(() =>
    emitNaive(project(exprNode({ ...fields(member), args: [member.args[0]!, numeric.args[1]!] }))),
  ).toThrow('param_incompatible');
});
