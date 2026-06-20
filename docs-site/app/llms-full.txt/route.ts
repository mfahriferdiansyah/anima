import { source } from '@/lib/source';
import { getLLMText } from '@/lib/get-llm-text';

// llms-full.txt = every docs page concatenated as clean markdown, in source
// order. `revalidate = false` pre-renders it to a static file for export.
export const revalidate = false;

const scope = `# Anima docs (full text)

> Notes on a shared canvas. Your own ai tools read and write them too.

Every Anima docs page below, concatenated as markdown. Two tracks: using Anima (notes, companion, publishing and export) and the developer build track (connect your own agent over anima-mcp, the MCP tool reference, self-hosting, and the custody / Seal / Walrus / resurrection internals).`;

export async function GET() {
  const scan = source.getPages().map(getLLMText);
  const scanned = await Promise.all(scan);

  return new Response(`${scope}\n\n${scanned.join('\n\n')}`);
}
