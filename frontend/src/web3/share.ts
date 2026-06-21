/**
 * The real share layer (plan 008 U2). Replaces the fully-mock `shareStore`.
 *
 * One live link per note/canvas (R25), with two access levels:
 *  - `view`: a published read-only `anima-pub` blob (plaintext or password
 *            envelope); the link addresses the blob: `/read.html?b=<blobId>`.
 *            `publishNote` is a SILENT agent-signed write (no wallet popup);
 *            UNpublish deletes the wallet-owned blob (a wallet popup, the
 *            destructive op, via `runDestructiveTx`).
 *  - `edit`: a live relay room (multiplayer). No blob is published. The link
 *            carries an unguessable room id (`?room=<id>`) or, when password-
 *            gated, the link SALT (`?salt=<salt>&edit=1`) from which the owner
 *            and any guest who knows the password derive the same room id at
 *            join time (`deriveRoomId`, U1). The link never carries the derived
 *            room id.
 *
 * State is an optimistic local store (mirroring `web3/canvasRegistry` + the mock
 * stores): mutators flip the store immediately so the dialog reacts, and the
 * slow chain writes (publish ~10s) fill in `blobObjectId`/`url` when they resolve
 * (`publishing`/`error` flags drive the UI). View links also reconcile from
 * `listPublished` (chain-as-registry) on the published-index swap; edit links are
 * local-only (rooms are ephemeral, never on chain).
 *
 * The `ShareState`/`ShareLink` binding contract is preserved: only OPTIONAL
 * fields are added (`blobObjectId`/`roomId`/`salt`/`publishing`/`error`).
 */
import { useSyncExternalStore } from 'react';
import { createStore } from '../mocks/store';
import { vaultData } from './vaultData';
import { getQuiltDeps } from './session';
import { runDestructiveTx } from '../hooks/useVault';
import { randomShareId } from './collabOps';
import { publishNote, unpublishNote, listPublished } from '../../../chain/core/src/index.js';
import type { Note } from '../../../chain/core/src/index.js';

export type LinkAccess = 'edit' | 'view';

export interface ShareLink {
  noteId: string;
  access: LinkAccess;
  /** Set when the link is password-protected; readers must enter it to open. */
  password: string | null;
  url: string;
  // --- additive optional fields (binding contract: shape stays compatible) ---
  /** view links: the published blob's object id, so unpublish can delete it. */
  blobObjectId?: string;
  /** edit links (no password): the unguessable relay room id (`?room=`). */
  roomId?: string;
  /** edit links (with password): the link salt; the room id is derived from password+salt at join. */
  salt?: string;
  /** a view publish (or re-publish) is in flight (the ~10s silent agent write). */
  publishing?: boolean;
  /** the last publish/unpublish error, surfaced in the dialog. */
  error?: string;
}

export interface ShareState {
  links: ShareLink[];
}

const store = createStore<ShareState>({ links: [] });

export const shareStore = {
  getSnapshot: store.getSnapshot,
  subscribe: store.subscribe,
};

