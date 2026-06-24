/**
 * The guest canvas edit ROOM (plan 2026-06-24 U13) — mounts the wallet-free board
 * (`CanvasEdit`, U8) on a relay room and wires the live co-edit: broadcast each
 * local element edit as an el-op, apply inbound el-ops + the chunked resync through
 * the shared `makeCanvasCollab` core. The guest is wallet-free and NEVER seals —
 * it broadcasts and reconciles only.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { CanvasEdit } from './CanvasEdit';
import { makeCanvasCollab, type CanvasCollab } from '../canvas/canvasCollab';
import { syncReq } from '../web3/collabOps';
import { serializeMsg, parseMsg } from '../mocks/presenceStore';
import type { CanvasElement } from '../../../chain/core/src/elements.js';
import type { PresenceMsg } from '../../../chain/core/src/index.js';

function relayUrl(room: string): string {
  const base = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8080';
  const ws = base.replace(/^http/, 'ws');
  return `${ws}/presence?room=${encodeURIComponent(room)}`;
}

const selfId = (): string => `read-${Math.random().toString(36).slice(2, 10)}`;

export function CanvasEditRoom({ room }: { room: string }): ReactElement {
  const idRef = useRef<string | null>(null);
  if (!idRef.current) idRef.current = selfId();
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const elementsRef = useRef<CanvasElement[]>([]);
  const collabRef = useRef<CanvasCollab | null>(null);
  elementsRef.current = elements;

  useEffect(() => {
    const id = idRef.current!;
    const ws = new WebSocket(relayUrl(room));
    const sockSend = (msg: PresenceMsg) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(serializeMsg(msg));
    };
    const collab = makeCanvasCollab({
      selfId: id,
      canvasId: room,
      send: sockSend,
      getElements: () => elementsRef.current,
      setElements,
      isResponder: () => false, // a guest never serves the authoritative snapshot
    });
    collabRef.current = collab;
    ws.onopen = () => {
      sockSend({ t: 'hello', id, label: `Guest ${id.slice(5, 9)}`, kind: 'human' });
      sockSend(syncReq(id)); // ask the owner (or a present peer) for the current scene
    };
    ws.onmessage = (e) => {
      const msg = typeof e.data === 'string' ? parseMsg(e.data) : null;
      if (msg) collab.onFrame(msg);
    };
    return () => {
      try {
        if (ws.readyState === WebSocket.OPEN) ws.send(serializeMsg({ t: 'bye', id }));
      } catch {
        /* closing anyway */
      }
      ws.close();
      collabRef.current = null;
    };
  }, [room]);

  // A local edit (place / move / delete) broadcasts the element. The element-list
  // state is shared: CanvasEdit applies the interaction (move/draw/delete) through
  // onElementsChange, and the collab controller applies inbound el-ops to the same
  // setElements — one source of truth, so local + remote never diverge.
  const onLocalEdit = (el: CanvasElement): void => {
    collabRef.current?.broadcast(el);
  };

  return <CanvasEdit elements={elements} onElementsChange={setElements} onLocalEdit={onLocalEdit} />;
}
