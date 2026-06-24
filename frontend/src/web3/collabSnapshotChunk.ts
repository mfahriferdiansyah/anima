/**
 * Tombstone-safe chunked snapshot resync (plan 2026-06-24 U7) — the pure core for
 * late-joiner canvas hydration over a LOSSY broadcast relay.
 *
 * A board's full element snapshot (INCLUDING tombstones, so a late joiner that
 * then receives a stale concurrent move reconciles to "deleted" rather than
 * resurrecting it) can exceed the relay's 64KB frame cap. The relay drops frames
 * to slow consumers AND fans out to all peers, so a naive multi-frame send can
 * deliver a partial OR interleaved scene — a correctness bug on the resurrection
 * surface. This core guards both:
 *
 *  - cap-check first: a snapshot that fits one frame is sent whole; chunking only
 *    runs above the cap.
 *  - generation id: each chunk carries a per-snapshot `gen`, so a re-broadcast or
 *    a mid-flight scene change can't interleave two snapshots into one buffer.
 *  - selective re-request: on a gap or timeout the receiver asks for ONLY the
 *    missing seqs (not a fresh full snapshot), so retransmission shrinks each
 *    round and the loop strictly converges instead of livelocking under loss.
 *
 * Pure: chunking is byte math, reassembly is buffer bookkeeping. The transport
 * (the relay socket) and the JSON/base64 framing live in the caller (U13/Canvas).
 */

/** The max bytes of a chunk payload (under the relay's 64KB frame, with headroom for the JSON envelope + base64 inflation). */
export const CHUNK_BYTES = 40_000;

/** A chunk of a snapshot: `gen` ties one generation, `seq`/`total` order it. */
export interface SnapshotChunk {
  gen: string;
  seq: number;
  total: number;
  payload: Uint8Array;
}

/**
 * Split a snapshot's bytes into ordered, gen-tagged chunks. A snapshot that fits
 * one chunk yields a single `{seq:0,total:1}` frame (the cap-check-first path).
 * `gen` must be unique per snapshot generation (the caller mints it).
 */
export function chunkSnapshot(bytes: Uint8Array, gen: string, chunkBytes = CHUNK_BYTES): SnapshotChunk[] {
  const total = Math.max(1, Math.ceil(bytes.length / chunkBytes));
  const chunks: SnapshotChunk[] = [];
  for (let seq = 0; seq < total; seq++) {
    chunks.push({ gen, seq, total, payload: bytes.subarray(seq * chunkBytes, (seq + 1) * chunkBytes) });
  }
  return chunks;
}

/**
 * Reassembles chunks of ONE snapshot generation, drop-tolerant. Feed each inbound
 * chunk; when every seq of a generation has arrived it returns the joined bytes
 * (once). A chunk from a newer `gen` resets the buffer (a stale generation is
 * discarded, never interleaved). `missing()` lists the seqs not yet seen, for a
 * selective re-request.
 */
export class SnapshotReceiver {
  private gen: string | null = null;
  private total = 0;
  private parts = new Map<number, Uint8Array>();
  private done = false;

  /** Feed a chunk. Returns the reassembled bytes when this generation completes, else null. */
  accept(chunk: SnapshotChunk): Uint8Array | null {
    // A newer (or first) generation resets the buffer; a stale one is ignored.
    if (this.gen !== chunk.gen) {
      if (this.gen !== null && chunk.gen < this.gen) return null; // older gen — drop
      this.gen = chunk.gen;
      this.total = chunk.total;
      this.parts = new Map();
      this.done = false;
    }
    if (this.done) return null;
    this.parts.set(chunk.seq, chunk.payload);
    if (this.parts.size < this.total) return null;
    // all chunks present — join in order
    this.done = true;
    const ordered: Uint8Array[] = [];
    let length = 0;
    for (let seq = 0; seq < this.total; seq++) {
      const p = this.parts.get(seq)!;
      ordered.push(p);
      length += p.length;
    }
    const out = new Uint8Array(length);
    let offset = 0;
    for (const p of ordered) {
      out.set(p, offset);
      offset += p.length;
    }
    return out;
  }

  /** The current generation being assembled, or null before the first chunk. */
  generation(): string | null {
    return this.gen;
  }

  /** The seqs of the current generation not yet received — the selective re-request list. */
  missing(): number[] {
    if (this.gen === null || this.done) return [];
    const gaps: number[] = [];
    for (let seq = 0; seq < this.total; seq++) {
      if (!this.parts.has(seq)) gaps.push(seq);
    }
    return gaps;
  }

  /** True once the current generation has been fully reassembled. */
  isComplete(): boolean {
    return this.done;
  }
}
