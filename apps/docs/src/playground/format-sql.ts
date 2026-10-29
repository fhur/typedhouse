import { clickhouse, formatDialect } from 'sql-formatter';

/** Display-only formatting. Never make valid compiler output depend on formatter coverage. */
export function formatSql(sql: string): string {
  try {
    return formatDialect(sql, {
      dialect: clickhouse,
      tabWidth: 2,
      keywordCase: 'upper',
      linesBetweenQueries: 1,
    });
  } catch {
    return sql;
  }
}
