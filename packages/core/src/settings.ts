import { quoteString } from './ch-type.js';
import { assertDataContainer } from './ir.js';

/** The query settings `q.settings()` accepts. Every other setting is refused, because many
 * change or break the rows a query returns: `limit` drops rows, `final` changes a count,
 * `group_by_use_nulls` changes a key's type, and `result_overflow_mode = 'break'` returns
 * partial results with no error. Integer limits take a non-negative safe integer or a bigint.
 */
export interface QuerySettings {
  readonly max_threads?: number | bigint;
  /** Seconds, fractions allowed. `0` means no limit. */
  readonly max_execution_time?: number;
  readonly max_memory_usage?: number | bigint;
  readonly max_rows_to_read?: number | bigint;
  readonly max_bytes_to_read?: number | bigint;
  readonly max_result_rows?: number | bigint;
  readonly max_result_bytes?: number | bigint;
  readonly max_block_size?: number | bigint;
  readonly max_bytes_before_external_group_by?: number | bigint;
  readonly max_bytes_before_external_sort?: number | bigint;
  readonly priority?: number | bigint;
  readonly log_comment?: string;
}

type SettingKind = 'integer' | 'seconds' | 'string';

const allowlist: Readonly<Record<keyof QuerySettings, SettingKind>> = {
  max_threads: 'integer',
  max_execution_time: 'seconds',
  max_memory_usage: 'integer',
  max_rows_to_read: 'integer',
  max_bytes_to_read: 'integer',
  max_result_rows: 'integer',
  max_result_bytes: 'integer',
  max_block_size: 'integer',
  max_bytes_before_external_group_by: 'integer',
  max_bytes_before_external_sort: 'integer',
  priority: 'integer',
  log_comment: 'string',
};

/** Emitted by the compiler or sent by the client; a caller's value would break the decoded result. */
const compilerOwned: ReadonlySet<string> = new Set([
  'join_use_nulls',
  'transform_null_in',
  'enable_extended_results_for_datetime_functions',
  'date_time_output_format',
  'output_format_json_quote_64bit_integers',
  'output_format_json_quote_decimals',
  'output_format_json_quote_denormals',
  'http_write_exception_in_output_format',
]);

/** Above this, 24.8 stores 2^63 with no error. */
const MAX_UINT64 = 2n ** 64n - 1n;

/** Below this, 24.8 reads a positive timeout as 0, which disables it with no error. */
const MIN_SECONDS = 0.000001;

/** Above this, the microseconds overflow: 24.8 raises code 36, or code 159 on every query. */
const MAX_SECONDS = 9223372036854;

function valueProblem(kind: SettingKind, value: unknown): string | undefined {
  switch (kind) {
    case 'integer':
      if (typeof value === 'bigint')
        return value >= 0n && value <= MAX_UINT64 ? undefined : 'expected a UInt64 bigint';

      // 1.5 would read back as 1; -1 and 1e21 (how JavaScript prints it) raise code 70.
      return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? undefined
        : 'expected a non-negative safe integer or a bigint';
    case 'seconds':
      return typeof value === 'number' &&
        (value === 0 || (value >= MIN_SECONDS && value <= MAX_SECONDS))
        ? undefined
        : `expected 0, or a number of seconds from ${MIN_SECONDS} to ${MAX_SECONDS}`;
    case 'string':
      if (typeof value !== 'string') return 'expected a string';
      // A lone surrogate reaches the server as U+FFFD, so it would not read back.
      return /\p{Cs}/u.test(value) ? 'expected well-formed Unicode' : undefined;
  }
}

export interface SettingsIssue {
  readonly code:
    'invalid_settings' | 'unknown_setting' | 'compiler_owned_setting' | 'invalid_setting_value';
  readonly path: string;
  readonly detail: string;
}

function literal(value: string | number | bigint): string {
  return typeof value === 'string' ? quoteString(value) : String(value);
}

/** Validate a settings object and render it from the same reads, each value read once: the
 * builder and the compiler both ask, because the compiler also receives hand-built nodes and
 * these values become SQL text. Gives `key = literal` items in the caller's order, or the first
 * problem. ClickHouse has no query parameters in `SETTINGS` (`x = {p:UInt32}` is a syntax error),
 * so these are literals, like `LIMIT`.
 */
export function readSettings(settings: unknown): SettingsIssue | readonly string[] {
  try {
    assertDataContainer(settings);
  } catch {
    settings = undefined;
  }

  if (!settings || Array.isArray(settings))
    return {
      code: 'invalid_settings',
      path: 'settings',
      detail: 'expected a plain object of settings',
    };

  const items: string[] = [];

  for (const key of Object.getOwnPropertyNames(settings)) {
    const path = `settings.${key}`;

    if (compilerOwned.has(key))
      return {
        code: 'compiler_owned_setting',
        path,
        detail: 'the compiler or the client sets this; a different value would break the result',
      };

    if (!Object.hasOwn(allowlist, key))
      return {
        code: 'unknown_setting',
        path,
        detail: `expected one of ${Object.keys(allowlist).join(', ')}`,
      };

    const value = (settings as Record<string, unknown>)[key];
    const problem = valueProblem(allowlist[key as keyof QuerySettings], value);
    if (problem) return { code: 'invalid_setting_value', path, detail: problem };

    if (!Object.getOwnPropertyDescriptor(settings, key)?.enumerable)
      return { code: 'invalid_settings', path, detail: 'expected an enumerable property' };

    items.push(`${key} = ${literal(value as string | number | bigint)}`);
  }

  return items;
}

/** The first problem with a settings object, or nothing. */
export function settingsIssue(settings: unknown): SettingsIssue | undefined {
  const read = readSettings(settings);
  return 'code' in read ? read : undefined;
}

/** `key = literal` for each setting; throws on an invalid one. */
export function renderSettings(settings: QuerySettings): readonly string[] {
  const read = readSettings(settings);
  if ('code' in read) throw new Error(`${read.code} at ${read.path}: ${read.detail}`);
  return read;
}
