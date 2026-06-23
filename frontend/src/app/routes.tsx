import { useAutoConnectWallet, useCurrentAccount } from '@mysten/dapp-kit';
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
import { Checking, SessionGate } from '@/pages/SessionStates';
import { Settings } from '@/pages/Settings';
import { disconnectedGate } from './appGate';
import { AppShell } from './AppShell';
import { WriteToasts } from './WriteToasts';

/**
 * Phase gate for every /app route. `useVaultSession` self-drives discovery from
 * the connected wallet (account change → configure + start; no wallet →
 * disconnected), so the gate reads the phase: render the workspace when ready,
 * show the placeholder while the session spins up, redirect to the landing only
 * after a real disconnect. On a hard refresh dapp-kit reconnects the wallet
 * asynchronously, so for the first few renders `account` is null while
 * `autoConnect` is still `'idle'`, and for one more render after it arrives the
 * phase lags at `'disconnected'`. `disconnectedGate` holds the route through
 * that whole window instead of bouncing to the landing and discarding it.
 */
function AppGate() {
  const session = useVaultSession();
  const account = useCurrentAccount();
  const autoConnect = useAutoConnectWallet();

  if (session.phase === 'ready') return <AppShell session={session} />;
  if (session.phase === 'disconnected') {
    return disconnectedGate(!!account, autoConnect) === 'landing' ? (
      <Navigate to="/" replace />
    ) : (
      <Checking />
    );
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
