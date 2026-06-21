/**
 * Notes read/edit/save (plan U4), migrated onto the shared web3/vaultData layer.
 * `useVault` selects notes + inline write-states from the one live VaultIndex;
 * `useWriteEvents` exposes the global toast stack vaultData hosts. Saves run the
 * REAL write-state lifecycle off `writeTurn`: `encrypting`/`certifying` are honest
 * optimistic labels, `certified(blobObjectId, provenanceUrl)`/`failed` come from
 * the promise. Funding is checked FIRST so a low balance surfaces the banner
 * (never a phantom `certifying`). Same hook signatures + snapshot shapes as the
 * deleted mock vaultStore (the binding contract) — no page rewrites.
 */
import { useSyncExternalStore } from 'react';
import {
  newNote,
  editedNote,
  writeTurn,
  preflight,
  buildForgetPlan,
  buildDeleteQuiltsTx,
  listVaultQuilts,
  listVaultCovers,
  uploadCover,
  readAll,
  VaultIndex,
  type NoteLocation,
} from '../../../chain/core/src/index.js';
import { dataUrlToBytes, COVER_MAX_BYTES } from '../web3/covers';
import type { WriteState } from '../components/WriteStateCard';
import { vaultData, type WriteEvent } from '../web3/vaultData';
import { getQuiltDeps } from '../web3/session';
// low-balance banner lives in the chat layer; import via useChat so this survives
// U6 deleting the chatStore mock (useChat keeps re-exporting triggerLowBalance).
import { triggerLowBalance } from './useChat';
import { OWNER_AUTHOR, type Note } from '../mocks/fixture';

export interface NotePatch {
  title?: string;
  body?: string;
  tags?: string[];
  links?: string[];
  /** Cover image: preset path, empty string (clear), or data URL (upload). */
  image?: string;
}

export interface VaultState {
  notes: Note[];
  /** Latest write state per noteId, for inline editor display. */
  writeStates: Record<string, WriteState>;
}

export interface ScrubEvent {
  removed: Array<{ noteId: string; title: string }>;
  line: string;
}

/** An unsaved draft has no chain location yet; saveNote replaces it with the real one. */
const DRAFT_LOCATION: NoteLocation = { quiltPatchId: '', quiltBlobId: '', blobObjectId: '' };

/** Runs a forget/wipe PTB through the wallet (one popup). Injected by the React layer. */
type ExecTx = (transaction: unknown) => Promise<unknown>;

/**
 * The wallet-exec for the destructive forget paths. The wallet can only be
 * reached through React hooks, so — like the session engine and the settings
 * layer — the forget functions read an injected `execTx` wired from
 * `useWalletExecTx()`. Set-only (no null-on-unmount): ManageLibrary (always
 * mounted via AppShell) and Settings/Notes/CanvasHome can be co-mounted and
 * would clobber each other's cleanup, but every `execTx` is the same wallet
 * adapter, so last-writer-wins has no wrong winner. The deps-null guard is the
 * real safety: forget early-returns without a ready vault regardless.
 */
let forgetExec: ExecTx | null = null;

/** Wire the wallet-exec adapter for forget — called by ManageLibrary/Settings from `useWalletExecTx()`. */
export function configureForgetExec(execTx: ExecTx): void {
  forgetExec = execTx;
}

/**
 * Block new note writes for the confirm→delete window of a bulk wipe, so a save
 * can't slip a fresh quilt onto Walrus between the point-in-time enumeration and
 * the delete. `persist()` early-returns while this is set.
 */
let wipeInProgress = false;

/** Notes plus the latest write state per note — selected from the live vaultData index. */
export function useVault(): VaultState {
  const snap = useSyncExternalStore(vaultData.subscribe, vaultData.getSnapshot);
  // vaultData holds chain/core notes (no cover); they satisfy the frontend Note shape (image optional).
  return { notes: snap.notes as Note[], writeStates: snap.writeStates };
}

