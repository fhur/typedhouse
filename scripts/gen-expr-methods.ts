import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { methodCatalog } from '../packages/core/src/catalog/index.js';
import type { Definition } from '../packages/core/src/catalog/define.js';

import { orderingCatalog } from '../packages/core/src/catalog/ordering.js';

const imports = `import type { Expr, Constant, ExprOperand, ConstantOperand } from './expr.js';\nimport type { Mode, Decimal } from './types.js';\n`;

const helpers = `import type { SetQuery, DateSetQuery, DateMembershipDescriptor, MembershipReceiver } from './subquery.js';
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
    case 'exp':
      return `${name}<D, V extends number | bigint | null>(this: Expr<V, N, M> & { readonly ir: { readonly type: D } } & ExpReceiver<D>): ExpResult<V, N, M>;`;
    case 'week':
      return `${name}<D, V extends Date | null>(this: Expr<V, N, M> & { readonly ir: { readonly type: D } } & WeekReceiver<D>): WeekResult<V, N, M>;`;
    case 'length':
    case 'empty':
      return `${name}<D, V extends string | readonly unknown[] | null>(this: Expr<V, N, M> & { readonly ir: { readonly type: D } } & StructuralReceiver<D, 'either'>): StructuralResult<V, N, M, '${surface === 'length' ? 'UInt64' : 'Bool'}'>;`;
    // Keep primitives separate from descriptor-checked expressions: a broad Operand
    // fallback would let unsupported decoded strings bypass the byte-string check.
    case 'startsWith':
      return `${name}<D, B, V extends string | null, U extends string | null>(this: Expr<V, N, M> & { readonly ir: { readonly type: D } } & StructuralReceiver<D, 'string'>, other: U | ((Expr<U, string, NoInfer<M>> | Constant<U>) & { readonly ir: { readonly type: B } } & StructuralReceiver<B, 'string'>)): StructuralResult<V | U, N, M, 'Bool'>;`;
    case 'has':
    case 'hasAny':
      return `${name}<D, V extends readonly unknown[]>(this: Expr<V, N, M> & { readonly ir: { readonly type: D } } & StructuralReceiver<D, 'array'>, other: Operand<${surface === 'has' ? 'NoInfer<V[number]>' : 'NoInfer<V>'}, NoInfer<M>>): StructuralResult<never, N, M, 'Bool'>;`;
    case 'arrayElement':
      return `${name}<D, V extends readonly unknown[]>(this: Expr<V, N, M> & { readonly ir: { readonly type: D } } & StructuralReceiver<D, 'array'>, index: Operand<number | bigint, NoInfer<M>>): ${definition.tsReturns?.replace(/\bT\b/g, 'V')};`;
    case 'element':
      return `${name}<D, V, const K extends ElementKeys<D>>(this: Expr<V, N, M> & { readonly ir: { readonly type: D } }, key: K & (string extends K ? never : unknown)): ${definition.tsReturns};`;
    case 'membership':
      return `${name}(this: Expr<Date | null, N, M> & { readonly ir: { readonly type: DateMembershipDescriptor } }, values: readonly Date[]): Expr<NullResult<T, boolean>, N, M>;\n  ${name}<R>(this: Expr<Date | null, N, M> & { readonly ir: { readonly type: DateMembershipDescriptor } }, query: DateSetQuery<R>): Expr<NullResult<T, boolean>, N, M>;\n  ${name}<D>(${receiver('string | number | bigint | boolean')} & { readonly ir: { readonly type: D } } & MembershipReceiver<D>, values: readonly NoInfer<NonNullable<T>>[]): Expr<NullResult<T, boolean>, N, M>;\n  ${name}<R, D>(${receiver('string | number | bigint | boolean')} & { readonly ir: { readonly type: D } } & MembershipReceiver<D>, query: SetQuery<R, NoInfer<T>>): Expr<NullResult<T, boolean>, N, M>;`;
    case 'between':
      return `${name}<D, L, H, U extends NonNullable<T> | null, V extends NonNullable<T> | null>(this: ExprOperand<string | number | bigint | Date | null, string, M> & { readonly ir: { readonly type: D } } & BetweenReceiver<D>, lower: U | ((ExprOperand<U, string, NoInfer<M>> | ConstantOperand<U>) & { readonly ir: { readonly type: L } } & BetweenReceiver<L>), upper: V | ((ExprOperand<V, string, NoInfer<M>> | ConstantOperand<V>) & { readonly ir: { readonly type: H } } & BetweenReceiver<H>)): Expr<NullResult<T | U | V, boolean>, N, M>;`;
    case 'comparison':
      return `${name}<U extends NonNullable<T> | null>(${receiver('string | number | bigint | boolean | Date')}, ${argument}): Expr<NullResult<T | U, boolean>, N, M>;`;
    case 'boolean':
      return `${name}<U extends boolean | null>(${receiver('boolean')}, ${argument}): Expr<NullResult<T | U, boolean>, N, M>;`;
    case 'not':
      return `${name}(${receiver('boolean')}): Expr<NullResult<T, boolean>, N, M>;`;
    case 'arithmetic':
    case 'divide': {
      if (!definition.tsReturns) throw new Error(`Missing tsReturns: ${name}`);
      const arithmeticReceiver = `this: ExprOperand<number | bigint | Decimal | null, string, M>`;
      return `${name}<D, B, U extends ArithmeticOperand<T> | null>(${arithmeticReceiver} & { readonly ir: { readonly type: D } }, other: (ExprOperand<U, string, NoInfer<M>> | ConstantOperand<U>) & { readonly ir: { readonly type: B } }): ${definition.tsReturns};\n  ${name}<D, U extends ArithmeticOperand<T> | null>(${arithmeticReceiver} & { readonly ir: { readonly type: D } }, other: U | ExprOperand<U, string, NoInfer<M>> | ConstantOperand<U>): ${definition.tsReturns.replace(/\bB\b/g, 'D')};`;
    }

    case 'nullTest':
      return `${name}(): Expr<boolean, N, M>;`;

    case 'ifNull': {
      if (!definition.tsReturns) throw new Error(`Missing tsReturns: ${name}`);
      return `${name}<D, B, U extends NonNullable<T> | null>(this: Expr<T, N, M> & { readonly ir: { readonly type: D } }, other: (Expr<U, string, NoInfer<M>> | Constant<U>) & { readonly ir: { readonly type: B } }): ${definition.tsReturns};\n  ${name}<D, U extends NonNullable<T> | null>(this: Expr<T, N, M> & { readonly ir: { readonly type: D } }, ${argument}): ${definition.tsReturns.replace(/\bB\b/g, 'FallbackDescriptor<D, U>')};`;
    }

    default:
      throw new Error(`missing signature generator: ${surface}`);
  }
}

// Documentation is generator-owned, not runtime function metadata.
const methodDocs: Readonly<Record<string, readonly [string, string]>> = {
  eq: [
    'Compare for equality. NULL propagates; use isNull() to test for NULL, not eq(null).',
    "from(parts).where(p => p.mpn.eq('ABC'));",
  ],
  ne: [
    'Compare for inequality. NULL propagates, so NULL rows do not pass a where() filter.',
    "from(parts).where(p => p.mpn.ne('ABC'));",
  ],
  lt: [
    'Test whether this value is strictly less than the operand. NULL propagates.',
    'val(2n).lt(3n);',
  ],
  le: [
    'Test whether this value is less than or equal to the operand. NULL propagates.',
    'val(2n).le(3n);',
  ],
  gt: [
    'Test whether this value is strictly greater than the operand. NULL propagates.',
    'val(3n).gt(2n);',
  ],
  ge: [
    'Test whether this value is greater than or equal to the operand. NULL propagates.',
    'val(3n).ge(2n);',
  ],
  between: [
    'Test an inclusive range with SQL BETWEEN; both endpoints are included.\nSupports integer/float, String/FixedString, Date and DateTime64(0–3) descriptors,\nincluding Nullable/LowCardinality wrappers; not Bool, Decimal, Enum or address strings.\nBounds must share the receiver’s decoded family (number and bigint are distinct).\nThe compiler rejects opaque, scalar-subquery and volatile receivers because lowering\nmay evaluate the receiver twice. Nullable operands give boolean | null; a NULL\ncomparison can still combine with false under SQL three-valued AND.\n@param lower Inclusive lower bound; plain values bind using the receiver descriptor.\n@param upper Inclusive upper bound; expressions retain their own descriptor.',
    "const inside: Expr<boolean> = val(3n).between(1n, 5n);\nval(new Date('2025-01-08T12:00:00Z'), col.DateTime64(3)).between(\n  new Date('2025-01-08T00:00:00Z'), new Date('2025-01-09T00:00:00Z'),\n);",
  ],
  in: [
    'Test membership in a value array or a one-column query. Empty arrays match nothing.\nA query operand is a set, not a scalar subquery; it may return many rows.\nNullable receivers retain a nullable result type; do not use membership to test for NULL.',
    "from(parts).where(p => p.mpn.in(['ABC', 'DEF']));",
  ],
  notIn: [
    'Test non-membership in a value array or a one-column query. Empty arrays exclude nothing.\nNullable receivers retain a nullable result type; use isNull() for an explicit NULL test.',
    "from(parts).where(p => p.mpn.notIn(['obsolete']));",
  ],
  and: [
    'Combine boolean expressions using SQL three-valued AND, not JavaScript short-circuiting.\nA false operand makes the result false; otherwise NULL can propagate.',
    "from(parts).where(p => p.mpn.notEmpty().and(p.mpn.startsWith('ABC')));",
  ],
  or: [
    'Combine boolean expressions using SQL three-valued OR, not JavaScript short-circuiting.\nA true operand makes the result true; otherwise NULL can propagate.',
    "from(parts).where(p => p.mpn.startsWith('ABC').or(p.mpn.startsWith('DEF')));",
  ],
  not: [
    'Negate a boolean expression; NULL remains NULL.',
    'from(parts).where(p => p.mpn.empty().not());',
  ],
  exp: [
    'Compute e raised to this value as Float64 (decoded number).\nAccepts Int/UInt8–64 and Float32/64, optionally Nullable; not Int128/256,\nDecimal or LowCardinality. Large inputs can produce Infinity; this is not a\nguarantee of finite output. NULL propagates and retains number | null.',
    'const growth: Expr<number> = val(1).exp();',
  ],
  plus: [
    'Add SQL numeric operands, not JavaScript strings or coerced values.\nInteger promotion grows the widest operand one step through 64 bits; 64/128/256\nretain their width. Either signed operand makes the result signed. Float input\npromotes to Float64. Decimal addition uses the larger scale and storage class.',
    'const total: Expr<bigint> = val(3, col.UInt32).plus(2);\nconst floating: Expr<number> = val(3, col.UInt32).plus(val(2));',
  ],
  minus: [
    'Subtract the operand; integer results are signed, even for unsigned inputs.\nThe widest integer grows one step through 64 bits; 64/128/256 retain their width.\nFloat input promotes to Float64. Decimal subtraction uses the larger scale\nand storage class; subtraction does not make a nullable operand non-null.',
    'const difference: Expr<bigint> = val(0, col.UInt32).minus(val(1, col.UInt32));',
  ],
  multiply: [
    'Multiply SQL numeric operands, preserving NULL.\nIntegers widen one step through 64 bits (64/128/256 stay unchanged); either signed\noperand makes the result signed. Float input promotes to Float64. Decimal\nscales add and the larger storage class wins; a scale exceeding that storage’s\nprecision can fail in ClickHouse. Inferred output does not guarantee no overflow.',
    'const product: Expr<bigint> = val(3, col.UInt32).multiply(2);\nconst floating: Expr<number> = val(1.25, col.Float32).multiply(val(2, col.Float32));',
  ],
  divide: [
    'Divide by the operand; non-Decimal division returns Float64 (number), not\ntruncated integer division. Division by zero can yield Infinity, -Infinity or\nNaN for Float64; Decimal division by zero fails in ClickHouse.\nDecimal results keep the numerator scale and larger storage class, truncating\nfractional excess rather than rounding. The numerator scale must be at least\nthe denominator scale for native Decimal division; inferred types do not enforce\nthat execution constraint. NULL propagates; there is no automatic safe-divide fallback.',
    'const ratio: Expr<number> = val(3n).divide(2n);\nconst missing: Expr<number | null> = val(null, col.Nullable(col.Int64)).divide(2n);',
  ],
  isNull: [
    'Test for NULL, returning a non-null boolean. Use instead of eq(null).',
    'val(null, col.Nullable(col.String)).isNull();',
  ],
  isNotNull: [
    'Test for a non-NULL value, returning a non-null boolean.\nFiltering with this predicate does not narrow the column descriptor in later callbacks.',
    'val(null, col.Nullable(col.String)).isNotNull();',
  ],
  ifNull: [
    'Replace NULL with a compatible fallback, without narrowing the original expression.\nA non-null receiver keeps its descriptor. For a nullable receiver the result uses\na common type, not arithmetic widening; a nullable fallback keeps the result nullable.\nIdentical base descriptors and supported integer/float common types are resolved;\nunsupported combinations fail compilation rather than guessing a conversion.\n@param other Fallback in the receiver’s decoded family, or null.\n@returns The resolved common descriptor; e.g. Int32 plus UInt32 fallback becomes\nInt64 (bigint), while String fallback remains string.',
    "const label: Expr<string> = val(null, col.Nullable(col.String)).ifNull('unknown');\nconst widened: Expr<bigint> = val(null, col.Nullable(col.Int32)).ifNull(val(4294967295, col.UInt32));",
  ],
  length: [
    'Count bytes of String/FixedString or elements of an Array as UInt64 (bigint).\nUTF-8 character count can differ: length of é😀 is 6 bytes. FixedString includes\npadding bytes. Nullable strings propagate NULL; array element nullability does not\nmake the count nullable.',
    "const bytes: Expr<bigint> = val('é😀', col.String).length();\nfrom(components).map(c => ({ partCount: c.matched_part_ids.length() }));",
  ],
  empty: [
    'Test whether String/FixedString has zero bytes or Array has zero elements.\nThis does not trim whitespace or ignore NULL elements: [null] is not empty.\n@returns boolean, or boolean | null for a nullable string receiver.',
    'from(components).where(c => c.matched_part_ids.empty());',
  ],
  notEmpty: [
    'Test whether String/FixedString has bytes or Array has elements.\nWhitespace and NULL array elements count; this is not a non-NULL test.\n@returns boolean, or boolean | null for a nullable string receiver; use isNotNull()\nwhen presence rather than length is the intended condition.',
    'from(components).where(c => c.matched_part_ids.notEmpty());',
  ],
  startsWith: [
    'Test a case-sensitive byte prefix on String/FixedString, without locale folding.\nBoth retained descriptors must be byte strings, optionally Nullable/LowCardinality;\na decoded string from Enum, UUID, IP, Decimal or high-precision time is not enough.\n@param other Plain prefix bound against the receiver, or a byte-string expression/constant.\n@returns boolean; NULL in either operand gives NULL and boolean | null.',
    "from(parts).where(p => p.mpn.startsWith('ABC'));\nconst missing: Expr<boolean | null> = val('ABC', col.String).startsWith(null);",
  ],
  has: [
    'Test whether a descriptor-backed Array contains an element.\n@param other Value bound using the array’s element descriptor, or a compatible\nexpression/constant of that decoded element type. NULL is searchable when the\nelement descriptor is nullable; it does not make the result nullable.\n@returns Non-null boolean; an empty array contains nothing.',
    "from(components).where(c => c.matched_part_ids.has('part-1'));\nconst found: Expr<boolean> = val([null, 7n], col.Array(col.Nullable(col.Int64))).has(null);",
  ],
  hasAny: [
    'Test whether descriptor-backed Arrays share an element, regardless of order\nor duplicates. Either array being empty gives false. NULL elements compare as\nvalues when admitted by the element descriptor, unlike scalar eq(null).\n@param other Array bound using the receiver descriptor, or a compatible Array expression.\n@returns Non-null boolean, including for arrays with nullable elements.',
    "from(components).where(c => c.matched_part_ids.hasAny(['part-1', 'part-2']));",
  ],
  arrayElement: [
    'Read one element of a descriptor-backed Array using ClickHouse’s one-based\nindex: 1 is first, -1 is last, not JavaScript’s zero-based indexing.\nOut-of-range access returns the element default (e.g. 0, empty string, or NULL\nfor Nullable elements), never undefined. Zero is not a valid first-element index:\nClickHouse may return a default for a constant array but reject a nonconstant one.\n@param index Integer number/bigint or integer-descriptor expression. Plain indexes\nbind as Int64; fractional and unsafe JS integer values fail parameter validation.\n@returns An expression retaining the exact element descriptor, including nested\narrays, tuple fields and element nullability; out-of-range access adds no union.',
    'const missing: Expr<string | null> = val([], col.Array(col.Nullable(col.String))).arrayElement(9);\nfrom(components).map(c => ({ lastPart: c.matched_part_ids.arrayElement(-1) }));',
  ],
  element: [
    'Select a field from a descriptor-backed named Tuple, or recursively from\nArrays of named Tuples. Array layers are retained; this does not expand rows.\n@param key Literal declared field name, bound as a String parameter; not an\nexpression, arbitrary string or positional tuple index. Dots are literal name\ncharacters, not a nested path; chain element() calls for nested named tuples.\n@returns The field’s decoded type and retained descriptor (including nullable\nfields), wrapped in the receiver’s array layers.',
    "from(components).map(c => ({\n  mpns: c.part_specifications.element('mpn'), // (string | null)[]\n  firstMpn: c.part_specifications.arrayElement(1).element('mpn'), // string | null\n}));",
  ],
  toStartOfWeek: [
    'Round Date or DateTime64(0–3) to the Sunday starting its week.\nThis bounded method has no week-mode or timezone override; it uses the input’s\nClickHouse temporal semantics. DateTime, Date32, higher precision and\nLowCardinality receivers are not supported, even when decoded as Date/string.\n@returns A Date descriptor decoded as JS Date; Nullable input gives Date | null.',
    "const sunday: Expr<Date> = val(new Date('2025-01-08T00:00:00Z'), col.Date).toStartOfWeek();",
  ],
  asc: [
    'Create an ascending sort key for orderBy() or thenBy(), not a scalar expression.\nChain nullsFirst() or nullsLast() to choose explicit NULL placement.',
    'from(parts).orderBy(p => p.mpn.asc());',
  ],
  desc: [
    'Create a descending sort key for orderBy() or thenBy(), not a scalar expression.\nChain nullsFirst() or nullsLast() to choose explicit NULL placement.',
    'from(parts).orderBy(p => p.mpn.desc());',
  ],
};

// Overload-specific hover text describes the bounded typed surface, not all native overloads.
function methodRemarks(name: string, overload: number): string {
  const mode =
    'Builds SQL without evaluating in JavaScript; preserves the receiver’s expression mode.\nExpression operands must use that mode; constants can be used in any mode.';

  if (['eq', 'ne', 'lt', 'le', 'gt', 'ge'].includes(name))
    return `${mode}\nAccepts string, number, bigint, boolean or Date receivers (optionally null).\nOperands must match the decoded family; number and bigint are not interchangeable.\nRetained SQL descriptors still undergo compiler compatibility and parameter checks;\na decoded string or Date alone does not prove a native overload is supported.\nUse Date or DateTime64(0–3) for serializable temporal parameters.\n@param other Plain value bound against the receiver descriptor, or a typed expression/\nconstant retaining its own descriptor. NULL is not a null-safe comparison.\n@returns boolean, with null in the result type if either operand is nullable.`;

  if (name === 'in' || name === 'notIn')
    return `${mode}\n${overload < 2 ? 'This overload requires retained Date or Nullable(Date) evidence, not Date32,\nDateTime, DateTime64 or LowCardinality. Date values bind as UTC calendar dates.' : 'This overload supports integer/float, String, FixedString, Bool, UUID and Enum\ndescriptors, optionally Nullable or LowCardinality (never LowCardinality(Enum)); not\nDecimal, IP or DateTime64 above millisecond precision. Matching decoded families are\nrequired; UUID remains distinct from String and number from bigint. An Enum receiver\nmatches declared names and Enum sets, and a String receiver rejects Enum and UUID sets.'}\n${overload % 2 === 0 ? '@param values Non-null values bound as one Array parameter against the receiver\ndescriptor. Empty lists are supported; expressions inside the list are not.' : '@param query An independently scoped, flat one-column query of the compatible\nfamily, with any number of rows. Nullable set columns are allowed; outer-column\ncaptures are not. Do not wrap this set in scalar().'}\n@returns boolean, conservatively boolean | null for a nullable receiver.\nMembership does not follow scalar comparison NULL propagation; NULL is not\nmatched as an ordinary value. Use isNull() for an explicit NULL test.`;

  if (['plus', 'minus', 'multiply', 'divide'].includes(name))
    return `${mode}\nReceivers are integer/float or branded Decimal values, optionally nullable;\nNullable/LowCardinality numeric descriptors are unwrapped for promotion.\nThe typed operand family must match: no number/bigint or Decimal/number mixing,\neven where native ClickHouse has additional overloads. Decimal column/expression\narithmetic is supported, but non-null Decimal JS parameters (including val()\nconstants) are not serialized by the current compiler; use column expressions.\n${overload === 0 ? '@param other Descriptor-backed expression/constant; both descriptors determine\nwidth, signedness and Decimal precision/scale.' : '@param other Plain value bound using the receiver descriptor, or an expression/\nconstant whose descriptor is not retained statically. Use val(value, descriptor)\nwhen a distinct serializable operand width must participate in inference.'}\n@returns Promoted numeric expression, nullable if either operand is nullable.\nIntegers through 32 bits and floats decode as number; 64/128/256-bit integers\ndecode as bigint. Decimal results are branded strings, with storage precision\n9/18/38/76. Erased descriptor evidence can leave number | bigint rather than\nan exact width. Inference describes output; it is not an overflow/scale safety check.`;

  if (name === 'ifNull')
    return `${mode}\n${overload === 0 ? 'This overload retains both descriptors for precise common-type inference.' : 'Plain fallbacks bind against the receiver descriptor; erased descriptor evidence\ncan make result inference less precise. A null fallback never removes nullability.'}`;

  if (['and', 'or', 'not'].includes(name))
    return `${mode}\nOnly Bool expressions (optionally Nullable/LowCardinality), not numeric truthiness.\n${name === 'not' ? '@returns boolean, or boolean | null for a nullable receiver.' : '@param other Boolean/null value bound as a parameter, or same-mode boolean expression.\n@returns boolean, conservatively boolean | null if either operand is nullable,\neven when a dominating true/false value makes a particular result non-null.'}\nDo not use SQL boolean composition as a JavaScript short-circuit guard against\ninvalid arithmetic; evaluation order is not promised here.`;

  if (['length', 'empty', 'notEmpty'].includes(name))
    return `${mode}\nRetained descriptors must be String/FixedString or Array, with supported wrappers;\nEnum, UUID, IP, Decimal and high-precision time do not become byte strings merely\nbecause their decoded JavaScript value is a string.`;

  if (name === 'isNull' || name === 'isNotNull')
    return `${mode}\nAvailable on any expression descriptor, not only Nullable. Tests the whole value,\nnot NULL elements inside arrays or tuples. Always returns non-null boolean;\nthis SQL predicate is not a TypeScript type guard and does not narrow later callbacks.`;

  if (name === 'asc' || name === 'desc')
    return 'Accepts an expression of any value type; server sortability still applies.\n@returns Ordering<M> retaining the receiver’s mode, not Expr and not sorted rows.\nWithout nullsFirst()/nullsLast(), NULL placement is left to ClickHouse’s default.\nReturn this key from orderBy()/thenBy(); it cannot be selected as a scalar value.';

  return mode;
}

function documented(name: string, declaration: string): string {
  const doc = methodDocs[name];
  if (!doc) throw new Error(`Missing method documentation: ${name}`);
  const [summary, example] = doc;

  return declaration
    .split('\n  ')
    .map((overload, index) => {
      const sample =
        name === 'in' || name === 'notIn'
          ? index === 0
            ? `const day = val(new Date('2025-01-05T00:00:00Z'), col.Date);\nconst member: Expr<boolean> = day.${name}([new Date('2025-01-05T00:00:00Z')]);`
            : index === 1
              ? `const weeks = from(components).map(c => c.updatedAt.toStartOfWeek());\nval(new Date('2025-01-05T00:00:00Z'), col.Date).${name}(weeks);`
              : index === 3
                ? `const selectedMpns = from(parts).where(p => p.mpn.startsWith('ABC')).map(p => p.mpn);\nfrom(parts).where(p => p.mpn.${name}(selectedMpns));`
                : example
          : example;

      const text = `${summary}\n@remarks\n${methodRemarks(name, index)}\n@example\n\`\`\`ts\n${sample}\n\`\`\``;

      const comment = `/**\n${text
        .split('\n')
        .map(line => `   * ${line}`)
        .join('\n')}\n   */`;

      return `  ${comment}\n  ${overload}`;
    })
    .join('\n');
}

const declarations =
  `import { Ordering } from './ordering.js';\n` +
  helpers +
  `export interface GeneratedExprMethods<T, N extends string = never, M extends Mode = 'row'> {\n${[...methodCatalog.map(d => documented(d.name, signature(d))), ...orderingCatalog.map(d => documented(d.name, `${d.name}(): Ordering<M>;`))].join('\n')}\n}\n`;

const header = '// Generated by scripts/gen-expr-methods.ts; do not edit.\n';

const runtime =
  header +
  `import type { Expr, Constant, ExprOperand, ConstantOperand } from './expr.js';\nimport type { Mode, Decimal } from './types.js';\n` +
  `import { invoke } from './catalog/define.js';
import { methodCatalog } from './catalog/index.js';
import { orderingCatalog } from './catalog/ordering.js';
` +
  declarations +
  `export function installMethods(extend: (methods: Record<string, (this: Expr<unknown, string, Mode>, ...args: never[]) => unknown>) => void): void {
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
    if (readFileSync(resolve(path), 'utf8') !== text)
      throw new Error(`Generated surface stale: ${path}`);
  } else writeFileSync(resolve(path), text);
}

console.log(
  `Expression surface ${check ? 'checked' : 'written'}: ${methodCatalog.length} methods.`,
);
