import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';

// Per-page raw-markdown endpoint: every docs page is also available at
// `/<slug>.md` as clean markdown, served as text/markdown so a coding agent
// (or the "view as markdown" link) can fetch the source without scraping HTML.
export const getStaticPaths: GetStaticPaths = async () => {
  const docs = await getCollection('docs');
  return docs.map((entry) => ({
    params: { slug: entry.id },
    props: { entry },
  }));
};

export const GET: APIRoute = ({ props }) => {
  const entry = (props as { entry: { data: { title: string }; body?: string } }).entry;
  const title = entry.data.title;
  const body = (entry.body ?? '').trim();
  const markdown = `# ${title}\n\n${body}\n`;
  return new Response(markdown, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
};
