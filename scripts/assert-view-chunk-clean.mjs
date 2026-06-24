#!/usr/bin/env node
/**
 * Bundle-isolation guard (plan 2026-06-24 U2) — the single most important
 * regression guard for the collaborative-share work.
 *
 * The chromeless reader's VIEW path must stay free of the wallet stack
 * (`@mysten/*`) AND the CRDT stack (`yjs` / `y-protocols` / `lib0`): a guest
 * opens a published note with no wallet and no live-edit code. The live editor
 * (EditView) is loaded behind a DYNAMIC import, so its `@mysten` + yjs graph
 * lands in a separate async chunk that the view path never fetches.
 *
 * This script walks the STATIC import graph reachable from `read.html` (the entry
 * chunk plus every chunk it statically imports, transitively — NOT the dynamic
 * imports) and fails the build if any of those bytes mention a forbidden module.
 * Dynamic-import edges are deliberately followed-not, so EditView's chunk is out
 * of scope (that's exactly where yjs is allowed to live).
 *
 * Usage: node scripts/assert-view-chunk-clean.mjs [distDir]
 *   distDir defaults to frontend/dist.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN = [/@mysten\//, /\byjs\b/, /y-protocols/, /\blib0\b/];

const here = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(process.argv[2] ?? join(here, '..', 'frontend', 'dist'));
const assetsDir = join(distDir, 'assets');
const readHtml = join(distDir, 'read.html');

function fail(msg) {
  console.error(`\n✗ view-chunk isolation FAILED: ${msg}\n`);
  process.exit(1);
}

if (!existsSync(readHtml)) fail(`${readHtml} not found — run \`pnpm build\` first.`);

// 1. Entry chunks: the <script src> tags in read.html.
const html = readFileSync(readHtml, 'utf8');
const entryChunks = [...html.matchAll(/assets\/([A-Za-z0-9_-]+\.js)/g)].map((m) => m[1]);
if (entryChunks.length === 0) fail('no entry script chunks found in read.html.');

// 2. Walk the STATIC import graph. A Vite/rollup chunk references its STATIC
//    imports as `import"./other.js"` / `from"./other.js"`, and its DYNAMIC
//    imports as `import("./other.js")`. We follow only the static edges, so the
//    dynamic EditView chunk (which legitimately holds yjs) is excluded.
const STATIC_IMPORT = /(?:^|[^(])(?:import|from)\s*"\.\/([A-Za-z0-9_-]+\.js)"/g;
const visited = new Set();
const queue = [...entryChunks];
const viewChunks = [];

while (queue.length) {
  const name = queue.shift();
  if (visited.has(name)) continue;
  visited.add(name);
  const path = join(assetsDir, name);
  if (!existsSync(path)) continue;
  const src = readFileSync(path, 'utf8');
  viewChunks.push({ name, src });
  for (const m of src.matchAll(STATIC_IMPORT)) {
    if (!visited.has(m[1])) queue.push(m[1]);
  }
}

// 3. Grep every static view chunk for a forbidden module.
const violations = [];
for (const { name, src } of viewChunks) {
  for (const re of FORBIDDEN) {
    if (re.test(src)) violations.push(`${name} contains ${re}`);
  }
}

if (violations.length) {
  fail(
    `the reader VIEW path statically includes forbidden modules:\n  ${violations.join(
      '\n  ',
    )}\n\nKeep @mysten + yjs behind the dynamic EditView import.`,
  );
}

console.log(
  `✓ view-chunk isolation OK — ${viewChunks.length} static reader chunk(s), no @mysten / yjs / y-protocols / lib0.`,
);
