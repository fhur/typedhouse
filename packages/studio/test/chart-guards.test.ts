// A chart can't take over the page; ordinary charts about URLs pass; a bad path is a 400, not a hung client.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkChartSpec } from '../server/chart.js';
import type { Connection } from '../server/clickhouse.js';
import { unavailableLlm } from '../server/llm.js';
import { startServer } from '../server/server.js';
import { withoutPageTargets } from '../web/chart-data.js';

const columns = [{ name: 'page', type: 'String' }, { name: 'visits', type: 'UInt64' }, { name: 'url', type: 'String' }];
const encoding = { x: { field: 'page', type: 'nominal' }, y: { field: 'visits', type: 'quantitative' } };
const bar = { mark: 'bar', encoding };

describe('a bind may not reach into the page', () => {
  it.each<[string, Record<string, unknown>]>([
    ['a range input', { params: [{ name: 'a', value: 1, bind: { input: 'range', min: 0, max: 2, element: 'body' } }] }],
    ['listening to an element that exists', { params: [{ name: 'a', bind: { element: '.cm-content' } }] }],
    ['per-field binds', { params: [{ name: 'a', select: { type: 'point', fields: ['page'] }, bind: { page: { input: 'select', options: ['x'], element: '#root' } } }] }],
    ['in a layer', { layer: [{ params: [{ name: 'a', bind: { input: 'range', element: 'body' } }], ...bar }] }],
    ['in config', { config: { params: [{ name: 'a', bind: { input: 'range', element: 'body' } }] } }],
  ])('%s is refused', (_name, extra) => {
    expect(checkChartSpec({ ...bar, ...extra }, columns)).toMatchObject({ ok: false, message: expect.stringContaining('.element') });
  });

  it('a bind inside the chart still passes, and `element` elsewhere means nothing', () => {
    expect(checkChartSpec({ ...bar, params: [{ name: 'a', value: 1, bind: { input: 'range', min: 0, max: 2 } }] }, columns)).toMatchObject({ ok: true });
    expect(checkChartSpec({ ...bar, params: [{ name: 'p', select: 'point', bind: 'legend' }] }, columns)).toMatchObject({ ok: true });
    expect(checkChartSpec({ ...bar, usage: { element: 'body' } }, columns)).toMatchObject({ ok: true });
  });

  it('the render-time guard drops only that, at any depth, and leaves the input', () => {
    const spec = {
      element: 'kept',
      params: [{ name: 'a', bind: { input: 'range', max: 2, element: 'body' } }, { name: 'b', bind: { page: { input: 'select', element: '#root' } } }],
      layer: [{ params: [{ name: 'c', bind: { element: 'body' } }] }],
    };
    const before = JSON.stringify(spec);
    expect(withoutPageTargets(spec)).toEqual({
      element: 'kept',
      params: [{ name: 'a', bind: { input: 'range', max: 2 } }, { name: 'b', bind: { page: { input: 'select' } } }],
      layer: [{ params: [{ name: 'c', bind: {} }] }],
    });
    expect(JSON.stringify(spec)).toBe(before);
  });
});

describe('address text is allowed, what can make a request is not', () => {
  it.each<[string, unknown]>([
    ['replace() on a URL column', { ...bar, transform: [{ calculate: "replace(datum.url, 'https://', '')", as: 'host' }] }],
    ['indexof() on a URL column', { ...bar, transform: [{ calculate: "indexof(datum.url, 'https://')", as: 'n' }] }],
    ['a title with an address', { ...bar, title: 'Traffic to https://example.com' }],
    ['a title starting with //', { ...bar, title: '// top pages' }],
    ['prose with URL (', { ...bar, title: 'Visits by URL (top 10)' }],
    ['an axis title url (path)', { mark: 'bar', encoding: { ...encoding, x: { ...encoding.x, title: 'url (path)' } } }],
    ['a word ending in url(', { ...bar, title: 'curl(x) and hurl(y)' }],
  ])('%s passes', (_name, spec) => {
    expect(checkChartSpec(spec, columns)).toMatchObject({ ok: true });
  });

  it.each<[string, unknown]>([
    ['a CSS paint', { mark: { type: 'bar', fill: 'url(https://evil.example/a.svg#p)' }, encoding }],
    ['an upper-case CSS cursor', { mark: { type: 'bar', cursor: 'URL(x.cur), auto' }, encoding }],
    ['url( in an expression', { ...bar, transform: [{ calculate: "'url(x' + datum.page", as: 'u' }] }],
    ['javascript:', { ...bar, title: 'JavaScript:alert(1)' }],
    ['an image mark', { mark: 'image', encoding }],
    ['an href', { ...bar, encoding: { ...encoding, href: { field: 'url' } } }],
    ['usermeta', { ...bar, usermeta: {} }],
    ['raw Vega', { ...bar, $schema: 'https://vega.github.io/schema/vega/v5.json' }],
    ['inlined data', { ...bar, data: { values: [] } }],
  ])('%s is refused', (_name, spec) => {
    expect(checkChartSpec(spec, columns).ok).toBe(false);
  });
});

describe('the static server on a malformed path', () => {
  it('answers 400 instead of hanging, and still serves good paths', async () => {
    const packageRoot = mkdtempSync(join(tmpdir(), 'studio-static-'));
    mkdirSync(join(packageRoot, 'dist', 'web'), { recursive: true });
    writeFileSync(join(packageRoot, 'dist', 'web', 'index.html'), 'HELLO');
    const server = await startServer({ conn: {} as Connection, llm: unavailableLlm('off'), port: 0, ui: 'static', packageRoot });
    try {
      const get = (path: string) => fetch(`${server.url}${path}`, { signal: AbortSignal.timeout(5_000) });
      for (const bad of ['/%E0%A4%A', '/%', '/a/%ZZ.js']) expect((await get(bad)).status, bad).toBe(400);
      expect(await (await get('/')).text()).toBe('HELLO');
      expect(await (await get('/some/route')).text()).toBe('HELLO');
      expect((await get('/missing.js')).status).toBe(404);
      expect((await get('/%00.js')).status).toBe(404);
    } finally {
      await server.close();
      rmSync(packageRoot, { recursive: true, force: true });
    }
  });
});
