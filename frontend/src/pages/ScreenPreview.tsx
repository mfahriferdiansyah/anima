import { useLayoutEffect, useRef, useState } from 'react';
import {
  Route,
  Router,
  Routes,
  UNSAFE_LocationContext,
  UNSAFE_NavigationContext,
  UNSAFE_RouteContext,
} from 'react-router-dom';
import { AppShell } from '@/app/AppShell';
import { PreviewSessionContext } from '@/hooks/useVaultSession';
import { PreviewCalendarContext } from '@/web3/calendar';
import { PreviewTimelineContext } from '@/hooks/useAgentTimeline';
import type { PreviewSeed } from '@/pages/landingSeed';
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
 * landing. The embedded pages read live global stores that are empty on the
 * public landing, so we supply a frozen `PreviewSeed` (ready session + connected
 * calendar + populated timeline) via context overrides scoped to this subtree —
 * the real app has no providers and is untouched.
 */

const APP_W = 1440;
// The preview frame is a fixed 16:10 (matches the deck card). The embedded app
// fills this frame (.shell height:100% via landing.css) so its calendar/rail
// flex-stretch to fit compactly — like the reference — instead of expanding to
// their tall natural height. Scaled to the card width.
const APP_H = 900;

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

export function ScreenPreview({ route, seed }: { route: string; seed: PreviewSeed }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.45);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / APP_W);
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
                {/* The embedded pages call useVaultSession()/useCalendar()/
                    useAgentTimeline() directly; without these they'd read the
                    global (disconnected/empty) stores and render blank/null. */}
                <PreviewSessionContext.Provider value={seed.session}>
                  <PreviewCalendarContext.Provider value={seed.calendar}>
                    <PreviewTimelineContext.Provider value={seed.timeline}>
                      <Routes>
                        <Route path="/app" element={<AppShell session={seed.session} />}>
                          <Route index element={<Home />} />
                          <Route path="companion" element={<Companion />} />
                          <Route path="notes/:noteId?" element={<Notes />} />
                          <Route path="canvas/:canvasId?" element={<Canvas />} />
                        </Route>
                      </Routes>
                    </PreviewTimelineContext.Provider>
                  </PreviewCalendarContext.Provider>
                </PreviewSessionContext.Provider>
              </Router>
            </UNSAFE_LocationContext.Provider>
          </UNSAFE_NavigationContext.Provider>
        </UNSAFE_RouteContext.Provider>
      </div>
    </div>
  );
}
