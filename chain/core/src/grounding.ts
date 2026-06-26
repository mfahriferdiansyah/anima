/**
 * Grounding assembly for Nova (the librarian half of the prompt system).
 *
 * The backend is keyless and never reads the vault, so selecting and serializing
 * what Nova sees happens here, client-side, over the decrypted `VaultIndex`. This
 * module lives in `chain/core` (not the frontend) so the same path is reusable by
 * the MCP later, mirroring `canvasContent`/`elements`. It never calls
 * `search()`/`notes()` in a way that leaks reserved `anima:*` notes (R19): canvas
 * content is read through `loadCanvasContent`, and note candidates come from the
 * existing user-notes-only `search()`.
 */
import type { VaultIndex } from './vaultIndex.js';
import { loadCanvasContent } from './canvasContent.js';

/** A calendar entry, passed through from the client (read-only schedule context). */
export interface CalendarEvent {
  title: string;
  start: string;
  end: string;
}

/** A note in the grounding bundle — wire-compatible with the backend ContextNote. */
export interface GroundingNote {
  noteId: string;
  title: string;
  body: string;
  tags: string[];
}

/** One serialized canvas board — wire-compatible with the backend CanvasContext. */
export interface GroundingCanvas {
  title: string;
  body: string;
}

/** The canvas(es) the caller deems relevant (the board the owner is on, plus any
 * referenced). The caller resolves titles (it owns the registry); core only needs
 * the id to serialize and the title to label. */
export interface CanvasRef {
  id: string;
  title: string;
}

export interface BuildGroundingInput {
  index: VaultIndex;
  /** Relevance query — the owner's latest message (chat) or a prep seed (draft). */
  query: string;
  /** Relevant boards; always admissible — the ceiling never drops them. */
  canvases?: CanvasRef[];
  calendar?: CalendarEvent[];
}

export interface GroundingResult {
  context: GroundingNote[];
  canvas: GroundingCanvas[];
  calendar: CalendarEvent[];
  /** How many ranked notes the safety ceiling dropped (0 in the normal case). */
  trimmed: number;
}

/** Candidate notes pulled from search, widened well past the old fixed top-6. */
const DEFAULT_MAX_NOTES = 24;
/** Generous character ceiling on assembled grounding. Sized so it normally never
 * fires for a personal vault; it only guards against a pathologically large one. */
const DEFAULT_CHAR_CEILING = 20000;

/**
 * A short plain-text excerpt of a note body, for grounding. Collapses whitespace
 * and truncates. Derived here so the serializer carries no frontend dependency.
 */
function excerpt(body: string, max = 200): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max).trimEnd() + '…' : flat;
}

/**
 * Serialize one canvas board into grounding text: the notes placed on it
 * (resolved to title + excerpt), free text and shape labels, and the arrow/line
 * relationships drawn between elements. Returns '' for an empty board.
 *
 * Excludes `image` elements (a `ref` is a private storage object id that must not
 * reach the model) and `draw` strokes (no text). A relationship is emitted only
 * when BOTH endpoints resolve to an included, labeled element, so a connector to a
 * deleted/unlabeled/missing node never serializes as a dangling "X relates to <>".
 */
export function serializeCanvas(index: VaultIndex, canvasId: string): string {
  const elements = (loadCanvasContent(index, canvasId).elements ?? []).filter((el) => !el.isDeleted);

  // Label by element id, but only for the items we actually include in grounding;
  // an arrow can then bind a relationship only between two included, labeled items.
  const labelById = new Map<string, string>();
  const noteLines: string[] = [];
  const textLines: string[] = [];

  for (const el of elements) {
    if (el.type === 'note') {
      const entry = index.get(el.noteId);
      if (!entry) continue; // placed note we can't resolve (e.g. note deleted) — skip
      const title = entry.note.title.trim() || 'Untitled note';
      labelById.set(el.id, title);
      const ex = excerpt(entry.note.body);
      noteLines.push(ex ? `- "${title}": ${ex}` : `- "${title}"`);
    } else if (el.type === 'text') {
      const t = el.text.trim();
      if (!t) continue;
      labelById.set(el.id, t);
      textLines.push(`- text: "${t}"`);
    } else if (el.type === 'rect' || el.type === 'ellipse') {
      const label = (el.label ?? '').trim();
      if (!label) continue;
      labelById.set(el.id, label);
      textLines.push(`- label: "${label}"`);
    }
    // image / draw: deliberately excluded (no content / private ref).
  }

  const relLines: string[] = [];
  for (const el of elements) {
    if (el.type !== 'arrow' && el.type !== 'line') continue;
    const from = el.startBinding && labelById.get(el.startBinding.elementId);
    const to = el.endBinding && labelById.get(el.endBinding.elementId);
    if (from && to) relLines.push(`- "${from}" relates to "${to}"`);
  }

  const parts: string[] = [];
  if (noteLines.length) parts.push('notes on this board:\n' + noteLines.join('\n'));
  if (textLines.length) parts.push('text and labels:\n' + textLines.join('\n'));
  if (relLines.length) parts.push('relationships:\n' + relLines.join('\n'));
  return parts.join('\n');
}

