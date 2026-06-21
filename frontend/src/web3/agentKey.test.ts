/**
 * DOM-free unit check for the per-device agent keypair (plan U4). `idb-keyval`
 * is mocked with an in-memory Map so the get-or-create state machine, the
 * in-flight concurrency dedup, and a mocked round-trip "reload" are exercised
 * directly — no jsdom, no real IndexedDB. Real generated keypairs supply the
 * addresses, so the persistence path is a true secret round-trip.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('idb-keyval', () => {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async (k: string) => store.get(k)),
    set: vi.fn(async (k: string, v: unknown) => {
      store.set(k, v);
    }),
    del: vi.fn(async (k: string) => {
      store.delete(k);
    }),
    __store: store,
  };
});

import * as idb from 'idb-keyval';
import {
  __resetAgentKeyForTests,
  agentAddress,
  getOrCreateAgentKey,
  hasAgentKey,
} from './agentKey';

const store = (idb as unknown as { __store: Map<string, unknown> }).__store;
const OWNER_A = '0xowner-a';
const OWNER_B = '0xowner-b';

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  __resetAgentKeyForTests();
});

describe('web3/agentKey', () => {
  it('creates+persists once, then returns the same key (get-or-create)', async () => {
    const first = await getOrCreateAgentKey(OWNER_A);
    expect(vi.mocked(idb.set)).toHaveBeenCalledTimes(1);
    expect(store.get('agentKey:' + OWNER_A)).toBeDefined();

    const second = await getOrCreateAgentKey(OWNER_A);
    expect(agentAddress(second)).toBe(agentAddress(first));
    // a hit must not re-persist
    expect(vi.mocked(idb.set)).toHaveBeenCalledTimes(1);
  });

  it('gives two distinct owners distinct keys + distinct stored secrets', async () => {
    const a = await getOrCreateAgentKey(OWNER_A);
    const b = await getOrCreateAgentKey(OWNER_B);

    expect(agentAddress(a)).not.toBe(agentAddress(b));
    expect(store.get('agentKey:' + OWNER_A)).toBeDefined();
    expect(store.get('agentKey:' + OWNER_B)).toBeDefined();
    expect(store.get('agentKey:' + OWNER_A)).not.toBe(store.get('agentKey:' + OWNER_B));
  });

  it('dedups concurrent inits to one key and one set (StrictMode-safe)', async () => {
    const [a, b] = await Promise.all([
      getOrCreateAgentKey(OWNER_A),
      getOrCreateAgentKey(OWNER_A),
    ]);

    expect(agentAddress(a)).toBe(agentAddress(b));
    expect(vi.mocked(idb.set)).toHaveBeenCalledTimes(1);
  });

  it('hasAgentKey is false before a key exists and true after', async () => {
    expect(await hasAgentKey(OWNER_A)).toBe(false);
    await getOrCreateAgentKey(OWNER_A);
    expect(await hasAgentKey(OWNER_A)).toBe(true);
    // pure presence, scoped per owner
    expect(await hasAgentKey(OWNER_B)).toBe(false);
  });

  it('survives a reload: reset drops in-flight but keeps the store, no re-persist', async () => {
    const created = await getOrCreateAgentKey(OWNER_A);
    expect(vi.mocked(idb.set)).toHaveBeenCalledTimes(1);

    // simulate a fresh page load: in-flight map gone, IDB store intact
    __resetAgentKeyForTests();

    const reloaded = await getOrCreateAgentKey(OWNER_A);
    expect(agentAddress(reloaded)).toBe(agentAddress(created));
    // loaded from the store — still exactly one persist across both calls
    expect(vi.mocked(idb.set)).toHaveBeenCalledTimes(1);
  });
});
