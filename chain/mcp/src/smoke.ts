/**
 * Live smoke test (NOT part of vitest): drives anima-mcp over real stdio
 * against the seeded demo vault on testnet, exactly like an MCP client would.
 *
 * Run: pnpm mcp:smoke   (needs chain/core/.spike-keys.json — gitignored)
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync } from 'node:fs';

const DEMO_VAULT_ID = '0x0baf7969f2889daec49f233f371dd41ac6883022a7a9d37a1cdabb50565505b5';
const DEMO_OWNER = '0x41af880776e8f2bccddce6920fb5f160aa33abd5d96963c4bc41ebaec5aded39';
const CALL_TIMEOUT = { timeout: 120_000 };

const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

function textOf(res: any): string {
  return (res.content ?? []).map((c: any) => c.text ?? '').join('\n');
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const out = await fn();
  log(`${label} in ${Date.now() - t0}ms`);
  return out;
}

async function main() {
  const keys = JSON.parse(readFileSync(new URL('../../core/.spike-keys.json', import.meta.url).pathname, 'utf8'));

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['-y', 'tsx', 'chain/mcp/src/index.ts'],
    env: {
      ...process.env as Record<string, string>,
      ANIMA_AGENT_KEY: keys.agent,
      ANIMA_VAULT_ID: DEMO_VAULT_ID,
      ANIMA_OWNER_ADDRESS: DEMO_OWNER,
      ANIMA_AGENT_NAME: 'claude-code',
    },
    stderr: 'inherit',
  });
  const client = new Client({ name: 'anima-smoke', version: '0.1.0' });
  await client.connect(transport);
  log('connected; tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));

  // 1) list_notes — seeded demo vault has 13 notes
  const list = await timed('list_notes', () => client.callTool({ name: 'list_notes', arguments: {} }, undefined, CALL_TIMEOUT));
  const listText = textOf(list);
  log(listText.split('\n')[0]);
  if (!/\d+ notes in the vault/.test(listText)) throw new Error(`unexpected list_notes output: ${listText}`);

  // 2) recall('wedding') → "Sister Maya's wedding"
  const recall = await timed('recall(wedding)', () => client.callTool({ name: 'recall', arguments: { query: 'wedding' } }, undefined, CALL_TIMEOUT));
  if (!textOf(recall).includes("Sister Maya's wedding")) throw new Error(`recall missed the wedding note: ${textOf(recall).slice(0, 300)}`);
  log("recall ✓ — Sister Maya's wedding surfaced");

  // 3) remember → writes a real quilt to testnet (slow is fine)
  const remember = await timed('remember', () =>
    client.callTool(
      { name: 'remember', arguments: { title: 'MCP smoke note', body: 'Written by the anima-mcp live smoke test.', tags: ['mcp', 'smoke'] } },
      undefined,
      CALL_TIMEOUT,
    ),
  );
  const remText = textOf(remember);
  if (remember.isError) throw new Error(`remember failed: ${remText}`);
  log(remText.split('\n')[0]);
  const noteId = remText.match(/note (\w{26})/)?.[1];
  if (!noteId) throw new Error('remember did not return a noteId');

  // 4) recall finds the fresh note (write-through index)
  const recall2 = await timed('recall(smoke)', () => client.callTool({ name: 'recall', arguments: { query: 'smoke note' } }, undefined, CALL_TIMEOUT));
  if (!textOf(recall2).includes(noteId)) throw new Error('recall did not surface the freshly remembered note');
  log('write-through recall ✓');

  // 5) read_note round-trips the full markdown
  const read = await timed('read_note', () => client.callTool({ name: 'read_note', arguments: { noteId } }, undefined, CALL_TIMEOUT));
  if (!textOf(read).includes('author: claude-code')) throw new Error('read_note missing attribution');
  log('read_note ✓ (author: claude-code)');

  await client.close();
  log('SMOKE COMPLETE');
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e);
  process.exit(1);
});
