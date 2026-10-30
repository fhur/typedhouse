// Generated exact/not-any runtime correspondence.
import { expectTypeOf } from 'expect-type';
import type { Infer } from '@typedhouse/core';
import { projectionEnrichment } from '../../packages/compiler/test/fixtures/corpus/projection-enrichment.js';
import type { ProjectionEnrichment } from './snapshots/corpus/projection-enrichment-row.js';
expectTypeOf<Infer<typeof projectionEnrichment>>().toEqualTypeOf<ProjectionEnrichment>();
expectTypeOf<Infer<typeof projectionEnrichment>>().not.toBeAny();
