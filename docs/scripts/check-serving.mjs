// Post-deploy serving smoke. Run against the live site after a Coolify deploy:
//   node scripts/check-serving.mjs            (defaults to https://docs.anima.app)
//   node scripts/check-serving.mjs https://docs.staging.example
// Verifies the agent-readable layer is actually reachable with the right
// content types and is not behind an auth wall or a forced download. A
// build-time check cannot see what the server returned, so this lives here.
const BASE = (process.argv[2] || process.env.DOCS_URL || 'https://docs.anima.app').replace(/\/$/, '');
const fail = [];

async function check(path, wantTypes) {
  try {
    const res = await fetch(BASE + path, { redirect: 'follow' });
    if (res.status !== 200) {
      fail.push(`${path}: HTTP ${res.status}${res.status === 401 || res.status === 403 ? ' (auth wall?)' : ''}`);
      return;
    }
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const cd = (res.headers.get('content-disposition') || '').toLowerCase();
    if (wantTypes && !wantTypes.some((t) => ct.includes(t))) {
      fail.push(`${path}: content-type "${ct}" (want one of ${wantTypes.join(', ')})`);
    }
    if (ct.includes('octet-stream') || cd.includes('attachment')) {
      fail.push(`${path}: served as a download, not inline`);
    }
  } catch (e) {
    fail.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

await check('/llms.txt', ['text/plain']);
await check('/llms-full.txt', ['text/plain']);
await check('/build/quickstart.md', ['text/markdown', 'text/plain']);
await check('/build/quickstart/', ['text/html']);

if (fail.length) {
  console.error(`serving smoke FAILED against ${BASE}:`);
  for (const m of fail) console.error('  - ' + m);
  process.exit(1);
}
console.log(`serving smoke passed against ${BASE}: llms files are text/plain, per-page .md is markdown, nothing behind an auth wall.`);
