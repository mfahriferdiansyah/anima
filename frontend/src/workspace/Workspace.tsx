/**
 * Ready-phase layout: chat (the companion) + vault (the brain, U7) + the
 * slide-over NoteView — the chip-click contract between them.
 */
import { useRef, useState } from 'react';
import { ConnectButton } from '@mysten/dapp-kit';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { VaultInfo, VaultIndex } from '@core/index.js';
import { Chat, type ChatHandle } from '../chat/Chat.js';
import { VaultPane } from '../vault/VaultPane.js';
import { NoteSlideOver } from '../vault/NoteSlideOver.js';
import { Orb } from '../theme/Orb.js';
import { authenticate } from '../lib/backendAuth.js';
import { useSignPersonalMessage } from '@mysten/dapp-kit';
import { AgentsModal } from '../agents/AgentsModal.js';
import { CanvasView } from '../canvas/CanvasView.js';

export function Workspace({
  ns,
  vault,
  agent,
  index,
  greet,
  model,
  wakePrompt,
  onIndexChanged,
}: {
  ns: string;
  vault: VaultInfo;
  agent: Ed25519Keypair;
  index: VaultIndex;
  greet?: boolean;
  model?: string;
  wakePrompt?: string;
  onIndexChanged: () => void;
}) {
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [tab, setTab] = useState<'chat' | 'canvas' | 'vault'>('chat');
  const [showAgents, setShowAgents] = useState(false);
  const chatRef = useRef<ChatHandle>(null);
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage();

  const getJwt = () =>
    authenticate(ns, vault.owner, (message) => signPersonalMessage({ message }));

  return (
    <div className="h-screen flex flex-col">
      <header className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Orb size={22} />
          <span style={{ fontWeight: 600 }}>{vault.name}</span>
          <span className="text-fg-faint" style={{ fontSize: 'var(--text-meta)' }}>
            {index.size} memories · owned by {vault.owner.slice(0, 8)}…
          </span>
        </div>
        <div className="flex items-center gap-3">
          <nav className="card flex p-0.5" style={{ fontSize: 'var(--text-meta)' }}>
            {(['chat', 'canvas', 'vault'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="px-3 py-1.5 rounded-lg"
                style={tab === t ? { background: 'var(--color-surface-2)', fontWeight: 600 } : { color: 'var(--color-fg-muted)' }}
              >
                {t === 'chat' ? 'companion' : t}
              </button>
            ))}
          </nav>
          <button
            onClick={() => setShowAgents(true)}
            className="card px-3 py-1.5 hover:border-border-strong"
            style={{ fontSize: 'var(--text-meta)', color: 'var(--color-fg-muted)' }}
          >
            agents
          </button>
          <ConnectButton />
        </div>
      </header>

      {showAgents && (
        <AgentsModal vault={vault} thisAgent={agent.toSuiAddress()} onClose={() => setShowAgents(false)} />
      )}

      <main className="flex-1 min-h-0 flex">
        {tab === 'canvas' ? (
          <section className="flex-1 min-w-0">
            <CanvasView ns={ns} vault={vault} agent={agent} index={index} onOpenNote={setOpenNoteId} />
          </section>
        ) : (
        <>
        <section className={`flex-1 min-w-0 ${tab !== 'chat' ? 'hidden lg:block' : ''}`}>
          <Chat
            ref={chatRef}
            ns={ns}
            vault={vault}
            agent={agent}
            index={index}
            getJwt={getJwt}
            model={model}
            wakePrompt={wakePrompt}
            onOpenNote={setOpenNoteId}
            greet={greet}
          />
        </section>
        <aside
          className={`w-full lg:w-[420px] lg:border-l border-border ${tab !== 'vault' ? 'hidden lg:block' : ''}`}
        >
          <VaultPane
            ns={ns}
            vault={vault}
            agent={agent}
            index={index}
            onOpenNote={setOpenNoteId}
            onChanged={onIndexChanged}
            scrubTranscript={(titles) => chatRef.current?.scrubFromTranscript(titles)}
          />
        </aside>
        </>
        )}
      </main>

      {openNoteId && (
        <NoteSlideOver
          ns={ns}
          noteId={openNoteId}
          vault={vault}
          agent={agent}
          index={index}
          onClose={() => setOpenNoteId(null)}
          onChanged={onIndexChanged}
        />
      )}
    </div>
  );
}
