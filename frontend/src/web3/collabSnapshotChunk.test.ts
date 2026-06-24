/**
 * Tombstone-safe chunked snapshot resync (plan 2026-06-24 U7). Pure: chunk math +
 * drop-tolerant reassembly. Covers cap-check-first (a small snapshot is one frame),
 * ordered reassembly, the generation-id guard (no interleaving two snapshots), and
 * the dropped-chunk selective re-request that converges rather than livelocks.
 */
import { describe, it, expect } from 'vitest';
import { chunkSnapshot, SnapshotReceiver, CHUNK_BYTES } from './collabSnapshotChunk';

const bytes = (n: number, fill = 1) => new Uint8Array(n).fill(fill);

describe('chunkSnapshot — cap-check first', () => {
  it('a snapshot that fits one chunk is sent whole (seq 0 of 1)', () => {
    const chunks = chunkSnapshot(bytes(100), 'gen-1');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ gen: 'gen-1', seq: 0, total: 1 });
  });

  it('a snapshot over the cap splits into ordered chunks', () => {
    const chunks = chunkSnapshot(bytes(CHUNK_BYTES * 2 + 5), 'gen-2');
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.seq)).toEqual([0, 1, 2]);
    expect(chunks.every((c) => c.total === 3)).toBe(true);
  });

  it('an empty snapshot still produces one chunk (total 1)', () => {
    const chunks = chunkSnapshot(bytes(0), 'gen-e');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].total).toBe(1);
  });
});

describe('SnapshotReceiver — reassembly', () => {
  it('reassembles in-order chunks to the original bytes', () => {
    const original = bytes(CHUNK_BYTES * 2 + 7, 9);
    const chunks = chunkSnapshot(original, 'g');
    const rx = new SnapshotReceiver();
    let result: Uint8Array | null = null;
    for (const c of chunks) result = rx.accept(c) ?? result;
    expect(result).not.toBeNull();
    expect([...result!]).toEqual([...original]);
    expect(rx.isComplete()).toBe(true);
  });

  it('reassembles out-of-order chunks correctly', () => {
    const original = bytes(CHUNK_BYTES * 3, 3);
    const chunks = chunkSnapshot(original, 'g');
    const rx = new SnapshotReceiver();
    // deliver in reverse
    let result: Uint8Array | null = null;
    for (const c of [...chunks].reverse()) result = rx.accept(c) ?? result;
    expect([...result!]).toEqual([...original]);
  });
});

describe('SnapshotReceiver — generation guard (no interleaving)', () => {
  it('a newer generation resets the buffer; the old partial is discarded', () => {
    const rx = new SnapshotReceiver();
    const genA = chunkSnapshot(bytes(CHUNK_BYTES * 2, 1), 'gen-a');
    const genB = chunkSnapshot(bytes(CHUNK_BYTES * 2, 2), 'gen-b');

    rx.accept(genA[0]); // partial of gen-a
    expect(rx.isComplete()).toBe(false);

    // gen-b chunks arrive — they must NOT interleave with gen-a's partial
    rx.accept(genB[0]);
    const done = rx.accept(genB[1]);
    expect(done).not.toBeNull();
    expect(rx.generation()).toBe('gen-b');
    expect([...done!]).toEqual([...bytes(CHUNK_BYTES * 2, 2)]); // pure gen-b, no gen-a bytes
  });

  it('a stale (older) generation chunk is dropped', () => {
    const rx = new SnapshotReceiver();
    rx.accept(chunkSnapshot(bytes(10), 'gen-b')[0]); // completes gen-b
    const stale = rx.accept(chunkSnapshot(bytes(10), 'gen-a')[0]); // older — dropped
    expect(stale).toBeNull();
    expect(rx.generation()).toBe('gen-b');
  });
});

describe('SnapshotReceiver — dropped-chunk selective re-request (converges, no livelock)', () => {
  it('missing() lists only the gaps, and a re-send of just those completes it', () => {
    const original = bytes(CHUNK_BYTES * 4, 7);
    const chunks = chunkSnapshot(original, 'g');
    const rx = new SnapshotReceiver();

    // the relay DROPS seq 1 and seq 3
    rx.accept(chunks[0]);
    rx.accept(chunks[2]);
    expect(rx.isComplete()).toBe(false);
    expect(rx.missing()).toEqual([1, 3]); // selective re-request asks for ONLY these

    // the responder re-sends just the missing seqs (shrinking retransmission)
    rx.accept(chunks[1]);
    const done = rx.accept(chunks[3]);
    expect(done).not.toBeNull();
    expect([...done!]).toEqual([...original]);
    expect(rx.missing()).toEqual([]); // converged
  });

  it('missing() is empty once complete (no spurious re-requests)', () => {
    const chunks = chunkSnapshot(bytes(100), 'g');
    const rx = new SnapshotReceiver();
    rx.accept(chunks[0]);
    expect(rx.isComplete()).toBe(true);
    expect(rx.missing()).toEqual([]);
  });
});
