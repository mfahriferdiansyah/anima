/**
 * The disposable retrieval index. Canonical memory lives ONLY on Walrus;
 * this index is a rebuildable local cache (custody stays honest).
 * Latest-version-wins per noteId; write-through on write/edit/delete.
 */
import type { IndexedNote, Note, NoteLocation } from './types.js';

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

  all(): IndexedNote[] {
    return [...this.#byId.values()].sort((a, b) => b.note.updatedAt.localeCompare(a.note.updatedAt));
  }

  get size(): number {
    return this.#byId.size;
  }

  /** Backlinks: notes whose `links` reference the given noteId. */
  backlinks(noteId: string): IndexedNote[] {
    return this.all().filter((e) => e.note.links.includes(noteId));
  }

  /**
   * Retrieval for the chat loop: keyword (title/body/tags) + recency.
   * Score: term hits weighted by field, with a mild recency boost.
   */
  search(query: string, topK = 6): IndexedNote[] {
    const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
    if (terms.length === 0) return this.all().slice(0, topK);

    const now = Date.now();
    const scored = this.all().map((e) => {
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
