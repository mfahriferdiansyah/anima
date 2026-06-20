import { source } from '@/lib/source';
import {
  DocsPage,
  DocsBody,
  DocsTitle,
  DocsDescription,
} from 'fumadocs-ui/page';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/mdx-components';
import { MarkdownCopyButton } from '@/components/ai/page-actions';
import type { Metadata } from 'next';

export default async function Page(props: {
  params: Promise<{ slug?: string[] }>;
}) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDXContent = page.data.body;
  // Every real page is also raw markdown at `/md/<slug>.md`. page.url is now
  // root-based (e.g. /build/quickstart -> /md/build/quickstart.md). The root
  // index has no slug, so the copy button only shows on real content pages.
  const hasSlug = (params.slug?.length ?? 0) > 0;
  const markdownUrl = `/md${page.url}.md`;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">
        {page.data.description}
      </DocsDescription>
      {hasSlug && (
        <div className="flex flex-row items-center gap-2 border-b border-fd-border pt-2 pb-6">
          <MarkdownCopyButton markdownUrl={markdownUrl} />
        </div>
      )}
      <DocsBody>
        <MDXContent components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
