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
      title: 'TypedHouse',
      description: 'TypedHouse is a type-safe ClickHouse query builder for TypeScript. Compose reusable queries and inspect the SQL you run.',
      customCss: ['./src/styles/docs.css'],
      components: { Head: './src/components/Head.astro', PageTitle: './src/components/DocTitle.astro' },
      sidebar: [
        {
          label: 'Guides',
          items: [
            { label: 'Getting started', slug: 'docs/getting-started' },
            { label: 'Simple example', slug: 'docs/tutorials/composition' },
            { label: 'Advanced example', slug: 'docs/tutorials/advanced-example' },
          ],
        },
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
