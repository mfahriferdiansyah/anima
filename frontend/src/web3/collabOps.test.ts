/**
 * Unit tests for the live-collaboration transport (plan 008 U1): the password-
 * gated room-id derivation, the active-share emit gate, the soft-lock state
 * machine, and the wire codec round-trip for the new content frames. DOM-free /
 * node-env (the DOM-bound sanitize is covered in collabSanitize.test.ts).
 */
import { describe, it, expect } from 'vitest';
import {
  deriveRoomId,
  randomShareId,
  makeShareGate,
  isContentOp,
  reduceLocks,
  lockedBy,
  takeOver,
  noteOp,
  noteWriting,
  canvasOp,
  syncReq,
  ySync,
  elOp,
  elChunk,
  elNeed,
  bytesToB64,
  b64ToBytes,
  LOCK_TTL_MS,
  type LockMap,
} from './collabOps';
import { parseMsg, serializeMsg } from '../mocks/presenceStore';
import type { PresenceMsg } from '../../../chain/core/src/index.js';
import type { CanvasElement } from '../../../chain/core/src/elements.js';

describe('deriveRoomId — password-gated edit room (KTD8 control 3)', () => {
  it('the right password derives the SAME room id; a wrong password a DIFFERENT one', async () => {
    const salt = 'link-salt-abc';
    const right1 = await deriveRoomId('correct horse', salt);
    const right2 = await deriveRoomId('correct horse', salt);
    const wrong = await deriveRoomId('wrong horse', salt);

    expect(right1).toBe(right2); // owner + guest who know the password meet in the same room
    expect(wrong).not.toBe(right1); // a wrong password lands in a different, empty room
    expect(right1).toMatch(/^[0-9a-f]{64}$/); // 256-bit hex id
  });

  it('the same password under a different link salt is a different room', async () => {
    const a = await deriveRoomId('pw', 'salt-1');
    const b = await deriveRoomId('pw', 'salt-2');
    expect(a).not.toBe(b);
  });

  it('randomShareId is high-entropy and unique per call', () => {
    const a = randomShareId();
    const b = randomShareId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe('makeShareGate — content ops only while a share is active (KTD8 control 1)', () => {
  it('drops content ops when inactive and lets them through when active; presence always passes', () => {
    const sent: PresenceMsg[] = [];
    const gate = makeShareGate((m) => sent.push(m));

    // inactive: a private edit broadcasts nothing
    gate.emit(noteOp('me', 'n1', 'secret body'));
    gate.emit(noteWriting('me', 'n1', true));
    gate.emit(canvasOp('me', 'shared', { n1: { x: 1, y: 1 } }));
    expect(sent).toHaveLength(0);
    // ...but cursor/ping presence still flows
    gate.emit({ t: 'cursor', id: 'me', x: 5, y: 6 });
    expect(sent).toHaveLength(1);

    // active: content ops flow
    gate.setActive(true);
    gate.emit(noteOp('me', 'n1', 'shared body'));
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({ t: 'note-op', id: 'me', noteId: 'n1', body: 'shared body' });
  });

  it('isContentOp classifies the three content frames and nothing else', () => {
    expect(isContentOp(noteOp('a', 'n', 'b'))).toBe(true);
    expect(isContentOp(noteWriting('a', 'n', true))).toBe(true);
    expect(isContentOp(canvasOp('a', 'c', {}))).toBe(true);
    expect(isContentOp({ t: 'cursor', id: 'a', x: 0, y: 0 })).toBe(false);
    expect(isContentOp({ t: 'hello', id: 'a', label: 'x', kind: 'human' })).toBe(false);
  });
});

describe('soft lock — per-note, auto-release, take-over (R32 / AE6)', () => {
  it('a note-writing on-ping locks the note for other peers but not the holder', () => {
    const locks = reduceLocks({}, noteWriting('peerB', 'n1', true), 1000);
    expect(lockedBy(locks, 'n1', 'peerA', 1000)).toBe('peerB'); // A is locked out
    expect(lockedBy(locks, 'n1', 'peerB', 1000)).toBeNull(); // B holds it, not locked out
    expect(lockedBy(locks, 'n2', 'peerA', 1000)).toBeNull(); // a different note is free
  });

  it('auto-releases ~5s after the last writing ping', () => {
    const locks = reduceLocks({}, noteWriting('peerB', 'n1', true), 1000);
    expect(lockedBy(locks, 'n1', 'peerA', 1000 + LOCK_TTL_MS - 1)).toBe('peerB'); // still fresh
    expect(lockedBy(locks, 'n1', 'peerA', 1000 + LOCK_TTL_MS + 1)).toBeNull(); // stale → released
  });

  it('a fresh on-ping refreshes the lock timestamp (keeps it alive)', () => {
    let locks = reduceLocks({}, noteWriting('peerB', 'n1', true), 1000);
    locks = reduceLocks(locks, noteWriting('peerB', 'n1', true), 4000); // refresh
    expect(lockedBy(locks, 'n1', 'peerA', 4000 + LOCK_TTL_MS - 1)).toBe('peerB');
  });

  it('an off-ping from the holder clears the lock; a stranger off-ping does not', () => {
    let locks = reduceLocks({}, noteWriting('peerB', 'n1', true), 1000);
    locks = reduceLocks(locks, noteWriting('peerA', 'n1', false), 1200); // not the holder
    expect(lockedBy(locks, 'n1', 'peerA', 1200)).toBe('peerB'); // still locked
    locks = reduceLocks(locks, noteWriting('peerB', 'n1', false), 1300); // the holder releases
    expect(lockedBy(locks, 'n1', 'peerA', 1300)).toBeNull();
  });

  it('takeOver drops another peer’s lock locally so this client can edit', () => {
    const locks = reduceLocks({}, noteWriting('peerB', 'n1', true), 1000);
    const after = takeOver(locks, 'n1');
    expect(lockedBy(after, 'n1', 'peerA', 1000)).toBeNull();
  });

  it('non-writing frames leave the lock map unchanged (same reference)', () => {
    const locks: LockMap = { n1: { peerId: 'peerB', at: 1000 } };
    expect(reduceLocks(locks, { t: 'cursor', id: 'x', x: 0, y: 0 }, 2000)).toBe(locks);
  });
});

describe('wire codec — content frames round-trip; junk is dropped', () => {
  it('every new content frame serializes and parses back identically', () => {
    const frames: PresenceMsg[] = [
      noteOp('a', 'n1', 'hello body'),
      noteWriting('a', 'n1', true),
      canvasOp('a', 'shared', { n1: { x: 10, y: 20 }, n2: { x: 0, y: 0 } }),
    ];
    for (const f of frames) {
      expect(parseMsg(serializeMsg(f))).toEqual(f);
    }
  });

  it('rejects a malformed content frame and an unknown type (no throw)', () => {
    expect(parseMsg('{"t":"note-op","id":"a"}')).toBeNull(); // missing noteId/body
    expect(parseMsg('{"t":"note-writing","id":"a","noteId":"n","on":"yes"}')).toBeNull(); // on not boolean
    expect(parseMsg('{"t":"canvas-op","id":"a","canvasId":"c"}')).toBeNull(); // missing layout
    expect(parseMsg('{"t":"totally-unknown","id":"a"}')).toBeNull();
    expect(parseMsg('not json')).toBeNull();
  });
});

// ── plan-2026-06-24 collaborative-share frames ──────────────────────────────

const SAMPLE_EL: CanvasElement = {
  id: 'sh:1',
  type: 'rect',
  x: 10,
  y: 20,
  w: 100,
  h: 50,
  angle: 0,
  index: 0,
  version: 3,
  versionNonce: 12345,
};

describe('base64 helpers — binary payloads ride inside the JSON frame', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 64]);
    expect([...b64ToBytes(bytesToB64(bytes))]).toEqual([...bytes]);
  });

  it('an empty payload round-trips to empty', () => {
    expect(b64ToBytes(bytesToB64(new Uint8Array(0))).length).toBe(0);
  });

  it('malformed base64 decodes to empty, not a throw', () => {
    expect(b64ToBytes('!!!not base64!!!').length).toBe(0);
  });
});

