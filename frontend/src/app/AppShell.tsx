import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BRAND_NAME } from '@/brand';
import { Orb } from '@/components/Orb';
import { disconnect } from '@/hooks/useVaultSession';
import type { SessionState } from '@/hooks/useVaultSession';
import { closePopup, expandPopup, openPopup, setOnCompanionRoute, useChat } from '@/hooks/useChat';
import { createNote, useVault } from '@/hooks/useVault';
import { vaultData } from '@/web3/vaultData';
import { restoreCalendar } from '@/web3/calendar';
import { createCanvas, useCanvases, useFolders } from '@/hooks/useCanvases';
import { buildLibrary } from './library';
import { ManageLibrary } from './ManageLibrary';
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

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function activeNoteId(pathname: string): string | null {
  const match = pathname.match(/^\/app\/notes\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Type glyphs that sit before a title so notes and the board read distinctly. */
const NOTE_GLYPH = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);
const CANVAS_GLYPH = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);
const PLUS_GLYPH = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const GEAR_GLYPH = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

type DocFilter = 'all' | 'notes' | 'canvas';

/** The persistent MEMORIES tree in the rail: folders of notes, dots and agent marks. */
function MemoryTree() {
  const { notes } = useVault();
  const canvases = useCanvases();
  const folderOrder = useFolders();
  const navigate = useNavigate();
  const location = useLocation();
  const openId = activeNoteId(location.pathname);
  // Only an actual board (/app/canvas/:id) highlights a canvas row; the gallery
  // (/app/canvas, no id) highlights nothing.
  const canvasMatch = location.pathname.match(/^\/app\/canvas\/(.+)$/);
  const activeCanvasId = canvasMatch ? decodeURIComponent(canvasMatch[1]) : null;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<DocFilter>('all');
  const [manageOpen, setManageOpen] = useState(false);

  // Notes + canvases filed into folders. Notes search through the index
  // (title/body/tags + recency, uncapped to notes.length so nothing is hidden);
  // canvases keep the title substring (the index holds only notes). The
  // All / Notes / Canvas control filters by type. While searching, folders
  // force-open so matches surface; empty folders drop out here.
  const q = query.trim();
  const ql = q.toLowerCase();
  const noteHits = q ? new Set(vaultData.search(q, notes.length).map((e) => e.note.noteId)) : null;
  const matches = (item: { kind: string; id: string; title: string }) =>
    !q || (item.kind === 'note' ? noteHits!.has(item.id) : item.title.toLowerCase().includes(ql));
  const kindWanted = filter === 'notes' ? 'note' : 'canvas'; // DocFilter 'notes' -> LibItem 'note'
  const library = buildLibrary(notes, canvases, folderOrder)
    .map((folder) => ({
      ...folder,
      items: folder.items.filter((item) => (filter === 'all' || item.kind === kindWanted) && matches(item)),
    }))
    .filter((folder) => folder.items.length > 0);
  const noMatches = q.length > 0 && library.length === 0;

  const newNote = () => navigate(`/app/notes/${createNote()}`);
  const newCanvas = () => navigate(`/app/canvas/${createCanvas()}`);

  return (
    <>
      <div className="pgsearch">
        <div className="pgsearch-field">
          <svg className="pgsearch-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search notes and canvases"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search notes and canvases"
          />
          {query ? (
            <button type="button" className="pgsearch-x" aria-label="Clear search" onClick={() => setQuery('')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          ) : null}
        </div>
        <button type="button" className="pgsearch-gear" aria-label="Organize folders" title="Organize folders" onClick={() => setManageOpen(true)}>
          {GEAR_GLYPH}
        </button>
      </div>

      <div className="pgfilter">
        <div className="pgseg" role="tablist" aria-label="Filter documents">
          {(['all', 'notes', 'canvas'] as DocFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              className={filter === f ? 'on' : undefined}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'notes' ? 'Notes' : 'Canvas'}
            </button>
          ))}
        </div>
      </div>
      <div className="pgtree-scroll">
        {library.map((folder) => {
          const isClosed = q ? false : (collapsed[folder.name] ?? false);
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
                <span className="fcnt">{folder.items.length}</span>
              </div>
              {!isClosed &&
                folder.items.map((item) => {
                  if (item.kind === 'canvas') {
                    const isActive = item.id === activeCanvasId;
                    return (
                      <div
                        key={item.id}
                        className={isActive ? 'pgrow on' : 'pgrow'}
                        onClick={() => navigate(`/app/canvas/${item.id}`)}
                      >
                        <span className="pgtype canvas" aria-hidden="true">{CANVAS_GLYPH}</span>
                        <span className="nt2">{item.title}</span>
                      </div>
                    );
                  }
                  const note = item.note!;
                  const isOpen = note.noteId === openId;
                  const byAgent = note.author.startsWith(AGENT_PREFIX);
                  return (
                    <div
                      key={item.id}
                      className={isOpen ? 'pgrow on' : 'pgrow'}
                      draggable
                      title="Drag onto a canvas to place it"
                      onDragStart={(event) => {
                        event.dataTransfer.setData('text/noteid', note.noteId);
                        event.dataTransfer.effectAllowed = 'copy';
                      }}
                      onClick={() => navigate(`/app/notes/${note.noteId}`)}
                    >
                      <span className="pgtype doc" aria-hidden="true">{NOTE_GLYPH}</span>
                      <span className="nt2">{item.title}</span>
                      {byAgent ? <span className="pgagentmark" aria-hidden="true">✦</span> : null}
                    </div>
                  );
                })}
            </div>
          );
        })}
        {noMatches ? <div className="pgempty2">No documents match “{query}”.</div> : null}
      </div>

      <div className="pgfoot">
        <button type="button" className="pgnew" onClick={newNote}>
          {PLUS_GLYPH}
          New note
        </button>
        <button type="button" className="pgnew" onClick={newCanvas}>
          {PLUS_GLYPH}
          New canvas
        </button>
      </div>

      <ManageLibrary open={manageOpen} onClose={() => setManageOpen(false)} />
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

