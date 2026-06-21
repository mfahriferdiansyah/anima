/**
 * Unit tests for covers.ts. Chain I/O (walrus, seal, suiClient) is fully mocked;
 * the live blob round-trip is NOT tested here (requires a real wallet + chain).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadCover, parseCoverRef, listVaultCovers } from '../covers.js';

// --- mock helpers ---

function makeSeal() {
  return {
    encryptNote: vi.fn().mockImplementation(async (_noteId: string, bytes: Uint8Array) =>
      // prepend 'ENC:' to simulate encryption
      new Uint8Array([69, 78, 67, 58, ...bytes]),
    ),
    decryptNote: vi.fn(),
  };
}

function makeSuiClient(overrides: Record<string, unknown> = {}) {
  return {
    walrus: {
      getBlobType: vi.fn().mockResolvedValue('0x2::walrus::Blob'),
      writeBlob: vi.fn().mockResolvedValue({
        blobObject: { id: 'obj-cover-1' },
        blobId: 'blobid-cover-1',
      }),
      readBlobAttributes: vi.fn(),
      ...overrides,
    },
    getOwnedObjects: vi.fn().mockResolvedValue({ data: [], hasNextPage: false }),
    signAndExecuteTransaction: vi.fn().mockResolvedValue({
      effects: { status: { status: 'success' } },
      digest: '0xdigest',
    }),
    waitForTransaction: vi.fn().mockResolvedValue(undefined),
  };
}

// Valid-format Sui addresses (64 hex chars after 0x)
const WALLET_ADDRESS = '0x' + 'a'.repeat(64);
const VAULT_ID = '0x' + 'b'.repeat(64);

const DEPS = {
  suiClient: null as unknown as ReturnType<typeof makeSuiClient>,
  seal: null as unknown as ReturnType<typeof makeSeal>,
  agentSigner: { toSuiAddress: () => '0x' + 'c'.repeat(64) } as any,
  walletAddress: WALLET_ADDRESS,
  vaultId: VAULT_ID,
};

beforeEach(() => {
  DEPS.suiClient = makeSuiClient();
  DEPS.seal = makeSeal();
});

describe('parseCoverRef', () => {
  it('classifies seal: refs', () => {
    expect(parseCoverRef('seal:abc123')).toEqual({ kind: 'seal', value: 'abc123' });
  });

  it('classifies blob: refs', () => {
    expect(parseCoverRef('blob:def456')).toEqual({ kind: 'blob', value: 'def456' });
  });

  it('classifies everything else as preset', () => {
    expect(parseCoverRef('/covers/ethos-orbit.svg')).toEqual({ kind: 'preset', value: '/covers/ethos-orbit.svg' });
    expect(parseCoverRef('ethos-orbit')).toEqual({ kind: 'preset', value: 'ethos-orbit' });
  });
});

describe('uploadCover — private (sealed)', () => {
  it('calls seal.encryptNote before writeBlob and returns a seal: ref', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const result = await uploadCover(DEPS as any, bytes, { noteId: 'note-1' });

    expect(DEPS.seal!.encryptNote).toHaveBeenCalledWith('note-1', bytes);
    expect(DEPS.suiClient!.walrus.writeBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.objectContaining({ app: 'anima-cover', vault: VAULT_ID, noteId: 'note-1', mode: 'sealed' }),
      }),
    );
    expect(result.ref).toBe('seal:blobid-cover-1');
    expect(result.blobId).toBe('blobid-cover-1');
  });

  it('transfers the blob object to the wallet', async () => {
    await uploadCover(DEPS as any, new Uint8Array([1]), { noteId: 'note-1' });
    expect(DEPS.suiClient!.signAndExecuteTransaction).toHaveBeenCalledOnce();
  });

  it('throws if the transfer tx fails', async () => {
    DEPS.suiClient!.signAndExecuteTransaction = vi.fn().mockResolvedValue({
      effects: { status: { status: 'failure' } },
      digest: '0xd',
    });
    await expect(uploadCover(DEPS as any, new Uint8Array([1]), { noteId: 'note-1' })).rejects.toThrow('cover transfer failed');
  });
});

describe('uploadCover — public', () => {
  it('skips seal.encryptNote and returns a blob: ref', async () => {
    const bytes = new Uint8Array([4, 5, 6]);
    const result = await uploadCover(DEPS as any, bytes, { noteId: 'note-2', public: true });

    expect(DEPS.seal!.encryptNote).not.toHaveBeenCalled();
    expect(DEPS.suiClient!.walrus.writeBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.objectContaining({ mode: 'public' }),
      }),
    );
    expect(result.ref).toBe('blob:blobid-cover-1');
  });
});

describe('listVaultCovers', () => {
  it('returns object ids for anima-cover blobs matching vault', async () => {
    DEPS.suiClient!.getOwnedObjects = vi.fn().mockResolvedValue({
      data: [{ data: { objectId: 'cover-obj-1' } }, { data: { objectId: 'cover-obj-2' } }],
      hasNextPage: false,
    });
    DEPS.suiClient!.walrus.readBlobAttributes = vi.fn()
      .mockResolvedValueOnce({ app: 'anima-cover', vault: VAULT_ID, noteId: 'note-a', mode: 'sealed' })
      .mockResolvedValueOnce({ app: 'anima', vault: VAULT_ID, noteId: 'note-b', mode: 'sealed' }); // wrong app

    const result = await listVaultCovers(DEPS as any);
    expect(result).toEqual(['cover-obj-1']); // cover-obj-2 excluded (wrong app)
  });

  it('filters by noteIds when provided', async () => {
    DEPS.suiClient!.getOwnedObjects = vi.fn().mockResolvedValue({
      data: [{ data: { objectId: 'cover-obj-a' } }, { data: { objectId: 'cover-obj-b' } }],
      hasNextPage: false,
    });
    DEPS.suiClient!.walrus.readBlobAttributes = vi.fn()
      .mockResolvedValueOnce({ app: 'anima-cover', vault: VAULT_ID, noteId: 'note-a', mode: 'sealed' })
      .mockResolvedValueOnce({ app: 'anima-cover', vault: VAULT_ID, noteId: 'note-b', mode: 'sealed' });

    const result = await listVaultCovers(DEPS as any, ['note-a']); // only note-a
    expect(result).toEqual(['cover-obj-a']);
  });

  it('skips blobs from a different vault', async () => {
    DEPS.suiClient!.getOwnedObjects = vi.fn().mockResolvedValue({
      data: [{ data: { objectId: 'foreign-obj' } }],
      hasNextPage: false,
    });
    DEPS.suiClient!.walrus.readBlobAttributes = vi.fn().mockResolvedValue({
      app: 'anima-cover', vault: '0x' + 'f'.repeat(64), noteId: 'note-x', mode: 'sealed',
    });

    const result = await listVaultCovers(DEPS as any);
    expect(result).toHaveLength(0);
  });

  it('skips objects whose readBlobAttributes throws', async () => {
    DEPS.suiClient!.getOwnedObjects = vi.fn().mockResolvedValue({
      data: [{ data: { objectId: 'bad-obj' } }],
      hasNextPage: false,
    });
    DEPS.suiClient!.walrus.readBlobAttributes = vi.fn().mockRejectedValue(new Error('no attrs'));

    const result = await listVaultCovers(DEPS as any);
    expect(result).toHaveLength(0);
  });
});
