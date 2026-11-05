import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import react from '@astrojs/react';
import { unified } from '@astrojs/markdown-remark';
import rehypeBaseLinks from './scripts/rehype-base-links.mjs';
import { typedhouseDark, typedhouseLight } from './src/styles/code-themes.mjs';

const base = process.env.BASE_PATH || '/';

export default defineConfig({
  site: process.env.SITE_URL || 'https://fhur.github.io',
  output: 'static',
  base,
  markdown: { processor: unified({ rehypePlugins: [[rehypeBaseLinks, { base }]] }) },
  devToolbar: { enabled: false },
  trailingSlash: 'ignore',
  integrations: [
    starlight({
      title: 'TypedHouse',
      description:
        'TypedHouse is a type-safe ClickHouse query builder for TypeScript. Compose reusable queries and inspect the SQL you run.',
      logo: { src: './src/assets/logo.svg', alt: '' },
      customCss: ['./src/styles/docs.css'],
      expressiveCode: {
        themes: [typedhouseDark, typedhouseLight],
        useStarlightUiThemeColors: true,
      },
      components: {
        Head: './src/components/Head.astro',
        PageTitle: './src/components/DocTitle.astro',
      },
      sidebar: [
        {
          label: 'Guides',
          items: [
            { label: 'Getting started', slug: 'docs/getting-started' },
            { label: 'Simple example', slug: 'docs/tutorials/composition' },
            { label: 'Advanced example', slug: 'docs/tutorials/advanced-example' },
            { label: 'Latest value and average', slug: 'docs/tutorials/latest-and-average' },
          ],
        },
        { label: 'Query Builder', items: [{ autogenerate: { directory: 'docs/query-builder' } }] },
        { label: 'Functions', items: [{ autogenerate: { directory: 'docs/functions' } }] },
        { label: 'Reference', items: [{ autogenerate: { directory: 'docs/reference' } }] },
        {
          label: 'Simplifying Compiler',
          items: [{ autogenerate: { directory: 'docs/compiler' } }],
        },
        { label: 'Playground', link: '/playground/' },
        { label: 'Engineering blog', link: '/blog/' },
        { label: 'Agent index', link: '/llms.txt' },
      ],
    }),
    react(),
  ],
});
