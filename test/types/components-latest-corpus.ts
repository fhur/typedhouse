// Generated exact/not-any runtime correspondence.
import { expectTypeOf } from 'expect-type';
import type { Infer } from '@typedhouse/core';
import { componentsLatest } from '../../packages/compiler/test/fixtures/corpus/components-latest.js';
import type { ComponentsLatest } from './snapshots/corpus/components-latest-row.js';
expectTypeOf<Infer<typeof componentsLatest>>().toEqualTypeOf<ComponentsLatest>();
expectTypeOf<Infer<typeof componentsLatest>>().not.toBeAny();