describe('collaborative-share frames — round-trip + share gating', () => {
  it('every new frame serializes and parses back identically', () => {
    const yBytes = new Uint8Array([9, 8, 7, 6]);
    const chunkBytes = new Uint8Array([1, 2, 3]);
    const frames: PresenceMsg[] = [
      syncReq('me'),
      ySync('me', yBytes),
      elOp('me', 'board-1', SAMPLE_EL),
      elChunk('me', 'board-1', 'gen-x', 0, 3, chunkBytes),
      elNeed('me', 'board-1', 'gen-x', [1, 2]),
    ];
    for (const f of frames) {
      expect(parseMsg(serializeMsg(f))).toEqual(f);
    }
  });

  it('the y-sync / el-chunk base64 decodes back to the original bytes', () => {
    const yBytes = new Uint8Array([42, 0, 255]);
    const frame = parseMsg(serializeMsg(ySync('me', yBytes)));
    expect(frame?.t).toBe('y-sync');
    if (frame?.t === 'y-sync') expect([...b64ToBytes(frame.b)]).toEqual([...yBytes]);
  });

  it('an el-op carries the full element through the wire', () => {
    const frame = parseMsg(serializeMsg(elOp('me', 'board-1', SAMPLE_EL)));
    expect(frame?.t).toBe('el-op');
    if (frame?.t === 'el-op') expect(frame.el).toEqual(SAMPLE_EL);
  });

  it('rejects malformed collaborative-share frames (no throw)', () => {
    expect(parseMsg('{"t":"sync-req"}')).toBeNull(); // missing id
    expect(parseMsg('{"t":"y-sync","id":"a"}')).toBeNull(); // missing b
    expect(parseMsg('{"t":"el-op","id":"a","canvasId":"c","el":{}}')).toBeNull(); // el has no id
    expect(parseMsg('{"t":"el-chunk","id":"a","canvasId":"c","gen":"g","seq":0}')).toBeNull(); // missing total/b
    expect(parseMsg('{"t":"el-need","id":"a","canvasId":"c","gen":"g","seqs":"nope"}')).toBeNull(); // seqs not array
  });

  it('isContentOp gates the new collaborative frames so they only flow under an active share', () => {
    expect(isContentOp(syncReq('a'))).toBe(true);
    expect(isContentOp(ySync('a', new Uint8Array()))).toBe(true);
    expect(isContentOp(elOp('a', 'c', SAMPLE_EL))).toBe(true);
    expect(isContentOp(elChunk('a', 'c', 'g', 0, 1, new Uint8Array()))).toBe(true);
    expect(isContentOp(elNeed('a', 'c', 'g', [0]))).toBe(true);

    const sent: PresenceMsg[] = [];
    const gate = makeShareGate((m) => sent.push(m));
    gate.emit(elOp('a', 'c', SAMPLE_EL)); // inactive → dropped
    expect(sent).toHaveLength(0);
    gate.setActive(true);
    gate.emit(elOp('a', 'c', SAMPLE_EL)); // active → flows
    expect(sent).toHaveLength(1);
  });
});
