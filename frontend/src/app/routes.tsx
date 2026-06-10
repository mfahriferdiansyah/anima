import { useEffect, useRef } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { startSession, useVaultSession } from '@/hooks/useVaultSession';
import { Canvas } from '@/pages/Canvas';
import { Companion } from '@/pages/Companion';
import { Home } from '@/pages/Home';
import { Landing } from '@/pages/Landing';
import { Notes } from '@/pages/Notes';
import { SessionGate } from '@/pages/SessionStates';
import { Settings } from '@/pages/Settings';
import { AppShell } from './AppShell';

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
        <Route index element={<Home />} />
        <Route path="companion" element={<Companion />} />
        <Route path="notes/:noteId?" element={<Notes />} />
        <Route path="canvas" element={<Canvas />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
