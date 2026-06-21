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

type GisCallback = (resp: { access_token?: string; error?: string }) => void;

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
