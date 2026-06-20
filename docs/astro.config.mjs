// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLlmsTxt from 'starlight-llms-txt';

// Subdomain deploy (docs.anima.app): set `site`, no `base` path.
// Sidebar order is pinned via explicit `items` (not autogenerate), so Starlight
// does not alphabetize the tracks.
export default defineConfig({
  site: 'https://docs.anima.app',
  integrations: [
    starlight({
      title: 'Anima',
      description:
        'Docs for Anima, an agentic notes and canvas workspace where your own ai tools read and write the same notes.',
      customCss: ['./src/styles/anima.css'],
      head: [
        { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' } },
        { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: true } },
        {
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&family=Space+Grotesk:wght@500;600;700&display=swap',
          },
        },
      ],
      plugins: [
        // Agent-readable layer: emits /llms.txt, /llms-full.txt, /llms-small.txt.
        // The "Build with Anima" customSet is the developer-only subset (R13).
        starlightLlmsTxt({
          projectName: 'Anima',
          description:
            'Anima is an agentic workspace where your own AI agents and your team read and write the same notes and canvas, sealed to storage you own, so it survives any app.',
          details:
            'This covers both tracks. The "Build with Anima" set is the developer-only subset: connect your own agent over anima-mcp (quickstart), the MCP tool reference, concept pages on how Anima works, FAQ, and self-hosting.',
          customSets: [
            {
              label: 'Build with Anima (developer track)',
              paths: ['build/**'],
              description:
                'Developer-only subset: quickstart, MCP tool reference, concepts, FAQ, and self-hosting.',
            },
          ],
        }),
      ],
      sidebar: [
        {
          label: 'Use Anima',
          items: [
            { slug: 'use/getting-started' },
            { slug: 'use/notes' },
            { slug: 'use/publishing-and-export' },
            { slug: 'use/companion' },
          ],
        },
        {
          label: 'Build with Anima',
          items: [
            { slug: 'build/quickstart' },
            { slug: 'build/mcp-reference' },
            { slug: 'build/faq' },
            { slug: 'build/self-hosting' },
            {
              label: 'How it works',
              items: [
                { slug: 'build/concepts/custody-and-ownership' },
                { slug: 'build/concepts/two-key-model' },
                { slug: 'build/concepts/seal-encryption' },
                { slug: 'build/concepts/walrus-storage' },
                { slug: 'build/concepts/resurrection' },
                { slug: 'build/concepts/signed-attribution' },
              ],
            },
          ],
        },
      ],
    }),
  ],
});