/** Reactive snapshot for the dialog (mirrors `useShare` over the old mock). */
export function useShareState(): ShareState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** A fresh share password the UI sets when protection is switched on. */
export function newSharePassword(): string {
  return `${Math.random().toString(36).slice(2, 6)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ── store helpers ─────────────────────────────────────────────────────────

const findLink = (noteId: string): ShareLink | undefined =>
  store.getSnapshot().links.find((l) => l.noteId === noteId);

/** Patch one link by noteId (no-op if absent). */
function patchLink(noteId: string, patch: Partial<ShareLink>): void {
  store.update((prev) => ({
    links: prev.links.map((l) => (l.noteId === noteId ? { ...l, ...patch } : l)),
  }));
}

/** Read the chain/core Note for a noteId from the live vault index. */
function noteFor(noteId: string): Note | undefined {
  return vaultData.getSnapshot().notes.find((n) => n.noteId === noteId) as Note | undefined;
}

// ── edit-link url helpers (no blob is published for edit links) ──────────────

/** A no-password edit link: an unguessable room id. */
const editRoomUrl = (roomId: string): string => `/read.html?room=${encodeURIComponent(roomId)}`;
/** A password-gated edit link: carries the SALT (room id derived client-side at join), never the room id. */
const editSaltUrl = (salt: string): string => `/read.html?salt=${encodeURIComponent(salt)}&edit=1`;

/** Build the edit link fields for the given password state (instant, no chain). */
function editFields(password: string | null): Pick<ShareLink, 'url' | 'roomId' | 'salt'> {
  if (password) {
    const salt = randomShareId();
    return { url: editSaltUrl(salt), roomId: undefined, salt };
  }
  const roomId = randomShareId();
  return { url: editRoomUrl(roomId), roomId, salt: undefined };
}

// ── publish (view) ───────────────────────────────────────────────────────

/**
 * Publish (or re-publish) a view link's blob for the given password state, then
 * delete any PRIOR blob. Publish-before-delete (the forget/survivors ordering)
 * so the live share is never broken and a stale plaintext blob is removed only
 * after the new one certifies. Sets `publishing`/`error` on the link.
 */
async function publishView(noteId: string, password: string | null): Promise<void> {
  const deps = getQuiltDeps();
  if (!deps) {
    patchLink(noteId, { publishing: false, error: 'Connect your wallet to publish a view link.' });
    return;
  }
  const note = noteFor(noteId);
  if (!note) {
    patchLink(noteId, { publishing: false, error: 'This note is not in the vault yet.' });
    return;
  }
  const priorBlob = findLink(noteId)?.blobObjectId;
  patchLink(noteId, { publishing: true, error: undefined });
  try {
    const published = await publishNote(deps, note, password ? { password } : {});
    patchLink(noteId, {
      url: published.url,
      blobObjectId: published.blobObjectId,
      roomId: undefined,
      salt: undefined,
      publishing: false,
      error: undefined,
    });
    // remove the now-stale prior blob (wallet-signed delete) AFTER the new one is live
    if (priorBlob && priorBlob !== published.blobObjectId) {
      await runDestructiveTx(await unpublishNote(deps, priorBlob));
    }
  } catch (e) {
    patchLink(noteId, { publishing: false, error: e instanceof Error ? e.message : 'Publish failed.' });
  }
}

/** Delete the published blob for a view link under a wallet signature (the destructive op). */
async function unpublishView(noteId: string): Promise<void> {
  const link = findLink(noteId);
  const blobObjectId = link?.blobObjectId;
  if (!blobObjectId) return;
  const deps = getQuiltDeps();
  if (!deps) return;
  await runDestructiveTx(await unpublishNote(deps, blobObjectId));
  patchLink(noteId, { blobObjectId: undefined });
}

// ── public API (consumed by useShare → ShareDialog) ─────────────────────────

/**
 * Open (or return) the live link for a note/canvas with the given access.
 * `edit` is instant (a room id / salt, no chain write); `view` triggers a silent
 * agent publish (filling `blobObjectId`+`url` when it resolves).
 */
export async function createShareLink(noteId: string, access: LinkAccess, _titleOverride?: string): Promise<void> {
  if (findLink(noteId)) return; // one link per note/canvas
  const base: ShareLink = { noteId, access, password: null, url: '' };
  if (access === 'edit') {
    store.update((prev) => ({ links: [{ ...base, ...editFields(null) }, ...prev.links] }));
    return;
  }
  // view → publish; seed with a publishing placeholder so the UI shows progress
  store.update((prev) => ({ links: [{ ...base, publishing: true }, ...prev.links] }));
  await publishView(noteId, null);
}

/** Flip a link between edit (multiplayer) and view (read-only). */
export async function setLinkAccess(noteId: string, access: LinkAccess): Promise<void> {
  const link = findLink(noteId);
  if (!link) {
    await createShareLink(noteId, access);
    return;
  }
  if (link.access === access) return;
  if (access === 'edit') {
    // view → edit: tear down the published blob, hand out a live room
    const priorBlob = link.blobObjectId;
    patchLink(noteId, { access, blobObjectId: undefined, error: undefined, ...editFields(link.password) });
    if (priorBlob) {
      const deps = getQuiltDeps();
      if (deps) {
        try {
          await runDestructiveTx(await unpublishNote(deps, priorBlob));
        } catch {
          /* best-effort: the blob self-heals on a later unpublish; the link is already an edit room */
        }
      }
    }
    return;
  }
  // edit → view: publish a blob (carrying the link's current password), drop the room
  patchLink(noteId, { access, roomId: undefined, salt: undefined });
  await publishView(noteId, link.password);
}

/**
 * Set or clear the link's password.
 *  - view: re-publish the blob with/without the envelope (publish-before-delete
 *    of the prior blob).
 *  - edit: set/clear the link SALT (no chain); the room id is derived from the
 *    password + salt at join time.
 */
export async function setLinkPassword(noteId: string, password: string | null): Promise<void> {
  const link = findLink(noteId);
  if (!link) return;
  patchLink(noteId, { password });
  if (link.access === 'view') {
    await publishView(noteId, password);
    return;
  }
  // edit: a password introduces a salt (room derived from it); clearing it returns to a plain room id
  patchLink(noteId, editFields(password));
}

/** Revoke a view link: delete its published blob under a wallet signature. */
export async function unpublish(noteId: string): Promise<void> {
  await unpublishView(noteId);
  store.update((prev) => ({ links: prev.links.filter((l) => l.noteId !== noteId) }));
}

/** Reset (tests / disconnect). */
export function resetShareStore(): void {
  store.update(() => ({ links: [] }));
}

/**
 * Reconcile view links from the chain registry (`listPublished`) on a published-
 * index swap. Local intent wins: only ADD a view link for a noteId not already
 * in the store (so the dialog's optimistic edit link / in-flight publish is never
 * clobbered, and there is one link per noteId, dedup). Edit links never reconcile.
 */
export async function reconcilePublished(): Promise<void> {
  const deps = getQuiltDeps();
  if (!deps) return;
  let published;
  try {
    published = await listPublished(deps);
  } catch {
    return; // a transient registry read failure leaves the optimistic store intact
  }
  const known = new Set(store.getSnapshot().links.map((l) => l.noteId));
  const additions: ShareLink[] = published
    .filter((p) => !known.has(p.noteId))
    .map((p) => ({
      noteId: p.noteId,
      access: 'view' as const,
      password: p.mode === 'password' ? '' : null,
      url: p.url,
      blobObjectId: p.blobObjectId,
    }));
  if (additions.length) store.update((prev) => ({ links: [...additions, ...prev.links] }));
}

// ── reconcile trigger ───────────────────────────────────────────────────────
//
// View links are chain-as-registry, so they must repopulate from `listPublished`
// whenever the live vault index swaps (session rebuild / account switch). Without
// this, a fresh load shows no link for a previously view-published note, and
// opening its ShareDialog would auto-create an EDIT link while the old world-
// readable `anima-pub` blob sits on-chain, un-seeable and un-revokable from the
// UI. Subscribe at module scope (like the hooks) and fire once per index identity:
//  - a non-null index reconciles view links in (local intent still wins);
//  - a null index (disconnect / account switch) clears the store so a stale
//    account's links never linger.
let lastIndex: unknown = null;
vaultData.subscribe(() => {
  const idx = vaultData.getSnapshot().index;
  if (idx === lastIndex) return; // same index object: no swap, nothing to do
  lastIndex = idx;
  if (!idx) {
    store.update(() => ({ links: [] }));
    return;
  }
  void reconcilePublished();
});
