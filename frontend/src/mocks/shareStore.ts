/**
 * Publishing per docs/integration.md section 6b: a note becomes a public
 * or password share with ~3s of mocked progress, lands in the
 * published-copies list, and unpublish removes it (the UI wallet-gates
 * unpublish, it is destructive).
 */
import { createStore } from './store';
import { mockMs } from './scenario';
import { vaultStore } from './vaultStore';

export type ShareMode = 'public' | 'password';

export interface PublishedCopy {
  id: string;
  noteId: string;
  title: string;
  mode: ShareMode;
  url: string;
  /** Present for password shares; the UI shows it exactly once. */
  password?: string;
  publishedAt: string;
}

export interface ShareState {
  publishing: { noteId: string; mode: ShareMode; progress: number } | null;
  publishedCopies: PublishedCopy[];
}

const store = createStore<ShareState>({ publishing: null, publishedCopies: [] });

export const shareStore = {
  getSnapshot: store.getSnapshot,
  subscribe: store.subscribe,
};

let copyCounter = 0;
let publishToken = 0;

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 32);
  return base || `note-${copyCounter}`;
}

function generatePassword(): string {
  return `${Math.random().toString(36).slice(2, 6)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Publish a note. Progress ticks to 100 over ~3s, then the copy resolves. */
export function publish(noteId: string, mode: ShareMode): Promise<PublishedCopy> {
  publishToken += 1;
  const token = publishToken;
  const note = vaultStore.getSnapshot().notes.find((entry) => entry.noteId === noteId);
  const title = note?.title || 'Untitled note';
  store.update((prev) => ({ ...prev, publishing: { noteId, mode, progress: 0 } }));
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (token !== publishToken) {
        clearInterval(interval);
        return;
      }
      const current = store.getSnapshot().publishing;
      if (!current) {
        clearInterval(interval);
        return;
      }
      const progress = Math.min(100, current.progress + 10);
      if (progress < 100) {
        store.update((prev) => ({ ...prev, publishing: { noteId, mode, progress } }));
        return;
      }
      clearInterval(interval);
      copyCounter += 1;
      const copy: PublishedCopy = {
        id: `pub-${copyCounter}`,
        noteId,
        title,
        mode,
        url: `anima.app/c/${slugify(title)}`,
        publishedAt: new Date().toISOString(),
        ...(mode === 'password' ? { password: generatePassword() } : {}),
      };
      store.update((prev) => ({
        publishing: null,
        publishedCopies: [copy, ...prev.publishedCopies],
      }));
      resolve(copy);
    }, mockMs(300));
  });
}

/** Remove a published copy. The UI requires a mock wallet confirm first (destructive). */
export function unpublish(id: string): void {
  store.update((prev) => ({
    ...prev,
    publishedCopies: prev.publishedCopies.filter((copy) => copy.id !== id),
  }));
}

export function resetShareStore(): void {
  publishToken += 1;
  copyCounter = 0;
  store.update(() => ({ publishing: null, publishedCopies: [] }));
}
