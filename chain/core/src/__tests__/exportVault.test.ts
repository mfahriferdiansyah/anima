import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { exportVaultZip } from '../exportVault.js';
import { newNote, parseNote } from '../notes.js';
import type { IndexedNote } from '../types.js';

describe('exportVaultZip (R14)', () => {
  it('produces a zip of parseable markdown files', () => {
    const notes = [
      newNote({ title: 'Sister wedding', body: 'lovely', author: 'anima' }),
      newNote({ title: 'Coffee: weird/chars*', body: 'matcha', author: 'anima' }),
    ];
    const entries: IndexedNote[] = notes.map((note, i) => ({
      note,
      location: { quiltPatchId: `p${i}`, quiltBlobId: `b${i}`, blobObjectId: `o${i}` },
    }));
    const zip = exportVaultZip(entries);
    const files = unzipSync(zip);
    const names = Object.keys(files);
    expect(names).toHaveLength(2);
    for (const name of names) {
      expect(name).toMatch(/\.md$/);
      const parsed = parseNote(strFromU8(files[name]));
      expect(notes.map((n) => n.noteId)).toContain(parsed.noteId);
    }
  });
});
