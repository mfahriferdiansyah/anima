/**
 * F0 — the connect-once moment. Guards (wrong network / no balance) with
 * committed copy, name your companion, ONE wallet PTB (create vault +
 * register this client's agent key + fund it), then the agent silently
 * exchanges a little SUI for WAL. Honest popup count: this PTB + one
 * personal-message signature for backend auth, once ever.
 */
import { useEffect, useState } from 'react';
import { useCurrentAccount, useSignAndExecuteTransaction, ConnectButton } from '@mysten/dapp-kit';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { buildOnboardingTx, suiBalance, exchangeSuiForWal, walBalance } from '@core/index.js';
import { getSuiClient } from '../lib/chain.js';
import { loadOrCreateAgentKey } from '../lib/agentKey.js';
import { Orb } from '../theme/Orb.js';

type Step = 'guards' | 'name' | 'creating' | 'funding' | 'done';

export function Onboarding({ ns, onComplete }: { ns: string; onComplete: () => void }) {
  const account = useCurrentAccount()!;
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [step, setStep] = useState<Step>('guards');
  const [guard, setGuard] = useState<string | null>(null);
  const [name, setName] = useState('Anima');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const suiClient = getSuiClient();
      const bal = await suiBalance(suiClient, account.address);
      if (bal < 300_000_000n) {
        setGuard(
          'Your wallet needs a little testnet SUI to create a vault (~0.3 SUI). Get some at faucet.sui.io, then come back.',
        );
      } else {
        setGuard(null);
        setStep('name');
      }
    })().catch(() => setGuard('Could not reach Sui testnet — check your connection.'));
  }, [account.address]);

  async function create() {
    setError(null);
    setStep('creating');
    try {
      const suiClient = getSuiClient();
      const agent: Ed25519Keypair = await loadOrCreateAgentKey(ns);
      const tx = buildOnboardingTx({ name, firstAgent: agent.toSuiAddress(), fundAgentMist: 250_000_000n });
      const { digest } = await signAndExecute({ transaction: tx });
      await suiClient.waitForTransaction({ digest });

      // silent: agent swaps some SUI for WAL (storage budget) — no popup
      setStep('funding');
      const wal = await walBalance(suiClient, agent.toSuiAddress());
      if (wal.balance < 20_000_000n) {
        await exchangeSuiForWal(suiClient, agent, 120_000_000n);
      }
      setStep('done');
      setTimeout(onComplete, 900);
    } catch (e: any) {
      setError(e.message?.slice(0, 160) ?? 'something went wrong');
      setStep('name');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="card w-full max-w-md p-8 flex flex-col items-center gap-6 text-center">
        <Orb state={step === 'creating' || step === 'funding' ? 'recall' : 'calm'} size={44} />

        {step === 'guards' && guard && (
          <>
            <h1 style={{ fontSize: 'var(--text-title)', fontWeight: 600 }}>One thing first</h1>
            <p className="text-fg-muted">{guard}</p>
            <ConnectButton />
          </>
        )}
        {step === 'guards' && !guard && <p className="text-fg-muted">checking your wallet…</p>}

        {step === 'name' && (
          <>
            <h1 style={{ fontSize: 'var(--text-title)', fontWeight: 600 }}>Name your companion</h1>
            <p className="text-fg-muted">
              Its memory will live on Walrus, owned by your wallet — not by any company. You can read, edit,
              and erase every memory it keeps.
            </p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="card w-full px-4 py-3 text-center outline-none focus:border-border-strong"
              maxLength={24}
            />
            <button
              onClick={create}
              disabled={!name.trim()}
              className="w-full py-3 rounded-[10px] font-semibold text-canvas"
              style={{ background: 'linear-gradient(90deg, var(--color-soul-violet), var(--color-soul-cyan))' }}
            >
              Create vault — one signature
            </button>
            {error && <p className="text-danger" style={{ fontSize: 'var(--text-meta)' }}>{error}</p>}
            <p className="text-fg-faint" style={{ fontSize: 'var(--text-meta)' }}>
              One transaction: creates your vault, registers this device's agent key, and gives it a tiny
              gas allowance for silent memory writes.
            </p>
          </>
        )}

        {step === 'creating' && <p className="text-fg-muted">creating your vault on Sui…</p>}
        {step === 'funding' && <p className="text-fg-muted">preparing silent memory writes (WAL)…</p>}
        {step === 'done' && <p className="text-ok">vault created — waking {name}…</p>}
      </div>
    </div>
  );
}
