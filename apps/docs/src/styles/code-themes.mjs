/**
 * Expressive Code (Starlight) themes that mirror the `--tk-*` palette in tokens.css, so Markdown
 * code blocks in the docs read like the homepage compile examples. Keep the two in sync.
 * Values (strings, SQL literals) share one color; backtick SQL identifiers stay plain.
 */
const palettes = {
  light: { bg: '#fbfafd', fg: '#1a1525', kw: '#6d3fc0', fn: '#1b62b5', val: '#a8530a', num: '#52486a', punct: '#6b6280', comment: '#6b6280' },
  dark: { bg: '#19141f', fg: '#f1eff5', kw: '#c7a1f9', fn: '#8fd8f0', val: '#faca60', num: '#b5b9d8', punct: '#9d93b3', comment: '#9d93b3' },
};

function theme(type) {
  const p = palettes[type];
  return {
    name: `typedhouse-${type}`,
    type,
    colors: { 'editor.background': p.bg, 'editor.foreground': p.fg },
    tokenColors: [
      { scope: ['punctuation', 'meta.brace', 'keyword.operator'], settings: { foreground: p.punct } },
      { scope: ['keyword', 'storage', 'keyword.operator.new', 'keyword.operator.expression', 'keyword.other.DML.sql', 'keyword.other.sql'], settings: { foreground: p.kw } },
      { scope: ['entity.name.function', 'support.function', 'meta.function-call entity.name.function', 'entity.name.type', 'support.type.builtin'], settings: { foreground: p.fn } },
      { scope: ['string', 'constant.language', 'constant.character.escape'], settings: { foreground: p.val } },
      { scope: ['string.quoted.other.backtick.sql', 'support.type.property-name', 'variable', 'meta.object-literal.key'], settings: { foreground: p.fg } },
      { scope: ['constant.numeric'], settings: { foreground: p.num } },
      { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: p.comment, fontStyle: 'italic' } },
    ],
  };
}

export const typedhouseLight = theme('light');
export const typedhouseDark = theme('dark');
