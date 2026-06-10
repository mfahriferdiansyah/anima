/**
 * DOM-free store tests (no jsdom, no testing-library): the mock stores
 * are plain modules, so the state machines are exercised directly with
 * fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completeOnboarding,
  pair,
  rejectPairing,
  resetSessionStore,
  sessionStore,
  startSession,
} from '../mocks/sessionStore';
import {
  failNextWrite,
  loadNotes,
  resetVaultStore,
  retryWrite,
  saveNote,
  vaultStore,
} from '../mocks/vaultStore';
import { resetWriteStateStore, writeStateStore } from '../mocks/writeStateStore';
import { chatStore, resetChatStore, send, type ChatMessage } from '../mocks/chatStore';
import { resetAgentTimeline } from '../mocks/agentTimeline';
import { chatScripts, makeVault } from '../mocks/fixture';

beforeEach(() => {
  vi.useFakeTimers();
  resetSessionStore();
  resetVaultStore();
  resetWriteStateStore();
  resetChatStore();
  resetAgentTimeline();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sessionStore: first-run scenario (AE1)', () => {
  it('walks checking -> first-run, then onboarding into ready with an empty vault', async () => {
    startSession('first-run');
    expect(sessionStore.getSnapshot().phase).toBe('checking');

    await vi.advanceTimersByTimeAsync(700);
    const firstRun = sessionStore.getSnapshot();
    expect(firstRun.phase).toBe('first-run');
    if (firstRun.phase !== 'first-run') return;
    expect(firstRun.onboarding).toBeNull();

    completeOnboarding('Nova');
    let state = sessionStore.getSnapshot();
    expect(state.phase === 'first-run' && state.onboarding).toBe('creating');

    await vi.advanceTimersByTimeAsync(950);
    state = sessionStore.getSnapshot();
    expect(state.phase === 'first-run' && state.onboarding).toBe('preparing');

    await vi.advanceTimersByTimeAsync(950);
    state = sessionStore.getSnapshot();
    expect(state.phase === 'first-run' && state.onboarding).toBe('done');

    await vi.advanceTimersByTimeAsync(600);
    state = sessionStore.getSnapshot();
    expect(state.phase).toBe('ready');
    if (state.phase !== 'ready') return;
    expect(state.vault.name).toBe('Nova');
    expect(state.index.count).toBe(0);
    expect(vaultStore.getSnapshot().notes).toHaveLength(0);
  });
});

describe('sessionStore: returning scenario (AE2)', () => {
  it('rebuilds with monotonically increasing done, then ready with 12 notes', async () => {
    const doneSeen: number[] = [];
    sessionStore.subscribe(() => {
      const state = sessionStore.getSnapshot();
      if (state.phase === 'rebuilding') doneSeen.push(state.done);
    });

    startSession('returning');
    await vi.advanceTimersByTimeAsync(650);
    const rebuilding = sessionStore.getSnapshot();
    expect(rebuilding.phase).toBe('rebuilding');
    if (rebuilding.phase !== 'rebuilding') return;
    expect(rebuilding.total).toBe(7);

    await vi.advanceTimersByTimeAsync(7 * 450 + 500);
    const ready = sessionStore.getSnapshot();
    expect(ready.phase).toBe('ready');
    if (ready.phase !== 'ready') return;

    expect(doneSeen.length).toBeGreaterThan(0);
    for (let i = 1; i < doneSeen.length; i += 1) {
      expect(doneSeen[i]).toBeGreaterThanOrEqual(doneSeen[i - 1]);
    }
    expect(doneSeen[doneSeen.length - 1]).toBe(7);
    expect(ready.index.count).toBe(12);
    expect(vaultStore.getSnapshot().notes).toHaveLength(12);
  });
});

describe('sessionStore: unpaired scenario', () => {
  it('rejecting the pairing keeps needs-pairing with a retryable error', async () => {
    startSession('unpaired');
    await vi.advanceTimersByTimeAsync(700);
    expect(sessionStore.getSnapshot().phase).toBe('needs-pairing');

    rejectPairing();
    const rejected = sessionStore.getSnapshot();
    expect(rejected.phase).toBe('needs-pairing');
    if (rejected.phase !== 'needs-pairing') return;
    expect(rejected.error).toBeTruthy();
  });

  it('pair() moves through rebuilding into ready with the full fixture', async () => {
    startSession('unpaired');
    await vi.advanceTimersByTimeAsync(700);
    pair();
    expect(sessionStore.getSnapshot().phase).toBe('rebuilding');

    await vi.advanceTimersByTimeAsync(7 * 450 + 500);
    const ready = sessionStore.getSnapshot();
    expect(ready.phase).toBe('ready');
    expect(vaultStore.getSnapshot().notes).toHaveLength(12);
  });
});

describe('vaultStore: write states (AE4)', () => {
  it('failNextWrite makes the save end failed; retry reaches certified', async () => {
    loadNotes(makeVault());
    failNextWrite();

    saveNote('n-demo', { body: 'updated body' });
    expect(vaultStore.getSnapshot().writeStates['n-demo']).toEqual({ phase: 'encrypting' });

    await vi.advanceTimersByTimeAsync(750);
    expect(vaultStore.getSnapshot().writeStates['n-demo']).toEqual({ phase: 'certifying' });

    await vi.advanceTimersByTimeAsync(950);
    expect(vaultStore.getSnapshot().writeStates['n-demo']).toEqual({ phase: 'failed' });

    retryWrite('n-demo');
    await vi.advanceTimersByTimeAsync(1700);
    const state = vaultStore.getSnapshot().writeStates['n-demo'];
    expect(state.phase).toBe('certified');
    if (state.phase !== 'certified') return;
    expect(state.blobObjectId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(state.provenanceUrl).toContain(state.blobObjectId);

    // both sequences surfaced as global toast events, last one certified
    const events = writeStateStore.getSnapshot().events;
    expect(events).toHaveLength(2);
    expect(events[events.length - 1].state.phase).toBe('certified');
  });
});

describe('chatStore: shared conversation (AE3)', () => {
  it('two subscribers see the identical message list', async () => {
    let seenA: ChatMessage[] | null = null;
    let seenB: ChatMessage[] | null = null;
    chatStore.subscribe(() => {
      seenA = chatStore.getSnapshot().messages;
    });
    chatStore.subscribe(() => {
      seenB = chatStore.getSnapshot().messages;
    });

    send('hello Nova');
    expect(chatStore.getSnapshot().thinking).toBe(true);

    await vi.advanceTimersByTimeAsync(10000);

    const messages = chatStore.getSnapshot().messages;
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('agent');
    expect(messages[1].streaming).toBe(false);
    expect(messages[1].text).toBe(chatScripts.default.text);
    expect(messages[1].citations).toEqual(chatScripts.default.citations);
    expect(chatStore.getSnapshot().thinking).toBe(false);

    expect(seenA).not.toBeNull();
    expect(seenA).toBe(seenB);
    expect(seenA).toBe(messages);
  });
});
