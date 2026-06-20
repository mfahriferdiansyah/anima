import { source } from '@/lib/source';
import { llms } from 'fumadocs-core/source';

// llms.txt = the index: a titled, linked map of every docs page, in nav order.
// `revalidate = false` pre-renders it to a static file for `output: 'export'`.
export const revalidate = false;

const scope = `# Anima docs

> Notes on a shared canvas. Your own ai tools read and write them too. Anima is an agentic workspace where your own AI agents and your team read and write the same notes and canvas, sealed to storage you own, so it survives any app.

These docs cover two tracks: using Anima (notes, companion, publishing) and building on Anima as a developer (connecting your own agent over anima-mcp, the MCP tool reference, and how the custody, Seal, Walrus, and resurrection internals work). The build track is the developer-facing scope. For the full text of every page concatenated, see /llms-full.txt; any page is also available as raw markdown at /md + its path + .md (for example /build/quickstart becomes /md/build/quickstart.md).`;

export function GET() {
  return new Response(`${scope}\n\n${llms(source).index()}`);
}
