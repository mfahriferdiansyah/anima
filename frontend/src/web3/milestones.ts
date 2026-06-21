/**
 * Milestones (Tier-2 U3) — derived from real chain/client state, never hardcoded
 * (R29). The four the settings rail shows:
 *   - First seal           ← the vault has ≥1 user note (date = earliest note)
 *   - External agent paired ← vault.agents has more than the device key
 *   - First public note     ← listPublished is non-empty
 *   - Resurrected           ← this device first saw the vault already populated
 *
 * `deriveMilestones` is PURE (node-tested); the signal-gathering (vaultData,
 * session, listPublished, localStorage) is the impure layer the settings hook
 * drives, mirroring how balances are refreshed.
 */
import { listPublished } from '../../../chain/core/src/index.js';
import { sessionStore, getQuiltDeps } from './session';
import { vaultData } from './vaultData';

export type MilestoneKey = 'seal' | 'paired' | 'public' | 'resurrected';

export interface Milestone {
  key: MilestoneKey;
  label: string;
  achieved: boolean;
  /** Short display date when known ('Jun 2'), or 'not yet' when unachieved. */
  date: string;
}

export interface MilestoneSignals {
  noteCount: number;
  /** ISO timestamp of the earliest user note, or null. */
  firstNoteAt: string | null;
  agentCount: number;
  hasPublished: boolean;
  resurrected: boolean;
}

/** ISO → a short 'Mon D' label; '' when absent/unparseable. */
export function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // UTC-stable: the source is a UTC ISO string, so format in UTC (no machine-TZ drift).
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** PURE: the four milestones from real signals. Achieved state is R29's contract. */
export function deriveMilestones(s: MilestoneSignals): Milestone[] {
  return [
    {
      key: 'seal',
      label: 'First seal',
      achieved: s.noteCount > 0,
      date: s.noteCount > 0 ? shortDate(s.firstNoteAt) || 'done' : 'not yet',
    },
    {
      key: 'paired',
      label: 'External agent paired',
      achieved: s.agentCount > 1,
      date: s.agentCount > 1 ? 'done' : 'not yet',
    },
    {
      key: 'public',
      label: 'First public note',
      achieved: s.hasPublished,
      date: s.hasPublished ? 'done' : 'not yet',
    },
    {
      key: 'resurrected',
      label: 'Resurrected',
      achieved: s.resurrected,
      date: s.resurrected ? 'done' : 'not yet',
    },
  ];
}

const SEEN_PREFIX = 'anima:seen:';

/**
 * Resurrection heuristic: the FIRST time this device (browser) sees a given
 * vault, a populated vault means we rebuilt someone else's notes from Walrus —
 * a resurrection. The creator's first session sees an empty vault → not
 * resurrected. The decision is stored once so it stays stable.
 */
export function resurrectionFlag(vaultId: string, hasNotesNow: boolean): boolean {
  if (typeof localStorage === 'undefined') return false;
  const key = SEEN_PREFIX + vaultId;
  const stored = localStorage.getItem(key);
  if (stored !== null) return stored === '1';
  const resurrected = hasNotesNow;
  try {
    localStorage.setItem(key, resurrected ? '1' : '0');
  } catch {
    /* private mode / quota — fall through */
  }
  return resurrected;
}

/** Sync signals from the live index + session (no I/O, no side effects). */
export function gatherSyncSignals(hasPublished: boolean, resurrected: boolean): MilestoneSignals {
  const notes = vaultData.getSnapshot().index?.notes() ?? [];
  const noteCount = notes.length;
  const firstNoteAt =
    noteCount > 0
      ? notes.reduce((min, e) => (e.note.updatedAt < min ? e.note.updatedAt : min), notes[0].note.updatedAt)
      : null;
  const s = sessionStore.getSnapshot();
  const agentCount = s.phase === 'ready' ? s.vault.agents.length : 0;
  return { noteCount, firstNoteAt, agentCount, hasPublished, resurrected };
}

/** Resolve + store the resurrection flag for the ready vault (localStorage). */
export function computeResurrection(): boolean {
  const s = sessionStore.getSnapshot();
  if (s.phase !== 'ready') return false;
  const noteCount = vaultData.getSnapshot().index?.notes().length ?? 0;
  return resurrectionFlag(s.vault.vaultId, noteCount > 0);
}

/** Async: has the owner ever published a note? (chain-as-registry scan). */
export async function fetchHasPublished(): Promise<boolean> {
  const deps = getQuiltDeps();
  if (!deps) return false;
  try {
    return (await listPublished(deps)).length > 0;
  } catch {
    return false;
  }
}
