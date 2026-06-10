/**
 * The slide-over NoteView — the chip-click contract (no navigation away from
 * chat). Read + edit; saving creates a NEW version via the silent write path,
 * and behavior changes immediately (AE2 — write-through index).
 */
import { useState } from 'react';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { editedNote, writeTurn, ensureAgentWal, type VaultInfo, type VaultIndex } from '@core/index.js';
import { getSuiClient, getSealVault, persistIndex } from '../lib/chain.js';

export function NoteSlideOver({
  ns, noteId, vault, agent, index, onClose, onChanged,
}: {
  ns: string;
  noteId: string;
  vault: VaultInfo;
  agent: Ed25519Keypair;
  index: VaultIndex;
  onClose: () => void;
  onChanged: () => void;
}) {
  const entry = index.get(noteId);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(entry?.note.body ?? '');
  const [title, setTitle] = useState(entry?.note.title ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!entry) return null;
  const { note } = entry;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const suiClient = getSuiClient();
      const seal = getSealVault({ signer: agent, vaultId: vault.vaultId, ownerAddress: vault.owner });
      const deps = { suiClient, seal, agentSigner: agent, walletAddress: vault.owner, vaultId: vault.vaultId };
      const v2 = editedNote(note, { title, body }, 'owner');
      // optimistic write-through FIRST: the companion's behavior changes NOW (AE2)
      index.upsert(v2, entry!.location);
      await persistIndex(ns, vault.vaultId, index);
      onChanged();
      setEditing(false);
      // then persist to Walrus silently (new version, new quilt)
      await ensureAgentWal(suiClient, agent).catch(() => void 0);
      const result = await writeTurn(deps, [v2]);
      index.upsert(v2, {
        quiltPatchId: result.perNote[0].quiltPatchId,
        quiltBlobId: result.quiltBlobId,
        blobObjectId: result.blobObjectId,
      });
      await persistIndex(ns, vault.vaultId, index);
    } catch (e: any) {
      setError(`saved locally; Walrus write failed — ${e.message?.slice(0, 80)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose} style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div
        className="h-full w-full max-w-md flex flex-col"
        style={{ background: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-fg-faint font-mono" style={{ fontSize: 'var(--text-meta)' }}>
            {note.noteId.slice(0, 10)}… · v{note.version} · by {note.author}
          </span>
          <div className="flex gap-2">
            {!editing ? (
              <button onClick={() => setEditing(true)} className="card px-3 py-1 hover:border-border-strong" style={{ fontSize: 'var(--text-meta)' }}>
                edit
              </button>
            ) : (
              <button
                onClick={save}
                disabled={saving}
                className="px-3 py-1 rounded-md font-semibold text-canvas"
                style={{ fontSize: 'var(--text-meta)', background: 'linear-gradient(90deg, var(--color-soul-violet), var(--color-soul-cyan))' }}
              >
                {saving ? 'saving…' : 'save (new version)'}
              </button>
            )}
            <button onClick={onClose} className="card px-3 py-1 hover:border-border-strong" style={{ fontSize: 'var(--text-meta)' }}>
              close
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-3">
          {!editing ? (
            <>
              <h2 style={{ fontSize: 'var(--text-title)', fontWeight: 600 }}>{note.title}</h2>
              <p className="whitespace-pre-wrap">{note.body}</p>
            </>
          ) : (
            <>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="card px-3 py-2 outline-none" style={{ fontWeight: 600 }} />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="card flex-1 min-h-48 px-3 py-2 outline-none resize-none"
              />
            </>
          )}
          <div className="flex gap-2 flex-wrap">
            {note.tags.map((t) => (
              <span key={t} className="text-fg-faint" style={{ fontSize: 'var(--text-meta)' }}>#{t}</span>
            ))}
          </div>
          {error && <p style={{ color: 'var(--color-danger)', fontSize: 'var(--text-meta)' }}>{error}</p>}

          <Backlinks index={index} noteId={noteId} />

          <div className="text-fg-faint mt-auto" style={{ fontSize: 'var(--text-meta)' }}>
            stored encrypted on Walrus ·{' '}
            <a className="font-mono hover:underline" target="_blank" rel="noreferrer" href={`https://testnet.suivision.xyz/object/${entry.location.blobObjectId}`}>
              {entry.location.blobObjectId.slice(0, 12)}… ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function Backlinks({ index, noteId }: { index: VaultIndex; noteId: string }) {
  const refs = index.backlinks(noteId);
  if (refs.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-fg-faint" style={{ fontSize: 'var(--text-meta)' }}>linked from {refs.length}:</span>
      {refs.map((r) => (
        <span key={r.note.noteId} className="text-fg-muted" style={{ fontSize: 'var(--text-meta)' }}>↳ {r.note.title}</span>
      ))}
    </div>
  );
}
