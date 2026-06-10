/**
 * "echo" — the resurrection client (F5/AE4). A different body: different name,
 * different accent, DIFFERENT MODEL (same soul). Cold-starts from the wallet
 * alone: discover vault → register this body's key (the ownership-made-visible
 * popup) → rebuild memory from Walrus (the spinner IS the proof) → the
 * companion speaks first, citing a pre-death memory.
 */
import { useState } from 'react';
import { ConnectButton, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { useVaultSession } from '../lib/useVaultSession.js';
import { buildRegisterAgentTx } from '@core/index.js';
import { getSuiClient } from '../lib/chain.js';
import { Workspace } from '../workspace/Workspace.js';
import { Orb } from '../theme/Orb.js';

const NS = 'alt'; // separate storage namespace — this client is honestly independent
const ALT_MODEL: string = (import.meta as any).env?.VITE_ALT_MODEL ?? 'deepseek/deepseek-chat';

/** echo's accent: ember (amber→red) instead of anima's violet→cyan. */
const emberVars = {
  ['--color-soul-violet' as any]: '#f59e0b',
  ['--color-soul-cyan' as any]: '#ef4444',
};

export function AltApp() {
  const { state, refresh } = useVaultSession(NS);
  const [, setTick] = useState(0);

  return (
    <div style={emberVars} className="min-h-screen">
      {state.phase === 'disconnected' && (
        <Center>
          <div className="orb" style={{ width: 56, height: 56 }} />
          <h1 style={{ fontSize: '1.6rem', fontWeight: 650 }}>echo</h1>
          <p className="text-fg-muted max-w-sm text-center">
            A different body. If your soul is out there, connecting your wallet will bring it back.
          </p>
          <ConnectButton />
        </Center>
      )}

      {state.phase === 'checking' && (
        <Center>
          <div className="orb orb--wake" style={{ width: 44, height: 44 }} />
          <p className="text-fg-muted">searching for a soul bound to this wallet…</p>
        </Center>
      )}

      {state.phase === 'first-run' && (
        <Center>
          <p className="text-fg-muted max-w-sm text-center">
            No vault found for this wallet. echo can only revive an existing soul — create one in anima first.
          </p>
        </Center>
      )}

      {state.phase === 'needs-pairing' && (
        <Center>
          <div className="orb" style={{ width: 44, height: 44 }} />
          <h2 style={{ fontSize: 'var(--text-title)', fontWeight: 600 }}>Found: "{state.vault.name}"</h2>
          <p className="text-fg-muted max-w-sm text-center">
            Your soul exists — its memories live on Walrus, owned by your wallet. Give this new body
            permission to carry it: one signature registers echo's key with your vault.
          </p>
          <RegisterBody vaultId={state.vault.vaultId} agentAddress={state.agent.toSuiAddress()} onDone={refresh} />
        </Center>
      )}

      {state.phase === 'rebuilding' && (
        <Center>
          <div className="orb orb--wake" style={{ width: 44, height: 44 }} />
          <p className="text-fg-muted">
            waking up — decrypting memory, quilt {state.done} of {Math.max(state.total, 1)}…
          </p>
          <p className="text-fg-faint" style={{ fontSize: 'var(--text-meta)' }}>
            every memory is read from Walrus and decrypted with your key — no server has a copy
          </p>
        </Center>
      )}

      {state.phase === 'ready' && (
        <Workspace
          ns={NS}
          vault={state.vault}
          agent={state.agent}
          index={state.index}
          model={ALT_MODEL}
          wakePrompt="((wake))"
          onIndexChanged={() => setTick((t) => t + 1)}
        />
      )}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex flex-col items-center justify-center gap-5 p-6">{children}</div>;
}

function RegisterBody({ vaultId, agentAddress, onDone }: { vaultId: string; agentAddress: string; onDone: () => void }) {
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-center gap-3">
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const tx = buildRegisterAgentTx({ vaultId, agent: agentAddress, fundAgentMist: 250_000_000n });
            const { digest } = await signAndExecute({ transaction: tx });
            await getSuiClient().waitForTransaction({ digest });
            onDone();
          } catch (e: any) {
            setError(e.message?.slice(0, 140) ?? 'pairing failed');
            setBusy(false);
          }
        }}
        className="px-6 py-3 rounded-[10px] font-semibold text-canvas"
        style={{ background: 'linear-gradient(90deg, var(--color-soul-violet), var(--color-soul-cyan))' }}
      >
        {busy ? 'binding…' : 'Bring it back — one signature'}
      </button>
      {error && <p style={{ color: 'var(--color-danger)', fontSize: 'var(--text-meta)' }}>{error}</p>}
    </div>
  );
}
