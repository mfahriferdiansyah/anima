import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { startSession, useVaultSession } from '@/hooks/useVaultSession';
import { Companion } from '@/pages/Companion';
import { Landing } from '@/pages/Landing';
import { SessionGate } from '@/pages/SessionStates';
import { AppShell } from './AppShell';

/** Placeholder page body: real pages land in U4-U10. */
function PlaceholderPage({ name, blurb, children }: { name: string; blurb: string; children?: ReactNode }) {
  return (
    <section>
      <h1 className="page-title">{name}</h1>
      <div className="empty">
        <span className="ghost" aria-hidden="true">✦</span>
        <div className="et">{name} is on its way</div>
        <div className="ed">{blurb}</div>
        {children}
      </div>
    </section>
  );
}

function NotesPlaceholder() {
  const { noteId } = useParams();
  return (
    <PlaceholderPage name="Notes" blurb="The note tree and the editor frame arrive here.">
      {noteId ? <span className="mono page-note">Selected note: {noteId}</span> : null}
    </PlaceholderPage>
  );
}

/**
 * Phase gate for every /app route: starts the session once on mount,
 * renders the workspace when ready, redirects to the landing page after
 * a disconnect, and shows the session-state placeholder in between.
 */
function AppGate() {
  const session = useVaultSession();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    startSession();
  }, []);

  if (session.phase === 'ready') return <AppShell session={session} />;
  if (session.phase === 'disconnected') {
    // Before the mount effect runs the store still reads disconnected; only
    // an actual disconnect (or a failed start) should bounce to the landing.
    if (!startedRef.current) return null;
    return <Navigate to="/" replace />;
  }
  return <SessionGate session={session} />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/app" element={<AppGate />}>
        <Route index element={<PlaceholderPage name="Home" blurb="The living dashboard arrives here: greeting, graph preview, quick starts and recents." />} />
        <Route path="companion" element={<Companion />} />
        <Route path="notes/:noteId?" element={<NotesPlaceholder />} />
        <Route path="canvas" element={<PlaceholderPage name="Canvas" blurb="The shared constellation arrives here." />} />
        <Route path="settings" element={<PlaceholderPage name="Settings" blurb="Identity, devices, balances and export arrive here." />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
