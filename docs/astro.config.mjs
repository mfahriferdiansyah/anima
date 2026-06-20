// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Subdomain deploy (docs.anima.app): set `site`, no `base` path.
// Sidebar order is pinned via explicit `items` (not autogenerate), so Starlight
// does not alphabetize the tracks. Pages are added as later units land.
export default defineConfig({
  site: 'https://docs.anima.app',
  integrations: [
    starlight({
      title: 'Anima',
      description:
        'Docs for Anima, an agentic notes and canvas workspace where your own ai tools read and write the same notes.',
      sidebar: [
        {
          label: 'Use Anima',
          items: [{ slug: 'use/getting-started' }],
        },
        {
          label: 'Build with Anima',
          items: [{ slug: 'build/quickstart' }],
        },
      ],
    }),
  ],
});
