/**
 * DOM-free tests for the calendar integration (plan U6, R28, AE7).
 *
 * Tests:
 *   - listEvents: maps the Google Calendar API response to CalendarEvent[].
 *   - listEvents: a 401 sets status 'error' (token expired path).
 *   - AE7: every fetch URL in the calendar flow targets googleapis.com /
 *     accounts.google.com — the Anima backend URL never appears and the token
 *     only appears in an Authorization header to a Google-owned host.
 *   - disconnectCalendar: clears state.
 *   - unconfigured: connectCalendar with no VITE_GOOGLE_CLIENT_ID sets status
 *     'unconfigured' without throwing.
 *   - getCalendarContext: returns [] when disconnected, shaped events when connected.
 *
 * The GIS global (globalThis.google) is stubbed so no DOM / script-load is
 * triggered. import.meta.env is not set in the test runner so clientId() returns
 * undefined by default, which is what the unconfigured test relies on.
 *
 * @mysten/dapp-kit is NOT imported by calendar.ts, so no mock needed there.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  listEvents,
  disconnectCalendar,
  connectCalendar,
  restoreCalendar,
  getCalendarContext,
  calendarStore,
  __resetCalendarForTests,
  __setClientIdForTests,
} from './calendar';

// The real VITE_GOOGLE_CLIENT_ID env var is not injected in vitest node mode
// (vi.stubEnv does not patch import.meta.env static access there).
// Use the test-only __setClientIdForTests seam to simulate a configured state.
const FAKE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

// ── Stub the GIS global (no DOM or script tag) ────────────────────────────────

type GisCallback = (resp: { access_token?: string; error?: string; expires_in?: number }) => void;

function stubGis(token: string) {
  let savedCallback: GisCallback | null = null;
  const gis = {
    accounts: {
      oauth2: {
        initTokenClient: vi.fn((opts: { callback: GisCallback }) => {
          savedCallback = opts.callback;
          return {
            requestAccessToken: vi.fn(() => {
              // Simulate the browser calling the callback with a token
              savedCallback?.({ access_token: token });
            }),
          };
        }),
      },
    },
  };
  vi.stubGlobal('google', gis);
  return gis;
}

// Richer GIS stub for the restore path: captures the prompt passed to
// requestAccessToken, and can fire either the success callback (with expires_in)
// or the error_callback (simulating a blocked silent channel, e.g. Brave).
const TOKEN_CACHE_KEY = 'anima:gcal:token';
const CONNECTED_FLAG = 'anima:gcal:connected';

function stubGisRestore(opts: { token?: string; expiresIn?: number; fail?: boolean }) {
  const requestSpy = vi.fn();
  let cb: GisCallback | null = null;
  let errCb: ((e: { type?: string }) => void) | null = null;
  const gis = {
    accounts: {
      oauth2: {
        initTokenClient: vi.fn((o: { callback: GisCallback; error_callback?: (e: { type?: string }) => void }) => {
          cb = o.callback;
          errCb = o.error_callback ?? null;
          return {
            requestAccessToken: requestSpy.mockImplementation(() => {
              if (opts.fail) {
                errCb?.({ type: 'interaction_required' });
                return;
              }
              cb?.({ access_token: opts.token ?? 'silent-tok', expires_in: opts.expiresIn });
            }),
          };
        }),
      },
    },
  };
  vi.stubGlobal('google', gis);
  return { requestSpy, initSpy: gis.accounts.oauth2.initTokenClient };
}

// In-memory Web Storage (the vitest node env has neither session nor local).
function makeStorage(name: 'sessionStorage' | 'localStorage', initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  vi.stubGlobal(name, {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  });
  return map;
}
const stubLocalStorage = (initial: Record<string, string> = {}) => makeStorage('localStorage', initial);

const ANIMA_BACKEND = 'http://localhost:8080';

// A typical Google Calendar API response shape
function makeGCalResponse(items: Array<{
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}>) {
  return { ok: true, status: 200, json: async () => ({ items }) } as Response;
}

beforeEach(() => {
  __resetCalendarForTests(); // also clears _clientIdOverride
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── listEvents — maps the Google API response ─────────────────────────────────

describe('listEvents', () => {
  it('maps a timed event from the Google Calendar API to CalendarEvent[]', async () => {
    __setClientIdForTests(FAKE_CLIENT_ID);
    const tokenValue = 'goog-access-token-123';
    stubGis(tokenValue);

    let capturedUrls: string[] = [];
    let capturedHeaders: string[] = [];

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrls.push(url);
      capturedHeaders.push((init?.headers as Record<string, string>)?.['Authorization'] ?? '');

      if (url.includes('googleapis.com/calendar')) {
        return makeGCalResponse([
          {
            id: 'evt-1',
            summary: 'Team standup',
            start: { dateTime: '2026-06-21T09:00:00Z' },
            end:   { dateTime: '2026-06-21T09:30:00Z' },
          },
        ]);
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }));

    // connectCalendar → GIS stub fires → listEvents called internally
    await connectCalendar();

    const snap = calendarStore.getSnapshot();
    expect(snap.status).toBe('connected');
    expect(snap.events).toHaveLength(1);
    expect(snap.events[0]).toMatchObject({
      id: 'evt-1',
      title: 'Team standup',
      start: '2026-06-21T09:00:00Z',
      end:   '2026-06-21T09:30:00Z',
      allDay: false,
    });
    expect(snap.lastSyncedAt).not.toBeNull();
  });

  it('maps an all-day event (date, not dateTime) correctly', async () => {
    __setClientIdForTests(FAKE_CLIENT_ID);
    stubGis('tok');
    vi.stubGlobal('fetch', vi.fn(async () =>
      makeGCalResponse([
        {
          id: 'evt-allday',
          summary: 'Demo day',
          start: { date: '2026-06-21' },
          end:   { date: '2026-06-22' },
        },
      ])
    ));
    await connectCalendar();
    const { events } = calendarStore.getSnapshot();
    expect(events[0].allDay).toBe(true);
    expect(events[0].start).toBe('2026-06-21');
  });

  it('returns [] and sets status error on a 401 response', async () => {
    // First: connect successfully with an empty event list to get a token in place.
    __setClientIdForTests(FAKE_CLIENT_ID);
    stubGis('tok-expiring');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('googleapis.com/calendar')) {
        return { ok: true, status: 200, json: async () => ({ items: [] }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }));
    await connectCalendar();
    expect(calendarStore.getSnapshot().status).toBe('connected');

    // Now simulate token expiry: next listEvents call returns 401
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () =>
      ({ ok: false, status: 401, json: async () => ({}) }) as Response
    ));
    const result = await listEvents();
    expect(result).toEqual([]);
    expect(calendarStore.getSnapshot().status).toBe('error');
  });
});

// ── AE7: no fetch ever targets the Anima backend ─────────────────────────────

describe('AE7 — token never leaves the client to the Anima backend', () => {
  it('every fetch URL during connect+listEvents is a Google-owned URL', async () => {
    __setClientIdForTests(FAKE_CLIENT_ID);
    stubGis('goog-ae7-token');
    const fetchedUrls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      fetchedUrls.push(url);
      return makeGCalResponse([
        {
          id: 'ae7-evt',
          summary: 'Sprint review',
          start: { dateTime: '2026-06-22T14:00:00Z' },
          end:   { dateTime: '2026-06-22T15:00:00Z' },
        },
      ]);
    }));

    await connectCalendar();

    // Assert: every URL is googleapis.com or accounts.google.com
    for (const url of fetchedUrls) {
      const host = new URL(url).hostname;
      expect(
        host === 'www.googleapis.com' || host === 'accounts.google.com',
        `fetch URL ${url} must be a Google-owned host, not the Anima backend (${ANIMA_BACKEND})`
      ).toBe(true);
    }
    // Assert: no URL contains the Anima backend
    for (const url of fetchedUrls) {
      expect(url).not.toContain(ANIMA_BACKEND);
      expect(url).not.toContain('localhost:8080');
    }
  });

  it('the access token only appears in Authorization headers to googleapis.com', async () => {
    __setClientIdForTests(FAKE_CLIENT_ID);
    const token = 'super-secret-access-token';
    stubGis(token);

    const capturedCalls: Array<{ url: string; auth: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)?.['Authorization'] ?? '';
      capturedCalls.push({ url, auth });
      return makeGCalResponse([]);
    }));

    await connectCalendar();

    for (const { url, auth } of capturedCalls) {
      if (auth.includes(token)) {
        const host = new URL(url).hostname;
        expect(
          host === 'www.googleapis.com' || host === 'accounts.google.com',
          `access token appeared in a request to ${url} — must only go to Google`
        ).toBe(true);
      }
    }
  });
});

// ── disconnectCalendar ────────────────────────────────────────────────────────

describe('disconnectCalendar', () => {
  it('resets the store to disconnected with no events', async () => {
    __setClientIdForTests(FAKE_CLIENT_ID);
    stubGis('tok');
    vi.stubGlobal('fetch', vi.fn(async () => makeGCalResponse([])));
    await connectCalendar();
    expect(calendarStore.getSnapshot().status).toBe('connected');

    disconnectCalendar();
    const snap = calendarStore.getSnapshot();
    expect(snap.status).toBe('disconnected');
    expect(snap.events).toEqual([]);
    expect(snap.lastSyncedAt).toBeNull();
  });

  it('clears the cached token so a later refresh cannot reuse it', async () => {
    __setClientIdForTests(FAKE_CLIENT_ID);
    const store = stubLocalStorage();
    stubGis('tok-to-cache');
    vi.stubGlobal('fetch', vi.fn(async () => makeGCalResponse([])));
    await connectCalendar();
    expect(store.has(TOKEN_CACHE_KEY)).toBe(true);

    disconnectCalendar();
    expect(store.has(TOKEN_CACHE_KEY)).toBe(false);
  });
});

// ── restoreCalendar — survive a refresh without a popup ──────────────────────

describe('restoreCalendar', () => {
  it('Net 1: reuses a valid cached token without invoking GIS', async () => {
    __setClientIdForTests(FAKE_CLIENT_ID);
    stubLocalStorage({
      [TOKEN_CACHE_KEY]: JSON.stringify({ token: 'cached-tok', expiresAt: Date.now() + 3_600_000 }),
    });
    const { initSpy } = stubGisRestore({}); // should NOT be called on a cache hit

    const authHeaders: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      authHeaders.push((init?.headers as Record<string, string>)?.['Authorization'] ?? '');
      return makeGCalResponse([
        { id: 'r1', summary: 'Restored event', start: { dateTime: '2026-06-23T09:00:00Z' }, end: { dateTime: '2026-06-23T10:00:00Z' } },
      ]);
    }));

    await restoreCalendar();

    expect(calendarStore.getSnapshot().status).toBe('connected');
    expect(calendarStore.getSnapshot().events).toHaveLength(1);
    expect(authHeaders[0]).toBe('Bearer cached-tok'); // the cached token, not a fresh GIS one
    expect(initSpy).not.toHaveBeenCalled(); // no popup, no silent handshake needed
  });

  it('Net 1: ignores an expired cached token and falls through to silent re-auth', async () => {
    __setClientIdForTests(FAKE_CLIENT_ID);
    stubLocalStorage({
      [TOKEN_CACHE_KEY]: JSON.stringify({ token: 'stale', expiresAt: Date.now() - 1000 }),
      [CONNECTED_FLAG]: '1', // opted in → Net 2 allowed
    });
    const { requestSpy } = stubGisRestore({ token: 'fresh-silent-tok', expiresIn: 3600 });
    vi.stubGlobal('fetch', vi.fn(async () => makeGCalResponse([])));

    await restoreCalendar();

    expect(requestSpy).toHaveBeenCalledWith({ prompt: 'none' }); // silent, no UI
    expect(calendarStore.getSnapshot().status).toBe('connected');
  });

  it('Net 2: silently re-auths (prompt:none) when there is no cache but the device opted in', async () => {
    __setClientIdForTests(FAKE_CLIENT_ID);
    const ls = stubLocalStorage({ [CONNECTED_FLAG]: '1' });
    const { requestSpy } = stubGisRestore({ token: 'silent-fresh', expiresIn: 3600 });
    vi.stubGlobal('fetch', vi.fn(async () => makeGCalResponse([])));

    await restoreCalendar();

    expect(requestSpy).toHaveBeenCalledWith({ prompt: 'none' });
    expect(calendarStore.getSnapshot().status).toBe('connected');
    expect(ls.has(TOKEN_CACHE_KEY)).toBe(true); // fresh token re-cached
  });

  it('does NOT touch GIS for a device that never connected (no cache, no flag)', async () => {
    __setClientIdForTests(FAKE_CLIENT_ID);
    stubLocalStorage(); // never connected — no flag, no cache
    const { initSpy } = stubGisRestore({});
    vi.stubGlobal('fetch', vi.fn(async () => makeGCalResponse([])));

    await restoreCalendar();

    expect(initSpy).not.toHaveBeenCalled(); // no GIS load, no Google ping
    expect(calendarStore.getSnapshot().status).toBe('disconnected');
  });

  it('stays disconnected (no throw) when the silent channel is blocked, e.g. Brave', async () => {
    __setClientIdForTests(FAKE_CLIENT_ID);
    stubLocalStorage({ [CONNECTED_FLAG]: '1' });
    stubGisRestore({ fail: true }); // error_callback fires → interaction_required
    vi.stubGlobal('fetch', vi.fn(async () => makeGCalResponse([])));

    await expect(restoreCalendar()).resolves.toBeUndefined();
    expect(calendarStore.getSnapshot().status).toBe('disconnected'); // not 'error'
  });

  it('records the connected flag on connect and clears it on disconnect', async () => {
    __setClientIdForTests(FAKE_CLIENT_ID);
    const ls = stubLocalStorage();
    stubGis('tok');
    vi.stubGlobal('fetch', vi.fn(async () => makeGCalResponse([])));

    await connectCalendar();
    expect(ls.get(CONNECTED_FLAG)).toBe('1');

    disconnectCalendar();
    expect(ls.has(CONNECTED_FLAG)).toBe(false);
  });

  it('sets unconfigured and does not touch GIS when no client id is set', async () => {
    const { initSpy } = stubGisRestore({});
    await expect(restoreCalendar()).resolves.toBeUndefined();
    expect(calendarStore.getSnapshot().status).toBe('unconfigured');
    expect(initSpy).not.toHaveBeenCalled();
  });
});

// ── unconfigured path (no VITE_GOOGLE_CLIENT_ID) ──────────────────────────────

describe('connectCalendar — unconfigured', () => {
  it('sets status unconfigured and does not throw when no client id is set', async () => {
    // import.meta.env.VITE_GOOGLE_CLIENT_ID is undefined in the vitest node env
    // (no Vite plugin injects it). clientId() returns undefined → unconfigured.
    await expect(connectCalendar()).resolves.toBeUndefined();
    expect(calendarStore.getSnapshot().status).toBe('unconfigured');
  });
});

// ── getCalendarContext ────────────────────────────────────────────────────────

describe('getCalendarContext', () => {
  it('returns [] when status is disconnected', () => {
    expect(calendarStore.getSnapshot().status).toBe('disconnected');
    expect(getCalendarContext()).toEqual([]);
  });

  it('returns shaped events when connected', async () => {
    __setClientIdForTests(FAKE_CLIENT_ID);
    stubGis('tok');
    vi.stubGlobal('fetch', vi.fn(async () =>
      makeGCalResponse([
        {
          id: 'ctx-1',
          summary: 'Design review',
          start: { dateTime: '2026-06-22T10:00:00Z' },
          end:   { dateTime: '2026-06-22T11:00:00Z' },
        },
      ])
    ));
    await connectCalendar();

    const ctx = getCalendarContext();
    expect(ctx).toHaveLength(1);
    expect(ctx[0]).toMatchObject({ title: 'Design review', start: '2026-06-22T10:00:00Z', end: '2026-06-22T11:00:00Z' });
    // No id field — just the three fields Nova needs
    expect('id' in ctx[0]).toBe(false);
  });
});
