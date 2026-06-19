import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BRAND_NAME } from '@/brand';
import { Orb } from '@/components/Orb';
import { disconnect } from '@/hooks/useVaultSession';
import type { SessionState } from '@/hooks/useVaultSession';
import { closePopup, expandPopup, openPopup, setOnCompanionRoute, useChat } from '@/hooks/useChat';
import { createNote, forgetNotes, useVault } from '@/hooks/useVault';
import type { Note } from '@/hooks/useVault';
import { confirmWithWallet } from '@/hooks/useWallet';
import { useScenario } from '@/hooks/useScenario';
import { ChatMessages } from '@/pages/ChatMessages';

export type ReadySession = Extract<SessionState, { phase: 'ready' }>;

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const AGENT_PREFIX = 'agent';

/** Lucide-style stroke icon frame: geometry only, currentColor, no fills. */
function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const NAV: Array<{ to: string; label: string; end?: boolean; icon: ReactNode }> = [
  {
    to: '/app',
    label: 'Home',
    end: true,
    icon: (
      <NavIcon>
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </NavIcon>
    ),
  },
  {
    to: '/app/companion',
    label: 'Companion',
    icon: (
      <NavIcon>
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
      </NavIcon>
    ),
  },
  {
    to: '/app/notes',
    label: 'Notes',
    icon: (
      <NavIcon>
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </NavIcon>
    ),
  },
  {
    to: '/app/canvas',
    label: 'Canvas',
    icon: (
      <NavIcon>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </NavIcon>
    ),
  },
  {
    to: '/app/settings',
    label: 'Settings',
    icon: (
      <NavIcon>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </NavIcon>
    ),
  },
];

interface Folder {
  name: string;
  notes: Note[];
}

