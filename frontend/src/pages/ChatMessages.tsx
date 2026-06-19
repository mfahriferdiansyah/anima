import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Orb } from '@/components/Orb';
import { send, useChat } from '@/hooks/useChat';
import type { ChatMessage as Message } from '@/hooks/useChat';
import { useVault } from '@/hooks/useVault';
import type { Note } from '@/hooks/useVault';
import '@/theme/chat.css';

/** Each starter hits a different scripted intent (default / draft / status). */
const STARTERS = [
  'What changed in my vault this week?',
  'Draft a checklist for demo day',
  'How is the WAL balance?',
];

function timeOf(at: string): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Kit choreography step 3: shimmer lines until the first words arrive. */
function StreamShimmer() {
  return (
    <span className="cstream" role="status" aria-label="Reply is arriving">
      <span className="sline" />
      <span className="sline" />
      <span className="sline" />
    </span>
  );
}

function AgentMessage({
  message,
  agentName,
  notes,
  onCite,
}: {
  message: Message;
  agentName: string;
  notes: Note[];
  onCite: (noteId: string) => void;
}) {
  const cited = (message.citations ?? [])
    .map((id) => notes.find((note) => note.noteId === id))
    .filter((note): note is Note => Boolean(note));
  return (
    <div className="cmsg agent anim">
      <span className="cav cav-agent" aria-hidden="true">✧</span>
      <div>
        <div className="cwho">{agentName.toLowerCase()} · agent</div>
        <div className="cb">{message.streaming && !message.text ? <StreamShimmer /> : message.text}</div>
        {!message.streaming && cited.length > 0 ? (
          <div className="ccites">
            {cited.map((note) => (
              <button
                key={note.noteId}
                type="button"
                className="ccite"
                title={note.title || 'Untitled note'}
                onClick={() => onCite(note.noteId)}
              >
                {note.title || 'Untitled note'}
              </button>
            ))}
          </div>
        ) : null}
        {!message.streaming ? (
          <div className="cfoot">
            {message.createdNoteId ? (
              <>
                <span className="ok" aria-hidden="true">✦</span> sealed · 1 note added
              </>
            ) : (
              'no vault changes'
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Page choreography: the agent reply with the ✦ attribution + mono receipt the spec calls for. */
function PageAgentMessage({
  message,
  agentName,
  notes,
  onCite,
}: {
  message: Message;
  agentName: string;
  notes: Note[];
  onCite: (noteId: string) => void;
}) {
  const cited = (message.citations ?? [])
    .map((id) => notes.find((note) => note.noteId === id))
    .filter((note): note is Note => Boolean(note));
  return (
    <div className="pgcm agent">
      <div className="who">
        <i>✧</i> {agentName.toLowerCase()} · agent
      </div>
      {message.streaming && !message.text ? (
        <span className="pgcshim" role="status" aria-label="Reply is arriving" />
      ) : (
        <div className="bub">{message.text}</div>
      )}
      {!message.streaming && cited.length > 0 ? (
        <div className="pgccites">
          {cited.map((note) => (
            <span
              key={note.noteId}
              role="button"
              tabIndex={0}
              title={note.title || 'Untitled note'}
              onClick={() => onCite(note.noteId)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onCite(note.noteId);
              }}
            >
              {note.title || 'Untitled note'}
            </span>
          ))}
        </div>
      ) : null}
      {!message.streaming ? (
        <div className="rcpt">
          {message.createdNoteId ? (
            <>
              <span className="ok" aria-hidden="true">✦</span> sealed · 1 note added
            </>
          ) : (
            'no vault changes'
          )}
        </div>
      ) : null}
    </div>
  );
}

export interface ChatMessagesProps {
  /** Page fills the available height; popup keeps the list at ~360px. */
  variant: 'page' | 'popup';
  agentName: string;
}

/**
 * The one conversation surface: list + input, shared by the Companion
 * page and the popup so a stream continues seamlessly across routes (AE3).
 */
export function ChatMessages({ variant, agentName }: ChatMessagesProps) {
  const chat = useChat();
  const { notes } = useVault();
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const settledRef = useRef(false);

  // Auto-scroll on every append and stream tick; instant on first paint.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: settledRef.current ? 'smooth' : 'auto' });
    settledRef.current = true;
  }, [chat.messages, chat.thinking]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (chat.thinking || !draft.trim()) return;
    send(draft);
    setDraft('');
  };

  const onComposerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (chat.thinking || !draft.trim()) return;
      send(draft);
      setDraft('');
    }
  };

  // Kit choreography step 2: the event pill shows what the agent is doing
  // between the send and the reply bubble appearing.
  const last = chat.messages[chat.messages.length - 1];
  const reading = chat.thinking && (!last || last.role !== 'agent');
  const readingLine =
    notes.length > 0
      ? `${agentName} is reading ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`
      : `${agentName} is reading the vault`;

  if (variant === 'page') {
    return (
      <>
        <div className="pged-scroll" ref={listRef}>
          <div className="pgccol">
            {chat.messages.length === 0 ? (
              <div className="pgchello">
                <span className="horb" aria-hidden="true">✦</span>
                <h4>Say hello to {agentName}</h4>
                <p>Replies cite the sealed memories they draw on. The transcript itself never persists.</p>
                <div className="pgcstarts">
                  {STARTERS.map((prompt) => (
                    <button key={prompt} type="button" onClick={() => send(prompt)}>
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {chat.messages.map((message) =>
                  message.role === 'event' ? (
                    <div key={message.id} className="pgcev">
                      {message.text}
                    </div>
                  ) : message.role === 'user' ? (
                    <div key={message.id} className="pgcm human">
                      <div className="bub">{message.text}</div>
                      <div className="rcpt">
                        <span className="ok" aria-hidden="true">✦</span> sent · {timeOf(message.at)}
                      </div>
                    </div>
                  ) : (
                    <PageAgentMessage
                      key={message.id}
                      message={message}
                      agentName={agentName}
                      notes={notes}
                      onCite={(noteId) => navigate(`/app/notes/${noteId}`)}
                    />
                  ),
                )}
                {reading ? (
                  <div className="pgcev" role="status">
                    {readingLine}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
        <div className="pgcomposer">
          <form className="pgcomp-card" onSubmit={submit}>
            <textarea
              rows={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onComposerKey}
              placeholder={`Message ${agentName}. She reads the vault before answering…`}
              aria-label="Message"
              disabled={chat.thinking}
            />
            <div className="pgcomp-row">
              <span className="hint">ENTER TO SEND · SHIFT+ENTER FOR A LINE BREAK</span>
              <button type="submit" className="pgcsend" aria-label="Send" disabled={chat.thinking || !draft.trim()}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m22 2-7 20-4-9-9-4Z" />
                  <path d="M22 2 11 13" />
                </svg>
              </button>
            </div>
          </form>
        </div>
      </>
    );
  }

  return (
    <>
      <div className={`cmsgs cmsgs-${variant}`} ref={listRef}>
        {chat.messages.length === 0 ? (
          <div className="empty chat-hello">
            <Orb size="lg" label={`${agentName} is listening`} />
            <div className="et">Say hello to {agentName}</div>
            <div className="ed">
              Replies cite the sealed memories they draw on. The transcript itself never persists.
            </div>
            <div className="chat-starters">
              {STARTERS.map((prompt) => (
                <button key={prompt} type="button" className="starter" onClick={() => send(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="cephemeral">transcripts are ephemeral · only sealed memories persist</div>
            {chat.messages.map((message) =>
              message.role === 'event' ? (
                <div key={message.id} className="cevent anim">
                  <em aria-hidden="true">✧</em> {message.text}
                </div>
              ) : message.role === 'user' ? (
                <div key={message.id} className="cmsg human anim">
                  <span className="cav cav-human" aria-hidden="true">Y</span>
                  <div>
                    <div className="cb">{message.text}</div>
                    <div className="cfoot">
                      <span className="ok" aria-hidden="true">✦</span> sent · {timeOf(message.at)}
                    </div>
                  </div>
                </div>
              ) : (
                <AgentMessage
                  key={message.id}
                  message={message}
                  agentName={agentName}
                  notes={notes}
                  onCite={(noteId) => navigate(`/app/notes/${noteId}`)}
                />
              ),
            )}
            {reading ? (
              <div className="cevent anim" role="status">
                <em aria-hidden="true">✧</em> {readingLine}
              </div>
            ) : null}
          </>
        )}
      </div>
      <form className="cinput" onSubmit={submit}>
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={`Message ${agentName}`}
          aria-label="Message"
          disabled={chat.thinking}
        />
        <button type="submit" aria-label="Send" disabled={chat.thinking || !draft.trim()}>
          ➤
        </button>
      </form>
    </>
  );
}
