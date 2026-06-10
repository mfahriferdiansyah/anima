import { describe, it, expect } from 'vitest';
import { sealWithPassword, openWithPassword, isPasswordShare } from '../share.js';
import { serializeNote, parseNote, newNote } from '../notes.js';

describe('share (R-share)', () => {
  it('password round-trip preserves the note', async () => {
    const note = newNote({ title: 'Secret trip', body: 'Kyoto in **autumn**.', author: 'owner', tags: ['travel'] });
    const sealed = await sealWithPassword(note, 'hunter2!');
    expect(isPasswordShare(sealed)).toBe(true);
    const opened = await openWithPassword(sealed, 'hunter2!');
    expect(opened).toEqual(note);
  });

  it('wrong password fails, never partial plaintext', async () => {
    const note = newNote({ title: 'x', body: 'y', author: 'a' });
    const sealed = await sealWithPassword(note, 'right');
    await expect(openWithPassword(sealed, 'wrong')).rejects.toThrow();
  });

  it('public payload is plain parseable markdown (aggregator-servable)', () => {
    const note = newNote({ title: 'Open post', body: 'hello world', author: 'owner' });
    const bytes = new TextEncoder().encode(serializeNote(note));
    expect(isPasswordShare(bytes)).toBe(false);
    expect(parseNote(new TextDecoder().decode(bytes)).title).toBe('Open post');
  });
});
