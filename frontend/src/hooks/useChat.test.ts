/**
 * DOM-free tests for the chat layer's PURE cores (plan U6). The live fetch/hook
 * wiring is NOT exercised here (it is the thin, integration-gated part); instead
 * we pin the three node-testable pieces ported from scripts/e2e-chat.ts:
 *  - parseSseStream: the SSE delta/event wire parser (handler.go format) —
 *    data:{delta} accumulation, event:done finalize, event:error throw, a
 *    reader.read() rejection propagating, and EOF-before-done → incomplete.
 *  - extractCitations: the [[noteId]] marker extractor.
 *  - runDistill: the distill→writeTurn→upsert driver with funding gate + draft force.
 *
 * chain/core is mocked so the driver needs no live chain; the parser/extractor
 * are pure and need nothing. `@mysten/dapp-kit` is stubbed because importing
 * `./useChat` transitively loads it for the `useChat` hook (not node-safe).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mysten/dapp-kit', () => ({
  useCurrentAccount: () => null,
  useSignPersonalMessage: () => ({ mutateAsync: async () => ({ signature: '' }) }),
}));

import {
  parseSseStream,
  extractCitations,
  pickIntent,
  runDistill,
  type SseReader,
  type DistillDeps,
} from './useChat';

const enc = (s: string) => new TextEncoder().encode(s);

/** A fake SSE reader that yields the given byte chunks, then EOF. */
function readerFrom(chunks: string[]): SseReader {
  let i = 0;
  return {
    read: async () => {
      if (i < chunks.length) return { done: false, value: enc(chunks[i++]) };
      return { done: true };
    },
  };
}

describe('chat: parseSseStream', () => {
  it('accumulates data:{delta} frames and finalizes on event: done', async () => {
    const reader = readerFrom([
      'data: {"delta":"Hello"}\n\n',
      'data: {"delta":", "}\n\n',
      'data: {"delta":"Nova"}\n\n',
      'event: done\ndata: {}\n\n',
    ]);
    const ticks: string[] = [];
    const result = await parseSseStream(reader, (t) => ticks.push(t));

    expect(result).toEqual({ text: 'Hello, Nova', done: true });
    // streamed the accumulated text on every delta
    expect(ticks).toEqual(['Hello', 'Hello, ', 'Hello, Nova']);
  });

  it('handles a delta split across two read() chunks (partial line buffering)', async () => {
    const reader = readerFrom(['data: {"de', 'lta":"Hi"}\n\n', 'event: done\ndata: {}\n\n']);
    const result = await parseSseStream(reader, () => {});
    expect(result).toEqual({ text: 'Hi', done: true });
  });

  it('throws with the upstream message on event: error', async () => {
    const reader = readerFrom([
      'data: {"delta":"partial"}\n\n',
      'event: error\ndata: {"error":"upstream exploded"}\n\n',
    ]);
    await expect(parseSseStream(reader, () => {})).rejects.toThrow('upstream exploded');
  });

  it('propagates a reader.read() REJECTION (network drop), not a hang', async () => {
    const reader: SseReader = {
      read: vi.fn().mockRejectedValue(new Error('network drop')),
    };
    await expect(parseSseStream(reader, () => {})).rejects.toThrow('network drop');
  });

  it('returns done:false when EOF is reached BEFORE event: done (incomplete)', async () => {
    const reader = readerFrom(['data: {"delta":"half a "}\n\n', 'data: {"delta":"reply"}\n\n']);
    const result = await parseSseStream(reader, () => {});
    expect(result).toEqual({ text: 'half a reply', done: false });
  });

  it('skips a malformed data frame without aborting the stream', async () => {
    const reader = readerFrom([
      'data: not-json\n\n',
      'data: {"delta":"ok"}\n\n',
      'event: done\ndata: {}\n\n',
    ]);
    const result = await parseSseStream(reader, () => {});
    expect(result).toEqual({ text: 'ok', done: true });
  });
});

