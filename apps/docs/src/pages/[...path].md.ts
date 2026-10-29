import type { APIRoute } from 'astro';
import { markdown, publishedPages } from '../lib/markdown';
export async function getStaticPaths() {
  return (await publishedPages()).map(page => ({ params: { path: page.path }, props: { page } }));
}
export const GET: APIRoute = ({ props, site }) => new Response(markdown(props.page, site), {
  headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
});
