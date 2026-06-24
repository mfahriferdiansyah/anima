/**
 * The collaborative-edit session (plan 2026-06-24 U2) — the single Yjs import
 * boundary. Everything in this module is loaded behind a DYNAMIC import (the
 * reader's edit chunk), so the static view path stays `@mysten`-free AND yjs-free
 * (asserted by scripts/assert-view-chunk-clean.mjs).
 *
 * It owns a `Y.Doc` (the live CRDT for note text) + an `Awareness` instance
 * (presence: identity, cursor, selection, seal-state) and binds both to the
 * relay socket through the existing presence frame protocol — NOT y-websocket's
 * own server (the relay is a dumb, stateless, lossy fan-out).
 *
 * Sync model (a deliberate simplification of the y-websocket readMessage loop):
 * because every frame already carries a `t` discriminator, we don't need the
 * lib0 multiplex byte. We exchange Yjs *state vectors* and *updates* directly via
 * yjs core (`encodeStateVector` / `encodeStateAsUpdate` / `applyUpdate`), tagged
 * by a 1-byte kind at the head of the `y-sync` binary payload:
 *   - STEP1  : "here's my state vector, send me what I'm missing" (on join / reconcile)
 *   - STEP2  : "here are the structs you lack" (the authoritative answer)
 *   - UPDATE : an incremental change as it happens
 *   - AWARE  : an awareness (presence) update
 * This avoids a direct `lib0/encoding` import (which the config-less test runner
 * cannot resolve) while preserving the exact protocol semantics.
 *
 * Loss tolerance: the relay drops frames to slow consumers, so a lone UPDATE can
 * be lost. A bounded, jittered periodic STEP1 reconcile re-requests and back-fills
 * a missed update — recovering it ONLY while a surviving peer still holds it (if
 * the only holder leaves first, it's gone; the durable seal is the backstop).
 *
 * The echo guard (`origin === LOCAL`) is mandatory: applying a remote update
 * fires `doc.on('update')` with our LOCAL origin, and without the guard we'd
 * re-broadcast every received update straight back into the relay (an amplifier).
 */
import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { bytesToB64, b64ToBytes } from './collabOps';
import type { PresenceMsg } from '../../../chain/core/src/index.js';

/** The 1-byte kind at the head of a `y-sync` binary payload. */
const enum Tag {
  Step1 = 0,
  Step2 = 1,
  Update = 2,
  Aware = 3,
}

/** Transaction origin for updates we applied from a peer — the echo guard reads this. */
const REMOTE = Symbol('collab-remote');

/** Default cadence of the loss-recovery reconcile (ms), jittered per call. */
const RECONCILE_MS = 4000;

/** Prepend the 1-byte tag to a binary payload. */
function tagged(tag: Tag, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 1);
  out[0] = tag;
  out.set(payload, 1);
  return out;
}

export interface CollabSessionOpts {
  /** Send a frame onto the relay (the share gate / socket wiring lives in the caller). */
  send: (msg: PresenceMsg) => void;
  /** This peer's non-identifying session id (the frame `id`). */
  selfId: string;
  /** Reconcile cadence override (tests pass 0 to disable the timer). */
  reconcileMs?: number;
  /** Deterministic jitter for tests (defaults to Math.random, which is banned in workflow scripts but fine in app code). */
  jitter?: () => number;
}

/**
 * A live collaborative session over the relay. The caller wires `onFrame` to the
 * socket's inbound `y-sync`/`sync-req` frames and `send` to the outbound path;
 * the session owns the doc + awareness and the sync/echo/reconcile logic.
 */
export class CollabSession {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  private readonly send: (msg: PresenceMsg) => void;
  private readonly selfId: string;
  private readonly reconcileMs: number;
  private readonly jitter: () => number;
  private reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  /** When true, this peer answers a `sync-req` with the full STEP2 (the owner / present-peer responder). */
  authoritative = false;

