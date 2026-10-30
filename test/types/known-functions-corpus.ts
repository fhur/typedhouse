// Generated exact/not-any runtime correspondence.
import { expectTypeOf } from 'expect-type';
import type { Infer } from '@typedhouse/core';
import * as queries from '../../packages/compiler/test/fixtures/corpus/known-functions.js';
import type * as Snapshot from './snapshots/corpus/known-functions-row.js';
expectTypeOf<Infer<typeof queries.knownHash>>().toEqualTypeOf<Snapshot.knownHash>();
expectTypeOf<Infer<typeof queries.knownHash>>().not.toBeAny();
expectTypeOf<Infer<typeof queries.knownUnique>>().toEqualTypeOf<Snapshot.knownUnique>();
expectTypeOf<Infer<typeof queries.knownUnique>>().not.toBeAny();
