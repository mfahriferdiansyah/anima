import { createMDX } from 'fumadocs-mdx/next';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const withMDX = createMDX();

const root = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Fully static site: `next build` emits an `out/` directory of HTML +
  // assets, with no Node server. This is what lets the docs ship as a
  // Walrus Site / any static host. Search runs as a downloaded static index
  // (see app/api/search/route.ts) and the agent-readable files (llms*.txt,
  // per-page .md) are pre-rendered route handlers.
  output: 'export',
  // Static export cannot run the Next image optimizer at request time.
  images: { unoptimized: true },
  // Pin the workspace root to this package; the parent anima/ has its own
  // lockfile, which Next would otherwise infer as the root.
  turbopack: {
    root,
  },
};

export default withMDX(config);
