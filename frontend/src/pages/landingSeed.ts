/**
 * Landing-only preview seed. The landing's scaled app previews (ScreenPreview)
 * render the REAL Home/Notes, which read the shared live stores — empty on the
 * public landing (no wallet → no rebuild, no calendar OAuth, no agent activity).
 * We hand the previews a frozen demo bundle: notes via the global vaultData spine
 * (it self-heals — the real session republishes before /app shows content), and
 * calendar + timeline via per-subtree context overrides (those stores never
 * self-heal, so seeding them globally would leak into the logged-in app — the
 * overrides write nothing global). Imported lazily on the deck's first
 * intersection so the app chunk + this seed stay off the critical path.
 */
import { VaultIndex, type IndexedNote } from '../../../chain/core/src/index.js';
import { AGENT_ADDRESS, COMPANION_NAME, OWNER_ADDRESS, VAULT_ID, agentEvents, makeVault } from '../mocks/fixture';
import { vaultData } from '../web3/vaultData';
import { sessionStore } from '../web3/session';
import type { CalendarState } from '../web3/calendar';
import type { TimelineState } from '../web3/suggest';
import type { ReadySession } from '../app/AppShell';

/** Everything the previews need so the embedded real-app pages read populated. */
export interface PreviewSeed {
  session: ReadySession;
  calendar: CalendarState;
  timeline: TimelineState;
}

const LANDING_INDEX = VaultIndex.fromEntries(
  makeVault().map(
    (note, i): IndexedNote => ({
      note,
      // Synthetic read handles — the previews are pointerEvents:none and never write.
      location: {
        quiltPatchId: `landing-${i}`,
        quiltBlobId: 'landing-quilt',
        blobObjectId: `landing-blob-${i}`,
      },
    }),
  ),
);

const LANDING_SESSION: ReadySession = {
  phase: 'ready',
  vault: { vaultId: VAULT_ID, owner: OWNER_ADDRESS, name: COMPANION_NAME, agents: [AGENT_ADDRESS] },
  agent: { name: COMPANION_NAME, address: AGENT_ADDRESS },
  index: { count: LANDING_INDEX.notes().length },
};

const pad = (n: number): string => String(n).padStart(2, '0');

/** A date(-time) string on the given day of the CURRENTLY-visible month, so the
 *  demo calendar always fills the month grid the user is looking at. Omit `hour`
 *  for an all-day event. */
function on(day: number, hour?: number): string {
  const d = new Date();
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(day)}`;
  return hour === undefined ? date : `${date}T${pad(hour)}:00:00`;
}

/** A connected calendar, densely populated across the whole month (like the
 *  reference) with events themed to the seeded notes. */
function landingCalendar(): CalendarState {
  const ev = (id: string, title: string, day: number, hour?: number): CalendarState['events'][number] =>
    hour === undefined
      ? { id, title, start: on(day), end: on(day), allDay: true }
      : { id, title, start: on(day, hour), end: on(day, hour + 1), allDay: false };
  return {
    status: 'connected',
    lastSyncedAt: new Date().toISOString(),
    events: [
      ev('lc-1', 'Team standup', 2, 9),
      ev('lc-2', 'Walrus epochs review', 3, 11),
      ev('lc-3', 'Seal key server sync', 4, 14),
      ev('lc-4', 'Quilt batching deep-dive', 5, 10),
      ev('lc-5', 'Team standup', 9, 9),
      ev('lc-6', 'Client encryption flow', 10, 13),
      ev('lc-7', 'Research review', 11, 15),
      ev('lc-8', 'Sui object model walkthrough', 12, 16),
      ev('lc-9', 'Reading list, June', 16, 16),
      ev('lc-10', 'Team standup', 17, 9),
      ev('lc-11', 'Demo script review', 18, 14),
      ev('lc-12', 'Pitch narrative sync', 19, 10),
      ev('lc-13', 'Team standup', 23, 9),
      ev('lc-14', 'Seal access control', 23, 11),
      ev('lc-15', 'Walrus storage deep-dive', 25, 15),
      ev('lc-16', 'Demo day run of show', 26, 13),
      ev('lc-17', 'Fly to Lisbon', 27),
      ev('lc-18', 'Alfama dusk walk', 28),
    ],
  };
}

const LANDING_SEED: PreviewSeed = {
  session: LANDING_SESSION,
  calendar: landingCalendar(),
  // Nova suggests = the calendar-grounded prep CHECKLIST (matches the reference);
  // `events` stays for the rail's activity fallback when no prep exists.
  timeline: {
    events: agentEvents,
    draftRequested: false,
    suggestion: null,
    prep: [
      { id: 'slides', title: 'Draft the demo day slides', meta: 'Demo day · Jun 21 · 9 days out', draft: true },
      { id: 'call', title: 'Prep questions for the Lisbon call', meta: 'tomorrow 15:00 · from Google Calendar', draft: true },
      { id: 'wal', title: 'Top up WAL before the trip', meta: 'balance covers about 3 weeks', draft: false },
    ],
  },
};

/** Publish the frozen notes index (only when it can't clobber a live one) and
 *  return the full preview bundle. */
export function seedLandingVault(): PreviewSeed {
  if (sessionStore.getSnapshot().phase !== 'ready' && vaultData.getSnapshot().index === null) {
    vaultData.publish(LANDING_INDEX);
  }
  return LANDING_SEED;
}
