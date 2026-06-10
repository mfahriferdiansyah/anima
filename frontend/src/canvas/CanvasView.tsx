/**
 * Minimal multiplayer canvas (visuals are placeholders for the design kit —
 * the plumbing underneath is final). Drag cards, see peer cursors live,
 * watch agent notes materialize. Pan by dragging empty space.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { VaultInfo, VaultIndex, IndexedNote } from '@core/index.js';
import { LAYOUT_TAG } from '@core/index.js';
import { useCanvasSync } from './useCanvasSync.js';
import { Orb } from '../theme/Orb.js';

const CARD_W = 200;

/** Deterministic scatter for never-placed notes (stable across clients). */
function defaultPos(noteId: string): { x: number; y: number } {
  let h = 0;
  for (const c of noteId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { x: 120 + (h % 1400), y: 100 + ((h >> 11) % 800) };
}

const PEER_COLORS = ['#8b5cf6', '#22d3ee', '#f59e0b', '#34d399', '#f87171', '#e879f9'];
const peerColor = (id: string) => PEER_COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % PEER_COLORS.length];

export function CanvasView({
  ns, vault, agent, index, onOpenNote,
}: {
  ns: string;
  vault: VaultInfo;
  agent: Ed25519Keypair;
  index: VaultIndex;
  onOpenNote: (id: string) => void;
}) {
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const onNewNotes = useCallback((notes: IndexedNote[]) => {
    setFresh((prev) => {
      const next = new Set(prev);
      for (const n of notes) next.add(n.note.noteId);
      return next;
    });
    setTimeout(() => setFresh(new Set()), 6000);
  }, []);

  const { peers, layout, moveNote, sendCursor, savingLayout } = useCanvasSync({
    ns, vault, agent, index, selfLabel: 'you', onNewNotes,
  });

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ kind: 'pan' | 'note'; id?: string; startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const [livePos, setLivePos] = useState<Record<string, { x: number; y: number }>>({});
  const lastCursorSend = useRef(0);

  const notes = useMemo(
    () => index.all().filter((e) => !e.note.tags.includes(LAYOUT_TAG)),
    [index, index.size, layout], // layout change implies sync happened
  );

  const posOf = (noteId: string) => livePos[noteId] ?? layout[noteId] ?? defaultPos(noteId);

  function onPointerDown(e: React.PointerEvent, noteId?: string) {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    if (noteId) {
      const p = posOf(noteId);
      setDrag({ kind: 'note', id: noteId, startX: e.clientX, startY: e.clientY, baseX: p.x, baseY: p.y });
    } else {
      setDrag({ kind: 'pan', startX: e.clientX, startY: e.clientY, baseX: pan.x, baseY: pan.y });
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    // broadcast cursor in CANVAS coords (~30fps throttle)
    const now = performance.now();
    if (now - lastCursorSend.current > 33) {
      lastCursorSend.current = now;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      sendCursor(e.clientX - rect.left - pan.x, e.clientY - rect.top - pan.y);
    }
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (drag.kind === 'pan') setPan({ x: drag.baseX + dx, y: drag.baseY + dy });
    else if (drag.id) setLivePos((prev) => ({ ...prev, [drag.id!]: { x: drag.baseX + dx, y: drag.baseY + dy } }));
  }

  function onPointerUp() {
    if (drag?.kind === 'note' && drag.id) {
      const p = livePos[drag.id];
      if (p && (p.x !== drag.baseX || p.y !== drag.baseY)) moveNote(drag.id, p.x, p.y);
    }
    setDrag(null);
  }

  const peerList = Object.values(peers);

  return (
    <div className="h-full relative overflow-hidden select-none" style={{ background: 'var(--color-canvas)' }}>
      {/* status strip */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-2 card px-3 py-1.5" style={{ fontSize: 'var(--text-meta)' }}>
        <Orb size={14} />
        <span className="text-fg-muted">{notes.length} memories</span>
        {peerList.length > 0 && (
          <span className="text-fg-muted">· {peerList.length + 1} here:</span>
        )}
        {peerList.map((p) => (
          <span key={p.id} className="flex items-center gap-1" style={{ color: peerColor(p.id) }}>
            ● {p.label}{p.kind === 'agent' ? ' ⚙' : ''}{p.writing ? ' ✍︎' : ''}
          </span>
        ))}
        {savingLayout && <span className="text-fg-faint">saving layout…</span>}
      </div>

      {/* the canvas plane */}
      <div
        className="absolute inset-0 z-10"
        style={{ cursor: drag?.kind === 'pan' ? 'grabbing' : 'grab' }}
        onPointerDown={(e) => onPointerDown(e)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <div style={{ transform: `translate(${pan.x}px, ${pan.y}px)`, position: 'absolute', inset: 0 }}>
          {/* link edges */}
          <svg className="absolute pointer-events-none" style={{ width: 4000, height: 3000, overflow: 'visible' }}>
            {notes.flatMap((e) =>
              e.note.links
                .filter((l) => index.get(l))
                .map((l) => {
                  const a = posOf(e.note.noteId);
                  const b = posOf(l);
                  return (
                    <line
                      key={`${e.note.noteId}-${l}`}
                      x1={a.x + CARD_W / 2} y1={a.y + 30}
                      x2={b.x + CARD_W / 2} y2={b.y + 30}
                      stroke="rgba(139,92,246,0.25)" strokeWidth="1.5"
                    />
                  );
                }),
            )}
          </svg>

          {/* memory cards */}
          {notes.map((e) => {
            const p = posOf(e.note.noteId);
            const isFresh = fresh.has(e.note.noteId);
            return (
              <div
                key={e.note.noteId}
                className={`card absolute px-3 py-2 ${isFresh ? 'note-glow' : ''}`}
                style={{ left: p.x, top: p.y, width: CARD_W, cursor: 'move', transition: isFresh ? 'box-shadow 0.4s' : undefined }}
                onPointerDown={(ev) => {
                  ev.stopPropagation();
                  onPointerDown(ev, e.note.noteId);
                }}
                onDoubleClick={() => onOpenNote(e.note.noteId)}
              >
                <div className="truncate" style={{ fontWeight: 600, fontSize: 'var(--text-meta)' }}>{e.note.title}</div>
                <div className="text-fg-faint truncate" style={{ fontSize: '11px' }}>
                  {e.note.author} · {e.note.tags.slice(0, 2).map((t) => `#${t}`).join(' ')}
                </div>
              </div>
            );
          })}

          {/* peer cursors */}
          {peerList
            .filter((p) => p.x !== undefined)
            .map((p) => (
              <div key={p.id} className="absolute pointer-events-none z-30" style={{ left: p.x, top: p.y, transition: 'left 0.1s linear, top 0.1s linear' }}>
                <svg width="14" height="18" viewBox="0 0 14 18">
                  <path d="M0 0 L14 7 L7 9 L5 18 Z" fill={peerColor(p.id)} />
                </svg>
                <span
                  className="px-1.5 py-0.5 rounded-md text-canvas"
                  style={{ background: peerColor(p.id), fontSize: '10px', fontWeight: 600, whiteSpace: 'nowrap' }}
                >
                  {p.label}{p.kind === 'agent' ? ' ⚙' : ''}{p.writing ? ' is writing…' : ''}
                </span>
              </div>
            ))}
        </div>
      </div>

      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 text-fg-faint" style={{ fontSize: 'var(--text-meta)' }}>
        drag cards to arrange · double-click to open · the layout lives in your vault and resurrects with it
      </div>
    </div>
  );
}
