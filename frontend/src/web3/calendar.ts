/**
 * Google Calendar read-only integration (plan U6, R28, AE7).
 *
 * AE7 — TOKEN CUSTODY BOUNDARY (the part that matters):
 *   The Google OAuth access token NEVER reaches the Anima backend. Every fetch
 *   that carries it targets googleapis.com directly from the browser. It is a
 *   Google API credential and Anima cannot (and must not) see it.
 *
 * Persistence — relaxed from the original "never persisted anywhere":
 *   To survive a refresh AND a brand-new tab without re-prompting, the
 *   short-lived (~1h) access token is cached in localStorage — origin-scoped,
 *   shared across tabs, still never sent to any server, and superseded by its
 *   ~1h expiry. This is the ONLY place the token is stored, and the backend
 *   custody boundary above is unchanged.
 *
 * Re-establishing on load (`restoreCalendar`), two nets:
 *   1. a still-valid cached token is reused directly — works in every browser,
 *      across refreshes and new tabs (localStorage is shared);
 *   2. otherwise a silent re-auth (`prompt:'none'`) mints a fresh token with no
 *      popup — works where Google's background channel is reachable, and no-ops
 *      cleanly (status 'disconnected', so the UI shows "Connect") where it is
 *      blocked, e.g. Brave's third-party-cookie blocking.
 *
 * Browser-OAuth only in v1. `connectCalendar` loads the Google Identity
 * Services script and calls `initTokenClient` / `requestAccessToken`. The live
 * consent popup is the only piece that requires a browser; all other logic is
 * unit-testable via GIS + localStorage stubs.
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

const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

// localStorage key for the cached access token (AE7-relaxed, client-only).
const TOKEN_CACHE_KEY = 'anima:gcal:token';
// localStorage flag: has this device ever connected the calendar? NOT a
// credential — just a boolean so silent restore (Net 2) only pings Google for
// users who opted in. Without it, every authed load would hit Google's GIS for
// users who never touched calendar — an unwanted third-party call for a
// non-custody product. Outlives the cached token (which has a ~1h TTL), so we
// still know the device opted in after the token expires.
const CONNECTED_FLAG = 'anima:gcal:connected';
// Treat a token as expired this long before its real expiry, to avoid handing
// off a credential that dies mid-request.
const EXPIRY_MARGIN_MS = 60_000;

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

/**
 * Cache the access token in localStorage so a refresh OR a brand-new tab can
 * re-use it without a popup. AE7: client-only (origin-scoped, ~1h TTL) and still
 * never sent to the Anima backend. All access is guarded — in the vitest node
 * env (and where storage is disabled) localStorage is absent and these helpers
 * no-op.
 */
function cacheToken(token: string, expiresInSec?: number): void {
  const ttlMs = (expiresInSec ?? 3600) * 1000;
  const entry: CachedToken = { token, expiresAt: Date.now() + ttlMs };
  try {
    localStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* localStorage unavailable/disabled — caching is best-effort */
  }
}

