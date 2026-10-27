export const scalarNames = ['UInt8', 'UInt16', 'UInt32', 'UInt64', 'UInt128', 'UInt256', 'Int8', 'Int16', 'Int32', 'Int64', 'Int128', 'Int256', 'Float32', 'Float64', 'Bool', 'String', 'UUID', 'Date', 'Date32', 'DateTime', 'IPv4', 'IPv6', 'JSON', 'Nothing'] as const;
export type ScalarName = typeof scalarNames[number];
export type CHType =
  | { kind: 'scalar'; name: ScalarName }
  | { kind: 'FixedString'; n: number }
  | { kind: 'DateTime'; tz?: string }
  | { kind: 'DateTime64'; precision: number; tz?: string }
  | { kind: 'Decimal'; precision: number; scale: number }
  | { kind: 'Enum'; bits: 8 | 16; values: Array<{ name: string; value: number }> }
  | { kind: 'Nullable'; inner: CHType }
  | { kind: 'LowCardinality'; inner: CHType }
  | { kind: 'Array'; inner: CHType }
  | { kind: 'Map'; key: CHType; value: CHType }
  | { kind: 'Tuple'; items: Array<{ name?: string; type: CHType }> }
  | { kind: 'Variant'; items: CHType[] }
  | { kind: 'Dynamic' }
  | { kind: 'AggregateFunction'; fn: string; args: CHType[] }
  | { kind: 'SimpleAggregateFunction'; fn: string; inner: CHType }
  | { kind: 'Unknown'; raw: string };

export function quoteString(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/\0/g, '\\0').replace(/\x08/g, '\\b').replace(/\f/g, '\\f')}'`;
}
export function quoteName(s: string): string {
  return /^[A-Za-z_][A-Za-z_0-9]*$/.test(s) ? s : '`' + s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/\0/g, '\\0').replace(/\x08/g, '\\b').replace(/\f/g, '\\f') + '`';
}
export function print(t: CHType): string {
  switch (t.kind) {
    case 'scalar': return t.name;
    case 'Unknown': return t.raw;
    case 'Dynamic': return 'Dynamic';
    case 'FixedString': return `FixedString(${t.n})`;
    case 'DateTime': return t.tz === undefined ? 'DateTime' : `DateTime(${quoteString(t.tz)})`;
    case 'DateTime64': return `DateTime64(${t.precision}${t.tz === undefined ? '' : ', ' + quoteString(t.tz)})`;
    case 'Decimal': return `Decimal(${t.precision}, ${t.scale})`;
    case 'Enum': return `Enum${t.bits}(${t.values.map(v => `${quoteString(v.name)} = ${v.value}`).join(', ')})`;
    case 'Nullable': case 'LowCardinality': case 'Array': return `${t.kind}(${print(t.inner)})`;
    case 'Map': return `Map(${print(t.key)}, ${print(t.value)})`;
    case 'Tuple': return `Tuple(${t.items.map(i => (i.name === undefined ? '' : quoteName(i.name) + ' ') + print(i.type)).join(', ')})`;
    case 'Variant': return `Variant(${t.items.map(print).join(', ')})`;
    case 'AggregateFunction': return `AggregateFunction(${[t.fn, ...t.args.map(print)].join(', ')})`;
    case 'SimpleAggregateFunction': return `SimpleAggregateFunction(${t.fn}, ${print(t.inner)})`;
  }
}

