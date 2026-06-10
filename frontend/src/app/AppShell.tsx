import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BRAND_NAME } from '@/brand';
import { Button } from '@/components/Button';
import { Orb } from '@/components/Orb';
import { disconnect } from '@/hooks/useVaultSession';
import type { SessionState } from '@/hooks/useVaultSession';
import { closePopup, expandPopup, openPopup, setOnCompanionRoute, useChat } from '@/hooks/useChat';
import { ChatMessages } from '@/pages/ChatMessages';

export type ReadySession = Extract<SessionState, { phase: 'ready' }>;

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

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
        <path d="M9 22V12h6v10" />
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
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M16 13H8" />
        <path d="M16 17H8" />
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
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </NavIcon>
    ),
  },
];

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
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M15 3h6v6" />
                    <path d="m21 3-7 7" />
                    <path d="M9 21H3v-6" />
                    <path d="m3 21 7-7" />
                  </svg>
                </button>
                <button type="button" className="chx" aria-label="Close quick chat" onClick={closePopup}>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
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

/** The ready-phase workspace: sidebar, header (R2), routed page, chat orb. */
export function AppShell({ session }: { session: ReadySession }) {
  const count = session.index.count;
  return (
    <div className="shell">
      <nav className="shell-side" aria-label="Workspace">
        <div className="shell-wordmark">
          {BRAND_NAME}
          <span className="star" aria-hidden="true">✦</span>
        </div>
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => (isActive ? 'snav active' : 'snav')}
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="shell-main">
        <header className="shell-head">
          <span className="shell-agent">
            <span className="glyph" aria-hidden="true">✧</span>
            {session.agent.name}
          </span>
          <span className="count-pill">
            {count} {count === 1 ? 'memory' : 'memories'}
          </span>
          <span className="mono shell-addr" title={session.vault.owner}>
            {shortAddress(session.vault.owner)}
          </span>
          <Button variant="quiet" size="sm" onClick={disconnect}>
            Disconnect
          </Button>
        </header>
        <main className="shell-page">
          <Outlet />
        </main>
      </div>
      <ChatOrb agentName={session.agent.name} />
    </div>
  );
}