/** Return the cached token if present and not within the expiry margin, else null. */
function readCachedToken(): string | null {
  try {
    const raw = localStorage.getItem(TOKEN_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedToken;
    if (typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'number') return null;
    if (parsed.expiresAt - EXPIRY_MARGIN_MS <= Date.now()) {
      clearCachedToken();
      return null;
    }
    return parsed.token;
  } catch {
    return null;
  }
}

function clearCachedToken(): void {
  try {
    localStorage.removeItem(TOKEN_CACHE_KEY);
  } catch {
    /* no-op */
  }
}

function rememberConnected(): void {
  try {
    localStorage.setItem(CONNECTED_FLAG, '1');
  } catch {
    /* no-op */
  }
}

function forgetConnected(): void {
  try {
    localStorage.removeItem(CONNECTED_FLAG);
  } catch {
    /* no-op */
  }
}

function hasConnectedBefore(): boolean {
  try {
    return localStorage.getItem(CONNECTED_FLAG) === '1';
  } catch {
    return false;
  }
}

// ── GIS token-client types (shared by acquireToken) ──────────────────────────

interface TokenResponse {
  access_token?: string;
  error?: string;
  expires_in?: number;
}
interface TokenClientConfig {
  client_id: string;
  scope: string;
  callback: (resp: TokenResponse) => void;
  error_callback?: (err: { type?: string; message?: string }) => void;
}
interface GoogleOAuth {
  accounts: {
    oauth2: {
      initTokenClient: (opts: TokenClientConfig) => {
        requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
      };
    };
  };
}

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
 * Acquire a Google access token via GIS and connect. Shared by the interactive
 * `connectCalendar` (silent:false → consent popup) and the silent
 * `restoreCalendar` net (silent:true → `prompt:'none'`, no UI).
 *
 * On success: token held in memory + cached, status 'connected', events loaded.
 * On failure: an interactive attempt surfaces as 'error' (and rejects); a silent
 * attempt is not a user-facing error — it lands on 'disconnected' and resolves,
 * so the caller never has to catch.
 */
async function acquireToken(opts: { silent: boolean }): Promise<void> {
  const id = clientId();
  if (!id) {
    store.update((prev) => ({ ...prev, status: 'unconfigured' }));
    return;
  }

  await ensureGisScript();

  return new Promise<void>((resolve, reject) => {
    const google = (globalThis as GlobalWithGoogle & { google: GoogleOAuth }).google;

    const fail = (err: Error) => {
      store.update((prev) => ({ ...prev, status: opts.silent ? 'disconnected' : 'error' }));
      if (opts.silent) resolve();
      else reject(err);
    };

    const client = google.accounts.oauth2.initTokenClient({
      client_id: id,
      scope: SCOPE,
      callback: async (resp) => {
        if (resp.error || !resp.access_token) {
          fail(new Error(resp.error ?? 'no access_token returned'));
          return;
        }
        // AE7: token held in memory + cached client-side only (never to backend)
        _accessToken = resp.access_token;
        cacheToken(resp.access_token, resp.expires_in);
        rememberConnected();
        store.update((prev) => ({ ...prev, status: 'connected' }));
        try {
          await listEvents();
          resolve();
        } catch (err) {
          if (opts.silent) resolve();
          else reject(err as Error);
        }
      },
      // Fires on a GIS-level failure (popup blocked, or 'interaction_required'
      // when the silent prompt:'none' channel is unavailable — e.g. Brave).
      error_callback: (err) => fail(new Error(err?.type ?? 'gis_error')),
    });
    client.requestAccessToken(opts.silent ? { prompt: 'none' } : {});
  });
}

/**
 * Initiate browser OAuth. If VITE_GOOGLE_CLIENT_ID is unset the store is set to
 * 'unconfigured' and the function returns without throwing (the UI shows the
 * "not configured" state rather than crashing).
 */
export async function connectCalendar(): Promise<void> {
  return acquireToken({ silent: false });
}

/**
 * Re-establish the connection on app load WITHOUT a popup. Net 1: reuse a still
 * valid cached token (works in every browser, incl. Brave). Net 2: if there is
 * no usable cached token, silently re-auth — works where Google's background
 * channel is reachable, no-ops cleanly to 'disconnected' where it is blocked.
 * Never throws.
 */
export async function restoreCalendar(): Promise<void> {
  if (!clientId()) {
    store.update((prev) => ({ ...prev, status: 'unconfigured' }));
    return;
  }

  // Net 1 — reuse a cached, unexpired token (no network handshake, no popup).
  const cached = readCachedToken();
  if (cached) {
    _accessToken = cached;
    store.update((prev) => ({ ...prev, status: 'connected' }));
    try {
      await listEvents(); // sets 'error' + clears token on a 401 (revoked early)
    } catch {
      // Network failure — treat as a miss and fall through to silent re-auth.
      _accessToken = null;
      store.update((prev) => ({ ...prev, status: 'disconnected' }));
    }
    if (store.getSnapshot().status === 'connected') return;
  }

  // Net 2 — silent re-auth (prompt:'none'). Only for devices that have connected
  // before: don't ping Google's GIS for users who never touched calendar.
  if (!hasConnectedBefore()) return;
  await acquireToken({ silent: true }); // acquire[silent] never throws
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
    clearCachedToken(); // the token is dead — don't let a refresh retry it
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
  clearCachedToken();
  forgetConnected();
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
  clearCachedToken();
  forgetConnected();
  store.update(() => ({ status: 'disconnected', lastSyncedAt: null, events: [] }));
}

/** Test-only: override the client ID so unit tests can bypass the Vite env var. */
export function __setClientIdForTests(id: string | undefined): void {
  _clientIdOverride = id;
}
