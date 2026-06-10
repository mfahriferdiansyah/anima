/**
 * U7a — the Obsidian face: browse/search the brain, forget for real.
 * Empty state is designed (first thing a judge sees pre-seed).
 * U7b (stats/export) rides along because both are one-liners on top of core.
 */
import { useMemo, useState } from 'react';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { VaultInfo, VaultIndex, IndexedNote } from '@core/index.js';
import { exportVaultZip } from '@core/index.js';
import { ForgetDialog } from './ForgetDialog.js';
import { Orb } from '../theme/Orb.js';

export function VaultPane({
  ns,
  vault,
  agent,
  index,
  onOpenNote,
  onChanged,
  scrubTranscript,
}: {
  ns: string;
  vault: VaultInfo;
  agent: Ed25519Keypair;
  index: VaultIndex;
  onOpenNote: (id: string) => void;
  onChanged: () => void;
  scrubTranscript: (titles: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [forgetMode, setForgetMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showForgetDialog, setShowForgetDialog] = useState(false);

  const all = index.all();
  const tags = useMemo(() => [...new Set(all.flatMap((e) => e.note.tags))].sort(), [all]);
  const visible = useMemo(() => {
    let v: IndexedNote[] = q ? index.search(q, 50) : all;
    if (tag) v = v.filter((e) => e.note.tags.includes(tag));
    return v;
  }, [q, tag, all, index]);

  if (all.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
        <Orb size={36} />
        <p style={{ fontWeight: 600 }}>Your memory vault is empty</p>
        <p className="text-fg-muted" style={{ fontSize: 'var(--text-meta)' }}>
          Start a conversation — every durable fact becomes a note here: readable, editable, erasable, yours.
        </p>
      </div>
    );
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 flex flex-col gap-2 border-b border-border shrink-0">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search memories…"
          className="card w-full px-3 py-2 outline-none focus:border-border-strong"
        />
        <div className="flex gap-1.5 flex-wrap items-center">
          {tags.slice(0, 8).map((t) => (
            <button
              key={t}
              onClick={() => setTag(tag === t ? null : t)}
              className="px-2 py-0.5 rounded-md card hover:border-border-strong"
              style={{
                fontSize: 'var(--text-meta)',
                ...(tag === t ? { borderColor: 'var(--color-soul-violet)', color: 'var(--color-soul-violet)' } : { color: 'var(--color-fg-muted)' }),
              }}
            >
              #{t}
            </button>
          ))}
          <span className="flex-1" />
          <button
            onClick={() => {
              setForgetMode(!forgetMode);
              setSelected(new Set());
            }}
            className="px-2 py-0.5 rounded-md card hover:border-border-strong"
            style={{ fontSize: 'var(--text-meta)', color: forgetMode ? 'var(--color-danger)' : 'var(--color-fg-muted)' }}
          >
            {forgetMode ? 'cancel' : 'forget…'}
          </button>
          <button
            onClick={() => {
              const zip = exportVaultZip(index.all());
              const url = URL.createObjectURL(new Blob([zip as unknown as BlobPart], { type: 'application/zip' }));
              const a = document.createElement('a');
              a.href = url;
              a.download = `${vault.name}-vault.zip`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="px-2 py-0.5 rounded-md card hover:border-border-strong"
            style={{ fontSize: 'var(--text-meta)', color: 'var(--color-fg-muted)' }}
            title="file over app — your whole brain as markdown"
          >
            export
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {visible.map((e) => (
          <div key={e.note.noteId} className="card px-3 py-2.5 flex items-start gap-2.5 hover:border-border-strong">
            {forgetMode && (
              <input
                type="checkbox"
                checked={selected.has(e.note.noteId)}
                onChange={() => toggleSelect(e.note.noteId)}
                className="mt-1 accent-[var(--color-danger)]"
              />
            )}
            <button className="flex-1 min-w-0 text-left" onClick={() => (forgetMode ? toggleSelect(e.note.noteId) : onOpenNote(e.note.noteId))}>
              <div className="truncate" style={{ fontWeight: 500 }}>{e.note.title}</div>
              <div className="truncate text-fg-muted" style={{ fontSize: 'var(--text-meta)' }}>{e.note.body}</div>
              <div className="flex gap-2 mt-1 text-fg-faint" style={{ fontSize: 'var(--text-meta)' }}>
                <span>{new Date(e.note.updatedAt).toLocaleDateString()}</span>
                <span>v{e.note.version}</span>
                <span>by {e.note.author}</span>
                {e.note.tags.slice(0, 3).map((t) => (
                  <span key={t}>#{t}</span>
                ))}
              </div>
            </button>
          </div>
        ))}
        {visible.length === 0 && (
          <p className="text-fg-faint text-center py-8" style={{ fontSize: 'var(--text-meta)' }}>
            no memories match
          </p>
        )}
      </div>

      <div className="p-3 border-t border-border shrink-0 flex items-center justify-between" style={{ fontSize: 'var(--text-meta)' }}>
        <span className="text-fg-faint">
          {index.size} memories · encrypted on Walrus · owned by your wallet
        </span>
        {forgetMode && selected.size > 0 && (
          <button
            onClick={() => setShowForgetDialog(true)}
            className="px-3 py-1.5 rounded-md font-semibold"
            style={{ background: 'var(--color-danger)', color: 'var(--color-canvas)' }}
          >
            forget {selected.size} {selected.size === 1 ? 'memory' : 'memories'}
          </button>
        )}
      </div>

      {showForgetDialog && (
        <ForgetDialog
          ns={ns}
          vault={vault}
          agent={agent}
          index={index}
          noteIds={[...selected]}
          onClose={() => {
            setShowForgetDialog(false);
            setForgetMode(false);
            setSelected(new Set());
          }}
          onForgotten={(titles) => {
            scrubTranscript(titles);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