/** The global write-event stream for the bottom-left toast stack. */
export function useWriteEvents(): WriteEvent[] {
  return useSyncExternalStore(vaultData.subscribe, vaultData.getSnapshot).writeEvents;
}

/** Mint a new draft note in the index (no chain write yet); returns its id so routing can open it. */
export function createNote(author: string = OWNER_AUTHOR): string {
  const note = newNote({ title: '', body: '', author });
  vaultData.upsert(note, DRAFT_LOCATION);
  return note.noteId;
}

/**
 * Classify a cover patch: returns the ready cover value for preset/clear,
 * pending upload bytes for data URLs, or null for oversize / no image patch.
 * Called synchronously so the no-op guard can check for cover intent.
 */
function classifyCoverPatch(
  image: string | undefined,
): { kind: 'value'; cover: string } | { kind: 'upload'; bytes: Uint8Array } | null {
  if (image === undefined) return null;
  if (!image || !image.startsWith('data:')) return { kind: 'value', cover: image };
  // data URL — decode and size-check before any async work
  let bytes: Uint8Array;
  try {
    bytes = dataUrlToBytes(image);
  } catch {
    return null; // malformed data URL — treat as no cover intent
  }
  if (bytes.byteLength > COVER_MAX_BYTES) return null; // oversize — skip silently
  return { kind: 'upload', bytes };
}

/** Chain-persisted scalar fields (title/body/tags/links). Cover is handled separately. */
function realChanges(patch: NotePatch): Partial<Pick<Note, 'title' | 'body' | 'tags' | 'links' | 'cover'>> {
  const changes: Partial<Pick<Note, 'title' | 'body' | 'tags' | 'links' | 'cover'>> = {};
  if (patch.title !== undefined) changes.title = patch.title;
  if (patch.body !== undefined) changes.body = patch.body;
  if (patch.tags !== undefined) changes.tags = patch.tags;
  if (patch.links !== undefined) changes.links = patch.links;
  return changes;
}

/**
 * Apply a patch and persist as a new sealed version. Without a noteId a fresh
 * draft is created first. Returns the id synchronously; the seal+write runs async
 * and drives the write-state lifecycle.
 */
export function saveNote(noteId: string | undefined, patch: NotePatch = {}): string {
  const id = noteId ?? createNote();
  void persist(id, patch);
  return id;
}

async function persist(id: string, patch: NotePatch): Promise<void> {
  // a bulk wipe is enumerating+deleting; block new quilts until it clears
  if (wipeInProgress) return;
  // double-submit guard: the in-flight write-state map is the signal
  const ws = vaultData.getSnapshot().writeStates[id];
  if (ws && (ws.phase === 'encrypting' || ws.phase === 'certifying')) return;

  const deps = getQuiltDeps();
  const current = vaultData.getSnapshot().index?.get(id)?.note;
  if (!deps || !current) return; // no live vault, or unknown note

  // 1) Classify scalar changes + cover intent synchronously
  const changes = realChanges(patch);
  const coverIntent = classifyCoverPatch(patch.image);

  // no-op guard: no scalar changes AND no cover intent → nothing to write
  if (Object.keys(changes).length === 0 && coverIntent === null) return;

  // 2) preflight FIRST — a low balance surfaces the banner with NO write-state (Save preserved),
  // so the banner never shows under a 'certifying' indicator implying an in-flight upload.
  const pf = await preflight(deps.suiClient, deps.agentSigner.toSuiAddress());
  if (!pf.ok) {
    triggerLowBalance();
    return;
  }

  // 3) Resolve cover value (upload if needed — happens AFTER preflight)
  if (coverIntent !== null) {
    if (coverIntent.kind === 'value') {
      changes.cover = coverIntent.cover;
    } else {
      // data URL upload: sealed private cover
      const { ref } = await uploadCover(deps, coverIntent.bytes, { noteId: id });
      changes.cover = ref;
    }
  }

  const next = editedNote(current, changes, OWNER_AUTHOR);
  const title = next.title || 'Untitled note';
  const eventId = vaultData.beginWriteEvent({ noteId: id, noteTitle: title, state: { phase: 'encrypting' } });
  vaultData.updateWriteEvent(eventId, { phase: 'certifying' });
  try {
    const res = await writeTurn(deps, [next]);
    const per = res.perNote.find((p) => p.noteId === id) ?? res.perNote[0];
    vaultData.upsert(next, { quiltPatchId: per.quiltPatchId, quiltBlobId: res.quiltBlobId, blobObjectId: res.blobObjectId });
    vaultData.updateWriteEvent(eventId, {
      phase: 'certified',
      blobObjectId: res.blobObjectId,
      provenanceUrl: `https://suiscan.xyz/testnet/object/${res.blobObjectId}`,
    });
  } catch {
    vaultData.updateWriteEvent(eventId, { phase: 'failed' });
  }
}

