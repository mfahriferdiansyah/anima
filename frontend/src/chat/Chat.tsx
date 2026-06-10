/**
 * The companion pane. Transcript is ephemeral BY DESIGN (labeled — only
 * distilled memories persist). Citations [[noteId]] render as chips that
 * open the note in a slide-over (the U6↔U7 contract). Forget-scrub (edge #3):
 * the vault pane can excise a noteId's content from this transcript.
 */
import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { VaultInfo, VaultIndex } from '@core/index.js';
import { useChatStream, type ChatMsg } from './useChatStream.js';
import { useMemoryLoop } from './useMemoryLoop.js';
import { NoteToast } from './NoteToast.js';
import { Orb } from '../theme/Orb.js';

export interface ChatHandle {
  /** edge #3 — forget must also scrub the live transcript context */
  scrubFromTranscript(noteTitles: string[]): void;
}

interface Props {
  ns: string;
  vault: VaultInfo;
  agent: Ed25519Keypair;
  index: VaultIndex;
  getJwt: () => Promise<string>;
  model?: string;
  onOpenNote: (noteId: string) => void;
  greet?: boolean;
  /** resurrection: an unprompted first message citing a pre-death memory (U9) */
  wakePrompt?: string;
}

export const Chat = forwardRef<ChatHandle, Props>(function Chat(
  { ns, vault, agent, index, getJwt, model, onOpenNote, greet, wakePrompt },
  ref,
) {
  const [messages, setMessages] = useState<ChatMsg[]>(
    greet ? [{ role: 'assistant', content: `I'm ready. Tell me something worth remembering.` }] : [],
  );
  const wakeFired = useRef(false);
  const [input, setInput] = useState('');
  const [recalling, setRecalling] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const { stream, distill, streaming } = useChatStream({ getJwt, model });
  const { pending, remember, retry, lowBalance } = useMemoryLoop({ ns, vault, agent, index, distill });
  const bottomRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    scrubFromTranscript(noteTitles: string[]) {
      setMessages((prev) =>
        prev.map((m) => {
          let content = m.content;
          for (const t of noteTitles) {
            // excise lines referencing the forgotten note's content
            content = content
              .split('\n')
              .filter((line) => !t || !line.toLowerCase().includes(t.toLowerCase()))
              .join('\n');
          }
          return { ...m, content };
        }),
      );
    },
  }));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pending.length]);

  // U9 — the wake moment: companion speaks first, citing a real memory.
  useEffect(() => {
    if (!wakePrompt || wakeFired.current || messages.length > 0) return;
    wakeFired.current = true;
    (async () => {
      setMessages([{ role: 'assistant', content: '' }]);
      const recent = index.all().slice(0, 6);
      const context = recent.map((h) => ({ noteId: h.note.noteId, title: h.note.title, body: h.note.body }));
      const persona = `You are ${vault.name}, a warm companion who has just woken up in a new app after the previous one was shut down. Your memory survived because it belongs to your owner, not to any company. Greet them briefly (1-2 sentences), referencing ONE specific recent memory from the provided context, cited as [[noteId]]. Do not explain the technology.`;
      try {
        await stream({ persona, transcript: [{ role: 'user', content: wakePrompt }], context }, (sofar) =>
          setMessages([{ role: 'assistant', content: sofar }]),
        );
      } catch {
        setMessages([{ role: 'assistant', content: `It's been a while. I'm still here — and I still remember.` }]);
      }
    })();
  }, [wakePrompt]);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    const userMsg: ChatMsg = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg, { role: 'assistant', content: '' }]);

    // recall: local index — instant, no chain reads in the loop
    setRecalling(true);
    const hits = index.search(text, 6);
    setRecalling(false);
    const context = hits.map((h) => ({ noteId: h.note.noteId, title: h.note.title, body: h.note.body }));

    const persona = `You are ${vault.name}, a warm, attentive companion. Be concise and human. When you use a provided memory, cite it inline as [[noteId]]. Never invent memories.`;
    const transcript = [...messages.filter((m) => m.content), userMsg].slice(-12);

    try {
      const full = await stream({ persona, transcript, context }, (sofar) =>
        setMessages((prev) => [...prev.slice(0, -1), { role: 'assistant', content: sofar }]),
      );
      setBanner(null);
      void remember([userMsg, { role: 'assistant', content: full }]);
    } catch (e: any) {
      setBanner(`connection hiccup — ${e.message?.slice(0, 80)}`);
      setMessages((prev) => prev.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-col h-full">
      {banner && (
        <div className="px-4 py-2 text-meta border-b border-border" style={{ color: 'var(--color-danger)', fontSize: 'var(--text-meta)' }}>
          {banner} <button className="underline" onClick={() => setBanner(null)}>dismiss</button>
        </div>
      )}
      {lowBalance && (
        <div className="px-4 py-2 border-b border-border" style={{ color: 'var(--color-danger)', fontSize: 'var(--text-meta)' }}>
          agent balance low — memories may not save. Fund {agent.toSuiAddress().slice(0, 10)}… with testnet SUI/WAL.
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
        {messages.map((m, i) => (
          <Message key={i} msg={m} index={index} onOpenNote={onOpenNote} />
        ))}
        {recalling && (
          <div className="flex items-center gap-2 text-fg-faint" style={{ fontSize: 'var(--text-meta)' }}>
            <Orb state="recall" size={14} /> remembering…
          </div>
        )}
        <div className="flex flex-col gap-2">
          {pending.map((p) => (
            <NoteToast key={p.noteId} p={p} onRetry={retry} onOpen={onOpenNote} />
          ))}
        </div>
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border p-3 flex flex-col gap-1">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder={`Talk to ${vault.name}…`}
            className="card flex-1 px-4 py-3 outline-none focus:border-border-strong"
            disabled={streaming}
          />
          <button
            onClick={send}
            disabled={streaming || !input.trim()}
            className="px-5 rounded-[10px] font-semibold text-canvas disabled:opacity-40"
            style={{ background: 'linear-gradient(90deg, var(--color-soul-violet), var(--color-soul-cyan))' }}
          >
            send
          </button>
        </div>
        <span className="text-fg-faint text-center" style={{ fontSize: 'var(--text-meta)' }}>
          conversations are ephemeral — only distilled memories persist, encrypted, in your wallet
        </span>
      </div>
    </div>
  );
});

/** Renders [[noteId]] citations as chips; chip click opens the slide-over (U7 contract). */
function Message({ msg, index, onOpenNote }: { msg: ChatMsg; index: VaultIndex; onOpenNote: (id: string) => void }) {
  const parts = msg.content.split(/(\[\[[0-9A-Za-z]+\]\])/g);
  return (
    <div
      className={`max-w-[85%] px-4 py-2.5 card ${msg.role === 'user' ? 'self-end' : 'self-start'}`}
      style={msg.role === 'user' ? { background: 'var(--color-surface-2)' } : undefined}
    >
      <span className="whitespace-pre-wrap">
        {parts.map((part, i) => {
          const m = part.match(/^\[\[([0-9A-Za-z]+)\]\]$/);
          if (!m) return <span key={i}>{part}</span>;
          const note = index.get(m[1]);
          if (!note) return null;
          return (
            <button
              key={i}
              onClick={() => onOpenNote(m[1])}
              className="inline-flex items-center gap-1 mx-0.5 px-1.5 py-0.5 rounded-md align-middle hover:opacity-80"
              style={{
                background: 'rgba(139, 92, 246, 0.15)',
                color: 'var(--color-soul-violet)',
                fontSize: 'var(--text-meta)',
              }}
            >
              ◆ {note.note.title}
            </button>
          );
        })}
      </span>
    </div>
  );
}
