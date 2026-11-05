import type { ChatActivity } from '../server/chat.js';

const toolLabels: Readonly<Record<string, string>> = {
  docs_search: 'Searching docs…',
  docs_read: 'Reading docs…',
  tables_list: 'Finding tables…',
  table_describe: 'Inspecting table…',
  columns_describe: 'Inspecting columns…',
  query_validate: 'Checking query…',
  query_run: 'Running query…',
  query_results_get: 'Reading query results…',
  query_apply: 'Writing query…',
  chart_validate: 'Checking chart…',
  chart_apply: 'Creating chart…',
  check_query: 'Checking query…',
  check_chart: 'Checking chart…',
};

export function toolActivityLabel(name: string): string {
  const readable = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  return toolLabels[name] ?? `${readable ? readable.charAt(0).toUpperCase() + readable.slice(1) : 'Working'}…`;
}

type ToolResult = Extract<ChatActivity, { kind: 'toolResult' }>;
export type ActivityItem = Extract<ChatActivity, { kind: 'text' }> | (Extract<ChatActivity, { kind: 'toolCall' }> & { results: ToolResult[] });

/** Keep calls in their original position and attach results by identity, not tool name. */
export function groupActivity(activity: readonly ChatActivity[]): ActivityItem[] {
  const results = new Map<string, ToolResult[]>();
  const key = (item: Extract<ChatActivity, { kind: 'toolCall' | 'toolResult' }>) => `${item.afterUserId}:${item.toolCallId}`;
  for (const item of activity) if (item.kind === 'toolResult') {
    const matches = results.get(key(item)) ?? [];
    matches.push(item);
    results.set(key(item), matches);
  }
  return activity.flatMap((item): ActivityItem[] => item.kind === 'toolResult' ? []
    : item.kind === 'text' ? [item] : [{ ...item, results: results.get(key(item)) ?? [] }]);
}

/** Results and assistant text do not count as calls. Never borrow activity from another user. */
export function activitySummary(activity: readonly ChatActivity[], userId: number | undefined, live: boolean) {
  const items = userId === undefined ? [] : activity.filter(item => item.afterUserId === userId);
  const calls = items.filter(item => item.kind === 'toolCall');
  const latest = calls.at(-1);
  const earlier = Math.max(0, calls.length - 1);
  const hints = [items.some(item => item.status === 'error') && 'error', items.some(item => item.status === 'interrupted') && 'interrupted'].filter(Boolean).join(' · ');
  return {
    items,
    label: live ? latest ? toolActivityLabel(latest.toolName) : 'Working…' : calls.length ? `${calls.length} tool call${calls.length === 1 ? '' : 's'}` : 'Agent activity',
    earlier,
    disclosure: live && earlier > 0 ? `+${earlier} tool call${earlier === 1 ? '' : 's'}` : 'Details',
    hints,
  };
}
