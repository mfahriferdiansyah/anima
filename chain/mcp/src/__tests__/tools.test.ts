/**
 * Pure-unit tests for the MCP tool handlers and the VaultClient glue —
 * core's network functions are mocked, nothing touches testnet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

vi.mock('../../../core/src/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../core/src/index.js')>();
  return {
    ...actual,
    createSuiClient: vi.fn(() => ({})),
    nodeFetchWithLongConnect: vi.fn(async () => (() => {}) as unknown as typeof fetch),
    SealVault: vi.fn(() => ({})),
    readVault: vi.fn(),
    preflight: vi.fn(),
    writeTurn: vi.fn(),
    listVaultQuilts: vi.fn(),
    readAll: vi.fn(),
  };
});

import { newNote, readVault, preflight, writeTurn, listVaultQuilts, readAll, type IndexedNote } from '../../../core/src/index.js';
import { loadConfig } from '../config.js';
import { VaultClient } from '../vaultClient.js';
import { recallTool, rememberTool, listNotesTool, readNoteTool } from '../tools.js';

const VAULT_ID = `0x${'1'.repeat(64)}`;
const OWNER = `0x${'2'.repeat(64)}`;

function makeClient(agentName = 'claude-code'): VaultClient {
  return new VaultClient(
    loadConfig({
      ANIMA_AGENT_KEY: new Ed25519Keypair().getSecretKey(),
      ANIMA_VAULT_ID: VAULT_ID,
      ANIMA_OWNER_ADDRESS: OWNER,
      ANIMA_AGENT_NAME: agentName,
      ANIMA_CACHE_DIR: mkdtempSync(join(tmpdir(), 'anima-mcp-test-')),
    }),
  );
}

const entry = (title: string, body: string, tags: string[] = []): IndexedNote => ({
  note: newNote({ title, body, tags, author: 'anima' }),
  location: { quiltPatchId: 'p1', quiltBlobId: 'qb1', blobObjectId: 'ob1' },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadConfig', () => {
  it('missing env → clear pairing error naming every missing var', () => {
    expect(() => loadConfig({})).toThrowError(
      /not paired.*ANIMA_AGENT_KEY.*ANIMA_VAULT_ID.*ANIMA_OWNER_ADDRESS/s,
    );
  });
});

describe('recall', () => {
  it('returns formatted hits as text + structuredContent', async () => {
    const wedding = entry("Sister Maya's wedding", 'Maya got married on a vineyard.', ['family']);
    const client = { agentAddress: '0x0', search: vi.fn(async () => [wedding]) } as unknown as VaultClient;

    const res = await recallTool(client, { query: 'wedding' });
    expect(res.isError).toBeUndefined();
    expect(res.content[0].text).toContain("Sister Maya's wedding");
    expect(res.content[0].text).toContain(wedding.note.noteId);
    expect(res.content[0].text).toContain('vineyard');
    expect(res.structuredContent).toEqual({
      notes: [
        {
          noteId: wedding.note.noteId,
          title: wedding.note.title,
          body: wedding.note.body,
          tags: ['family'],
          updatedAt: wedding.note.updatedAt,
        },
      ],
    });
  });
});

describe('read_note', () => {
  it('unknown id → clear error, not a stack trace', async () => {
    const client = { agentAddress: '0x0', read: vi.fn(async () => undefined) } as unknown as VaultClient;
    const res = await readNoteTool(client, { noteId: 'NOPE' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('No note with id NOPE');
  });
});

describe('remember (VaultClient over mocked core)', () => {
  function arm(client: VaultClient) {
    vi.mocked(readVault).mockResolvedValue({ vaultId: VAULT_ID, owner: OWNER, name: 'Anima', agents: [client.agentAddress] });
    vi.mocked(listVaultQuilts).mockResolvedValue([]);
    vi.mocked(readAll).mockResolvedValue([]);
    vi.mocked(preflight).mockResolvedValue({ sui: 1n, wal: 1n, ok: true, needsSui: false, needsWal: false });
    vi.mocked(writeTurn).mockImplementation(async (_deps, notes) => ({
      quiltBlobId: 'qb-new',
      blobObjectId: 'ob-new',
      transferDigest: 'digest',
      perNote: notes.map((n) => ({ noteId: n.noteId, version: n.version, quiltPatchId: 'patch-new' })),
    }));
  }

  it('writes with author from env and upserts the cached index (no re-read)', async () => {
    const client = makeClient('claude-code');
    arm(client);

    const res = await rememberTool(client, { title: 'MCP smoke note', body: 'written via MCP', tags: ['mcp'] });
    expect(res.isError).toBeUndefined();

    expect(writeTurn).toHaveBeenCalledTimes(1);
    const [, notes] = vi.mocked(writeTurn).mock.calls[0];
    expect(notes).toHaveLength(1);
    expect(notes[0].author).toBe('claude-code');
    expect(notes[0].title).toBe('MCP smoke note');
    expect(res.content[0].text).toContain(notes[0].noteId);
    expect(res.content[0].text).toContain('qb-new');

    // write-through: recall finds the new note from the in-memory index, no chain re-read
    const recall = await recallTool(client, { query: 'smoke note' });
    expect(recall.content[0].text).toContain('MCP smoke note');
    expect(readAll).toHaveBeenCalledTimes(1); // only the initial rebuild
  });

  it('insufficient funds → funding error naming the agent address', async () => {
    const client = makeClient();
    arm(client);
    vi.mocked(preflight).mockResolvedValue({ sui: 0n, wal: 0n, ok: false, needsSui: true, needsWal: true });

    const res = await rememberTool(client, { title: 'x', body: 'y' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain(client.agentAddress);
    expect(res.content[0].text).toContain('Fund it');
  });
});

describe('unpaired key (edge #6)', () => {
  it('every tool returns the pairing message, not NoAccessError or a stack trace', async () => {
    const client = makeClient();
    vi.mocked(readVault).mockResolvedValue({ vaultId: VAULT_ID, owner: OWNER, name: 'Anima', agents: [] });

    const res = await listNotesTool(client);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain(`Agent key not paired: ${client.agentAddress}`);
    expect(res.content[0].text).toContain('Register it in the ANIMA app (Settings → Connect external agent)');
    expect(listVaultQuilts).not.toHaveBeenCalled(); // fails before touching Walrus
  });
});