/** Re-run the current note's seal+write after a failure. */
export function retryWrite(noteId: string): void {
  const current = vaultData.getSnapshot().index?.get(noteId)?.note;
  if (!current) return;
  // re-persist the current title+body (a fresh version) to recover from a failed seal
  void persist(noteId, { title: current.title, body: current.body, tags: current.tags, links: current.links });
}

/** Move a note into a folder (the folder is tags[0]) — a real tags write (folders themselves stay Tier-2). */
export function setNoteFolder(noteId: string, folder: string): void {
  const current = vaultData.getSnapshot().index?.get(noteId)?.note;
  if (!current) return;
  saveNote(noteId, { tags: [folder, ...current.tags.slice(1)] });
}

function scrubLine(removed: ScrubEvent['removed']): string {
  const titles = removed.map((e) => e.title).join(', ');
  return removed.length === 1
    ? `Forgot 1 memory: ${titles}. Transcript references were scrubbed.`
    : `Forgot ${removed.length} memories: ${titles}. Transcript references were scrubbed.`;
}

/**
 * Forget for real (plan U7): rewrite co-resident survivors into a fresh quilt,
 * then delete the old quilts in ONE wallet-signed PTB.
 *
 * The affected blobs come from FULL PHYSICAL RESIDENCY (`readAll(listVaultQuilts)`),
 * NOT the latest-wins index: an edited note has stale prior-version quilts the
 * index forgot about, and feeding the index would delete only the latest blob,
 * leaving decryptable prior-version ciphertext on Walrus that resurrects at v1
 * (the AE2 leak). Survivors-first: a survivor sharing a doomed quilt is rewritten
 * and upserted to its NEW location BEFORE the delete, so a same-session re-forget
 * targets the new blob and a delete failure leaves it durable. Only survivors
 * whose LATEST indexed location still sits in a doomed blob are rewritten — an
 * already-rewritten survivor (run 2 of a retried forget) is skipped, so a rejected
 * delete re-runs the delete alone with no orphan duplicate (idempotence).
 */
