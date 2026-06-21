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

  it('round-trips a note WITH a preset cover', () => {
    const n = { ...newNote({ title: 'With cover', body: 'body', author: 'owner' }), cover: '/covers/ethos-orbit.svg' };
    const parsed = parseNote(serializeNote(n));
    expect(parsed.cover).toBe('/covers/ethos-orbit.svg');
    expect(parsed.title).toBe('With cover');
  });

  it('round-trips a note WITH a seal: cover ref', () => {
    const n = { ...newNote({ title: 'Sealed cover', body: 'body', author: 'owner' }), cover: 'seal:abc123def456' };
    const parsed = parseNote(serializeNote(n));
    expect(parsed.cover).toBe('seal:abc123def456');
  });

  it('a note WITHOUT a cover serializes with no cover line', () => {
    const n = newNote({ title: 'No cover', body: 'body', author: 'owner' });
    const serialized = serializeNote(n);
    expect(serialized).not.toContain('cover:');
    const parsed = parseNote(serialized);
    expect(parsed.cover).toBeUndefined();
  });

  it('editedNote accepts a cover change', () => {
    const n = newNote({ title: 'x', body: 'y', author: 'a' });
    const e = editedNote(n, { cover: 'seal:xyz' }, 'owner');
    expect(e.cover).toBe('seal:xyz');
    expect(e.version).toBe(2);
  });

  it('editedNote clears cover with empty string', () => {
    const n = { ...newNote({ title: 'x', body: 'y', author: 'a' }), cover: 'seal:xyz' };
    const e = editedNote(n, { cover: '' }, 'owner');
    // empty string cover → serializes as absent
    const serialized = serializeNote(e);
    expect(serialized).not.toContain('cover:');
  });
});
