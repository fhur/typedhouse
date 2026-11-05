import { describe, expect, it } from 'vitest';
import type { ChatActivity } from '../server/chat.js';
import { activitySummary, groupActivity, toolActivityLabel } from '../web/activity.js';

const call = (id: string, toolName: string, afterUserId = 1): ChatActivity => ({ id, afterUserId, kind: 'toolCall', toolCallId: id, toolName, arguments: '{}', truncated: false, status: 'success' });

describe('compact activity', () => {
  it('renders four calls and four results as four items, pairing repeated tools by call ID', () => {
    const calls = ['a', 'b', 'c', 'd'].map(id => call(id, 'query_run'));
    const results: ChatActivity[] = [...calls].reverse().map(item => ({
      id: `result-${item.id}`, afterUserId: item.afterUserId, kind: 'toolResult',
      toolCallId: item.id, toolName: 'query_run', text: item.id, status: 'success', truncated: false, isError: false,
    }));
    const grouped = groupActivity([...calls, ...results]);
    expect(grouped).toHaveLength(4);
    expect(grouped.map(item => item.kind === 'toolCall' && item.results.map(result => result.text))).toEqual([['a'], ['b'], ['c'], ['d']]);
    expect(grouped.map(item => item.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('keeps pending calls and public text, and isolates reused IDs across turns', () => {
    const text: ChatActivity = { id: 'text', afterUserId: 1, kind: 'text', text: 'Checking', status: 'success', truncated: false };
    const result: ChatActivity = { id: 'result', afterUserId: 2, kind: 'toolResult', toolCallId: 'same', toolName: 'query_run', text: 'error', status: 'error', isError: true, truncated: true };
    expect(groupActivity([call('same', 'query_run'), text, call('same', 'query_run', 2), result])).toMatchObject([
      { kind: 'toolCall', results: [] }, { kind: 'text', text: 'Checking' },
      { kind: 'toolCall', results: [{ text: 'error', truncated: true }] },
    ]);
  });
  it('maps every current and legacy tool and provides readable fallbacks', () => {
    const labels = ['docs_search', 'docs_read', 'tables_list', 'table_describe', 'columns_describe', 'query_validate', 'query_run', 'query_results_get', 'query_apply', 'chart_validate', 'chart_apply', 'check_query', 'check_chart'].map(toolActivityLabel);
    expect(labels).toEqual(['Searching docs…', 'Reading docs…', 'Finding tables…', 'Inspecting table…', 'Inspecting columns…', 'Checking query…', 'Running query…', 'Reading query results…', 'Writing query…', 'Checking chart…', 'Creating chart…', 'Checking query…', 'Checking chart…']);
    expect(toolActivityLabel('custom_tool')).toBe('Custom tool…');
    expect(toolActivityLabel('x')).toBe('X…');
    expect(toolActivityLabel('')).toBe('Working…');
    expect(toolActivityLabel('_-')).toBe('Working…');
  });
  it('counts only earlier calls, retaining latest completed call while live', () => {
    const items: ChatActivity[] = [call('a', 'docs_search'), { id: 'text', afterUserId: 1, kind: 'text', text: 'thinking', truncated: false, status: 'success' }, call('b', 'query_apply'), { id: 'result', afterUserId: 1, kind: 'toolResult', toolCallId: 'b', toolName: 'query_apply', text: 'failed', truncated: false, status: 'error', isError: true }];
    expect(activitySummary(items, 1, true)).toMatchObject({ label: 'Writing query…', earlier: 1, disclosure: '+1 tool call', hints: 'error' });
    expect(activitySummary([...items, call('c', 'chart_apply')], 1, true).disclosure).toBe('+2 tool calls');
    expect(activitySummary(items.slice(0, 1), 1, true)).toMatchObject({ earlier: 0, disclosure: 'Details' });
    expect(activitySummary(items, 1, false)).toMatchObject({ label: '2 tool calls', disclosure: 'Details', hints: 'error' });
  });
  it('isolates pending and newer turns and keeps interruption history', () => {
    const items = [{ ...call('a', 'query_apply'), status: 'interrupted' as const }];
    for (const id of [undefined, 2]) expect(activitySummary(items, id, true)).toMatchObject({ label: 'Working…', earlier: 0, items: [], hints: '' });
    expect(activitySummary(items, 1, false)).toMatchObject({ label: '1 tool call', disclosure: 'Details', hints: 'interrupted' });
    expect(activitySummary([], 1, false).label).toBe('Agent activity');
  });
});
