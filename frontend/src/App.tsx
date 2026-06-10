/**
 * Main app shell: session-phase router. Chat (U6) and Vault (U7) panes land
 * in their units; this shell renders every state honestly (empty vault,
 * rebuild progress, pairing) so no screen is ever an accident.
 */
import { ConnectButton } from '@mysten/dapp-kit';
import { useVaultSession } from './lib/useVaultSession.js';
import { Onboarding } from './onboarding/Onboarding.js';
import { Orb } from './theme/Orb.js';

const NS = 'anima';

export default function App() {
  const { state, refresh } = useVaultSession(NS);

  if (state.phase === 'disconnected') {
    return (
      <Center>
        <Orb size={56} />
        <h1 style={{ fontSize: '1.6rem', fontWeight: 650, letterSpacing: '-0.02em' }}>anima</h1>
        <p className="text-fg-muted max-w-sm text-center">
          A companion whose memory belongs to you — readable, editable, erasable, and impossible for any
          company to take away.
        </p>
        <ConnectButton />
      </Center>
    );
  }

  if (state.phase === 'checking') {
    return (
      <Center>
        <Orb size={44} />
        <p className="text-fg-muted">looking for your vault…</p>
      </Center>
    );
  }

  if (state.phase === 'first-run') {
    return <Onboarding ns={NS} onComplete={refresh} />;
  }

  if (state.phase === 'needs-pairing') {
    // returning user on a fresh browser: vault exists, this device's key isn't registered yet (R15)
    return (
      <Center>
        <Orb size={44} />
        <h1 style={{ fontSize: 'var(--text-title)', fontWeight: 600 }}>Welcome back</h1>
        <p className="text-fg-muted max-w-sm text-center">
          Your vault "{state.vault.name}" exists, but this device isn't paired yet. Pairing registers this
          device's agent key with one wallet transaction.
        </p>
        <PairThisDevice vault={state.vault} agentAddress={state.agent.toSuiAddress()} onPaired={refresh} />
      </Center>
    );
  }

  if (state.phase === 'rebuilding') {
    return (
      <Center>
        <Orb state="wake" size={44} />
        <p className="text-fg-muted">
          rebuilding memory from Walrus — quilt {state.done} of {Math.max(state.total, 1)}
        </p>
      </Center>
    );
  }

  // ready — U6 (chat) + U7 (vault) panes mount here
  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-5 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <Orb size={22} />
          <span style={{ fontWeight: 600 }}>{state.vault.name}</span>
          <span className="text-fg-faint" style={{ fontSize: 'var(--text-meta)' }}>
            {state.index.size} memories · yours
          </span>
        </div>
        <ConnectButton />
      </header>
      <main className="flex-1 flex items-center justify-center">
        <p className="text-fg-muted">chat + vault land in U6/U7 — session ready ✓</p>
      </main>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex flex-col items-center justify-center gap-5 p-6">{children}</div>;
}

import { useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { buildRegisterAgentTx, type VaultInfo } from '@core/index.js';
import { getSuiClient } from './lib/chain.js';
import { useState } from 'react';

function PairThisDevice({ vault, agentAddress, onPaired }: { vault: VaultInfo; agentAddress: string; onPaired: () => void }) {
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
            const tx = buildRegisterAgentTx({ vaultId: vault.vaultId, agent: agentAddress, fundAgentMist: 250_000_000n });
            const { digest } = await signAndExecute({ transaction: tx });
            await getSuiClient().waitForTransaction({ digest });
            onPaired();
          } catch (e: any) {
            setError(e.message?.slice(0, 140) ?? 'pairing failed');
            setBusy(false);
          }
        }}
        className="px-6 py-3 rounded-[10px] font-semibold text-canvas"
        style={{ background: 'linear-gradient(90deg, var(--color-soul-violet), var(--color-soul-cyan))' }}
      >
        {busy ? 'pairing…' : 'Pair this device — one signature'}
      </button>
      {error && <p className="text-danger" style={{ fontSize: 'var(--text-meta)' }}>{error}</p>}
    </div>
  );
}