/** Proportionally truncate canvas bodies to fit `room` chars, keeping each board
 * present (never dropping the board the owner is on). */
function trimCanvasBodies(canvas: GroundingCanvas[], room: number): void {
  const total = canvas.reduce((s, c) => s + c.body.length, 0);
  if (total === 0) return;
  for (const c of canvas) {
    const share = Math.max(200, Math.floor((c.body.length / total) * room));
    if (c.body.length > share) {
      c.body = c.body.slice(0, share).trimEnd() + '\n…(board trimmed to stay within budget)';
    }
  }
}

/**
 * Assemble the grounding bundle the client sends to the backend: relevance-ranked
 * notes, the relevant serialized canvas(es), and calendar. A generous safety
 * ceiling keeps the total bounded for a pathologically large vault; in the normal
 * case nothing is dropped. Canvas and calendar are always admissible — only the
 * lowest-ranked NOTES are dropped, and only above the ceiling. When anything is
 * trimmed, a short completeness marker is added (as a non-citable board) so Nova
 * hedges rather than answering confidently from partial context.
 */
export function buildGrounding(
  input: BuildGroundingInput,
  opts: { maxNotes?: number; charCeiling?: number } = {},
): GroundingResult {
  const maxNotes = opts.maxNotes ?? DEFAULT_MAX_NOTES;
  const ceiling = opts.charCeiling ?? DEFAULT_CHAR_CEILING;

  const ranked: GroundingNote[] = input.index.search(input.query, maxNotes).map((e) => ({
    noteId: e.note.noteId,
    title: e.note.title,
    body: e.note.body,
    tags: e.note.tags,
  }));

  const canvas: GroundingCanvas[] = [];
  for (const ref of input.canvases ?? []) {
    const body = serializeCanvas(input.index, ref.id);
    if (body) canvas.push({ title: ref.title, body });
  }
  const calendar = input.calendar ?? [];

  const calChars = calendar.reduce((s, ev) => s + ev.title.length + ev.start.length + ev.end.length, 0);
  let protectedChars = calChars + canvas.reduce((s, c) => s + c.title.length + c.body.length, 0);

  // Extreme case: the always-admissible content alone exceeds the ceiling. Trim
  // WITHIN the canvas rather than dropping the board the owner just asked about.
  if (ceiling > 0 && protectedChars > ceiling && canvas.length > 0) {
    trimCanvasBodies(canvas, Math.max(0, ceiling - calChars));
    protectedChars = calChars + canvas.reduce((s, c) => s + c.title.length + c.body.length, 0);
  }

  // Fill the remaining budget with notes in rank order; drop the lowest-ranked rest.
  const context: GroundingNote[] = [];
  let used = protectedChars;
  let trimmed = 0;
  for (let i = 0; i < ranked.length; i++) {
    const n = ranked[i];
    const cost = n.title.length + n.body.length;
    if (ceiling > 0 && context.length > 0 && used + cost > ceiling) {
      trimmed = ranked.length - context.length;
      break;
    }
    context.push(n);
    used += cost;
  }

  if (trimmed > 0) {
    canvas.push({
      title: 'grounding status',
      body: `${trimmed} lower-ranked note${trimmed === 1 ? ' was' : 's were'} left out to stay within budget. Work with what is here, and say if you need more detail.`,
    });
  }

  return { context, canvas, calendar, trimmed };
}
