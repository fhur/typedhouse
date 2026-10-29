import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import react from '@astrojs/react';
import rehypeBaseLinks from './scripts/rehype-base-links.mjs';

const base = process.env.BASE_PATH || '/';

export default defineConfig({
  site: process.env.SITE_URL || 'https://chql.pages.dev',
  output: 'static',
  base,
  markdown: { rehypePlugins: [[rehypeBaseLinks, { base }]] },
  devToolbar: { enabled: false },
  trailingSlash: 'ignore',
  integrations: [
    starlight({
      title: 'chql',
      description: 'Typed, composable queries for ClickHouse. Explicit APIs. Typed constraints. Inspectable SQL.',
      customCss: ['./src/styles/docs.css'],
      components: { PageTitle: './src/components/DocTitle.astro' },
      sidebar: [
        { label: 'Start here', items: [{ label: 'Build your first query', slug: 'docs/getting-started' }] },
        { label: 'Tutorials', autogenerate: { directory: 'docs/tutorials' } },
        { label: 'Query Builder', autogenerate: { directory: 'docs/query-builder' } },
        { label: 'Functions', autogenerate: { directory: 'docs/functions' } },
        { label: 'Reference', autogenerate: { directory: 'docs/reference' } },
        { label: 'Simplifying Compiler', autogenerate: { directory: 'docs/compiler' } },
        { label: 'Playground', link: '/playground/' },
        { label: 'Engineering blog', link: '/blog/' },
        { label: 'Agent index', link: '/llms.txt' },
      ],
    }),
    react(),
  ],
});
