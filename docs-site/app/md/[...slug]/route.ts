import { getLLMText } from '@/lib/get-llm-text';
import { source } from '@/lib/source';
import { notFound } from 'next/navigation';

// Per-page clean markdown for agents and readers. Every docs page is reachable
// as raw markdown at `/md/<slug>.md` (e.g. /md/use/notes.md), mirroring the
// page URL under a `/md` prefix.
//
// Why this shape: under `output: 'export'` there are no rewrites, and the
// `/docs/[[...slug]]` page route already owns `/docs/...md`. A clean `[...slug]`
// segment (no literal suffix on the folder) is what Next expands into one
// static file per page; the `.md` extension is baked into the slug *value* in
// generateStaticParams, so the emitted files end in `.md`.
export const revalidate = false;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug?: string[] }> },
) {
  const { slug = [] } = (await params) ?? {};
  // Strip the `.md` we appended to the last segment to recover the page slug.
  const real = [...slug.slice(0, -1), slug.at(-1)?.replace(/\.md$/, '') ?? ''];
  const page = source.getPage(real);
  if (!page) notFound();

  return new Response(await getLLMText(page), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
    },
  });
}

export function generateStaticParams() {
  return source
    .generateParams()
    .filter((p) => Array.isArray(p.slug) && p.slug.length > 0)
    .map((p) => ({ slug: [...p.slug.slice(0, -1), `${p.slug.at(-1)}.md`] }));
}
