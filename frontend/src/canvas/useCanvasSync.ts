/**
 * Headless multiplayer-canvas state (visuals come from the design kit).
 * - presence: WS room per vault (cursors, labels, writing, note-created pings)
 * - freshness: pings (and a fallback poll) trigger INCREMENTAL chain sync —
 *   only unseen quilts are read; new notes "materialize" via onNewNotes
 * - layout: durable positions via the canvas-layout note (debounced save)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  loadLayout, saveLayout, syncNewQuilts, ensureAgentWal,
  type CanvasLayout, type PresenceMsg, type IndexedNote, type VaultInfo, VaultIndex,
} from '@core/index.js';
import { getSuiClient, getSealVault, persistIndex } from '../lib/chain.js';
import { BACKEND_URL } from '../lib/backendAuth.js';

const POLL_MS = 25_000;
const LAYOUT_DEBOUNCE_MS = 4_000;

export interface Peer {
  id: string;
  label: string;
  kind: 'human' | 'agent';
  x?: number;
  y?: number;
  writing?: boolean;
  lastSeen: number;
}

export function useCanvasSync(opts: {
  ns: string;
  vault: VaultInfo;
  agent: Ed25519Keypair;
  index: VaultIndex;
  selfLabel?: string;
  onNewNotes?: (notes: IndexedNote[]) => void;
}) {
  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const [layout, setLayout] = useState<CanvasLayout>(() => loadLayout(opts.index));
  const [savingLayout, setSavingLayout] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const selfId = useRef(`me-${Math.random().toString(36).slice(2, 8)}`);
  const layoutDirty = useRef<CanvasLayout | null>(null);
  const layoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncing = useRef(false);

  const deps = useCallback(() => {
    const suiClient = getSuiClient();
    const seal = getSealVault({ signer: opts.agent, vaultId: opts.vault.vaultId, ownerAddress: opts.vault.owner });
    return { suiClient, seal, agentSigner: opts.agent, walletAddress: opts.vault.owner, vaultId: opts.vault.vaultId };
  }, [opts.agent, opts.vault]);

  /** Incremental chain sync — cheap, reads only unseen quilts. */
  const sync = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      const added = await syncNewQuilts(deps(), opts.index);
      if (added.length > 0) {
        setLayout(loadLayout(opts.index)); // a peer may have moved things
        await persistIndex(opts.ns, opts.vault.vaultId, opts.index);
        opts.onNewNotes?.(added.filter((e) => !e.note.tags.includes('anima:canvas-layout')));
      }
    } catch {
      /* transient chain hiccup — next poll retries */
    } finally {
      syncing.current = false;
    }
  }, [deps, opts.index, opts.ns, opts.vault.vaultId, opts.onNewNotes]);

  // presence socket
  useEffect(() => {
    const url = `${BACKEND_URL.replace(/^http/, 'ws')}/presence?vault=${opts.vault.vaultId}`;
    let alive = true;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      return; // presence is optional — canvas still works via polling
    }
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ t: 'hello', id: selfId.current, label: opts.selfLabel ?? 'you', kind: 'human' } satisfies PresenceMsg));
    });
    ws.addEventListener('message', (ev) => {
      if (!alive) return;
      try {
        const msg = JSON.parse(ev.data) as PresenceMsg;
        setPeers((prev) => {
          const next = { ...prev };
          const now = Date.now();
          switch (msg.t) {
            case 'hello':
              next[msg.id] = { id: msg.id, label: msg.label, kind: msg.kind, lastSeen: now };
              break;
            case 'cursor':
              next[msg.id] = { ...(next[msg.id] ?? { id: msg.id, label: '…', kind: 'human' as const }), x: msg.x, y: msg.y, lastSeen: now };
              break;
            case 'writing':
              next[msg.id] = { ...(next[msg.id] ?? { id: msg.id, label: '…', kind: 'agent' as const }), writing: msg.on, lastSeen: now };
              break;
            case 'note-created':
              void sync();
              break;
            case 'bye':
              delete next[msg.id];
              break;
          }
          return next;
        });
      } catch {
        /* malformed frame — ignore */
      }
    });

    const reap = setInterval(() => {
      setPeers((prev) => Object.fromEntries(Object.entries(prev).filter(([, p]) => Date.now() - p.lastSeen < 90_000)));
    }, 30_000);
    const poll = setInterval(() => void sync(), POLL_MS);

    return () => {
      alive = false;
      clearInterval(reap);
      clearInterval(poll);
      try {
        ws.send(JSON.stringify({ t: 'bye', id: selfId.current } satisfies PresenceMsg));
        ws.close();
      } catch {
        /* already gone */
      }
    };
  }, [opts.vault.vaultId, sync, opts.selfLabel]);

  /** Throttled by the caller (e.g. rAF) — sends this client's cursor. */
  const sendCursor = useCallback((x: number, y: number) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: 'cursor', id: selfId.current, x, y } satisfies PresenceMsg));
    }
  }, []);

  /** Move a note locally; persists (debounced) as a new layout-note version. */
  const moveNote = useCallback(
    (noteId: string, x: number, y: number) => {
      setLayout((prev) => {
        const next = { ...prev, [noteId]: { x, y } };
        layoutDirty.current = next;
        if (layoutTimer.current) clearTimeout(layoutTimer.current);
        layoutTimer.current = setTimeout(async () => {
          const toSave = layoutDirty.current;
          layoutDirty.current = null;
          if (!toSave) return;
          setSavingLayout(true);
          try {
            await ensureAgentWal(getSuiClient(), opts.agent).catch(() => void 0);
            await saveLayout(deps(), opts.index, toSave, 'owner');
            await persistIndex(opts.ns, opts.vault.vaultId, opts.index);
          } catch {
            layoutDirty.current = toSave; // retry on next move
          } finally {
            setSavingLayout(false);
          }
        }, LAYOUT_DEBOUNCE_MS);
        return next;
      });
    },
    [deps, opts.agent, opts.index, opts.ns, opts.vault.vaultId],
  );

  return { peers, layout, moveNote, sendCursor, savingLayout, sync };
}
