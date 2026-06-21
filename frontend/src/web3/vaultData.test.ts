/**
 * DOM-free test for the shared data layer's pure factory (plan U2). React is not
 * involved — createVaultData() is exercised directly, the way the mock store
 * tests exercise createStore(). Proves: reserved-note filtering on the snapshot +
 * search, write-through upsert/remove, and the write-event lifecycle incl. the
 * `silent` path that updates writeStates without a toast (the bulk-forget quiesce
 * relies on silent writes still registering in writeStates).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createVaultData, type VaultDataStore } from './vaultData';
import { VaultIndex, newNote } from '../../../chain/core/src/index.js';
import type { IndexedNote, Note } from '../../../chain/core/src/index.js';

const loc = (i: number) => ({ quiltPatchId: `p${i}`, quiltBlobId: `b${i}`, blobObjectId: `o${i}` });
const entry = (note: Note, i = 1): IndexedNote => ({ note, location: loc(i) });

let vd: VaultDataStore;
beforeEach(() => {
  vd = createVaultData();
});

describe('web3/vaultData', () => {
  it('is empty until an index is published', () => {
    expect(vd.getSnapshot().index).toBeNull();
    expect(vd.getSnapshot().notes).toEqual([]);
    expect(vd.search('anything')).toEqual([]);
    expect(vd.backlinks('n1')).toEqual([]);
  });

  it('publish exposes reserved-filtered notes + search, but keeps the reserved note in the index', () => {
    const user = newNote({ title: 'real note', body: 'hello world', author: 'owner' });
    const layout = newNote({ title: 'Canvas layout', body: 'positions', author: 'owner', tags: ['anima:canvas-layout'] });
    vd.publish(VaultIndex.fromEntries([entry(user, 1), entry(layout, 2)]));

    expect(vd.getSnapshot().notes.map((n) => n.noteId)).toEqual([user.noteId]); // reserved excluded
    expect(vd.getSnapshot().index?.all()).toHaveLength(2); // layout still in the index (loaders need it)
    // the layout note (body 'positions') must NEVER surface in recall, even on a body match
    expect(vd.search('positions').map((e) => e.note.noteId)).not.toContain(layout.noteId);
    expect(vd.search('hello')[0]?.note.noteId).toBe(user.noteId);
  });

  it('backlinks delegate to the index over a populated vault (reserved linker excluded)', () => {
    // U5: the search-page derivation reads vaultData.backlinks(noteId); the empty
    // guard is tested above, this pins the populated path + reserved exclusion the
    // store inherits from the index (index-level cases live in vaultIndex.test.ts).
    const target = newNote({ title: 'target', body: 'pointed-to', author: 'owner' });
    const referrer = newNote({ title: 'referrer', body: 'points', author: 'owner', links: [target.noteId] });
    const reservedReferrer = newNote({ title: 'layout', body: 'positions', author: 'owner', tags: ['anima:canvas-layout'], links: [target.noteId] });
    vd.publish(VaultIndex.fromEntries([entry(target, 1), entry(referrer, 2), entry(reservedReferrer, 3)]));

    expect(vd.backlinks(target.noteId).map((e) => e.note.noteId)).toEqual([referrer.noteId]);
    expect(vd.backlinks(referrer.noteId)).toEqual([]); // no inbound links
  });

  it('emits a new snapshot reference on every mutation (useSyncExternalStore identity)', () => {
    const before = vd.getSnapshot();
    vd.publish(VaultIndex.fromEntries([entry(newNote({ title: 'a', body: 'b', author: 'o' }))]));
    expect(vd.getSnapshot()).not.toBe(before);
  });

  it('upsert/remove write through to notes()', () => {
    vd.publish(VaultIndex.fromEntries([]));
    const n = newNote({ title: 'new', body: 'fresh', author: 'owner' });
    vd.upsert(n, loc(1));
    expect(vd.getSnapshot().notes.map((x) => x.noteId)).toEqual([n.noteId]);
    vd.remove(n.noteId);
    expect(vd.getSnapshot().notes).toHaveLength(0);
  });

  it('upsert auto-creates an index when none was published yet (first write before rebuild)', () => {
    const n = newNote({ title: 'a', body: 'b', author: 'o' });
    vd.upsert(n, loc(1));
    expect(vd.getSnapshot().notes.map((x) => x.noteId)).toEqual([n.noteId]);
  });

  describe('write-event lifecycle', () => {
    it('non-silent: pushes a toast and tracks the inline write-state through the lifecycle', () => {
      const id = vd.beginWriteEvent({ noteId: 'n1', noteTitle: 'Note 1', state: { phase: 'encrypting' } });
      expect(vd.getSnapshot().writeEvents).toHaveLength(1);
      expect(vd.getSnapshot().writeStates['n1']).toEqual({ phase: 'encrypting' });

      vd.updateWriteEvent(id, { phase: 'certifying' });
      expect(vd.getSnapshot().writeEvents[0].state).toEqual({ phase: 'certifying' });
      expect(vd.getSnapshot().writeStates['n1']).toEqual({ phase: 'certifying' });

      vd.updateWriteEvent(id, { phase: 'certified', blobObjectId: '0xb', provenanceUrl: 'https://x/0xb' });
      expect(vd.getSnapshot().writeStates['n1']).toMatchObject({ phase: 'certified', blobObjectId: '0xb' });

      vd.dismissWriteEvent(id);
      expect(vd.getSnapshot().writeEvents).toHaveLength(0); // toast gone
      expect(vd.getSnapshot().writeStates['n1']).toMatchObject({ phase: 'certified' }); // inline stays
    });

    it('silent: updates writeStates (quiesce predicate) but never pushes a toast', () => {
      const id = vd.beginWriteEvent({ noteId: 'layout', noteTitle: 'Canvas layout', state: { phase: 'encrypting' }, silent: true });
      expect(vd.getSnapshot().writeEvents).toHaveLength(0); // no toast for the silent autosave
      expect(vd.getSnapshot().writeStates['layout']).toEqual({ phase: 'encrypting' });

      vd.updateWriteEvent(id, { phase: 'certified', blobObjectId: '0xL', provenanceUrl: 'u' });
      expect(vd.getSnapshot().writeEvents).toHaveLength(0);
      expect(vd.getSnapshot().writeStates['layout']).toMatchObject({ phase: 'certified' });
    });

    it('updateWriteEvent on an unknown id is a no-op', () => {
      vd.updateWriteEvent('nope', { phase: 'failed' });
      expect(vd.getSnapshot().writeEvents).toHaveLength(0);
      expect(vd.getSnapshot().writeStates).toEqual({});
    });
  });

  it('reset clears index, write-states, and the toast stack', () => {
    vd.publish(VaultIndex.fromEntries([entry(newNote({ title: 'a', body: 'b', author: 'o' }))]));
    vd.beginWriteEvent({ noteId: 'n1', noteTitle: 'x', state: { phase: 'encrypting' } });
    vd.reset();
    const s = vd.getSnapshot();
    expect(s.index).toBeNull();
    expect(s.notes).toEqual([]);
    expect(s.writeEvents).toEqual([]);
    expect(s.writeStates).toEqual({});
  });
});
