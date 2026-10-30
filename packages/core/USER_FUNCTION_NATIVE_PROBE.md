# User scalar execution: native contract decision

Status: historical pre-implementation decision gate, subsequently resolved by owner approval to reject LowCardinality/FixedString/Enum in the initial String execution subset. See `USER_FUNCTIONS.md` for the implemented boundary; this probe does not itself establish implementation acceptance.
Base: `262e553206efd6299fcfab808599f990784a5fbb`.
Branch/worktree: `user-scalar-functions`, `.worktrees/user-scalar-functions`.
Frozen install succeeded. No production code or spec changed.

## Native evidence

Each probe used a fresh owned `--rm` container, not an existing server:

```sh
docker run --rm --entrypoint clickhouse clickhouse/clickhouse-server:24.8 local --query "SELECT version(), editDistance('abc', 'abc'), toTypeName(editDistance('abc', 'abc')), editDistance('abc', 'axc'), editDistance('', 'abc'), editDistance('é', 'e'), editDistance(CAST(NULL AS Nullable(String)), 'abc'), toTypeName(editDistance(CAST(NULL AS Nullable(String)), 'abc')) FORMAT JSONEachRow"
```

Observed ClickHouse **24.8.14.39**:

- identical `abc`: `0`, `UInt64`;
- differing `abc` / `axc`: `1`;
- empty / `abc`: `3`;
- Unicode `é` / `e`: `2` (byte distance, not character distance);
- `Nullable(String)` NULL / `abc`: NULL, `Nullable(UInt64)`.

Separate argument-family probes:

```sql
SELECT editDistance(toFixedString('abc', 3), 'abc');
SELECT editDistance(CAST('abc' AS Enum8('abc'=1,'axc'=2)), 'abc');
SELECT editDistance(CAST('abc' AS LowCardinality(String)), 'abc') AS distance,
       toTypeName(distance) AS type;
SELECT editDistance(CAST(NULL AS LowCardinality(Nullable(String))), 'abc') AS distance,
       toTypeName(distance) AS type;
```

FixedString and Enum each fail with code **43 / ILLEGAL_TYPE_OF_ARGUMENT**. The initial multiquery stopped at FixedString, so Enum and LowCardinality were subsequently tested separately (not a retry of a failed acceptance suite).
LowCardinality returns `0` / **`LowCardinality(UInt64)`**, and its nullable variant returns NULL / **`LowCardinality(Nullable(UInt64))`**.

Stored-column reproduction, ruling out a constant-only artifact:

```sh
docker run --rm --entrypoint clickhouse clickhouse/clickhouse-server:24.8 local --multiquery --query "CREATE TABLE probe (s LowCardinality(String), n LowCardinality(Nullable(String))) ENGINE=Memory; INSERT INTO probe VALUES ('abc','abc'),('axc',NULL),('', ''); SELECT version() AS version, s, editDistance(s, 'abc') AS distance, toTypeName(editDistance(s, 'abc')) AS result_type, editDistance(n, 'abc') AS nullable_distance, toTypeName(editDistance(n, 'abc')) AS nullable_result_type FROM probe ORDER BY s FORMAT JSONEachRow;"
```

Actual output:

```json
{"version":"24.8.14.39","s":"","distance":"3","result_type":"LowCardinality(UInt64)","nullable_distance":"3","nullable_result_type":"LowCardinality(Nullable(UInt64))"}
{"version":"24.8.14.39","s":"abc","distance":"0","result_type":"LowCardinality(UInt64)","nullable_distance":"0","nullable_result_type":"LowCardinality(Nullable(UInt64))"}
{"version":"24.8.14.39","s":"axc","distance":"1","result_type":"LowCardinality(UInt64)","nullable_distance":null,"nullable_result_type":"LowCardinality(Nullable(UInt64))"}
```

## Original exact decision (now resolved)

The library's actual `stringLike` matcher recursively unwraps Nullable/LowCardinality and also accepts FixedString, Enum and address types. The requested concrete-return rule produces `UInt64` or `Nullable(UInt64)` from the example definition. It cannot claim exact native descriptors for the observed LowCardinality arguments. Decoding both as bigint does not establish descriptor equality.

Recommended bounded decision: authorize execution rejection of LowCardinality operands in this first concrete-return slice (as well as explicit unsupported-family errors where necessary), retaining the unchanged String example and Nullable(String) propagation. Do not add a CAST, erase the wrapper in the descriptor oracle, or invent generic LowCardinality result inference. Alternatively, authorize a separate explicit wrapper-result contract with independent native validation; that is broader than a fixed concrete return plus nullable propagation.

FixedString/Enum server rejection alone is covered by the requested explicit-unsupported option; the **successful native call with a different result descriptor** is the reason for this stop under the requested mismatch gate. This is not a claim that arbitrary application definitions can be authenticated against server signatures.

At the time of this probe, no user resolver, serialized contract, public type changes, corpus extension, native client run/stream test or compiler matrix had been implemented/run. Subsequent implementation evidence is recorded in TODO.md, not retroactively attributed to this probe. Prior 808 runtime / 7 codegen / 166 SQL / 314 negatives / 252 corpus rows remain historical accepted base evidence, not verification of user-function execution. Advanced aggregates/state/raw remain backlog. No stage, commit, push, reset, delegation, main/other-worktree write, protected-document read or owner `.playwright-cli` inspection occurred.
