# Bounded user scalar execution

Application `defineFunction` calls require no registration, generated catalog, compiler import of application code, or SQL CAST:

```ts
const editDistance = defineFunction({
  name: 'editDistance', args: [stringLike, stringLike],
  returns: col.UInt64, deterministic: true,
});
parts.map(p => ({ mpn: p.mpn, distance: editDistance(p.mpn, 'GRM155R61A104KA01D') }));
```

The decoded distance is exactly `bigint`; its retained descriptor is UInt64. Nullable(String) inputs produce Nullable(UInt64) and `bigint | null`. Native ClickHouse **24.8.14.39** verifies both. Unicode editDistance counts bytes (`é` versus `e` is 2), not characters.

## First-slice envelope

- Fixed arity, including zero arguments; scalar functions only.
- The **actual library singleton** `stringLike` normalizes to a versioned declarative argument contract. Its execution subset is **String or one Nullable(String)**, globally for user scalars, not an editDistance-specific special case. Matching arbitrary callbacks or objects claiming a stringLike tag is not supported.
- Concrete argument Columns may describe **String or UInt64**, optionally one Nullable wrapper. These are per-position base-family contracts: an operand may have that base type with or without Nullable. Nullable propagation depends on actual operand descriptors, not merely on whether the argument contract allows Nullable. Plain values receive that position's non-null base descriptor, with NULL lifted normally. Explicit typed parameters keep their descriptor and identity. `repeat(String, UInt64)` has native coverage; JavaScript counts must be bigint, not number.
- Concrete returns are decoder-backed primitive String, Bool, integer and floating-point Columns, optionally one Nullable wrapper. There is no inferred server signature. `nullable: 'propagate'` defaults to wrapping the declared return if any argument is nullable; `'never'` retains exactly the declared return. A nullable declared return stays nullable.
- LowCardinality (including Nullable/LowCardinality nesting), FixedString, Enum, UUID/address, structural and other argument families are not executable in this slice. Native editDistance rejects FixedString/Enum, and returns LowCardinality(UInt64) for LowCardinality(String), so stripping that result wrapper would be false descriptor evidence.
- Callback returns, `'arg0'`, custom/other matchers and unsupported concrete Columns retain existing construction behavior but compilation reports unsupported execution, even if the call claims a plausible type. User aggregates, parametric aggregates, states/combinators, raw and broader matcher families remain backlog.

These are owner-approved bounded execution limits, **not a waiver of the full spec's broader stringLike/extension requirements**. See `USER_FUNCTION_NATIVE_PROBE.md` for the original mismatch and exact reproductions.

## Evidence, types and validation

Each supported definition captures an immutable, plain version-1 scalar contract: name, optional SQL name, ordered argument contracts, concrete return, nullable rule and determinism. No callbacks, matcher functions, application import or global function registry enter the IR. The compiler validates the serialized contract independently, checks metadata agreement, result/nullability, arity, SQL identifier safety and every bound operand. Known and user evidence are mutually exclusive; typed-origin forgery guards remain intact. Actual typed catalog names/SQL aliases and supported aggregate If names are reserved with ASCII-case-insensitive comparison (`duplicate_function`) for both the public definition name and its emitted SQL alias. For example, `sum`, `SUM`, `SuM`, and an application name aliased to `SuM` are all rejected. Merely being a known server function is not a collision: `editDistance` remains allowed. Unreserved names and aliases such as `editDistance` and `ApplicationValue` retain their exact original spelling in ordinary SQL emission, without registration. Known-function supplied server classification remains a separate trust contract, not name autodetection.

This is **caller-supplied signature and determinism evidence**, not authentication or a promise that the target server implements the declaration. A dishonest declaration can still disagree with the server. The compiler guarantees internal descriptor consistency, not server authorization or signature discovery. Use independent native `toTypeName`/result probes when defining a function.

`DefinedFunction<A,R,P,S>` remains usable; an optional defaulted fifth name parameter retains literal function names for constant-only calls. Concrete Column returns now retain `DescribedExpr` evidence rather than erasing it to Expr. Root names/modes come from the first nonconstant expression, skipping JS/val constants; all other expression modes must match. Constants-only calls use the function name and row mode. Unsupported-family construction is deliberately not removed at the public type level: the existing matcher API promises construction compatibility. Compiler validation is mandatory after type erasure.

Both emitters use normal calls with the validated SQL name, never typed-function special lowering. User determinism is recursively combined with children by the existing capability computation; it does not grant optimizer eligibility, stronger static capabilities, or `.live()`. Existing parameter serialization is unchanged (including its typed NULL representation); the exact non-null example emits no CAST.

## Verification artifacts

- `packages/compiler/test/user-functions.test.ts`: ownership, arity, parameter identity, nested calls, contract/mode/binding forgeries, unsupported forms and families, collisions and hostile names.
- `packages/client/test/user-functions.integration.ts`: independent native SQL and type-name oracles; run/stream on both backends; negative family controls.
- `test/types/user-functions.ts` and `negative/expressions/z-user-functions.ts`: source/built exact and not-any evidence plus precise diagnostic gates.
- `packages/compiler/test/fixtures/corpus/user-functions.ts`: additive 253rd query, runtime-derived descriptor/row snapshots and actual readable declarations for three official compilers. The original 252 queries and 200+2 benchmark inputs/budgets are unchanged.

Actual completed matrix evidence, including any failure, belongs in TODO.md; this document does not assert unrun checks passed.
