/**
 * The disposable retrieval index. Canonical memory lives ONLY on Walrus;
 * this index is a rebuildable local cache (custody stays honest).
 * Latest-version-wins per noteId; write-through on write/edit/delete.
 */
import type { IndexedNote, Note, NoteLocation } from './types.js';

/**
 * Reserved app-state notes (canvas layout, future folders/registries) are tagged
 * `anima:*`. They are durable vault notes but must never surface as user memory —
 * they are filtered out of recall and the notes library (plan R19). Layout
 * loaders that WANT the reserved note read it via `all()`/`findLayoutNote`.
 */
export function isReservedNote(note: Note): boolean {
  return note.tags.some((t) => t.startsWith('anima:'));
}

export class VaultIndex {
  #byId = new Map<string, IndexedNote>();

  /** Latest-version-wins materialization (edge #5: rebuild sees edits, not ghosts). */
  static fromEntries(entries: IndexedNote[]): VaultIndex {
    const idx = new VaultIndex();
    for (const e of entries) idx.upsert(e.note, e.location);
    return idx;
  }

  upsert(note: Note, location: NoteLocation): void {
    const existing = this.#byId.get(note.noteId);
    if (!existing || note.version >= existing.note.version) {
      this.#byId.set(note.noteId, { note, location });
    }
  }

  remove(noteId: string): void {
    this.#byId.delete(noteId);
  }

  get(noteId: string): IndexedNote | undefined {
    return this.#byId.get(noteId);
  }

  /** Every entry, reserved app-state notes INCLUDED (layout loaders need this). */
  all(): IndexedNote[] {
    return [...this.#byId.values()].sort((a, b) => b.note.updatedAt.localeCompare(a.note.updatedAt));
  }

  /** User-facing notes only — reserved `anima:*` app-state filtered out (R19). */
  notes(): IndexedNote[] {
    return this.all().filter((e) => !isReservedNote(e.note));
  }

  get size(): number {
    return this.#byId.size;
  }

  /** Backlinks: user notes whose `links` reference the given noteId (reserved excluded). */
  backlinks(noteId: string): IndexedNote[] {
    return this.notes().filter((e) => e.note.links.includes(noteId));
  }

  /**
   * Retrieval for the chat loop: keyword (title/body/tags) + recency.
   * Score: term hits weighted by field, with a mild recency boost.
   */
  search(query: string, topK = 6): IndexedNote[] {
    const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
    // Recall is over user notes only — the reserved layout note must never leak
    // into Nova's context (frontend) or MCP recall (which calls search() directly).
    if (terms.length === 0) return this.notes().slice(0, topK);

    const now = Date.now();
    const scored = this.notes().map((e) => {
      const title = e.note.title.toLowerCase();
      const body = e.note.body.toLowerCase();
      const tags = e.note.tags.join(' ').toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (title.includes(t)) score += 5;
        if (tags.includes(t)) score += 3;
        if (body.includes(t)) score += 1;
      }
      const ageDays = (now - Date.parse(e.note.updatedAt)) / 86_400_000;
      score += Math.max(0, 1 - ageDays / 90); // mild recency boost
      return { e, score };
    });
    return scored
      .filter((s) => s.score > 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((s) => s.e);
  }

  /** Serialize for the consumer's storage layer (IndexedDB in browser, JSON file in MCP). */
  serialize(): string {
    return JSON.stringify(this.all());
  }

  static load(json: string): VaultIndex {
    return VaultIndex.fromEntries(JSON.parse(json));
  }
}