/** Group notes into sidebar folders by their first tag, first-seen order. */
function buildFolders(notes: Note[]): Folder[] {
  const order: string[] = [];
  const byFolder = new Map<string, Note[]>();
  for (const note of notes) {
    const key = note.tags[0] ?? 'untitled';
    if (!byFolder.has(key)) {
      byFolder.set(key, []);
      order.push(key);
    }
    byFolder.get(key)!.push(note);
  }
  return order.map((name) => ({ name, notes: byFolder.get(name)! }));
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function activeNoteId(pathname: string): string | null {
  const match = pathname.match(/^\/app\/notes\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** The persistent MEMORIES tree in the rail: folders of notes, dots and agent marks. */
function MemoryTree() {
  const { notes } = useVault();
  const navigate = useNavigate();
  const location = useLocation();
  const openId = activeNoteId(location.pathname);
  const folders = buildFolders(notes);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const toggleSelectMode = () => {
    setSelecting((prev) => !prev);
    setSelected(new Set());
  };
  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Forget is the destructive op: it enumerates the victims, then gates on the
  // (mocked) wallet — writes are silent, deletion costs a signature (R16/R20).
  const forgetSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const victims = notes.filter((note) => selected.has(note.noteId)).map((note) => note.title || 'Untitled');
    const approved = await confirmWithWallet(
      `Forget ${ids.length} ${ids.length === 1 ? 'memory' : 'memories'}: ${victims.join(', ')}`,
    );
    if (!approved) return;
    forgetNotes(ids);
    setSelecting(false);
    setSelected(new Set());
  };

  return (
    <>
      <div className="pgtree-h">
        <b>MEMORIES</b>
        <button type="button" className="pgtree-sel" onClick={toggleSelectMode}>
          {selecting ? 'Done' : 'Select'}
        </button>
      </div>
      <div className="pgtree-scroll">
        {folders.map((folder) => {
          const isClosed = collapsed[folder.name] ?? false;
          return (
            <div key={folder.name}>
              <div
                className={isClosed ? 'pgfold closed' : 'pgfold'}
                onClick={() => setCollapsed((prev) => ({ ...prev, [folder.name]: !isClosed }))}
              >
                <svg className="chev" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m2 4 3 3 3-3" />
                </svg>
                <span>{titleCase(folder.name)}</span>
                <span className="fcnt">{folder.notes.length}</span>
              </div>
              {!isClosed &&
                folder.notes.map((note) => {
                  const isOpen = note.noteId === openId;
                  const byAgent = note.author.startsWith(AGENT_PREFIX);
                  const isSel = selected.has(note.noteId);
                  return (
                    <div
                      key={note.noteId}
                      className={`pgrow${isOpen && !selecting ? ' on' : ''}${isSel ? ' sel' : ''}`}
                      onClick={() => (selecting ? toggleSelected(note.noteId) : navigate(`/app/notes/${note.noteId}`))}
                    >
                      {selecting ? (
                        <span className={isSel ? 'pgdot sel' : 'pgdot draft'} aria-hidden="true" />
                      ) : (
                        <span className={isOpen ? 'pgdot open' : 'pgdot none'} aria-hidden="true" />
                      )}
                      <span className="nt2">{note.title || 'Untitled'}</span>
                      {byAgent ? <span className="pgagentmark" aria-hidden="true">✦</span> : null}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
      {selecting ? (
        <button
          type="button"
          className="pgnew pgforget"
          disabled={selected.size === 0}
          onClick={forgetSelected}
        >
          Forget ({selected.size})
        </button>
      ) : (
        <button
          type="button"
          className="pgnew"
          onClick={() => {
            const id = createNote();
            navigate(`/app/notes/${id}`);
          }}
        >
          + New note
        </button>
      )}
    </>
  );
}

/**
 * Floating popup-chat orb: hidden on the Companion route, reports route
 * changes to the chat store, opens the compact panel above itself. The
 * panel lives here (above the Outlet) so it persists across routes;
 * expand closes it and hands the shared transcript to the Companion page.
 */
function ChatOrb({ agentName }: { agentName: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const onCompanion = location.pathname.startsWith('/app/companion');
  const chat = useChat();

  useEffect(() => {
    setOnCompanionRoute(onCompanion);
    return () => setOnCompanionRoute(false);
  }, [onCompanion]);

  if (onCompanion) return null;

  const expand = () => {
    expandPopup();
    navigate('/app/companion');
  };

  return (
    <>
      {chat.chatOpen ? (
        <div className="orbpanel">
          <div className="chat chat-popup">
            <div className="chead">
              <span className="cglyph" aria-hidden="true">✧</span> {agentName}
              <div className="chead-actions">
                <button type="button" className="chx" aria-label="Open the Companion page" onClick={expand}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M15 3h6v6" />
                    <path d="m21 3-7 7" />
                    <path d="M9 21H3v-6" />
                    <path d="m3 21 7-7" />
                  </svg>
                </button>
                <button type="button" className="chx" aria-label="Close quick chat" onClick={closePopup}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <ChatMessages variant="popup" agentName={agentName} />
          </div>
        </div>
      ) : null}
      <button
        type="button"
        className="orbfab"
        onClick={chat.chatOpen ? closePopup : openPopup}
        aria-label={chat.chatOpen ? 'Close quick chat' : 'Open quick chat'}
      >
        <Orb size="md" working={chat.thinking} badge={chat.pendingBadge} />
      </button>
    </>
  );
}

/** The ready-phase workspace: top bar, light rail (nav + memories tree), routed page, chat orb. */
export function AppShell({ session }: { session: ReadySession }) {
  const count = session.index.count;
  const { scenario } = useScenario();
  return (
    <div className="shell v-single">
      <header className="pghead">
        <span className="pgagent">
          <span className="ag2" aria-hidden="true">✦</span>
          <span className="agname">{session.agent.name}</span>
        </span>
        <span className="pgpill">
          {count} {count === 1 ? 'memory' : 'memories'}
        </span>
        <span className="pgaddr" title={session.vault.owner}>
          {shortAddress(session.vault.owner)}
        </span>
        <button type="button" className="pgdisc" onClick={disconnect}>
          Disconnect
        </button>
      </header>
      <div className="pgbody">
        <aside className="pgtree">
          <div className="pgtree-top">
            <div className="pgmark2">
              {BRAND_NAME}
              <i>✦</i>
            </div>
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => (isActive ? 'pgnav2 on2' : 'pgnav2')}
              >
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </div>
          <MemoryTree />
          <div className="pgtree-foot">MOCKED · {scenario}</div>
        </aside>
        <Outlet />
      </div>
      <ChatOrb agentName={session.agent.name} />
    </div>
  );
}
