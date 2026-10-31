# TypedHouse client

`createClient` delegates transport, JSON parsing, streaming, backpressure and cancellation to `@clickhouse/client`. `run` collects rows; `stream` yields rows without collecting the whole result. Both backend modes use the same representation adapter and execution settings.

## Response policy

Trust the server and the official driver's parsed values rather than validating every ClickHouse value in JavaScript:

- Int64/UInt64 and wider integers become `bigint`.
- Date/Date32 and DateTime/DateTime64 up to millisecond precision become UTC `Date` objects. Higher-precision DateTime64 stays a string.
- Arrays and named/positional tuples recurse through those conversions. Nullable and LowCardinality wrappers are transparent.
- Decimal stays an exact branded string: execution forces `output_format_json_quote_decimals=1`, alongside quoted 64-bit integers, quoted denormals and ISO dates. No Decimal class is involved.
- Maps, JSON, Variant, Dynamic and Unknown values pass through unchanged. Maps retain the very same object, including nested wire values.
- Small integers, strings, UUID/IP strings and Enum strings are not exhaustively validated. Brands/unions describe the server result, not a runtime validation promise. Bool and `nan`/`-nan`/`inf`/`-inf` retain their small compatibility conversions.

Malformed rows, missing columns, invalid conversion inputs and unsupported raw aggregate states still fail. Nested output paths preserve literal keys such as `__proto__` without mutating prototypes. Execution/conversion failures retain `QueryError` SQL, params and best-effort node context; preparation errors occur before execution.

### Breaking Map migration

All Map output types are now `Record<string, unknown>`, independent of the ClickHouse key/value descriptors. Numeric keys are strings, not pair arrays; Int64, Date and nested values inside Maps are **not** converted to bigint/Date. Narrow values explicitly in application code. Codegen and descriptor-derived expression types use this same contract. `canonicalKey` compares Map object contents as wire values, without applying the Map's child descriptors.

## Streaming acceptance

Streaming relies on the official driver's resource management and retains the real 10M-row bounded-memory gate. A separate literal one-HTTP-chunk buffering proof is no longer an acceptance requirement. This does not bound server-side memory. Close iterators before closing an owned backend; injected backends remain caller-owned.

Input parameter serialization is a separate compiler concern and is unchanged by this response policy.
