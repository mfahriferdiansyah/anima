import { describe, it, expect } from 'vitest';
import { VaultIndex, isReservedNote } from '../vaultIndex.js';
import { newNote } from '../notes.js';
import type { IndexedNote, Note } from '../types.js';

const loc = (i: number) => ({ quiltPatchId: `p${i}`, quiltBlobId: `b${i}`, blobObjectId: `o${i}` });
const entry = (note: Note, i = 1): IndexedNote => ({ note, location: loc(i) });

describe('VaultIndex', () => {
  it('latest-version-wins on rebuild regardless of order', () => {
    const v1 = newNote({ title: 'Coffee', body: 'cappuccino', author: 'anima' });
    const v2 = { ...v1, version: 2, body: 'matcha' };
    // v2 arrives BEFORE v1 (out-of-order rebuild)
    const idx = VaultIndex.fromEntries([entry(v2, 2), entry(v1, 1)]);
    expect(idx.size).toBe(1);
    expect(idx.get(v1.noteId)?.note.body).toBe('matcha');
  });

  it('write-through edit changes search results immediately (AE2 foundation)', () => {
    const n = newNote({ title: 'Coffee preference', body: 'loves cappuccino', author: 'anima', tags: ['prefs'] });
    const idx = VaultIndex.fromEntries([entry(n)]);
    expect(idx.search('cappuccino')[0]?.note.noteId).toBe(n.noteId);
    idx.upsert({ ...n, version: 2, body: 'switched to matcha' }, loc(1));
    expect(idx.search('matcha')[0]?.note.body).toContain('matcha');
  });

  it('remove makes a note unfindable (forget write-through)', () => {
    const n = newNote({ title: 'Ex partner', body: 'about alex', author: 'anima' });
    const idx = VaultIndex.fromEntries([entry(n)]);
    idx.remove(n.noteId);
    expect(idx.search('alex')).toHaveLength(0);
    expect(idx.size).toBe(0);
  });

  it('search ranks title > tag > body and returns topK', () => {
    const a = newNote({ title: 'wedding plans', body: 'x', author: 'a' });
    const b = newNote({ title: 'other', body: 'mentions wedding once', author: 'a' });
    const c = newNote({ title: 'unrelated', body: 'nothing', author: 'a', tags: ['wedding'] });
    const idx = VaultIndex.fromEntries([entry(a, 1), entry(b, 2), entry(c, 3)]);
    const hits = idx.search('wedding');
    expect(hits[0].note.noteId).toBe(a.noteId);
    expect(hits.map((h) => h.note.noteId)).toContain(c.noteId);
    expect(idx.search('wedding', 1)).toHaveLength(1);
  });

  it('backlinks finds referring notes', () => {
    const target = newNote({ title: 'target', body: 'x', author: 'a' });
    const referrer = newNote({ title: 'ref', body: 'y', author: 'a', links: [target.noteId] });
    const idx = VaultIndex.fromEntries([entry(target, 1), entry(referrer, 2)]);
    expect(idx.backlinks(target.noteId).map((e) => e.note.noteId)).toEqual([referrer.noteId]);
  });

  it('serialize/load round-trip', () => {
    const n = newNote({ title: 'persist me', body: 'z', author: 'a' });
    const idx = VaultIndex.fromEntries([entry(n)]);
    const loaded = VaultIndex.load(idx.serialize());
    expect(loaded.get(n.noteId)?.note).toEqual(n);
  });

  it('empty query returns recent notes', () => {
    const n = newNote({ title: 'a', body: 'b', author: 'a' });
    const idx = VaultIndex.fromEntries([entry(n)]);
    expect(idx.search('')).toHaveLength(1);
  });

  describe('reserved-note hygiene (R19)', () => {
    it('isReservedNote flags anima:* tags only', () => {
      expect(isReservedNote(newNote({ title: 'x', body: 'y', author: 'a', tags: ['anima:canvas-layout'] }))).toBe(true);
      expect(isReservedNote(newNote({ title: 'x', body: 'y', author: 'a', tags: ['prefs', 'anima:folders'] }))).toBe(true);
      expect(isReservedNote(newNote({ title: 'x', body: 'y', author: 'a', tags: ['prefs'] }))).toBe(false);
      expect(isReservedNote(newNote({ title: 'x', body: 'y', author: 'a' }))).toBe(false);
    });

    it('notes() excludes reserved notes that all()/get() still expose (layout loaders need all())', () => {
      const user = newNote({ title: 'real note', body: 'hello', author: 'owner' });
      const layout = newNote({ title: 'Canvas layout', body: '{"n1":{"x":1,"y":2}}', author: 'owner', tags: ['anima:canvas-layout'] });
      const idx = VaultIndex.fromEntries([entry(user, 1), entry(layout, 2)]);
      expect(idx.all()).toHaveLength(2);
      expect(idx.get(layout.noteId)?.note.noteId).toBe(layout.noteId); // findLayoutNote path
      expect(idx.notes().map((e) => e.note.noteId)).toEqual([user.noteId]);
    });

    it('search() never returns a reserved note even on a body-term match (MCP recall fix)', () => {
      const layout = newNote({ title: 'Canvas layout', body: 'constellation positions for the board', author: 'owner', tags: ['anima:canvas-layout'] });
      const idx = VaultIndex.fromEntries([entry(layout, 1)]);
      expect(idx.search('constellation')).toHaveLength(0);
      expect(idx.search('')).toHaveLength(0); // empty-query path is filtered too
    });

    it('backlinks() excludes a reserved note that links the target', () => {
      const target = newNote({ title: 'target', body: 'x', author: 'a' });
      const reservedReferrer = newNote({ title: 'layout', body: 'y', author: 'a', tags: ['anima:canvas-layout'], links: [target.noteId] });
      const userReferrer = newNote({ title: 'ref', body: 'z', author: 'a', links: [target.noteId] });
      const idx = VaultIndex.fromEntries([entry(target, 1), entry(reservedReferrer, 2), entry(userReferrer, 3)]);
      expect(idx.backlinks(target.noteId).map((e) => e.note.noteId)).toEqual([userReferrer.noteId]);
    });
  });
});
