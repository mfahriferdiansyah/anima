/**
 * Unit tests for the owner-side anon-collab controller (plan 008 AE4). DOM-free /
 * node-env: the WebSocket hook is not tested here; `makeOwnerCollab` is the pure
 * decision layer (which inbound frames persist, guest-label attribution, the
 * echo-suppression that breaks the persist->index->rebroadcast loop).
 */
import { describe, it, expect } from 'vitest';
import { makeOwnerCollab } from './shareCollab';
import { noteOp, noteWriting } from './collabOps';
import type { CollabPersister } from './collabPersist';
import type { PresenceMsg } from '../../../chain/core/src/index.js';

function fakePersister(): CollabPersister & { calls: Array<[string, string, string]> } {
  const calls: Array<[string, string, string]> = [];
  return {
    calls,
    onGuestEdit: (id, body, label) => calls.push([id, body, label]),
    setWriterPresent: () => {},
    dispose: () => {},
  };
}

function setup() {
  const sent: PresenceMsg[] = [];
  const persister = fakePersister();
  const collab = makeOwnerCollab({ noteId: 'n1', selfId: 'owner', send: (m) => sent.push(m), persister });
  return { sent, persister, collab };
}

describe('makeOwnerCollab — guest tracking', () => {
  it('counts guests on hello and drops them on bye', () => {
    const { collab } = setup();
    collab.onFrame({ t: 'hello', id: 'g1', label: 'Guest ab', kind: 'human' });
    collab.onFrame({ t: 'hello', id: 'g2', label: 'Guest cd', kind: 'human' });
    expect(collab.guestCount()).toBe(2);
    collab.onFrame({ t: 'bye', id: 'g1' });
    expect(collab.guestCount()).toBe(1);
  });

  it('ignores the owner’s own hello echo (self id not counted)', () => {
    const { collab } = setup();
    collab.onFrame({ t: 'hello', id: 'owner', label: 'Owner', kind: 'human' });
    expect(collab.guestCount()).toBe(0);
  });
});

describe('makeOwnerCollab — AE4 persistence of guest edits', () => {
  it('persists a guest note-op, attributed to the guest label', () => {
    const { collab, persister } = setup();
    collab.onFrame({ t: 'hello', id: 'g1', label: 'Guest zz', kind: 'human' });
    collab.onFrame(noteOp('g1', 'n1', 'a guest wrote this'));
    expect(persister.calls).toEqual([['n1', 'a guest wrote this', 'Guest zz']]);
  });

  it('falls back to a generic label when the guest never said hello', () => {
    const { collab, persister } = setup();
    collab.onFrame(noteOp('g9', 'n1', 'orphan edit'));
    expect(persister.calls[0]).toEqual(['n1', 'orphan edit', 'Guest']);
  });

  it('ignores the owner’s own note-op echo (does not persist it as a guest edit)', () => {
    const { collab, persister } = setup();
    collab.onFrame(noteOp('owner', 'n1', 'my own text'));
    expect(persister.calls).toHaveLength(0);
  });

  it('note-writing frames do not trigger a persist', () => {
    const { collab, persister } = setup();
    collab.onFrame(noteWriting('g1', 'n1', true));
    expect(persister.calls).toHaveLength(0);
  });
});

describe('makeOwnerCollab — owner edits broadcast, guest echoes suppressed', () => {
  it('broadcasts the owner’s own body change as a note-op', () => {
    const { collab, sent } = setup();
    collab.onOwnerBody('owner typed this');
    expect(sent).toEqual([noteOp('owner', 'n1', 'owner typed this')]);
  });

  it('does NOT rebroadcast a body that came from a guest op we just persisted (breaks the loop)', () => {
    const { collab, sent } = setup();
    collab.onFrame(noteOp('g1', 'n1', 'guest body')); // persisted, suppress set
    // the persist lands -> index changes -> onOwnerBody fires with the guest body
    collab.onOwnerBody('guest body');
    expect(sent).toHaveLength(0); // suppressed
    // a subsequent genuine owner edit IS broadcast again
    collab.onOwnerBody('owner edit after');
    expect(sent).toEqual([noteOp('owner', 'n1', 'owner edit after')]);
  });
});
