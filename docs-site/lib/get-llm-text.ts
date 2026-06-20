import { source } from '@/lib/source';

/**
 * Render one docs page as clean markdown for agent consumption: a title +
 * canonical URL header, then the processed markdown body. Used by both the
 * concatenated llms-full.txt and the per-page .md route.
 *
 * Requires `includeProcessedMarkdown` in source.config.ts so `getText`
 * can return the processed (component-stripped) markdown.
 */
export async function getLLMText(page: (typeof source)['$inferPage']) {
  const processed = await page.data.getText('processed');

  return `# ${page.data.title} (${page.url})

${processed}`;
}
