// Generated exact/not-any runtime correspondence.
import { expectTypeOf } from 'expect-type';
import type { Infer } from '@chql/core';
import { snippetDistance } from '../../packages/compiler/test/fixtures/corpus/sql-snippets.js';
import type { SnippetDistance } from './snapshots/corpus/sql-snippets-row.js';
expectTypeOf<Infer<typeof snippetDistance>>().toEqualTypeOf<SnippetDistance>();
expectTypeOf<Infer<typeof snippetDistance>>().not.toBeAny();