describe('chat: extractCitations', () => {
  // real note ids are alphanumeric ULIDs (chain/core newNote uses ulid()); the
  // marker grammar matches the e2e-chat reference regex: [[ [0-9A-Za-z]+ ]].
  it('extracts [[noteId]] ULID markers in order, de-duplicated', () => {
    expect(
      extractCitations('From [[01HZX9K3QF8ABCD]] and [[01HZX9M2WP7QRST]], also [[01HZX9K3QF8ABCD]] again.'),
    ).toEqual(['01HZX9K3QF8ABCD', '01HZX9M2WP7QRST']);
  });

  it('returns [] when there are no markers', () => {
    expect(extractCitations('no citations here')).toEqual([]);
  });

  it('handles a single ULID-style id', () => {
    expect(extractCitations('see [[01HZX9K3QF8ABCD]]')).toEqual(['01HZX9K3QF8ABCD']);
  });
});

describe('chat: pickIntent', () => {
  it('detects draft / status / default', () => {
    expect(pickIntent('Draft a checklist')).toBe('draft');
    expect(pickIntent('how is the WAL balance?')).toBe('status');
    expect(pickIntent('what changed this week')).toBe('default');
  });
});

describe('chat: runDistill driver', () => {
  const DEPS = { suiClient: {}, agentSigner: { toSuiAddress: () => '0xagent' } };
  const okPreflight = { sui: 5n, wal: 5n, ok: true, needsSui: false, needsWal: false };

  function makeDeps(over: Partial<DistillDeps> = {}): {
    deps: DistillDeps;
    upsert: ReturnType<typeof vi.fn>;
    writeTurn: ReturnType<typeof vi.fn>;
    onLowBalance: ReturnType<typeof vi.fn>;
  } {
    const upsert = vi.fn();
    const onLowBalance = vi.fn();
    const writeTurn = vi.fn(async (_deps: unknown, notes: Array<{ noteId: string }>) => ({
      quiltBlobId: 'qb',
      blobObjectId: '0xBLOB',
      perNote: notes.map((n, i) => ({ noteId: n.noteId, quiltPatchId: `p${i}` })),
    }));
    let idCounter = 0;
    const deps: DistillDeps = {
      distill: async () => [{ title: 'Fern', body: 'named the plant Fern', tags: ['life'] }],
      getDeps: () => DEPS as never,
      writeTurn: writeTurn as never,
      preflight: (async () => okPreflight) as never,
      newNote: ((input: { title: string; body: string }) => ({
        noteId: `note-${++idCounter}`,
        title: input.title,
        body: input.body,
      })) as never,
      upsert: upsert as never,
      onLowBalance,
      ...over,
    };
    return { deps, upsert, writeTurn, onLowBalance };
  }

  beforeEach(() => vi.clearAllMocks());

  it('distills → writeTurn → upsert and returns the created note ids', async () => {
    const { deps, upsert, writeTurn } = makeDeps();
    const res = await runDistill(deps, false);

    expect(res.createdNoteIds).toEqual(['note-1']);
    expect(writeTurn).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ noteId: 'note-1', title: 'Fern' }),
      { quiltPatchId: 'p0', quiltBlobId: 'qb', blobObjectId: '0xBLOB' },
    );
  });

  it('low balance: surfaces the banner, SKIPS the write, returns no ids', async () => {
    const { deps, writeTurn, onLowBalance } = makeDeps({
      preflight: (async () => ({ ...okPreflight, ok: false, needsWal: true })) as never,
    });
    const res = await runDistill(deps, false);

    expect(onLowBalance).toHaveBeenCalledOnce();
    expect(writeTurn).not.toHaveBeenCalled();
    expect(res.createdNoteIds).toEqual([]);
  });

  it('no candidates + not forced: writes nothing (chit-chat is disposable)', async () => {
    const { deps, writeTurn } = makeDeps({ distill: async () => [] });
    const res = await runDistill(deps, false);

    expect(writeTurn).not.toHaveBeenCalled();
    expect(res.createdNoteIds).toEqual([]);
  });

  it("draft intent forces a sealed note even when the distiller returns nothing", async () => {
    const { deps, writeTurn } = makeDeps({ distill: async () => [] });
    const res = await runDistill(deps, true);

    expect(writeTurn).toHaveBeenCalledOnce();
    expect(res.createdNoteIds).toEqual(['note-1']);
  });

  it('no live vault (getDeps null): no-op', async () => {
    const { deps, writeTurn } = makeDeps({ getDeps: (() => null) as never });
    const res = await runDistill(deps, true);

    expect(writeTurn).not.toHaveBeenCalled();
    expect(res.createdNoteIds).toEqual([]);
  });
});
