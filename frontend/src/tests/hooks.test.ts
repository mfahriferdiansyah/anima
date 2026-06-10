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
  renameCompanion,
  resetSessionStore,
  sessionStore,
  startSession,
} from '../mocks/sessionStore';
import {
  connectExternalAgent,
  regenerateAgentSecret,
  resetSettingsStore,
  revokeKey,
  settingsStore,
} from '../mocks/settingsStore';
import {
  failNextWrite,
  loadNotes,
  resetVaultStore,
  retryWrite,
  saveNote,
  vaultStore,
} from '../mocks/vaultStore';
import { resetWriteStateStore, writeStateStore } from '../mocks/writeStateStore';
import { chatStore, resetChatStore, send, sendOnOpen, type ChatMessage } from '../mocks/chatStore';
import { resetAgentTimeline, scheduleAgentNote } from '../mocks/agentTimeline';
import { moveNote, presenceStore, resetPresenceStore } from '../mocks/presenceStore';
import { chatScripts, makeVault, materializeNoteSeed } from '../mocks/fixture';

beforeEach(() => {
  vi.useFakeTimers();
  resetSessionStore();
  resetVaultStore();
  resetWriteStateStore();
  resetChatStore();
  resetAgentTimeline();
  resetPresenceStore();
  resetSettingsStore();
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

describe('sessionStore: renameCompanion (U10)', () => {
  it('updates the ready vault and agent names; no-op outside ready', async () => {
    renameCompanion('Lyra'); // disconnected: nothing to rename
    expect(sessionStore.getSnapshot().phase).toBe('disconnected');

    startSession('returning');
    await vi.advanceTimersByTimeAsync(650 + 7 * 450 + 500);
    expect(sessionStore.getSnapshot().phase).toBe('ready');

    renameCompanion('  Lyra  ');
    const ready = sessionStore.getSnapshot();
    if (ready.phase !== 'ready') return;
    expect(ready.vault.name).toBe('Lyra');
    expect(ready.agent.name).toBe('Lyra');

    renameCompanion('   '); // blank names never apply
    const after = sessionStore.getSnapshot();
    expect(after.phase === 'ready' && after.vault.name).toBe('Lyra');
  });
});

describe('settingsStore: keys and secrets (U10)', () => {
  it('seeds the fixture keys and revoke removes one', () => {
    expect(settingsStore.getSnapshot().keys).toHaveLength(3);
    revokeKey('key-studio');
    const keys = settingsStore.getSnapshot().keys;
    expect(keys).toHaveLength(2);
    expect(keys.some((key) => key.id === 'key-studio')).toBe(false);
  });

  it('connect issues a key whose secret lives only in the return value', () => {
    const { key, secret } = connectExternalAgent('  ');
    expect(secret).toMatch(/^anima_sk_[0-9a-f]{40}$/);
    expect(key.kind).toBe('external');
    expect(key.label).toBe('external agent 1');

    const stored = settingsStore.getSnapshot().keys.find((entry) => entry.id === key.id);
    expect(stored?.secretIssued).toBe(true);
    expect(JSON.stringify(settingsStore.getSnapshot())).not.toContain(secret);
  });

  it('regenerate returns a fresh secret for external keys only', () => {
    const { key, secret } = connectExternalAgent('claude code');
    const next = regenerateAgentSecret(key.id);
    expect(next).toMatch(/^anima_sk_[0-9a-f]{40}$/);
    expect(next).not.toBe(secret);
    expect(regenerateAgentSecret('key-browser')).toBeNull(); // device keys have no secret
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

describe('presenceStore: canvas layout (U9)', () => {
  it('moveNote applies immediately and the layout outlives the save pulse', async () => {
    const savingSeen: boolean[] = [];
    presenceStore.subscribe(() => {
      savingSeen.push(presenceStore.getSnapshot().savingLayout);
    });

    moveNote('n-walrus', 333, 444);
    expect(presenceStore.getSnapshot().layout['n-walrus']).toEqual({ x: 333, y: 444 });
    expect(presenceStore.getSnapshot().savingLayout).toBe(false);

    // dragging keeps resetting the debounce; only the final position saves
    moveNote('n-walrus', 350, 460);
    await vi.advanceTimersByTimeAsync(850);
    expect(presenceStore.getSnapshot().savingLayout).toBe(true);

    await vi.advanceTimersByTimeAsync(650);
    expect(presenceStore.getSnapshot().savingLayout).toBe(false);
    expect(presenceStore.getSnapshot().layout['n-walrus']).toEqual({ x: 350, y: 460 });
    // exactly one pulse: false* -> true -> false
    expect(savingSeen.filter((value, i) => value && !savingSeen[i - 1])).toHaveLength(1);
  });

  it('scheduleAgentNote materializes a placed agent note ~6s in, then the flag clears', async () => {
    loadNotes(makeVault());
    scheduleAgentNote();
    scheduleAgentNote(); // idempotent: the beat fires once
    expect(presenceStore.getSnapshot().materializedNoteId).toBeNull();

    await vi.advanceTimersByTimeAsync(6100);
    const materializedId = presenceStore.getSnapshot().materializedNoteId;
    expect(materializedId).toBeTruthy();
    if (!materializedId) return;

    const note = vaultStore.getSnapshot().notes.find((entry) => entry.noteId === materializedId);
    expect(note?.title).toBe(materializeNoteSeed.title);
    expect(note?.author).toBe('agent:nova');
    expect(presenceStore.getSnapshot().layout[materializedId]).toEqual({
      x: materializeNoteSeed.x,
      y: materializeNoteSeed.y,
    });
    expect(vaultStore.getSnapshot().notes).toHaveLength(13);

    await vi.advanceTimersByTimeAsync(2500);
    expect(presenceStore.getSnapshot().materializedNoteId).toBeNull();
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

  it('sendOnOpen opens the popup and a draft reply records the created note', async () => {
    sendOnOpen('draft a checklist for demo day');
    expect(chatStore.getSnapshot().chatOpen).toBe(true);
    expect(chatStore.getSnapshot().thinking).toBe(true);

    await vi.advanceTimersByTimeAsync(20000);

    const reply = chatStore.getSnapshot().messages[1];
    expect(reply.role).toBe('agent');
    expect(reply.createdNoteId).toBeDefined();
    expect(reply.citations?.[0]).toBe(reply.createdNoteId);
    // popup was open the whole time, so no orb badge
    expect(chatStore.getSnapshot().pendingBadge).toBe(false);
  });
});
