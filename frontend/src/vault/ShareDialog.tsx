/**
 * Share a memory: publish as a public article or a password-protected page.
 * Published copies are listed FROM CHAIN (no local registry); unpublish is a
 * wallet-signed delete — the custody asymmetry, visible.
 */
import { useEffect, useState } from 'react';
import { useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  publishNote, listPublished, buildDeleteQuiltsTx, ensureAgentWal, aggregatorUrl,
  type Note, type VaultInfo, type PublishedShare, type QuiltDeps,
} from '@core/index.js';
import { getSuiClient, getSealVault } from '../lib/chain.js';

export function ShareDialog({
  note, vault, agent, onClose,
}: {
  note: Note;
  vault: VaultInfo;
  agent: Ed25519Keypair;
  onClose: () => void;
}) {
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [mode, setMode] = useState<'public' | 'password'>('public');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shares, setShares] = useState<PublishedShare[] | null>(null);
  const [justPublished, setJustPublished] = useState<PublishedShare | null>(null);

  const deps = (): QuiltDeps => {
    const suiClient = getSuiClient();
    const seal = getSealVault({ signer: agent, vaultId: vault.vaultId, ownerAddress: vault.owner });
    return { suiClient, seal, agentSigner: agent, walletAddress: vault.owner, vaultId: vault.vaultId };
  };

  useEffect(() => {
    listPublished({ suiClient: getSuiClient(), walletAddress: vault.owner }, note.noteId)
      .then(setShares)
      .catch(() => setShares([]));
  }, [note.noteId, vault.owner]);

  async function publish() {
    if (mode === 'password' && password.length < 4) return setError('password too short');
    setBusy('publishing');
    setError(null);
    try {
      const d = deps();
      await ensureAgentWal(d.suiClient, agent).catch(() => void 0);
      const share = await publishNote(d, note, mode === 'password' ? { password } : {});
      setJustPublished(share);
      setShares((prev) => [...(prev ?? []), share]);
    } catch (e: any) {
      setError(e.message?.slice(0, 140));
    } finally {
      setBusy(null);
    }
  }

  async function unpublish(share: PublishedShare) {
    setBusy(share.blobObjectId);
    setError(null);
    try {
      const d = deps();
      const tx = await buildDeleteQuiltsTx(d, [share.blobObjectId]);
      const { digest } = await signAndExecute({ transaction: tx });
      await d.suiClient.waitForTransaction({ digest });
      setShares((prev) => (prev ?? []).filter((s) => s.blobObjectId !== share.blobObjectId));
      if (justPublished?.blobObjectId === share.blobObjectId) setJustPublished(null);
    } catch (e: any) {
      setError(e.message?.slice(0, 140));
    } finally {
      setBusy(null);
    }
  }

  const fullUrl = (s: PublishedShare) => `${location.origin}${s.url}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="card w-full max-w-md p-6 flex flex-col gap-4" style={{ background: 'var(--color-surface)' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontSize: 'var(--text-title)', fontWeight: 600 }}>Share "{note.title}"</h2>

        {!justPublished ? (
          <>
            <div className="flex gap-2">
              {(['public', 'password'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className="card flex-1 px-3 py-2.5 text-left"
                  style={mode === m ? { borderColor: 'var(--color-soul-violet)' } : undefined}
                >
                  <div style={{ fontWeight: 600, fontSize: 'var(--text-meta)' }}>{m === 'public' ? '🌐 Public article' : '🔒 Password link'}</div>
                  <div className="text-fg-faint" style={{ fontSize: '11px' }}>
                    {m === 'public' ? 'anyone with the link; permanent on Walrus' : 'encrypted; unlocks in the reader’s browser'}
                  </div>
                </button>
              ))}
            </div>
            {mode === 'password' && (
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="choose a password (shared out-of-band)"
                className="card px-4 py-2.5 outline-none focus:border-border-strong"
              />
            )}
            <button
              onClick={publish}
              disabled={busy !== null}
              className="py-3 rounded-[10px] font-semibold text-canvas"
              style={{ background: 'linear-gradient(90deg, var(--color-soul-violet), var(--color-soul-cyan))' }}
            >
              {busy === 'publishing' ? 'publishing to Walrus… (~15s)' : 'Publish'}
            </button>
            <p className="text-fg-faint" style={{ fontSize: 'var(--text-meta)' }}>
              A copy of this memory becomes a standalone artifact on Walrus, owned by your wallet. The
              original stays encrypted in your vault. You can unpublish anytime (one wallet signature).
            </p>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <p style={{ color: 'var(--color-ok)', fontWeight: 600 }}>Published ✓</p>
            <div className="card px-3 py-2 font-mono break-all" style={{ fontSize: 'var(--text-meta)' }}>{fullUrl(justPublished)}</div>
            <div className="flex gap-2">
              <button onClick={() => navigator.clipboard.writeText(fullUrl(justPublished))} className="card flex-1 py-2 hover:border-border-strong" style={{ fontSize: 'var(--text-meta)' }}>
                copy link
              </button>
              <a href={justPublished.url} target="_blank" rel="noreferrer" className="card flex-1 py-2 text-center hover:border-border-strong" style={{ fontSize: 'var(--text-meta)' }}>
                open article ↗
              </a>
            </div>
            {justPublished.mode === 'public' && (
              <a className="text-fg-faint font-mono hover:underline" style={{ fontSize: '11px' }} href={aggregatorUrl(justPublished.blobId)} target="_blank" rel="noreferrer">
                raw aggregator url ↗ (works without anima at all)
              </a>
            )}
          </div>
        )}

        {shares && shares.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-fg-faint" style={{ fontSize: 'var(--text-meta)' }}>published copies of this memory:</span>
            {shares.map((s) => (
              <div key={s.blobObjectId} className="card px-3 py-2 flex items-center gap-2" style={{ fontSize: 'var(--text-meta)' }}>
                <span>{s.mode === 'password' ? '🔒' : '🌐'}</span>
                <a href={s.url} target="_blank" rel="noreferrer" className="font-mono flex-1 truncate hover:underline">
                  {s.blobId.slice(0, 18)}…
                </a>
                <button
                  onClick={() => unpublish(s)}
                  disabled={busy !== null}
                  className="px-2 py-0.5 rounded-md card hover:border-border-strong"
                  style={{ color: 'var(--color-danger)' }}
                >
                  {busy === s.blobObjectId ? 'unpublishing…' : 'unpublish'}
                </button>
              </div>
            ))}
          </div>
        )}

        {error && <p style={{ color: 'var(--color-danger)', fontSize: 'var(--text-meta)' }}>{error}</p>}
        <button onClick={onClose} className="card py-2 hover:border-border-strong" style={{ fontSize: 'var(--text-meta)' }}>close</button>
      </div>
    </div>
  );
}
