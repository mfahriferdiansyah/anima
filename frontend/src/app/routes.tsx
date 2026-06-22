import { useEffect, useRef } from 'react';
import {
  Navigate,
  Outlet,
  Route,
  createBrowserRouter,
  createRoutesFromElements,
} from 'react-router-dom';
import { useVaultSession } from '@/hooks/useVaultSession';
import { Canvas } from '@/pages/Canvas';
import { Companion } from '@/pages/Companion';
import { Home } from '@/pages/Home';
import { Landing } from '@/pages/Landing';
import { Notes } from '@/pages/Notes';
import { SessionGate } from '@/pages/SessionStates';
import { Settings } from '@/pages/Settings';
import { AppShell } from './AppShell';
import { WriteToasts } from './WriteToasts';

/**
 * Phase gate for every /app route. `useVaultSession` self-drives discovery from
 * the connected wallet (account change → configure + start; no wallet →
 * disconnected), so the gate only reads the phase: render the workspace when
 * ready, redirect to the landing after a disconnect, show the placeholder in
 * between. The mount latch suppresses the first-tick redirect before the session
 * hook's effect has run.
 */
function AppGate() {
  const session = useVaultSession();
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
  }, []);

  if (session.phase === 'ready') return <AppShell session={session} />;
  if (session.phase === 'disconnected') {
    // Before the hook's effect runs the store still reads disconnected; only an
    // actual disconnect (no wallet, or a failed start) should bounce to landing.
    if (!mountedRef.current) return null;
    return <Navigate to="/" replace />;
  }
  return <SessionGate session={session} />;
}

/**
 * Root layout: the global write-state toast stack renders on every route (it was
 * a sibling of <BrowserRouter> before the data-router migration). The matched
 * route renders in the <Outlet/>.
 */
function RootLayout() {
  return (
    <>
      <Outlet />
      <WriteToasts />
    </>
  );
}

/** One data router, created once at module scope (never in render). */
export const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<RootLayout />}>
      <Route path="/" element={<Landing />} />
      <Route path="/app" element={<AppGate />}>
        <Route index element={<Home />} />
        <Route path="companion" element={<Companion />} />
        <Route path="notes/:noteId?" element={<Notes />} />
        <Route path="canvas/:canvasId?" element={<Canvas />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>,
  ),
);