/** The ready-phase workspace: light rail (nav + memories tree + account), routed page, chat orb. */
export function AppShell({ session }: { session: ReadySession }) {
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [acctOpen, setAcctOpen] = useState(false);
  // The drawer + account menu are modal; any navigation dismisses them.
  useEffect(() => {
    setDrawerOpen(false);
    setAcctOpen(false);
  }, [location.pathname]);
  // Re-establish the Google Calendar connection after a refresh without a popup
  // (cached token → silent re-auth). No-ops when never connected/unconfigured.
  useEffect(() => {
    void restoreCalendar();
  }, []);
  return (
    <div className="shell v-single">
      {/* floating menu toggle (small screens only); opens the rail drawer */}
      <button type="button" className="pgburger" aria-label="Toggle menu" aria-expanded={drawerOpen} onClick={() => setDrawerOpen((open) => !open)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      <div className="pgbody">
        {drawerOpen ? <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" /> : null}
        <aside className={drawerOpen ? 'pgtree open' : 'pgtree'}>
          <div className="pgtree-top">
            <NavLink to="/app" end className="pgmark2" aria-label={`${BRAND_NAME} home`}>
              {BRAND_NAME}
              <i>✦</i>
            </NavLink>
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
          <div className="pgrail-acct">
            <button
              type="button"
              className={acctOpen ? 'pgacct open' : 'pgacct'}
              aria-haspopup="menu"
              aria-expanded={acctOpen}
              onClick={() => setAcctOpen((open) => !open)}
            >
              <span className="pgacct-av" aria-hidden="true">✦</span>
              <span className="pgacct-id">
                <span className="pgacct-name">{session.agent.name}</span>
                <span className="pgacct-addr">{shortAddress(session.vault.owner)}</span>
              </span>
              <span className="pgacct-dot" title="Connected" aria-hidden="true" />
            </button>
            {acctOpen ? (
              <>
                <div className="pgacct-scrim" onClick={() => setAcctOpen(false)} aria-hidden="true" />
                <div className="pgacct-menu" role="menu">
                  <button type="button" className="pgacct-mitem" role="menuitem" onClick={disconnect}>
                    Disconnect
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </aside>
        <Outlet />
      </div>
      <ChatOrb agentName={session.agent.name} />
    </div>
  );
}
