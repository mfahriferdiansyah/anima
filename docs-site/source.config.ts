import { defineDocs, defineConfig } from 'fumadocs-mdx/config';

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    // Keep the processed markdown around so the agent-readable layer
    // (llms.txt, llms-full.txt, per-page .md) can serve clean text via
    // page.data.getText('processed').
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
});

export default defineConfig();
