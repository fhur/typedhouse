# Generated known functions

`typedhouse generate` retains the `functions` metadata export and exports callable `fn` (scalar) and `agg` (aggregate) namespaces using `createKnownFunctions(functions)` from `@typedhouse/core`.

```ts
import { fn, agg } from './generated/functions.js';
components.map(c => ({ h: fn.cityHash64(c.entityId).as(col.UInt64) }));
components.aggregate(g => ({ n: agg.uniqExact(g.entityId).as(col.UInt64) }));
```

Arguments must be expressions; wrap constants with `val`. Scalars preserve the first argument's name and expression mode. Zero-argument calls use the function name. Aggregates consume grouped expressions or constants and return aggregate mode; scalars may wrap aggregate expressions. Names are literal catalog keys, partitioned by aggregate classification.

Results remain `unknown` until `.as(col.X)`. Every executed known call requires its own declaration, including nested calls. This is a caller assertion for inference and decoding, **not a SQL CAST or server return-type inference**. The supported result grammar is integers, floats, String/FixedString, Bool, Date/DateTime, DateTime64(0..3), and recursively Nullable/LowCardinality/Array/Tuple of those. A declaration must match actual server results; the server and decoder can still reject a call.

Calls capture immutable plain catalog evidence. The compiler checks membership, classification, determinism, aliases, declaration consistency, modes and bindings without importing application modules or using a global registry. Evidence does not authenticate a malicious application, prove server freshness, or infer arity/argument signatures. Aliases are metadata only: SQL uses the original called name. Unsafe SQL names are rejected independently of JavaScript property quoting. Missing determinism is generated as null and treated conservatively as false; aggregate linearity is never inferred.

Typed catalog optimizations and special SQL lowering do not apply to known calls with the same name. Parametric aggregates, state results, derived combinators, lambdas and user-origin functions remain unsupported. Literal catalog entries are not synthesized into additional suffix names. Broader decoder types and the rest of M3/v1 remain separate work.
