/**
 * Google Calendar read-only integration (plan U6, R28, AE7).
 *
 * AE7 — TOKEN CUSTODY BOUNDARY:
 *   The Google OAuth access token is held in a module-level variable (never
 *   persisted to localStorage, sessionStorage, or a server). Every fetch that
 *   carries the token targets googleapis.com directly from the browser. The
 *   token is NEVER forwarded to the Anima backend — it is a Google API
 *   credential and Anima cannot (and must not) see it.
 *
 * Browser-OAuth only in v1. `connectCalendar` loads the Google Identity
 * Services script and calls `initTokenClient` / `requestAccessToken`. The live
 * consent popup is the only piece that requires a browser; all other logic is
 * unit-testable via GIS global stubs.
 */
import { createContext, useContext, useSyncExternalStore } from 'react';
import { createStore } from '../mocks/store';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO-8601
  end: string;   // ISO-8601
  allDay: boolean;
}

export type CalendarStatus = 'disconnected' | 'connected' | 'error' | 'unconfigured';

export interface CalendarState {
  status: CalendarStatus;
  lastSyncedAt: string | null;
  events: CalendarEvent[];
}

// ── Store ─────────────────────────────────────────────────────────────────────

const store = createStore<CalendarState>({
  status: 'disconnected',
  lastSyncedAt: null,
  events: [],
});

export const calendarStore = {
  getSnapshot: store.getSnapshot,
  subscribe: store.subscribe,
};

// ── Module-private token (AE7: never sent to Anima backend) ──────────────────

let _accessToken: string | null = null;

// Test-only override for the client ID (allows unit tests to bypass the
// VITE_GOOGLE_CLIENT_ID env var, which is not injected in vitest node mode).
let _clientIdOverride: string | undefined;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Read VITE_GOOGLE_CLIENT_ID without throwing in node/test environments. */
function clientId(): string | undefined {
  if (_clientIdOverride !== undefined) return _clientIdOverride;
  try {
    return (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_GOOGLE_CLIENT_ID;
  } catch {
    return undefined;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

// Typed accessor for the GIS global; avoids TS7017 on globalThis index.
type GlobalWithGoogle = typeof globalThis & { google?: unknown };
const g = globalThis as GlobalWithGoogle;

/**
 * Loads the Google Identity Services script if not already present.
 * Guard: only runs in a DOM environment. Node tests must stub globalThis.google.
 */
async function ensureGisScript(): Promise<void> {
  if (typeof g.google !== 'undefined') return;
  if (typeof document === 'undefined') return; // node / test env without stub
  return new Promise((resolve, reject) => {
    if (typeof g.google !== 'undefined') { resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Initiate browser OAuth. If VITE_GOOGLE_CLIENT_ID is unset the store is set to
 * 'unconfigured' and the function returns without throwing (the UI shows the
 * "not configured" state rather than crashing).
 */
export async function connectCalendar(): Promise<void> {
  const id = clientId();
  if (!id) {
    store.update((prev) => ({ ...prev, status: 'unconfigured' }));
    return;
  }

  await ensureGisScript();

  return new Promise<void>((resolve, reject) => {
    const google = (globalThis as GlobalWithGoogle & {
      google: {
        accounts: {
          oauth2: {
            initTokenClient: (opts: {
              client_id: string;
              scope: string;
              callback: (resp: { access_token?: string; error?: string }) => void;
            }) => { requestAccessToken: () => void };
          };
        };
      };
    }).google;

    const client = google.accounts.oauth2.initTokenClient({
      client_id: id,
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
      callback: async (resp) => {
        if (resp.error || !resp.access_token) {
          store.update((prev) => ({ ...prev, status: 'error' }));
          reject(new Error(resp.error ?? 'no access_token returned'));
          return;
        }
        // AE7: token held in module variable only
        _accessToken = resp.access_token;
        store.update((prev) => ({ ...prev, status: 'connected' }));
        try {
          await listEvents();
          resolve();
        } catch (err) {
          reject(err);
        }
      },
    });
    client.requestAccessToken();
  });
}

/**
 * Fetch events from the user's primary calendar for the next `rangeDays` days.
 * Calls googleapis.com directly with the client-held token (AE7).
 * A 401 response sets status 'error' (token expired → UI shows re-connect).
 */
export async function listEvents(rangeDays = 14): Promise<CalendarEvent[]> {
  if (!_accessToken) {
    store.update((prev) => ({ ...prev, status: 'error' }));
    return [];
  }

  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + rangeDays * 86_400_000).toISOString();
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '100',
  });

  // AE7: this fetch goes to googleapis.com, never to the Anima backend
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${_accessToken}` },
  });

  if (res.status === 401) {
    _accessToken = null;
    store.update((prev) => ({ ...prev, status: 'error' }));
    return [];
  }

  if (!res.ok) {
    store.update((prev) => ({ ...prev, status: 'error' }));
    return [];
  }

  const json = (await res.json()) as {
    items?: Array<{
      id: string;
      summary?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }>;
  };

  const events: CalendarEvent[] = (json.items ?? []).map((item) => {
    const startVal = item.start?.dateTime ?? item.start?.date ?? '';
    const endVal = item.end?.dateTime ?? item.end?.date ?? '';
    const allDay = !item.start?.dateTime;
    return {
      id: item.id,
      title: item.summary ?? '(no title)',
      start: startVal,
      end: endVal,
      allDay,
    };
  });

  store.update(() => ({
    status: 'connected',
    lastSyncedAt: nowIso(),
    events,
  }));

  return events;
}

/**
 * Clear the in-memory token and reset the store to 'disconnected'.
 * AE7: no server call needed — the token was never persisted anywhere.
 */
export function disconnectCalendar(): void {
  _accessToken = null;
  store.update(() => ({ status: 'disconnected', lastSyncedAt: null, events: [] }));
}

/**
 * Return calendar events shaped for the /suggest context (used by Nova's
 * requestDraft). Returns [] when not connected.
 */
export function getCalendarContext(): { title: string; start: string; end: string }[] {
  const snap = store.getSnapshot();
  if (snap.status !== 'connected') return [];
  return snap.events.map(({ title, start, end }) => ({ title, start, end }));
}

/**
 * Landing-preview override (mirrors useVaultSession's PreviewSessionContext).
 * The landing's decorative previews supply a seeded, connected calendar so the
 * Home preview shows events; the real app has no provider and always reads the
 * live store. Writes nothing global, so the logged-in app is untouched.
 */
export const PreviewCalendarContext = createContext<CalendarState | null>(null);

/**
 * React hook: subscribe to CalendarState via useSyncExternalStore.
 * Thin wiring over the module store — the testable logic is in the functions above.
 */
export function useCalendar(): CalendarState {
  const preview = useContext(PreviewCalendarContext);
  const live = useSyncExternalStore(calendarStore.subscribe, calendarStore.getSnapshot);
  return preview ?? live;
}

/** Test-only reset — mirrors the pattern in auth.ts. */
export function __resetCalendarForTests(): void {
  _accessToken = null;
  _clientIdOverride = undefined;
  store.update(() => ({ status: 'disconnected', lastSyncedAt: null, events: [] }));
}

/** Test-only: override the client ID so unit tests can bypass the Vite env var. */
export function __setClientIdForTests(id: string | undefined): void {
  _clientIdOverride = id;
}
