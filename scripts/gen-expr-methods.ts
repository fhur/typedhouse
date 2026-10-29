import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { methodCatalog, type Definition } from '../packages/core/src/catalog/index.js';

import { orderingCatalog } from '../packages/core/src/catalog/ordering.js';

const imports = `import type { Expr, Constant, ExprOperand, ConstantOperand } from './expr.js';\nimport type { Mode, Decimal } from './types.js';\n`;
const helpers = `import type { SetQuery, DateSetQuery, DateMembershipDescriptor } from './subquery.js';
import type { BetweenReceiver, ExpReceiver, ExpResult, WeekReceiver, WeekResult, IfNullResult, FallbackDescriptor, StructuralReceiver, StructuralResult, ArrayElementResult, ElementKeys, ElementResult } from './catalog/descriptor-types.js';
type NullResult<T, R> = null extends T ? R | null : R;
type NumericResult<T> = T extends bigint ? bigint : T extends Decimal ? Decimal : number | bigint;
type DivideResult<T> = T extends Decimal ? Decimal : number;
type ArithmeticOperand<T> = NonNullable<T> extends Decimal ? Decimal : NonNullable<T>;
// Bounded numeric tuples mirror Decimal storage/scale resolution, not decoded strings.
type Units<N extends number, A extends unknown[] = []> = number extends N ? unknown[] : A['length'] extends N ? A : Units<N, [...A, unknown]>;
type Larger<A extends number, B extends number> = number extends A | B ? number : A extends A ? B extends B ? Units<A> extends [...Units<B>, ...unknown[]] ? A : B : never : never;
type Added<A extends number, B extends number> = number extends A | B ? number : A extends A ? B extends B ? [...Units<A>, ...Units<B>]['length'] : never : never;
type Storage<P extends number> = number extends P ? 9 | 18 | 38 | 76 : P extends P ? Units<9> extends [...Units<P>, ...unknown[]] ? 9 : Units<18> extends [...Units<P>, ...unknown[]] ? 18 : Units<38> extends [...Units<P>, ...unknown[]] ? 38 : 76 : never;
type DecimalPrecision<D> = Unwrap<D> extends { kind: 'Decimal'; precision: infer P extends number } ? P : 0;
type DecimalScale<D> = Unwrap<D> extends { kind: 'Decimal'; scale: infer S extends number } ? S : 0;
type DecimalPromoted<A, B, Op> = [Unwrap<A> | Unwrap<B>] extends [{ kind: 'Decimal' | 'scalar' }] ? [Extract<Unwrap<A> | Unwrap<B>, { kind: 'Decimal' }>] extends [never] ? never :
  { readonly kind: 'Decimal'; readonly precision: Storage<Larger<DecimalPrecision<A>, DecimalPrecision<B>>>;
    readonly scale: Op extends 'multiply' ? Added<DecimalScale<A>, DecimalScale<B>> : Op extends 'divide' ? DecimalScale<A> : Larger<DecimalScale<A>, DecimalScale<B>> } : never;
type Operand<T, M extends Mode> = T | Expr<T, string, M> | Constant<T>;
type Unwrap<D> = [D] extends [{ kind: 'Nullable' | 'LowCardinality'; inner: infer I }] ? Unwrap<I> : D;
type ScalarName<D> = Unwrap<D> extends { kind: 'scalar'; name: infer S extends string } ? S : never;
type Width<S> = S extends \`\${'UInt' | 'Int'}\${infer W extends number}\` ? W : never;
type Grown<W> = 256 extends W ? 256 : 128 extends W ? 128 : 64 extends W ? 64 : 32 extends W ? 64 : 16 extends W ? 32 : 16;
type Promoted<A, B, Op> = [ScalarName<A>] extends [never] ? never : [ScalarName<B>] extends [never] ? never :
  Op extends 'divide' ? 'Float64' : Extract<ScalarName<A> | ScalarName<B>, \`Float\${number}\`> extends never ?
  \`\${Op extends 'minus' ? 'Int' : Extract<ScalarName<A> | ScalarName<B>, \`Int\${number}\`> extends never ? 'UInt' : 'Int'}\${Grown<Width<ScalarName<A> | ScalarName<B>>>}\` : 'Float64';
type NumericType<S> = S extends 'Float64' | 'UInt16' | 'Int16' | 'UInt32' | 'Int32' ? number : bigint;
type ArithmeticResult<T, N extends string, M extends Mode, D, U, B, Op, S = Promoted<D, B, Op>> =
  [DecimalPromoted<D, B, Op>] extends [never] ?
  [S] extends [never] ? Expr<NullResult<T | U, Op extends 'divide' ? DivideResult<NonNullable<T>> : NumericResult<NonNullable<T>>>, N, M> :
  Expr<NullResult<T | U, NumericType<S>>, N, M> & { readonly ir: Expr<T, N, M>['ir'] & { readonly type: null extends T | U ? { readonly kind: 'Nullable'; readonly inner: { readonly kind: 'scalar'; readonly name: S } } : { readonly kind: 'scalar'; readonly name: S } } } :
  DecimalPromoted<D, B, Op> extends { precision: infer P extends number; scale: infer Scale extends number } ?
  Expr<NullResult<T | U, Decimal<P, Scale>>, N, M> & { readonly ir: Expr<T, N, M>['ir'] & { readonly type: null extends T | U ? { readonly kind: 'Nullable'; readonly inner: DecimalPromoted<D, B, Op> } : DecimalPromoted<D, B, Op> } } : never;
`;
function signature(definition: Definition): string {
  const { name, surface } = definition;
  const receiver = (allowed: string) => `this: Expr<${allowed} | null, string, M>`;
  const argument = 'other: Operand<U, NoInfer<M>>';
  switch (surface) {
    case 'exp': return `${name}<D, V extends number | bigint | null>(this: Expr<V, N, M> & { readonly ir: { readonly type: D } } & ExpReceiver<D>): ExpResult<V, N, M>;`;
    case 'week': return `${name}<D, V extends Date | null>(this: Expr<V, N, M> & { readonly ir: { readonly type: D } } & WeekReceiver<D>): WeekResult<V, N, M>;`;
    case 'length': case 'empty': return `${name}<D, V extends string | readonly unknown[] | null>(this: Expr<V, N, M> & { readonly ir: { readonly type: D } } & StructuralReceiver<D, 'either'>): StructuralResult<V, N, M, '${surface === 'length' ? 'UInt64' : 'Bool'}'>;`;
    // Keep primitives separate from descriptor-checked expressions: a broad Operand
    // fallback would let unsupported decoded strings bypass the byte-string check.
    case 'startsWith': return `${name}<D, B, V extends string | null, U extends string | null>(this: Expr<V, N, M> & { readonly ir: { readonly type: D } } & StructuralReceiver<D, 'string'>, other: U | ((Expr<U, string, NoInfer<M>> | Constant<U>) & { readonly ir: { readonly type: B } } & StructuralReceiver<B, 'string'>)): StructuralResult<V | U, N, M, 'Bool'>;`;
    case 'has': case 'hasAny': return `${name}<D, V extends readonly unknown[]>(this: Expr<V, N, M> & { readonly ir: { readonly type: D } } & StructuralReceiver<D, 'array'>, other: Operand<${surface === 'has' ? 'NoInfer<V[number]>' : 'NoInfer<V>'}, NoInfer<M>>): StructuralResult<never, N, M, 'Bool'>;`;
    case 'arrayElement': return `${name}<D, V extends readonly unknown[]>(this: Expr<V, N, M> & { readonly ir: { readonly type: D } } & StructuralReceiver<D, 'array'>, index: Operand<number | bigint, NoInfer<M>>): ${definition.tsReturns?.replace(/\bT\b/g, 'V')};`;
    case 'element': return `${name}<D, V, const K extends ElementKeys<D>>(this: Expr<V, N, M> & { readonly ir: { readonly type: D } }, key: K & (string extends K ? never : unknown)): ${definition.tsReturns};`;
    case 'membership': return `${name}(this: Expr<Date | null, N, M> & { readonly ir: { readonly type: DateMembershipDescriptor } }, values: readonly Date[]): Expr<NullResult<T, boolean>, N, M>;\n  ${name}<R>(this: Expr<Date | null, N, M> & { readonly ir: { readonly type: DateMembershipDescriptor } }, query: DateSetQuery<R>): Expr<NullResult<T, boolean>, N, M>;\n  ${name}(${receiver('string | number | bigint | boolean')}, values: readonly NoInfer<NonNullable<T>>[]): Expr<NullResult<T, boolean>, N, M>;\n  ${name}<R>(${receiver('string | number | bigint | boolean')}, query: SetQuery<R, NoInfer<T>>): Expr<NullResult<T, boolean>, N, M>;`;
    case 'between': return `${name}<D, L, H, U extends NonNullable<T> | null, V extends NonNullable<T> | null>(this: ExprOperand<string | number | bigint | Date | null, string, M> & { readonly ir: { readonly type: D } } & BetweenReceiver<D>, lower: U | ((ExprOperand<U, string, NoInfer<M>> | ConstantOperand<U>) & { readonly ir: { readonly type: L } } & BetweenReceiver<L>), upper: V | ((ExprOperand<V, string, NoInfer<M>> | ConstantOperand<V>) & { readonly ir: { readonly type: H } } & BetweenReceiver<H>)): Expr<NullResult<T | U | V, boolean>, N, M>;`;
    case 'comparison': return `${name}<U extends NonNullable<T> | null>(${receiver('string | number | bigint | boolean | Date')}, ${argument}): Expr<NullResult<T | U, boolean>, N, M>;`;
    case 'boolean': return `${name}<U extends boolean | null>(${receiver('boolean')}, ${argument}): Expr<NullResult<T | U, boolean>, N, M>;`;
    case 'not': return `${name}(${receiver('boolean')}): Expr<NullResult<T, boolean>, N, M>;`;
    case 'arithmetic': case 'divide': {
      if (!definition.tsReturns) throw new Error(`Missing tsReturns: ${name}`);
      const arithmeticReceiver = `this: ExprOperand<number | bigint | Decimal | null, string, M>`;
      return `${name}<D, B, U extends ArithmeticOperand<T> | null>(${arithmeticReceiver} & { readonly ir: { readonly type: D } }, other: (ExprOperand<U, string, NoInfer<M>> | ConstantOperand<U>) & { readonly ir: { readonly type: B } }): ${definition.tsReturns};\n  ${name}<D, U extends ArithmeticOperand<T> | null>(${arithmeticReceiver} & { readonly ir: { readonly type: D } }, other: U | ExprOperand<U, string, NoInfer<M>> | ConstantOperand<U>): ${definition.tsReturns.replace(/\bB\b/g, 'D')};`;
    }
    case 'nullTest': return `${name}(): Expr<boolean, N, M>;`;
    case 'ifNull': {
      if (!definition.tsReturns) throw new Error(`Missing tsReturns: ${name}`);
      return `${name}<D, B, U extends NonNullable<T> | null>(this: Expr<T, N, M> & { readonly ir: { readonly type: D } }, other: (Expr<U, string, NoInfer<M>> | Constant<U>) & { readonly ir: { readonly type: B } }): ${definition.tsReturns};\n  ${name}<D, U extends NonNullable<T> | null>(this: Expr<T, N, M> & { readonly ir: { readonly type: D } }, ${argument}): ${definition.tsReturns.replace(/\bB\b/g, 'FallbackDescriptor<D, U>')};`;
    }
    default: throw new Error(`missing signature generator: ${surface}`);
  }
}
const declarations = `import { Ordering } from './ordering.js';\n` + helpers + `export interface GeneratedExprMethods<T, N extends string = never, M extends Mode = 'row'> {\n${[...methodCatalog.map(d => `  ${signature(d)}`), ...orderingCatalog.map(d => `  ${d.name}(): Ordering<M>;`)].join('\n')}\n}\n`;
const header = '// Generated by scripts/gen-expr-methods.ts; do not edit.\n';
const runtime = header + `import type { Expr, Constant, ExprOperand, ConstantOperand } from './expr.js';\nimport type { Mode, Decimal } from './types.js';\n` + `import { invoke } from './catalog/define.js';
import { methodCatalog } from './catalog/index.js';
import { orderingCatalog } from './catalog/ordering.js';
` + declarations + `export function installMethods(extend: (methods: Record<string, (this: Expr<unknown, string, Mode>, ...args: never[]) => unknown>) => void): void {
  extend(Object.fromEntries([
    ...methodCatalog.map(def => [def.name, function(this: Expr<unknown, string, Mode>, ...args: unknown[]) { return invoke(def, [this, ...args]); }]),
    ...orderingCatalog.map(def => [def.name, function(this: Expr<unknown, string, Mode>) { return new Ordering(this, def.direction); }]),
  ]));
}
`;
const declaration = header + imports + declarations;
const outputs = new Map([
  ['packages/core/src/expr-methods.generated.ts', runtime],
  ['packages/core/src/expr-methods.generated.d.ts', declaration],
  ['test/types/snapshots/expr-methods.generated.d.ts', declaration],
]);
const check = process.argv.includes('--check');
if (!check && !process.argv.includes('--write')) throw new Error('Specify --write or --check');
for (const [path, text] of outputs) {
  if (check) {
    if (readFileSync(resolve(path), 'utf8') !== text) throw new Error(`Generated surface stale: ${path}`);
  } else writeFileSync(resolve(path), text);
}
console.log(`Expression surface ${check ? 'checked' : 'written'}: ${methodCatalog.length} methods.`);
