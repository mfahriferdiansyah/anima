/**
 * The memory loop: after each exchange, distill durable facts → markdown
 * notes → encrypt → one quilt per turn → transfer to wallet — all async,
 * never blocking chat. Write-through into the index (AE2 lives here).
 * Failed writes keep the batch and expose retry() (edge #1).
 */
import { useCallback, useRef, useState } from 'react';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  newNote, writeTurn, preflight, type Note, type VaultInfo, VaultIndex,
} from '@core/index.js';
import { getSuiClient, getSealVault, persistIndex } from '../lib/chain.js';
import type { PendingNote } from './NoteToast.js';
import type { ChatMsg } from './useChatStream.js';

export function useMemoryLoop(opts: {
  ns: string;
  vault: VaultInfo;
  agent: Ed25519Keypair;
  index: VaultIndex;
  distill: (transcript: ChatMsg[]) => Promise<{ title: string; body: string; tags?: string[]; links?: string[] }[]>;
}) {
  const [pending, setPending] = useState<PendingNote[]>([]);
  const [lowBalance, setLowBalance] = useState(false);
  const failedBatch = useRef<Note[] | null>(null);

  const setStates = (notes: Note[], state: PendingNote['state'], extra?: Partial<PendingNote>) =>
    setPending((prev) => {
      const others = prev.filter((p) => !notes.some((n) => n.noteId === p.noteId));
      return [...others, ...notes.map((n) => ({ noteId: n.noteId, title: n.title, state, ...extra }))];
    });

  const writeBatch = useCallback(
    async (notes: Note[]) => {
      const suiClient = getSuiClient();
      const seal = getSealVault({ signer: opts.agent, vaultId: opts.vault.vaultId, ownerAddress: opts.vault.owner });
      const deps = {
        suiClient,
        seal,
        agentSigner: opts.agent,
        walletAddress: opts.vault.owner,
        vaultId: opts.vault.vaultId,
      };
      try {
        setStates(notes, 'encrypting');
        // preflight (edge #7): surface top-up instead of a mysterious failure
        const pf = await preflight(suiClient, opts.agent.toSuiAddress());
        setLowBalance(!pf.ok);
        if (!pf.ok) throw new Error('agent balance low — top up to keep remembering');

        setStates(notes, 'certifying');
        const result = await writeTurn(deps, notes);

        // write-through: the index is the chat's source of truth (AE2)
        for (const [i, n] of notes.entries()) {
          opts.index.upsert(n, {
            quiltPatchId: result.perNote[i].quiltPatchId,
            quiltBlobId: result.quiltBlobId,
            blobObjectId: result.blobObjectId,
          });
        }
        await persistIndex(opts.ns, opts.vault.vaultId, opts.index);
        failedBatch.current = null;
        setStates(notes, 'certified', { blobObjectId: result.blobObjectId });
        // let certified cards linger, then clear
        setTimeout(
          () => setPending((prev) => prev.filter((p) => !notes.some((n) => n.noteId === p.noteId))),
          12_000,
        );
      } catch (e: any) {
        failedBatch.current = notes;
        setStates(notes, 'failed', { error: e.message?.slice(0, 80) });
      }
    },
    [opts.agent, opts.vault, opts.index, opts.ns],
  );

  /** Fire-and-forget after a completed exchange. */
  const remember = useCallback(
    async (lastExchange: ChatMsg[]) => {
      const candidates = await opts.distill(lastExchange).catch(() => []);
      if (candidates.length === 0) return; // chit-chat is a normal no-op
      const notes = candidates.map((c) =>
        newNote({ title: c.title, body: c.body, tags: c.tags ?? [], links: c.links ?? [], author: 'anima' }),
      );
      void writeBatch(notes);
    },
    [opts.distill, writeBatch],
  );

  const retry = useCallback(() => {
    if (failedBatch.current) void writeBatch(failedBatch.current);
  }, [writeBatch]);

  return { pending, remember, retry, lowBalance };
}
