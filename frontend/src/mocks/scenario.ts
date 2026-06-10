/**
 * Scenario resolution for the mock layer.
 * Order: ?scenario= query param, then localStorage `anima:scenario`,
 * default `returning`. A `?fast=1` flag shortens every mock latency
 * for tests and screenshot runs. All browser APIs are guarded so the
 * module loads cleanly under node (vitest).
 */
export type Scenario = 'first-run' | 'returning' | 'unpaired';

const SCENARIO_KEY = 'anima:scenario';
const SCENARIOS: readonly Scenario[] = ['first-run', 'returning', 'unpaired'];

function queryParam(name: string): string | null {
  if (typeof location === 'undefined') return null;
  return new URLSearchParams(location.search).get(name);
}

function storageGet(key: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage may be unavailable (private mode); the query param still works
  }
}

function isScenario(value: string | null): value is Scenario {
  return value !== null && (SCENARIOS as readonly string[]).includes(value);
}

/** Current scenario; a valid query param wins and is persisted for later loads. */
export function resolveScenario(): Scenario {
  const fromQuery = queryParam('scenario');
  if (isScenario(fromQuery)) {
    storageSet(SCENARIO_KEY, fromQuery);
    return fromQuery;
  }
  const stored = storageGet(SCENARIO_KEY);
  if (isScenario(stored)) return stored;
  return 'returning';
}

/** Persist a scenario choice. Callers (the MOCKED badge) reload afterwards. */
export function setScenario(scenario: Scenario): void {
  storageSet(SCENARIO_KEY, scenario);
}

/** Clear every `anima:` key from browser storage. Callers reload afterwards. */
export function resetMocks(): void {
  if (typeof localStorage === 'undefined') return;
  const doomed: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith('anima:')) doomed.push(key);
  }
  for (const key of doomed) localStorage.removeItem(key);
}

let fastTimers = queryParam('fast') === '1';

export function isFastTimers(): boolean {
  return fastTimers;
}

export function setFastTimers(value: boolean): void {
  fastTimers = value;
}

/** Every mock latency routes through here so `?fast=1` shortens them all. */
export function mockMs(ms: number): number {
  return fastTimers ? Math.min(ms, 25) : ms;
}
