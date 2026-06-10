import { describe, it, expect } from 'vitest';
import { serializeNote, parseNote, newNote, editedNote, noteIdentifier } from '../notes.js';

describe('notes', () => {
  it('serialize → parse round-trip preserves every field', () => {
    const n = newNote({
      title: 'Sister wedding',
      body: 'It was lovely.\n\nTwo paragraphs.',
      author: 'anima',
      tags: ['family', 'event'],
      links: ['01ABC'],
    });
    const parsed = parseNote(serializeNote(n));
    expect(parsed).toEqual(n);
  });

  it('parse rejects content without frontmatter', () => {
    expect(() => parseNote('# just markdown')).toThrow(/frontmatter/);
  });

  it('parse rejects missing required keys', () => {
    expect(() => parseNote('---\nnoteId: X\n---\n# t\nb')).toThrow(/missing/);
  });

  it('editedNote bumps version and preserves noteId', () => {
    const n = newNote({ title: 'Coffee', body: 'cappuccino', author: 'anima' });
    const e = editedNote(n, { body: 'switched to matcha' }, 'owner');
    expect(e.noteId).toBe(n.noteId);
    expect(e.version).toBe(2);
    expect(e.body).toBe('switched to matcha');
    expect(e.author).toBe('owner');
  });

  it('noteIdentifier is unique per version', () => {
    const n = newNote({ title: 'x', body: 'y', author: 'a' });
    expect(noteIdentifier(n)).toBe(`${n.noteId}@1`);
    expect(noteIdentifier(editedNote(n, {}, 'a'))).toBe(`${n.noteId}@2`);
  });

  it('handles bodies containing frontmatter-like lines', () => {
    const n = newNote({ title: 'tricky', body: 'code: example\n---\nmore', author: 'a' });
    const parsed = parseNote(serializeNote(n));
    expect(parsed.body).toContain('---');
    expect(parsed.title).toBe('tricky');
  });
});
