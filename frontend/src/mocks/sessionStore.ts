/**
 * The six-phase session machine per docs/integration.md section 2:
 * disconnected | checking | first-run | needs-pairing | rebuilding | ready.
 * Scenario decides the walk; timers give it believable latency. A
 * generation counter cancels stale timers across restarts.
 */
import { createStore } from './store';
import { mockMs, resolveScenario, type Scenario } from './scenario';
import {
  AGENT_ADDRESS,
  COMPANION_NAME,
  OWNER_ADDRESS,
  VAULT_ID,
  makeEmptyVault,
  makeVault,
  type Note,
} from './fixture';
import { loadNotes } from './vaultStore';
import { scheduleLowBalanceBanner } from './chatStore';

export type OnboardingStep = 'creating' | 'preparing' | 'done';

export interface VaultInfo {
  vaultId: string;
  owner: string;
  name: string;
  agents: string[];
}

export interface AgentInfo {
  name: string;
  address: string;
}

export type SessionState =
  | { phase: 'disconnected' }
  | { phase: 'checking' }
  | { phase: 'first-run'; address: string; onboarding: OnboardingStep | null; error: string | null }
  | { phase: 'needs-pairing'; vault: VaultInfo; agent: AgentInfo; error: string | null }
  | { phase: 'rebuilding'; done: number; total: number; error: string | null }
  | { phase: 'ready'; vault: VaultInfo; agent: AgentInfo; index: { count: number } };

const TOTAL_QUILTS = 7;

const store = createStore<SessionState>({ phase: 'disconnected' });

export const sessionStore = {
  getSnapshot: store.getSnapshot,
  subscribe: store.subscribe,
};

let generation = 0;
let rebuildShouldFail = false;

function later(ms: number, gen: number, fn: () => void): void {
  setTimeout(() => {
    if (gen === generation) fn();
  }, mockMs(ms));
}

function vaultInfo(name: string): VaultInfo {
  return {
    vaultId: VAULT_ID,
    owner: OWNER_ADDRESS,
    name,
    agents: [`agent:${name.toLowerCase()}`, 'agent:claude-code'],
  };
}

function agentInfo(name: string): AgentInfo {
  return { name, address: AGENT_ADDRESS };
}

/** Start (or restart) the machine. Defaults to the resolved browser scenario. */
export function startSession(scenario: Scenario = resolveScenario()): void {
  generation += 1;
  const gen = generation;
  store.update(() => ({ phase: 'checking' }));
  later(600, gen, () => {
    if (scenario === 'first-run') {
      store.update(() => ({
        phase: 'first-run',
        address: OWNER_ADDRESS,
        onboarding: null,
        error: null,
      }));
    } else if (scenario === 'unpaired') {
      store.update(() => ({
        phase: 'needs-pairing',
        vault: vaultInfo(COMPANION_NAME),
        agent: agentInfo(COMPANION_NAME),
        error: null,
      }));
    } else {
      beginRebuild(gen, 0);
    }
  });
}

function beginRebuild(gen: number, startAt: number): void {
  store.update(() => ({ phase: 'rebuilding', done: startAt, total: TOTAL_QUILTS, error: null }));
  tickRebuild(gen);
}

function tickRebuild(gen: number): void {
  later(450, gen, () => {
    const state = store.getSnapshot();
    if (state.phase !== 'rebuilding' || state.error) return;
    if (rebuildShouldFail) {
      rebuildShouldFail = false;
      store.update(() => ({
        ...state,
        error: `Could not decrypt quilt ${state.done + 1} of ${state.total}. Retry when the connection settles.`,
      }));
      return;
    }
    const done = state.done + 1;
    store.update(() => ({ phase: 'rebuilding', done, total: state.total, error: null }));
    if (done >= state.total) {
      later(350, gen, () => goReady(makeVault(), COMPANION_NAME));
    } else {
      tickRebuild(gen);
    }
  });
}

function goReady(notes: Note[], name: string): void {
  loadNotes(notes);
  store.update(() => ({
    phase: 'ready',
    vault: vaultInfo(name),
    agent: agentInfo(name),
    index: { count: notes.length },
  }));
  scheduleLowBalanceBanner();
}

/**
 * The onboarding ceremony: creating, preparing, done, then ready with an
 * EMPTY vault. The name becomes the companion and vault name.
 */
export function completeOnboarding(name: string): void {
  const state = store.getSnapshot();
  if (state.phase !== 'first-run' || state.onboarding !== null) return;
  const gen = generation;
  const address = state.address;
  const step = (onboarding: OnboardingStep) =>
    store.update(() => ({ phase: 'first-run', address, onboarding, error: null }));
  step('creating');
  later(900, gen, () => {
    step('preparing');
    later(900, gen, () => {
      step('done');
      later(500, gen, () => goReady(makeEmptyVault(), name.trim() || COMPANION_NAME));
    });
  });
}

/** The wallet declined the creation signature: back to the sign step with an inline error. */
export function rejectSignature(): void {
  const state = store.getSnapshot();
  if (state.phase !== 'first-run') return;
  store.update(() => ({
    phase: 'first-run',
    address: state.address,
    onboarding: null,
    error: 'Signature request was declined. Nothing was created, sign again when you are ready.',
  }));
}

/** Ceremony closed before signing: stay in first-run, the UI returns to the landing view. */
export function closeBeforeSign(): void {
  const state = store.getSnapshot();
  if (state.phase !== 'first-run') return;
  store.update(() => ({
    phase: 'first-run',
    address: state.address,
    onboarding: null,
    error: null,
  }));
}

/** Pair this device (one mock tx), then rebuild into the full vault. */
export function pair(): void {
  if (store.getSnapshot().phase !== 'needs-pairing') return;
  beginRebuild(generation, 0);
}

/** Pairing signature declined: error with retry, the device stays unpaired. */
export function rejectPairing(): void {
  const state = store.getSnapshot();
  if (state.phase !== 'needs-pairing') return;
  store.update(() => ({
    ...state,
    error: 'Pairing signature was declined. This device stays unpaired until you approve it.',
  }));
}

/** Resume a failed rebuild from where it stopped. */
export function retryRebuild(): void {
  const state = store.getSnapshot();
  if (state.phase !== 'rebuilding' || !state.error) return;
  beginRebuild(generation, state.done);
}

/** Dev switch: the next rebuild tick fails with a retryable error. */
export function failNextRebuild(): void {
  rebuildShouldFail = true;
}

export function disconnect(): void {
  generation += 1;
  store.update(() => ({ phase: 'disconnected' }));
}

export function resetSessionStore(): void {
  generation += 1;
  rebuildShouldFail = false;
  store.update(() => ({ phase: 'disconnected' }));
}
