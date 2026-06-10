/**
 * Forget, for real — the wallet-gated destructive flow:
 * 1. enumerate EXACTLY what dies (before any popup)
 * 2. silent survivors-rewrite (agent) — edge #4, nothing innocent lost
 * 3. ONE wallet signature deleting the affected quilts (it owns them)
 * 4. write-through index + transcript scrub (edge #3 — the demo killer)
 */
import { useState } from 'react';
import { useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  buildForgetPlan, buildDeleteQuiltsTx, writeTurn, ensureAgentWal,
  type VaultInfo, type VaultIndex,
} from '@core/index.js';
import { getSuiClient, getSealVault, persistIndex } from '../lib/chain.js';

type Phase = 'review' | 'rewriting' | 'confirm-delete' | 'deleting' | 'done';

export function ForgetDialog({
  ns, vault, agent, index, noteIds, onClose, onForgotten,
}: {
  ns: string;
  vault: VaultInfo;
  agent: Ed25519Keypair;
  index: VaultIndex;
  noteIds: string[];
  onClose: () => void;
  onForgotten: (titles: string[]) => void;
}) {
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [phase, setPhase] = useState<Phase>('review');
  const [error, setError] = useState<string | null>(null);

  const plan = buildForgetPlan(index.all(), noteIds);
  const forgottenTitles = plan.forgotten.map((n) => n.title);

  async function run() {
    const suiClient = getSuiClient();
    const seal = getSealVault({ signer: agent, vaultId: vault.vaultId, ownerAddress: vault.owner });
    const deps = { suiClient, seal, agentSigner: agent, walletAddress: vault.owner, vaultId: vault.vaultId };
    try {
      // 1) survivors first — silent agent write
      if (plan.survivors.length > 0) {
        setPhase('rewriting');
        await ensureAgentWal(suiClient, agent).catch(() => void 0);
        const result = await writeTurn(deps, plan.survivors);
        for (const [i, n] of plan.survivors.entries()) {
          index.upsert(n, {
            quiltPatchId: result.perNote[i].quiltPatchId,
            quiltBlobId: result.quiltBlobId,
            blobObjectId: result.blobObjectId,
          });
        }
      }
      // 2) the wallet-gated deletion — one signature, all affected quilts
      setPhase('confirm-delete');
      const tx = await buildDeleteQuiltsTx(deps, plan.affectedBlobObjectIds);
      setPhase('deleting');
      const { digest } = await signAndExecute({ transaction: tx });
      await suiClient.waitForTransaction({ digest });

      // 3) write-through
      for (const id of noteIds) index.remove(id);
      await persistIndex(ns, vault.vaultId, index);
      onForgotten(forgottenTitles);
      setPhase('done');
      setTimeout(onClose, 1200);
    } catch (e: any) {
      setError(e.message?.slice(0, 140) ?? 'forget failed');
      setPhase('review');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="card w-full max-w-md p-6 flex flex-col gap-4" style={{ background: 'var(--color-surface)' }}>
        {phase === 'review' && (
          <>
            <h2 style={{ fontSize: 'var(--text-title)', fontWeight: 600, color: 'var(--color-danger)' }}>
              Forget, permanently
            </h2>
            <div className="flex flex-col gap-1.5">
              <p className="text-fg-muted" style={{ fontSize: 'var(--text-meta)' }}>These memories will be erased from Walrus:</p>
              {plan.forgotten.map((n) => (
                <div key={n.noteId} className="card px-3 py-2" style={{ borderColor: 'rgba(248,113,113,0.4)' }}>
                  {n.title}
                </div>
              ))}
              {plan.survivors.length > 0 && (
                <p className="text-fg-faint mt-1" style={{ fontSize: 'var(--text-meta)' }}>
                  {plan.survivors.length} other {plan.survivors.length === 1 ? 'memory' : 'memories'} sharing storage will be
                  safely rewritten first — nothing else is lost.
                </p>
              )}
              <p className="text-fg-faint" style={{ fontSize: 'var(--text-meta)' }}>
                Erasing requires your wallet signature — memories write silently, but only you can destroy them.
              </p>
            </div>
            {error && <p style={{ color: 'var(--color-danger)', fontSize: 'var(--text-meta)' }}>{error}</p>}
            <div className="flex gap-2">
              <button onClick={onClose} className="card flex-1 py-2.5 hover:border-border-strong">cancel</button>
              <button
                onClick={run}
                className="flex-1 py-2.5 rounded-[10px] font-semibold"
                style={{ background: 'var(--color-danger)', color: 'var(--color-canvas)' }}
              >
                forget {plan.forgotten.length === 1 ? 'it' : `all ${plan.forgotten.length}`}
              </button>
            </div>
          </>
        )}
        {phase === 'rewriting' && <Busy label="protecting other memories (rewriting survivors)…" />}
        {phase === 'confirm-delete' && <Busy label="preparing the deletion — your wallet will ask to confirm…" />}
        {phase === 'deleting' && <Busy label="erasing from Walrus…" />}
        {phase === 'done' && <p className="text-center" style={{ color: 'var(--color-ok)' }}>forgotten.</p>}
      </div>
    </div>
  );
}

function Busy({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="size-4 rounded-full border-2 border-fg-faint border-t-transparent animate-spin" />
      <span className="text-fg-muted" style={{ fontSize: 'var(--text-meta)' }}>{label}</span>
    </div>
  );
}
