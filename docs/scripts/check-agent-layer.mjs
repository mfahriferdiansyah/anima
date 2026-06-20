// Build-time integrity check for the agent-readable layer. Runs against
// docs/dist/ after `astro build`. A build-time check cannot observe what
// Coolify actually served, so the live serving contract is verified separately
// by check-serving.mjs after deploy.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const ORIGIN = 'https://docs.anima.app';
const fail = [];
const ok = (cond, msg) => {
  if (!cond) fail.push(msg);
};

if (!existsSync(DIST)) {
  console.error('check-agent-layer: docs/dist not found. Run `pnpm build` first.');
  process.exit(1);
}

// 1. The llms set files exist.
for (const f of ['llms.txt', 'llms-full.txt', 'llms-small.txt']) {
  ok(existsSync(join(DIST, f)), `missing ${f}`);
}

// 2. Every docs.anima.app URL referenced in llms.txt resolves to a built file.
const llms = readFileSync(join(DIST, 'llms.txt'), 'utf8');
const urls = [...llms.matchAll(/\((https:\/\/docs\.anima\.app[^)]+)\)/g)].map((m) => m[1]);
for (const u of urls) {
  let p = u.slice(ORIGIN.length);
  if (p.endsWith('/')) p += 'index.html';
  ok(existsSync(join(DIST, p.replace(/^\//, ''))), `llms.txt references a missing file: ${u}`);
}

// 3. The dev-track scope is stated, and llms-full is substantial.
ok(/developer-only subset|Build with Anima/i.test(llms), 'llms.txt does not state the developer-track scope');
ok(readFileSync(join(DIST, 'llms-full.txt'), 'utf8').length > 500, 'llms-full.txt looks empty');

// 4. Every per-page .md endpoint is clean markdown, not HTML.
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.md')) {
      const md = readFileSync(p, 'utf8');
      const rel = relative(DIST, p);
      ok(md.trim().length > 0, `${rel} is empty`);
      ok(!/<!doctype html|<html[\s>]/i.test(md), `${rel} contains HTML, not clean markdown`);
      ok(md.startsWith('# '), `${rel} does not start with a markdown heading`);
    }
  }
}
walk(DIST);

if (fail.length) {
  console.error('agent-layer check FAILED:');
  for (const m of fail) console.error('  - ' + m);
  process.exit(1);
}
console.log('agent-layer check passed: llms set files resolve and every per-page .md is clean markdown.');
