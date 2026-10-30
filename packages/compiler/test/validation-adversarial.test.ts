import { expect, it } from 'vitest';
import { col, type CHType, type Rel } from '@typedhouse/core';
import { compile, emitNaive, ValidationError } from '../src/index.js';
import { validateStructure } from '../src/validate-structure.js';
import { mutation, source } from './validation-arbitrary.js';

it.each([['preflight', validateStructure], ['planned', compile], ['naive', emitNaive]] as const)('validates non-enumerable table descriptors before recursive printing: %s', (_name, validate) => {
  const descriptor: { kind: 'Array'; inner: unknown } = { kind: 'Array', inner: null };
  descriptor.inner = descriptor;
  const columns = Object.defineProperty({ tags: col.Array(col.String).type }, 'id', { value: descriptor });
  if (source.ir.kind !== 'Scan') throw new Error('fixture');
  const root = { ...source.ir, table: { ...source.ir.table, columns } } as unknown as Rel;
  let error: unknown;
  try { validate(root); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(ValidationError);
  expect(error).toMatchObject({ code: 'cyclic_ir', path: 'root.table.columns.id.inner' });
  expect((error as ValidationError).node).toBe(descriptor);
});

it('keeps supported non-enumerable table descriptor records valid', () => {
  if (source.ir.kind !== 'Scan') throw new Error('fixture');
  const columns = Object.defineProperty({ tags: col.Array(col.String).type }, 'id', { value: col.UInt64.type });
  const root = { ...source.ir, table: { ...source.ir.table, columns } } as unknown as Rel;
  for (const emit of [compile, emitNaive]) {
    expect(emit(root).columns).toEqual(source.ir.columns);
  }
});

it('checks hidden expression record edges while retaining shared descriptor identity', () => {
  const project = structuredClone(source.map(r => ({ id: r.id })).ir);
  if (project.kind !== 'Project') throw new Error('fixture');
  const expr = project.exprs.id!;
  // The enumerable spare preserves the semantic count check, while emission
  // reads the non-enumerable expression by output name.
  const exprs = Object.defineProperty({ spare: expr }, 'id', { value: expr });
  const root = { ...project, exprs };
  expect(() => validateStructure(root)).not.toThrow();
  expect(Object.getOwnPropertyDescriptor(exprs, 'id')!.value).toBe(exprs.spare);
  for (const emit of [compile, emitNaive]) expect(emit(root).columns).toEqual(project.columns);
  const cycle: CHType = { kind: 'Array', inner: col.UInt64.type };
  cycle.inner = cycle;
  const cyclic = { ...expr, type: cycle };
  const broken = { ...project, exprs: Object.defineProperty({ spare: expr }, 'id', { value: cyclic }) } as Rel;
  for (const validate of [validateStructure, compile, emitNaive]) {
    let error: unknown;
    try { validate(broken); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ code: 'cyclic_ir', path: 'root.exprs.id.type.inner' });
    expect((error as ValidationError).node).toBe(cycle);
  }
});

it('checks hidden output descriptors selected by order and keeps the acyclic shape supported', () => {
  const columns = Object.defineProperty({ spare: col.UInt64.type, tags: col.Array(col.String).type }, 'id', { value: col.UInt64.type, configurable: true });
  const root = { ...source.ir, output: { ...source.ir.output, columns } } as Rel;
  for (const emit of [compile, emitNaive]) expect(emit(root).columns).toEqual({ id: col.UInt64.type, tags: col.Array(col.String).type });
  const cycle: CHType = { kind: 'Array', inner: col.UInt64.type };
  cycle.inner = cycle;
  Object.defineProperty(columns, 'id', { value: cycle });
  for (const validate of [validateStructure, compile, emitNaive]) {
    let error: unknown;
    try { validate(root); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ code: 'cyclic_ir', path: 'root.output.columns.id.inner' });
    expect((error as ValidationError).node).toBe(cycle);
  }
});

it('accepts null-prototype records and dense non-enumerable expression array entries', () => {
  const root = structuredClone(source.where(r => r.id.gt(1n)).ir);
  if (root.kind !== 'Filter' || root.pred.kind !== 'Call') throw new Error('fixture');
  const expected = [compile(root), emitNaive(root)];
  if (root.output.shape !== 'flat') throw new Error('fixture');
  Object.setPrototypeOf(root.output.columns, null);
  for (let i = 0; i < root.pred.args.length; i++) Object.defineProperty(root.pred.args, i, { enumerable: false });
  expect(compile(root)).toEqual(expected[0]);
  expect(emitNaive(root)).toEqual(expected[1]);
});

it.each([
  ['input', 'invalid_structure', 'root.input.input'],
  ['expressionCycle', 'cyclic_ir', 'root.input.pred.args[0]'],
  ['subqueryCycle', 'cyclic_ir', 'root.input.exprs.n.rel'],
  ['outputCycle', 'cyclic_ir', 'root.input.output.inputs[0][1]'],
  ['descriptorCycle', 'cyclic_ir', 'root.input.output.columns.id.inner'],
] as const)('independently pins generated mutation diagnostics: %s', (category, code, path) => {
  // Do not reuse the mutation factory's expected code/path or path-derived node.
  const { root } = mutation({ category, wrappers: ['limit'], value: 17 });
  for (const emit of [compile, emitNaive]) {
    expect(() => emit(root)).toThrowError(expect.objectContaining({ code, path }));
  }
});

it('reports a shared expression only when its later use closes an active cycle', () => {
  const root = structuredClone(source.where(r => r.id.gt(1n)).ir);
  if (root.kind !== 'Filter' || root.pred.kind !== 'Call') throw new Error('fixture');
  const args = [...root.pred.args, root.pred];
  Object.assign(root.pred, { args });
  for (const emit of [compile, emitNaive]) {
    let error: unknown;
    try { emit(root); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ code: 'cyclic_ir', path: 'root.pred.args[2]' });
    expect((error as ValidationError).node).toBe(root.pred);
  }
});