  constructor(opts: CollabSessionOpts) {
    this.doc = new Y.Doc();
    this.awareness = new Awareness(this.doc);
    this.send = opts.send;
    this.selfId = opts.selfId;
    this.reconcileMs = opts.reconcileMs ?? RECONCILE_MS;
    this.jitter = opts.jitter ?? (() => Math.random());

    // Broadcast our local updates (echo-guarded so a remote-applied update is
    // never re-sent).
    this.doc.on('update', this.onDocUpdate);
    // Broadcast awareness changes (identity / cursor / selection).
    this.awareness.on('update', this.onAwarenessUpdate);

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.onBeforeUnload);
    }
  }

  /** Call once connected: announce ourselves (STEP1) so peers send us what we lack. */
  start(): void {
    this.sendStep1();
    this.scheduleReconcile();
  }

  // ── outbound ────────────────────────────────────────────────────────────

  private onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === REMOTE) return; // echo guard — a remote-applied update is not re-broadcast
    this.emitSync(tagged(Tag.Update, update));
  };

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (origin === REMOTE) return;
    const changed = added.concat(updated, removed);
    this.emitSync(tagged(Tag.Aware, encodeAwarenessUpdate(this.awareness, changed)));
  };

  private sendStep1(): void {
    this.emitSync(tagged(Tag.Step1, Y.encodeStateVector(this.doc)));
  }

  private emitSync(payload: Uint8Array): void {
    if (this.destroyed) return;
    this.send({ t: 'y-sync', id: this.selfId, b: bytesToB64(payload) });
  }

  // ── inbound ─────────────────────────────────────────────────────────────

  /** Feed an inbound `y-sync` or `sync-req` frame. Ignores our own echoes and other frame kinds. */
  onFrame(msg: PresenceMsg): void {
    if (this.destroyed) return;
    if (msg.t === 'sync-req') {
      // A late joiner asks for state. Only the authoritative responder answers
      // with the full STEP2 (avoids the N-peer state storm on a broadcast bus);
      // everyone re-announces their own STEP1 so the joiner converges either way.
      if (msg.id === this.selfId) return;
      if (this.authoritative) this.sendStep2(Y.encodeStateVector(new Y.Doc()));
      else this.sendStep1();
      return;
    }
    if (msg.t !== 'y-sync' || msg.id === this.selfId) return;
    const bytes = b64ToBytes(msg.b);
    if (bytes.length < 1) return;
    const tag = bytes[0] as Tag;
    const payload = bytes.subarray(1);
    switch (tag) {
      case Tag.Step1:
        // A peer's state vector — answer with the structs they lack.
        this.sendStep2(payload);
        break;
      case Tag.Step2:
      case Tag.Update:
        // Apply with the REMOTE origin so our echo guard doesn't re-broadcast it.
        Y.applyUpdate(this.doc, payload, REMOTE);
        break;
      case Tag.Aware:
        applyAwarenessUpdate(this.awareness, payload, REMOTE);
        break;
    }
  }

  private sendStep2(stateVector: Uint8Array): void {
    this.emitSync(tagged(Tag.Step2, Y.encodeStateAsUpdate(this.doc, stateVector)));
  }

  // ── loss recovery ─────────────────────────────────────────────────────────

  /**
   * A bounded, jittered periodic STEP1: re-requests state so a dropped UPDATE is
   * back-filled by any surviving peer that still holds it. Low-frequency on
   * purpose — it shares the same droppable fan-out buffer it repairs.
   */
  private scheduleReconcile(): void {
    if (this.reconcileMs <= 0 || this.destroyed) return;
    const delay = this.reconcileMs * (0.75 + 0.5 * this.jitter());
    this.reconcileTimer = setTimeout(() => {
      if (this.destroyed) return;
      this.sendStep1();
      this.scheduleReconcile();
    }, delay);
  }

  // ── teardown ──────────────────────────────────────────────────────────────

  private onBeforeUnload = (): void => {
    // Drop our awareness so peers don't show a ghost cursor for up to 30s.
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'unload');
  };

  destroy(): void {
    if (this.destroyed) return;
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
    this.doc.off('update', this.onDocUpdate);
    // Broadcast our awareness removal BEFORE tearing the send path down, so peers
    // drop our cursor instantly instead of waiting out the 30s awareness timeout.
    // (`destroy` origin ≠ REMOTE, so onAwarenessUpdate emits it.)
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy');
    this.destroyed = true;
    this.awareness.off('update', this.onAwarenessUpdate);
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', this.onBeforeUnload);
    this.awareness.destroy();
    this.doc.destroy();
  }
}
