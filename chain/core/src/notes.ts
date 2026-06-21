/**
 * Markdown note (de)serialization. Memory is human-readable BY DESIGN:
 * every memory is a markdown file with a small frontmatter block — the
 * file-over-app receipt. Frontmatter is a strict subset of YAML (flat
 * keys, JSON arrays) so we need no YAML dependency.
 */
import type { Note, NoteFrontmatter } from './types.js';
import { ulid } from './ulid.js';

const FM_DELIM = '---';

export function serializeNote(note: Note): string {
  const lines = [
    FM_DELIM,
    `noteId: ${note.noteId}`,
    `version: ${note.version}`,
    `updatedAt: ${note.updatedAt}`,
    `author: ${note.author}`,
    `tags: ${JSON.stringify(note.tags)}`,
    `links: ${JSON.stringify(note.links)}`,
  ];
  if (note.cover) lines.push(`cover: ${note.cover}`);
  lines.push(FM_DELIM);
  return `${lines.join('\n')}\n# ${note.title}\n\n${note.body}\n`;
}

export function parseNote(markdown: string): Note {
  const lines = markdown.split('\n');
  if (lines[0] !== FM_DELIM) throw new Error('note missing frontmatter');
  const end = lines.indexOf(FM_DELIM, 1);
  if (end < 0) throw new Error('unterminated frontmatter');

  const raw: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const i = line.indexOf(': ');
    if (i > 0) raw[line.slice(0, i)] = line.slice(i + 2);
  }
  const fm: NoteFrontmatter = {
    noteId: must(raw, 'noteId'),
    version: Number(must(raw, 'version')),
    updatedAt: must(raw, 'updatedAt'),
    author: must(raw, 'author'),
    tags: JSON.parse(raw.tags ?? '[]'),
    links: JSON.parse(raw.links ?? '[]'),
    ...(raw.cover !== undefined ? { cover: raw.cover } : {}),
  };

  const bodyLines = lines.slice(end + 1).join('\n').trim().split('\n');
  let title = '';
  let bodyStart = 0;
  if (bodyLines[0]?.startsWith('# ')) {
    title = bodyLines[0].slice(2).trim();
    bodyStart = 1;
  }
  const body = bodyLines.slice(bodyStart).join('\n').trim();
  return { ...fm, title, body };
}

function must(raw: Record<string, string>, key: string): string {
  const v = raw[key];
  if (v === undefined) throw new Error(`note frontmatter missing ${key}`);
  return v;
}

/** Create a fresh v1 note. */
export function newNote(input: {
  title: string;
  body: string;
  author: string;
  tags?: string[];
  links?: string[];
  updatedAt?: string;
  noteId?: string;
}): Note {
  return {
    noteId: input.noteId ?? ulid(),
    version: 1,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    author: input.author,
    tags: input.tags ?? [],
    links: input.links ?? [],
    title: input.title,
    body: input.body,
  };
}

/** Produce the next version of an edited note. */
export function editedNote(prev: Note, changes: Partial<Pick<Note, 'title' | 'body' | 'tags' | 'links' | 'cover'>>, author: string): Note {
  return {
    ...prev,
    ...changes,
    version: prev.version + 1,
    updatedAt: new Date().toISOString(),
    author,
  };
}

/** Walrus quilt identifier for a note version (identifiers must be unique per quilt). */
export const noteIdentifier = (n: Pick<Note, 'noteId' | 'version'>) => `${n.noteId}@${n.version}`;
