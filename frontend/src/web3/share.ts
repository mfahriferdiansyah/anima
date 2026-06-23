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
import { getQuiltDeps, isInsufficientFunds } from './session';
import { runDestructiveTx } from '../hooks/useVault';
import { randomShareId } from './collabOps';
import { buildCanvasSnapshotNote } from './canvasSnapshot';
import { runWithReceipt, objectProvenanceUrl, txProvenanceUrl, digestOf } from './onchainToast';
import { publishNote, unpublishNote, listPublished } from '../../../chain/core/src/index.js';
import type { Note } from '../../../chain/core/src/index.js';

export type LinkAccess = 'edit' | 'view';

export interface ShareLink {
  noteId: string;
  access: LinkAccess;
  /** 'note' shares a memory; 'canvas' publishes a read-only board snapshot. */
  kind: 'note' | 'canvas';
  /** Set when the link is password-protected; readers must enter it to open. */
  password: string | null;
  url: string;
  // --- additive optional fields (binding contract: shape stays compatible) ---
  /** the document title, baked into a canvas snapshot at generate time. */
  title?: string;
  /** view links: the published blob's object id, so unpublish can delete it. */
  blobObjectId?: string;
  /** edit links (no password): the unguessable relay room id (`?room=`). */
  roomId?: string;
  /** edit links (with password): the link salt; the room id is derived from password+salt at join. */
  salt?: string;
  /** view links: the generated absolute reader link, kept across access switches so re-selecting view never re-publishes. */
  viewUrl?: string;
  /**
   * The current step of a publish/revoke, narrated as a progression:
   *  - 'publishing': the silent agent write of the new copy (no wallet).
   *  - 'cleaning': deleting the PRIOR wallet-owned copy (a wallet approval; refunds the deposit).
   *  - 'revoking': deleting the published copy on Revoke (a wallet approval; refunds the deposit).
   * Absent when idle.
   */
  phase?: 'publishing' | 'cleaning' | 'revoking';
  /**
   * Set when the prior-copy delete was skipped/rejected: that old copy is STILL
   * published (the previous link still opens it). Drives the warning + a retry.
   */
  staleBlob?: string;
  /** the publish failed because the agent is out of funds — drives a Top up action. */
  needsFunds?: boolean;
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

// ── url helpers ──────────────────────────────────────────────────────────────

/**
 * Make a reader link absolute. The reader lives at `<origin>/read.html`, so a
 * bare `/read.html?…` path is unusable once copied out of the app (no host).
 * `chain/core`'s `shareUrl` stays origin-agnostic (isomorphic); the origin is
 * stamped here, at the browser edge. In a non-browser env (the node tests) there
 * is no origin, so the path is left relative.
 */
function withOrigin(path: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return origin ? `${origin}${path}` : path;
}

// ── edit-link url helpers (no blob is published for edit links) ──────────────

/** A no-password edit link: an unguessable room id. */
const editRoomUrl = (roomId: string): string => withOrigin(`/read.html?room=${encodeURIComponent(roomId)}`);
/** A password-gated edit link: carries the SALT (room id derived client-side at join), never the room id. */
const editSaltUrl = (salt: string): string => withOrigin(`/read.html?salt=${encodeURIComponent(salt)}&edit=1`);

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
 * delete any PRIOR blob. Two on-chain ops the dialog narrates as a progression:
 *  1. 'publishing' — the silent agent write of the new copy (no wallet). Walrus
 *     blobs are immutable, so a content/password change is always a NEW blob.
 *  2. 'cleaning' — delete the PRIOR wallet-owned copy (a wallet approval). Done
 *     AFTER the new copy certifies (publish-before-delete) so the link never
 *     breaks. If the user skips/rejects this delete, the old copy stays published
 *     (its earlier link still opens) — recorded as `staleBlob` for a retry.
 */
async function publishView(noteId: string, password: string | null): Promise<void> {
  const deps = getQuiltDeps();
  if (!deps) {
    patchLink(noteId, { phase: undefined, error: 'Connect your wallet to publish a view link.' });
    return;
  }
  // A canvas link publishes a denormalized read-only board snapshot (carried as a
  // note body, kind 'canvas'); a note link publishes the memory itself.
  const link = findLink(noteId);
  const kind = link?.kind ?? 'note';
  const note = kind === 'canvas' ? buildCanvasSnapshotNote(noteId, link?.title ?? '') : noteFor(noteId);
  if (!note) {
    patchLink(noteId, {
      phase: undefined,
      error: kind === 'canvas' ? 'This board is not in the vault yet.' : 'This note is not in the vault yet.',
    });
    return;
  }
  const priorBlob = link?.blobObjectId;
  patchLink(noteId, { phase: 'publishing', error: undefined, staleBlob: undefined, needsFunds: undefined });
  let published;
  try {
    // Step 1 — publish the new copy (silent agent write; the SAME provenance
    // receipt a note save does).
    published = await runWithReceipt(
      {
        key: `publish:${noteId}`,
        title: note.title || 'Untitled',
        labels: { pending: 'Publishing link', success: 'Link published' },
      },
      () =>
        publishNote(deps, note, { ...(password ? { password } : {}), kind }).then((p) => ({
          result: p,
          provenanceUrl: objectProvenanceUrl(p.blobObjectId),
        })),
    );
  } catch (e) {
    // An out-of-funds failure is recoverable: surface a Top up action, not a raw
    // chain error with hex addresses.
    if (isInsufficientFunds(e)) {
      patchLink(noteId, { phase: undefined, needsFunds: true, error: undefined });
    } else {
      patchLink(noteId, { phase: undefined, error: e instanceof Error ? e.message : 'Publish failed.' });
    }
    return;
  }
  const url = withOrigin(published.url);
  const needsCleanup = !!priorBlob && priorBlob !== published.blobObjectId;
  patchLink(noteId, {
    url,
    viewUrl: url,
    blobObjectId: published.blobObjectId,
    phase: needsCleanup ? 'cleaning' : undefined,
    error: undefined,
  });
  // Step 2 — remove the now-stale prior copy (wallet-signed delete). The new copy
  // is already live, so a failure/rejection here only leaves the OLD copy around.
  if (needsCleanup) {
    try {
      await runDestructiveTx(await unpublishNote(deps, priorBlob!));
      patchLink(noteId, { phase: undefined, staleBlob: undefined });
    } catch {
      patchLink(noteId, { phase: undefined, staleBlob: priorBlob });
    }
  }
}

/**
 * Retry deleting a prior copy whose cleanup was skipped/rejected (`staleBlob`).
 * The new copy is already the live link; this just removes the lingering old one
 * (a wallet-signed delete).
 */
export async function removeStaleCopy(noteId: string): Promise<void> {
  const link = findLink(noteId);
  const blob = link?.staleBlob;
  if (!blob) return;
  const deps = getQuiltDeps();
  if (!deps) return;
  patchLink(noteId, { phase: 'cleaning', error: undefined });
  try {
    await runDestructiveTx(await unpublishNote(deps, blob));
    patchLink(noteId, { phase: undefined, staleBlob: undefined });
  } catch {
    patchLink(noteId, { phase: undefined }); // keep staleBlob so the retry stays offered
  }
}

/** Clear the out-of-funds notice (e.g. after the Top up modal closes), so the
 * Generate affordance returns for a retry. */
export function dismissFunds(noteId: string): void {
  patchLink(noteId, { needsFunds: undefined });
}


// ── public API (consumed by useShare → ShareDialog) ─────────────────────────

/**
 * Open (or return) the live link for a note/canvas with the given access. Pure
 * LOCAL state — no chain write on open, for EITHER access (the earlier auto-
 * publish on view stamped a blob the moment the dialog touched the view card).
 * `edit` is an instant relay room; `view` seeds an empty link whose blob is
 * published only on an explicit `generateView`.
 */
export async function createShareLink(
  noteId: string,
  access: LinkAccess,
  kind: 'note' | 'canvas' = 'note',
  title?: string,
): Promise<void> {
  if (findLink(noteId)) return; // one link per note/canvas
  const base: ShareLink = { noteId, access, kind, title, password: null, url: '' };
  const fields = access === 'edit' ? editFields(null) : {};
  store.update((prev) => ({ links: [{ ...base, ...fields }, ...prev.links] }));
}

/**
 * Flip a link between edit (multiplayer) and view (read-only). LOCAL ONLY: a card
 * switch never writes to the chain. Switching to view shows the already-generated
 * link (if any) or the Generate affordance (empty url); switching to edit reuses
 * the existing room (no churn) and KEEPS any published blob — deletion is the
 * Revoke op alone, never a side effect of toggling.
 */
export async function setLinkAccess(noteId: string, access: LinkAccess): Promise<void> {
  const link = findLink(noteId);
  if (!link) {
    await createShareLink(noteId, access);
    return;
  }
  if (link.access === access) return;
  if (access === 'edit') {
    // reuse the link's existing room/salt so the edit link is stable across switches;
    // mint one only if this link has never had an edit room.
    const haveRoom = link.password ? !!link.salt : !!link.roomId;
    const fields = haveRoom
      ? { url: link.password ? editSaltUrl(link.salt!) : editRoomUrl(link.roomId!) }
      : editFields(link.password);
    patchLink(noteId, { access, error: undefined, ...fields });
    return;
  }
  // edit → view: show the generated link if we have one, else the Generate CTA.
  patchLink(noteId, { access, url: link.viewUrl ?? '', error: undefined });
}

/**
 * Set or clear the link's password. LOCAL ONLY (the password switch used to
 * re-publish a view blob on every toggle — same stamping bug as the access card).
 *  - view: record the password and invalidate any generated link, so the new
 *    envelope is published on the next explicit `generateView` (which still does
 *    publish-before-delete of the prior blob, kept here for that cleanup).
 *  - edit: set/clear the link SALT (no chain); the room id is derived from the
 *    password + salt at join time.
 */
export async function setLinkPassword(noteId: string, password: string | null): Promise<void> {
  const link = findLink(noteId);
  if (!link) return;
  if (link.access === 'view') {
    patchLink(noteId, { password, url: '', viewUrl: undefined, error: undefined });
    return;
  }
  patchLink(noteId, { password, ...editFields(password) });
}

/**
 * Publish (or re-publish) a view link's blob — the ONLY path that writes to the
 * chain for a share. The link appears only after this resolves, so a copied link
 * is always live. Carries the link's current password (a locked envelope when
 * set). Publish-before-delete removes any prior blob after the new one certifies.
 */
export async function generateView(noteId: string): Promise<void> {
  const link = findLink(noteId);
  if (!link) return;
  await publishView(noteId, link.password);
}

/**
 * Revoke a published view link: delete its blob under a wallet signature (which
 * also refunds the storage deposit). Runs through the SAME progression ('revoking')
 * the dialog narrates — no native confirm; the wallet approval is the confirmation.
 * On success the link is removed; on failure the phase clears with an error.
 */
export async function unpublish(noteId: string): Promise<void> {
  const link = findLink(noteId);
  const blobObjectId = link?.blobObjectId;
  if (!blobObjectId) {
    store.update((prev) => ({ links: prev.links.filter((l) => l.noteId !== noteId) }));
    return;
  }
  const deps = getQuiltDeps();
  if (!deps) {
    patchLink(noteId, { error: 'Connect your wallet to revoke this link.' });
    return;
  }
  patchLink(noteId, { phase: 'revoking', error: undefined });
  try {
    // The revoke tx IS the provenance for a delete — link the receipt at its digest.
    await runWithReceipt(
      {
        key: `unpublish:${noteId}`,
        title: noteFor(noteId)?.title || link?.title || 'Shared link',
        labels: { pending: 'Revoking link', success: 'Link revoked' },
      },
      async () => {
        const res = await runDestructiveTx(await unpublishNote(deps, blobObjectId));
        const digest = digestOf(res);
        return { result: res, provenanceUrl: digest ? txProvenanceUrl(digest) : '' };
      },
    );
    store.update((prev) => ({ links: prev.links.filter((l) => l.noteId !== noteId) }));
  } catch (e) {
    patchLink(noteId, { phase: undefined, error: e instanceof Error ? e.message : 'Could not revoke this link.' });
  }
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
      kind: p.kind,
      password: p.mode === 'password' ? '' : null,
      url: withOrigin(p.url),
      viewUrl: withOrigin(p.url),
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
