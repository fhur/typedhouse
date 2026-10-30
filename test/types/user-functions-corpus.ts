// Generated exact/not-any runtime correspondence.
import { expectTypeOf } from 'expect-type';
import type { Infer } from '@typedhouse/core';
import { userEditDistance } from '../../packages/compiler/test/fixtures/corpus/user-functions.js';
import type { UserEditDistance } from './snapshots/corpus/user-functions-row.js';
expectTypeOf<Infer<typeof userEditDistance>>().toEqualTypeOf<UserEditDistance>();
expectTypeOf<Infer<typeof userEditDistance>>().not.toBeAny();
