// Markdown-authored links need the same base as Astro-generated navigation.
export default function rehypeBaseLinks({ base = '/' } = {}) {
  const prefix = base.replace(/\/$/, '');
  return function transform(tree) {
    function visit(node) {
      for (const key of ['href', 'src']) {
        const value = node.properties?.[key];
        if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
          && prefix && value !== prefix && !value.startsWith(`${prefix}/`)) {
          node.properties[key] = `${prefix}${value}`;
        }
      }
      for (const child of node.children ?? []) visit(child);
    }
    visit(tree);
  };
}