export async function forgetNotes(ids: string[]): Promise<ScrubEvent> {
  // capture titles from the live index FIRST (before any rewrite/remove churn)
  const idSet = new Set(ids);
  const removed = vaultData
    .getSnapshot()
    .notes.filter((n) => idSet.has(n.noteId))
    .map((n) => ({ noteId: n.noteId, title: n.title || 'Untitled note' }));

  const deps = getQuiltDeps();
  if (!deps) return { removed, line: scrubLine(removed) };

  // 1) full physical residency → which quilts die, which notes co-resided
  const residency = await readAll(deps, await listVaultQuilts(deps));
  const plan = buildForgetPlan(residency, ids);

  // cover blobs for the forgotten notes (a distinct blob kind, separate enumeration)
  const coverBlobIds = await listVaultCovers(deps, ids);

  // combined delete list (quilts + covers)
  const blobsToDelete = [...plan.affectedBlobObjectIds, ...coverBlobIds];

  if (blobsToDelete.length === 0) {
    // nothing on-chain to delete (e.g. unsaved drafts) — drop locally
    for (const id of ids) vaultData.remove(id);
    return { removed, line: scrubLine(removed) };
  }

  // a chain delete is needed — assert the wallet exec BEFORE any rewrite/remove,
  // so a missing exec creates no orphan and removes nothing (the note stays, retryable)
  if (!forgetExec) throw new Error('forgetNotes: wallet exec not wired');

  // 2) rewrite ONLY survivors whose LATEST indexed location is still in a doomed
  // quilt blob (covers have no survivors — don't let them enter the rewrite logic)
  const affected = new Set(plan.affectedBlobObjectIds);
  const index = vaultData.getSnapshot().index;
  const toRewrite = [...new Set(plan.survivors.map((s) => s.noteId))]
    .map((id) => index?.get(id))
    .filter((e): e is NonNullable<typeof e> => !!e && affected.has(e.location.blobObjectId))
    .map((e) => e.note);

  // 3) survivors-first: rewrite + upsert to the NEW blob BEFORE the delete
  if (toRewrite.length > 0) {
    const res = await writeTurn(deps, toRewrite);
    for (const survivor of toRewrite) {
      const per = res.perNote.find((p) => p.noteId === survivor.noteId) ?? res.perNote[0];
      vaultData.upsert(survivor, {
        quiltPatchId: per.quiltPatchId,
        quiltBlobId: res.quiltBlobId,
        blobObjectId: res.blobObjectId,
      });
    }
  }

  // 4) ONE atomic wallet signature deletes every doomed quilt + cover blob
  const tx = await buildDeleteQuiltsTx(deps, blobsToDelete);
  await forgetExec(tx);

  // 5) on-chain erasure done → drop the forgotten notes from the live index
  for (const id of ids) vaultData.remove(id);
  return { removed, line: scrubLine(removed) };
}

/**
 * Forget everything (plan U7 bulk): wipe every quilt in the vault under one
 * wallet signature. Quiesce first — wait out any in-flight encrypting/certifying
 * write (silent layout/survivor writes included, since they register in
 * writeStates) and block new writes for the confirm→delete window, so the
 * enumeration is a faithful point-in-time snapshot. Sui PTB atomicity means a
 * rejected signature leaves nothing deleted. The Vault object SURVIVES — the
 * index is cleared but not nulled (re-onboardable, no teardown).
 */
export async function forgetEverything(): Promise<void> {
  const deps = getQuiltDeps();
  if (!deps) return;
  // assert the wallet exec up front: a missing exec must NOT clear the index
  // (a skipped delete + emptied index = a lying "wiped" that leaks every quilt)
  if (!forgetExec) throw new Error('forgetEverything: wallet exec not wired');

  wipeInProgress = true;
  try {
    // quiesce: wait while any write is mid-flight (covers silent writes too)
    while (
      Object.values(vaultData.getSnapshot().writeStates).some(
        (ws) => ws.phase === 'encrypting' || ws.phase === 'certifying',
      )
    ) {
      await new Promise((r) => setTimeout(r, 50));
    }

    // point-in-time enumeration, then ONE atomic delete of every quilt
    const blobs = await listVaultQuilts(deps);
    const tx = await buildDeleteQuiltsTx(deps, blobs);
    await forgetExec(tx);

    // clear the index in place — the Vault survives, so it stays re-onboardable
    vaultData.publish(VaultIndex.fromEntries([]));
  } finally {
    wipeInProgress = false;
  }
}

/** Dismiss a toast from the global write-event stack (App.tsx). */
export function dismissWriteEvent(id: string): void {
  vaultData.dismissWriteEvent(id);
}

export type { Note } from '../mocks/fixture';
export type { WriteEvent } from '../web3/vaultData';
