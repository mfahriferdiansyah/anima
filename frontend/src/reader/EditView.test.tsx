// @vitest-environment jsdom
/**
 * Guest note edit surface (plan 2026-06-24 U4). A FAKE WebSocket wires two
 * `EditView` rooms through one in-memory relay (broadcast, no self-echo), so the
 * Yjs-over-relay round-trip is exercised without a server. Proves: a wallet-free
 * mount (no connect/sign prompt, no `@mysten` import on this path), two guests'
 * concurrent typing converges, and a late joiner hydrates from a present peer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EditView } from './EditView';
import { serializeMsg, parseMsg } from '../mocks/presenceStore';
import type { PresenceMsg } from '../../../chain/core/src/index.js';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── a fake relay: every open socket on a room receives every OTHER socket's
//    frames (never its own — the real relay suppresses the self-echo). ──────────
class FakeRelayHub {
  private sockets = new Set<FakeWebSocket>();
  join(s: FakeWebSocket) {
    this.sockets.add(s);
  }
  leave(s: FakeWebSocket) {
    this.sockets.delete(s);
  }
  broadcast(from: FakeWebSocket, data: string) {
    for (const s of this.sockets) {
      if (s === from) continue;
      s.deliver(data);
    }
  }
}
const hub = new FakeRelayHub();

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    hub.join(this);
    // Open synchronously-but-deferred: a microtask AND a macrotask boundary are
    // drained by the test's flush(), but we keep onopen out of the constructor so
    // the caller's handler assignment runs first.
    setTimeout(() => {
      if (this.readyState === FakeWebSocket.CLOSED) return;
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    }, 0);
  }
  send(data: string) {
    hub.broadcast(this, data);
  }
  deliver(data: string) {
    this.onmessage?.({ data });
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
    hub.leave(this);
    this.onclose?.();
  }
}

let connectCalls = 0;
beforeEach(() => {
  connectCalls = 0;
  vi.stubGlobal(
    'WebSocket',
    class extends FakeWebSocket {
      constructor(url: string) {
        connectCalls += 1;
        super(url);
      }
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function mount(props: { room: string }): Promise<{ root: Root; container: HTMLElement }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root!: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<EditView room={props.room} salt={null} />);
    await Promise.resolve();
  });
  return { root, container };
}

// Drain both the microtask queue and the setTimeout(0) macrotask (the fake
// socket opens on a 0-delay timer), then let React commit.
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); await Promise.resolve(); });
const textarea = (c: HTMLElement) => c.querySelector('textarea') as HTMLTextAreaElement;

describe('EditView — wallet-free Yjs note surface', () => {
  it('mounts a live textarea with no wallet/connect prompt (AE9)', async () => {
    const { root, container } = await mount({ room: 'room-A' });
    await flush();
    const ta = textarea(container);
    expect(ta).toBeTruthy();
    expect(ta.disabled).toBe(false); // no soft-lock disabling
    // the live notice uses the neutral .sharenote (kit), not an invented tint
    expect(container.querySelector('.sharenote')).toBeTruthy();
    // no "connect wallet" / "sign in" affordance on the guest surface
    expect(container.textContent).not.toMatch(/connect|sign in|wallet/i);
    await act(async () => root.unmount());
  });

  it('two guests in one room converge on concurrent typing (AE2)', async () => {
    const a = await mount({ room: 'room-converge' });
    const b = await mount({ room: 'room-converge' });
    await flush();
    await flush();

    const taA = textarea(a.container);
    const taB = textarea(b.container);

    // guest A types
    await act(async () => {
      taA.value = 'hello from A';
      taA.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    await flush();

    // B sees A's text (sync over the fake relay)
    expect(taB.value).toBe('hello from A');

    // guest B appends — both converge
    await act(async () => {
      taB.value = 'hello from A + B';
      taB.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    await flush();

    expect(taA.value).toBe('hello from A + B');
    expect(taA.value).toBe(taB.value);

    await act(async () => a.root.unmount());
    await act(async () => b.root.unmount());
  });

  it('a late joiner hydrates from a present peer (sync-req → state)', async () => {
    const a = await mount({ room: 'room-late' });
    await flush();
    const taA = textarea(a.container);
    await act(async () => {
      taA.value = 'content that existed before the late joiner';
      taA.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    await flush();

    // B joins LATE and should hydrate via its sync-req
    const b = await mount({ room: 'room-late' });
    await flush();
    await flush();
    const taB = textarea(b.container);
    expect(taB.value).toBe('content that existed before the late joiner');

    await act(async () => a.root.unmount());
    await act(async () => b.root.unmount());
  });

  it('an incomplete link (no room, no salt) shows an honest error, not a dead editor', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root!: Root;
    await act(async () => {
      root = createRoot(container);
      root.render(<EditView room={null} salt={null} />);
      await Promise.resolve();
    });
    expect(container.textContent).toMatch(/incomplete/i);
    expect(container.querySelector('textarea')).toBeNull();
    await act(async () => root.unmount());
  });
});

// A tiny guard that the frame protocol the surface relies on is intact.
describe('EditView relies on the y-sync/sync-req frames', () => {
  it('round-trips a sync-req through the wire codec', () => {
    const f: PresenceMsg = { t: 'sync-req', id: 'g1' };
    expect(parseMsg(serializeMsg(f))).toEqual(f);
  });
});