class Parser {
  pos = 0;
  constructor(readonly text: string) {}
  ws(): void { while (/\s/.test(this.text[this.pos] ?? '') && this.pos < this.text.length) this.pos++; }
  take(s: string): boolean { this.ws(); if (this.text.startsWith(s, this.pos)) { this.pos += s.length; return true; } return false; }
  need(s: string): void { if (!this.take(s)) throw new Error(`Expected ${s}`); }
  word(): string { this.ws(); const m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(this.text.slice(this.pos)); if (!m) throw new Error('Expected identifier'); this.pos += m[0].length; return m[0]; }
  number(): number { this.ws(); const m = /^-?\d+/.exec(this.text.slice(this.pos)); if (!m) throw new Error('Expected integer'); this.pos += m[0].length; const n = Number(m[0]); if (!Number.isSafeInteger(n)) throw new Error('Unsafe integer'); return n; }
  quoted(): string {
    this.ws(); const q = this.text[this.pos++]; if (q !== "'" && q !== '`' && q !== '"') throw new Error('Expected quote');
    let out = '';
    while (this.pos < this.text.length) {
      const c = this.text[this.pos++]!;
      if (c === q) { if (this.text[this.pos] === q) { this.pos++; out += q; } else return out; }
      else if (c === '\\') {
        const e = this.text[this.pos++];
        if (e === undefined) throw new Error('Escape');
        if (e === 'x' && /^[0-9a-fA-F]{2}/.test(this.text.slice(this.pos))) {
          // Hex escapes are UTF-8 bytes, not individual Unicode code points.
          // Decode the entire run without re-encoding adjacent literal Unicode.
          const bytes: number[] = [];
          do {
            bytes.push(Number.parseInt(this.text.slice(this.pos, this.pos + 2), 16));
            this.pos += 2;
            if (!/^\\x[0-9a-fA-F]{2}/.test(this.text.slice(this.pos))) break;
            this.pos += 2;
          } while (true);
          out += new TextDecoder('utf-8', { ignoreBOM: true }).decode(new Uint8Array(bytes));
        } else {
          const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', '0': '\0', b: '\b', f: '\f', a: '\x07', v: '\v', '\\': '\\', "'": "'", '"': '"', '`': '`', '/': '/', '=': '=' };
          // ClickHouse preserves the slash for unrecognized escape sequences.
          out += escapes[e] ?? '\\' + e;
        }
      }
      else out += c;
    }
    throw new Error('Unclosed quote');
  }
  list<T>(item: () => T): T[] { const out: T[] = []; if (this.take(')')) return out; do { out.push(item()); } while (this.take(',')); this.need(')'); return out; }
  type(depth = 0): CHType {
    if (depth > 128) throw new Error('Type nesting limit');
    const name = this.word(); const child = () => this.type(depth + 1);
    if (!this.take('(')) {
      if (name === 'Dynamic') return { kind: 'Dynamic' };
      // Bare DateTime has one canonical representation; print also accepts scalar DateTime.
      if (name === 'DateTime') return { kind: 'DateTime' };
      if ((scalarNames as readonly string[]).includes(name)) return { kind: 'scalar', name: name as ScalarName };
      throw new Error('Unknown type');
    }
    let result: CHType;
    switch (name) {
      case 'Nullable': case 'LowCardinality': case 'Array': result = { kind: name, inner: child() }; break;
      case 'FixedString': result = { kind: name, n: this.number() }; break;
      case 'DateTime': result = { kind: name, tz: this.quoted() }; break;
      case 'DateTime64': { const precision = this.number(); result = { kind: name, precision, ...(this.take(',') ? { tz: this.quoted() } : {}) }; break; }
      case 'Decimal': { const precision = this.number(); this.need(','); result = { kind: name, precision, scale: this.number() }; break; }
      case 'Decimal32': case 'Decimal64': case 'Decimal128': case 'Decimal256': result = { kind: 'Decimal', precision: { Decimal32: 9, Decimal64: 18, Decimal128: 38, Decimal256: 76 }[name], scale: this.number() }; break;
      case 'Map': { const key = child(); this.need(','); result = { kind: name, key, value: child() }; break; }
      case 'Variant': return { kind: name, items: this.list(child) };
      case 'Tuple': return { kind: name, items: this.list(() => {
        this.ws(); const start = this.pos;
        if (['`', '"', "'"].includes(this.text[this.pos]!)) { const n = this.quoted(); return { name: n, type: child() }; }
        const n = this.word(); this.ws();
        if (/^[A-Za-z_]/.test(this.text[this.pos] ?? '')) return { name: n, type: child() };
        this.pos = start; return { type: child() };
      }) };
      case 'Enum8': case 'Enum16': return { kind: 'Enum', bits: name === 'Enum8' ? 8 : 16, values: this.list(() => { const n = this.quoted(); this.need('='); return { name: n, value: this.number() }; }) };
      case 'AggregateFunction': case 'SimpleAggregateFunction': {
        const start = this.pos; this.word();
        // Parametric function names contain their own balanced argument list.
        if (this.take('(')) { let level = 1; while (level) { this.ws(); const c = this.text[this.pos]; if (c === undefined) throw new Error('Unclosed function'); if (c === "'" || c === '`' || c === '"') this.quoted(); else { this.pos++; if (c === '(') level++; if (c === ')') level--; } } }
        const fn = this.text.slice(start, this.pos).trim();
        if (name === 'AggregateFunction') { const args = this.take(',') ? this.list(child) : (this.need(')'), []); return { kind: name, fn, args }; }
        this.need(','); result = { kind: name, fn, inner: child() }; break;
      }
      default: throw new Error('Unknown type');
    }
    this.need(')'); return result;
  }
}
/** Malformed, unsupported, or excessively deep inputs are preserved verbatim. */
export function parseCHType(text: string): CHType {
  try { const p = new Parser(text); const t = p.type(); p.ws(); if (p.pos !== text.length) throw new Error('Trailing input'); return t; }
  catch { return { kind: 'Unknown', raw: text }; }
}
