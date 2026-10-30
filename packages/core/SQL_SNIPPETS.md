# Trusted scalar SQL snippets

```ts
import { col, sql } from '@chql/core';

parts.map(p => ({
  mpn: p.mpn,
  distance: sql`editDistance(${p.mpn}, ${'GRM155'})`.as(col.UInt64),
}));
```

The tag returns only an `.as(descriptor)` declaration builder, not an expression.
The descriptor is mandatory runtime data for inference and existing decoding;
`.as` emits no CAST and does not prove the server's result type. Nullable results
must be declared nullable. Generic-only `sql<T>` is not supported. This is the
owner-approved replacement for custom scalar declarations, without a registry,
application callbacks, or method-extension APIs.

Supported result descriptors are the same bounded decoder grammar as generated
known functions: integer/float/String/Bool/Date/DateTime primitives, FixedString,
DateTime64 precision 0–3, recursive Nullable/LowCardinality/Array and consistently
named or unnamed Tuples. Unknown, JSON, Dynamic, Variant, Decimal, Map and aggregate
states are not supported results. No new decoder is introduced.

## Trust boundary

Template text is trusted author SQL. The author asserts that it is a scalar,
read-only row expression and that all column dependencies occur through bound
expression holes. Literal hidden identifier dependencies are unsupported.
**No SQL lexer, parser, sanitizer, signature verifier or read-only verifier runs.**
Holes must occupy expression positions outside quoted strings, comments and
identifier tokens. Invalid trusted text may cause a server error; parameterization
does not make an arbitrary malicious template safe.

Plain strings, booleans, numbers, bigints, Dates and supported arrays become typed
parameters using the ordinary `val` defaults, independently of the result
descriptor. Use `val(value, descriptor)` for explicit parameter types, including
typed nulls. Empty or otherwise untyped parameters fail existing validation.
Strings are values, never dynamic identifiers. Columns must be bound `Expr`
operands; there is no dynamic-identifier API. Both every hole and the whole
expression are parenthesized. Reused expression/parameter nodes retain identity.

The tag snapshots owned parts and parameters. The compiler checks dense strings,
argument counts, descriptors, provenance, row placement and column binding before
emission; malformed IR produces node-path errors. Declared row snippets may nest.
Bare snippets, grouped/aggregate operands and direct Query interpolation are not
supported. Existing `scalar(query)` is allowed with its independent scope and
cardinality validation. Raw expressions cannot occur in aggregate outputs or
operands, including inside casts or ordinary calls.

Snippets have no root column name: use object projection to name the result.
They are opaque and nondeterministic for capabilities and optimization, with no
caller override. Existing conservative rewrite/CTE fences remain. Raw relations,
raw queries, aggregate SQL snippets and aggregate states are not public APIs.
