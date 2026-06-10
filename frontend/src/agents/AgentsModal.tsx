/**
 * Agents & devices: who can carry the soul.
 * - list the vault's registered agent keys (this device, MCP, echo…)
 * - REVOKE any of them (R16 — one wallet tx; their next fresh session fails)
 * - pair an external agent (U8): generate its keypair HERE, show the secret
 *   ONCE for manual copy (never written to any file), register+fund in one PTB,
 *   and hand over a ready-to-paste MCP env block.
 */
import { useState } from 'react';
import { useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { buildRegisterAgentTx, buildRevokeAgentTx, readVault, type VaultInfo } from '@core/index.js';
import { getSuiClient } from '../lib/chain.js';

export function AgentsModal({ vault: initial, thisAgent, onClose }: { vault: VaultInfo; thisAgent: string; onClose: () => void }) {
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [vault, setVault] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<{ secret: string; address: string; registered: boolean } | null>(null);

  async function refresh() {
    setVault(await readVault(getSuiClient(), initial.vaultId));
  }

  async function revoke(addr: string) {
    setBusy(addr);
    setError(null);
    try {
      const tx = buildRevokeAgentTx({ vaultId: vault.vaultId, agent: addr });
      const { digest } = await signAndExecute({ transaction: tx });
      await getSuiClient().waitForTransaction({ digest });
      await refresh();
    } catch (e: any) {
      setError(e.message?.slice(0, 140));
    } finally {
      setBusy(null);
    }
  }

  function startPairing() {
    const kp = Ed25519Keypair.generate();
    setPairing({ secret: kp.getSecretKey(), address: kp.toSuiAddress(), registered: false });
  }

  async function registerPairing() {
    if (!pairing) return;
    setBusy('pairing');
    setError(null);
    try {
      const tx = buildRegisterAgentTx({ vaultId: vault.vaultId, agent: pairing.address, fundAgentMist: 250_000_000n });
      const { digest } = await signAndExecute({ transaction: tx });
      await getSuiClient().waitForTransaction({ digest });
      await refresh();
      setPairing({ ...pairing, registered: true });
    } catch (e: any) {
      setError(e.message?.slice(0, 140));
    } finally {
      setBusy(null);
    }
  }

  const mcpEnv = pairing
    ? `ANIMA_AGENT_KEY=${pairing.secret}\nANIMA_VAULT_ID=${vault.vaultId}\nANIMA_OWNER_ADDRESS=${vault.owner}\nANIMA_AGENT_NAME=claude-code`
    : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="card w-full max-w-lg p-6 flex flex-col gap-4 max-h-[85vh] overflow-y-auto" style={{ background: 'var(--color-surface)' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontSize: 'var(--text-title)', fontWeight: 600 }}>Agents & devices</h2>
        <p className="text-fg-muted" style={{ fontSize: 'var(--text-meta)' }}>
          These keys may read and write your vault's memory. Revoking one shuts it out: its next session is
          refused by the on-chain policy.
        </p>

        <div className="flex flex-col gap-2">
          {vault.agents.map((a) => (
            <div key={a} className="card px-3 py-2.5 flex items-center gap-3">
              <span className="font-mono flex-1 truncate" style={{ fontSize: 'var(--text-meta)' }}>{a}</span>
              {a === thisAgent ? (
                <span className="text-fg-faint" style={{ fontSize: 'var(--text-meta)' }}>this device</span>
              ) : (
                <button
                  onClick={() => revoke(a)}
                  disabled={busy !== null}
                  className="px-2.5 py-1 rounded-md card hover:border-border-strong"
                  style={{ fontSize: 'var(--text-meta)', color: 'var(--color-danger)' }}
                >
                  {busy === a ? 'revoking…' : 'revoke'}
                </button>
              )}
            </div>
          ))}
        </div>

        {!pairing ? (
          <button onClick={startPairing} className="card py-2.5 hover:border-border-strong" style={{ fontSize: 'var(--text-meta)' }}>
            + Connect an external agent (Claude Code, Cursor…)
          </button>
        ) : (
          <div className="card p-4 flex flex-col gap-3" style={{ borderColor: 'var(--color-border-strong)' }}>
            <p style={{ fontWeight: 600 }}>
              {pairing.registered ? '2. Paired ✓ — configure your MCP client' : '1. Register the agent key — one wallet tx'}
            </p>
            {!pairing.registered ? (
              <>
                <p className="text-fg-muted" style={{ fontSize: 'var(--text-meta)' }}>
                  A fresh keypair was generated for the external agent (address {pairing.address.slice(0, 12)}…).
                  Registering also gives it a small gas allowance so it can write memories.
                </p>
                <button
                  onClick={registerPairing}
                  disabled={busy !== null}
                  className="py-2.5 rounded-[10px] font-semibold text-canvas"
                  style={{ background: 'linear-gradient(90deg, var(--color-soul-violet), var(--color-soul-cyan))' }}
                >
                  {busy === 'pairing' ? 'registering…' : 'Register & fund — one signature'}
                </button>
              </>
            ) : (
              <>
                <p className="text-fg-muted" style={{ fontSize: 'var(--text-meta)' }}>
                  Copy this into your shell or MCP config env. The secret is shown ONCE and never stored by
                  anima — treat it like a password.
                </p>
                <pre className="card p-3 overflow-x-auto font-mono" style={{ fontSize: 'var(--text-meta)' }}>{mcpEnv}</pre>
                <button
                  onClick={() => navigator.clipboard.writeText(mcpEnv)}
                  className="card py-2 hover:border-border-strong"
                  style={{ fontSize: 'var(--text-meta)' }}
                >
                  copy to clipboard
                </button>
                <p className="text-fg-faint" style={{ fontSize: 'var(--text-meta)' }}>
                  Then in the repo: the committed .mcp.json points Claude Code at anima-mcp — paste these as env.
                </p>
              </>
            )}
          </div>
        )}

        {error && <p style={{ color: 'var(--color-danger)', fontSize: 'var(--text-meta)' }}>{error}</p>}
        <button onClick={onClose} className="card py-2 hover:border-border-strong" style={{ fontSize: 'var(--text-meta)' }}>close</button>
      </div>
    </div>
  );
}
