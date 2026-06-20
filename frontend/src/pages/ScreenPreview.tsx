import { useLayoutEffect, useRef, useState } from 'react';
import {
  Route,
  Router,
  Routes,
  UNSAFE_LocationContext,
  UNSAFE_NavigationContext,
  UNSAFE_RouteContext,
} from 'react-router-dom';
import { AppShell, type ReadySession } from '@/app/AppShell';
import { Canvas } from '@/pages/Canvas';
import { Companion } from '@/pages/Companion';
import { Home } from '@/pages/Home';
import { Notes } from '@/pages/Notes';

/**
 * A live, non-interactive, scaled preview of a REAL app screen, for the
 * landing. The app root is a <BrowserRouter>, so a nested router would throw
 * "You cannot render a <Router> inside another <Router>". We reset React
 * Router's three internal contexts per frame (clears the invariant AND lets the
 * inner <Routes> match from scratch), then render the low-level <Router> with a
 * FROZEN no-op navigator so any navigate()/link click inside the embedded app
 * does nothing — it can't change the real URL or pull the visitor out of the
 * landing. The session is the global mock store driven to `ready` once by the
 * landing; we pass that ReadySession into AppShell.
 */

const APP_W = 1440;
const APP_H = 900;
// fit the whole page in the bezel (no crop); the bezel itself is large so the
// page still reads big, with its own natural edges.
const ZOOM = 1;

const FROZEN_NAV = {
  createHref: (to: unknown) => (typeof to === 'string' ? to : ((to as { pathname?: string })?.pathname ?? '/')),
  encodeLocation: (to: unknown) => ({
    pathname: typeof to === 'string' ? to : ((to as { pathname?: string })?.pathname ?? '/'),
    search: '',
    hash: '',
    state: null,
    key: 'default',
  }),
  push: () => {},
  replace: () => {},
  go: () => {},
};

export function ScreenPreview({ route, session }: { route: string; session: ReadySession }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.45);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setScale((el.clientWidth / APP_W) * ZOOM);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={boxRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} aria-hidden="true">
      <div
        style={{
          width: APP_W,
          height: APP_H,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
        }}
      >
        <UNSAFE_RouteContext.Provider value={{ outlet: null, matches: [], isDataRoute: false } as never}>
          <UNSAFE_NavigationContext.Provider value={null as never}>
            <UNSAFE_LocationContext.Provider value={null as never}>
              <Router location={route} navigator={FROZEN_NAV as never}>
                <Routes>
                  <Route path="/app" element={<AppShell session={session} />}>
                    <Route index element={<Home />} />
                    <Route path="companion" element={<Companion />} />
                    <Route path="notes/:noteId?" element={<Notes />} />
                    <Route path="canvas/:canvasId?" element={<Canvas />} />
                  </Route>
                </Routes>
              </Router>
            </UNSAFE_LocationContext.Provider>
          </UNSAFE_NavigationContext.Provider>
        </UNSAFE_RouteContext.Provider>
      </div>
    </div>
  );
}
