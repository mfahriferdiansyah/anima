/**
 * Sharing: a note/canvas gets one live collaborative link with an access level
 * (edit = multiplayer, view = read-only) and an optional password gate. The
 * link is instant — there is no separate "publish a copy" flow. A view link
 * with no password is a public read-only share; adding a password gates it.
 */
import { createStore } from './store';
import { vaultStore } from './vaultStore';

export type LinkAccess = 'edit' | 'view';

export interface ShareLink {
  noteId: string;
  access: LinkAccess;
  /** Set when the link is password-protected; readers must enter it to open. */
  password: string | null;
  url: string;
}

export interface ShareState {
  links: ShareLink[];
}

const store = createStore<ShareState>({ links: [] });

export const shareStore = {
  getSnapshot: store.getSnapshot,
  subscribe: store.subscribe,
};

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 32);
  return base || 'note';
}

/** A fresh mock password for the UI to set when protection is switched on. */
export function newSharePassword(): string {
  return `${Math.random().toString(36).slice(2, 6)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Open (or return) the live link for a note/canvas with the given access. */
export function createShareLink(noteId: string, access: LinkAccess, titleOverride?: string): ShareLink {
  const existing = store.getSnapshot().links.find((link) => link.noteId === noteId);
  if (existing) return existing;
  const note = vaultStore.getSnapshot().notes.find((entry) => entry.noteId === noteId);
  const title = titleOverride?.trim() || note?.title || noteId;
  const link: ShareLink = { noteId, access, password: null, url: `anima.app/s/${slugify(title)}` };
  store.update((prev) => ({ links: [link, ...prev.links] }));
  return link;
}

/** Flip an existing link between edit (multiplayer) and view (read-only). */
export function setLinkAccess(noteId: string, access: LinkAccess): void {
  store.update((prev) => ({ links: prev.links.map((link) => (link.noteId === noteId ? { ...link, access } : link)) }));
}

/** Set or clear the link's password (pass null to remove protection). */
export function setLinkPassword(noteId: string, password: string | null): void {
  store.update((prev) => ({ links: prev.links.map((link) => (link.noteId === noteId ? { ...link, password } : link)) }));
}

export function resetShareStore(): void {
  store.update(() => ({ links: [] }));
}
