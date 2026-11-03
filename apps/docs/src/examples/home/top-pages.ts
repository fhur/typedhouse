import { col, count, from, table, uniq } from '@typedhouse/core';

const pageViews = table(
  'page_views',
  { date: col.Date, path: col.String, visitorId: col.String },
  { engine: 'MergeTree', sortingKey: ['date', 'path'], partitionKey: [] },
);

// #region example
// Top pages this month, with unique visitors
export default from(pageViews)
  .where(v => v.date.ge(new Date('2026-11-01')))
  .groupBy(v => v.path)
  .aggregate(v => ({
    views: count(),
    visitors: uniq(v.visitorId),
  }))
  .orderBy(v => v.views.desc())
  .limit(10);
// #endregion
