import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/Button';
import { ToastStack } from '@/components/ToastStack';
import type { ToastItem } from '@/components/ToastStack';
import { createNote, useVault } from '@/hooks/useVault';
import type { Note } from '@/hooks/useVault';
import { moveNote, startPresence, stopPresence, usePresence } from '@/hooks/usePresence';
import type { Peer } from '@/hooks/usePresence';
import { scheduleAgentNote } from '@/hooks/useAgentTimeline';
import { useVaultSession } from '@/hooks/useVaultSession';
import '@/theme/canvas.css';

const CARD_WIDTH = 210;
/** Edge endpoints aim at the card's visual middle (title + two excerpt lines). */
const CARD_CENTER_Y = 44;
const DRAG_THRESHOLD_PX = 4;

/** Scattered faint stars, one per ~40 grid dots (kit spec). */
const CONSTELLATION: ReadonlyArray<{ left: string; top: string }> = [
  { left: '16%', top: '30%' },
  { left: '58%', top: '18%' },
  { left: '80%', top: '64%' },
  { left: '30%', top: '78%' },
  { left: '44%', top: '46%' },
  { left: '90%', top: '24%' },
];

/** Kit .aged format, as on the Notes tree. */
function shortAge(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Flatten the body into excerpt text: wiki links become titles, list markers drop. */
function excerptOf(note: Note, titles: Map<string, string>): string {
  return note.body
    .replace(/\[\[([^\]]+)\]\]/g, (_, id: string) => titles.get(id) ?? id)
    .split('\n')
    .map((line) => line.replace(/^[\s\->#]*(\[[ x]\]\s*)?/, '').trim())
    .filter(Boolean)
    .join(' ');
}

function PeerCursor({ peer }: { peer: Peer }) {
  const style = { transform: `translate(${peer.x}px, ${peer.y}px)` };
  if (peer.kind === 'human') {
    return (
      <div className="cursor" style={style} aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 18 18">
          <path d="M2 1 L16 9 L9.5 10.5 L7 17 Z" fill="#FF4D8D" />
        </svg>
        <span className="tagp" style={{ background: 'var(--pink-500)' }}>{peer.label}</span>
      </div>
    );
  }
  return (
    <div className="cursor agent" style={style} aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 22 22">
        <path
          d="M11 1 L13.4 8.6 L21 11 L13.4 13.4 L11 21 L8.6 13.4 L1 11 L8.6 8.6 Z"
          fill="none"
          stroke="#FF5C1A"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      <span className="tagp">
        ✧ {peer.label.toLowerCase()}
        {peer.isWriting ? ' · is writing…' : ''}
      </span>
    </div>
  );
}

interface DragState {
  noteId: string;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
  moved: boolean;
}

/**
 * The constellation board (R14): draggable note cards over the dotted
 * paper, fixture links as faint edges, scripted peer cursors, and the
 * agent's materialize beat. Layout writes go through moveNote, which
 * debounces the mock save and pulses the saving pill.
 */
export function Canvas() {
  const session = useVaultSession();
  const navigate = useNavigate();
  const { notes } = useVault();
  const { peers, layout, savingLayout, materializedNoteId } = usePresence();
  const dragRef = useRef<DragState | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastCounter = useRef(0);

  useEffect(() => {
    startPresence();
    scheduleAgentNote();
    return () => stopPresence();
  }, []);

  const titles = useMemo(() => {
    const map = new Map<string, string>();
    for (const note of notes) map.set(note.noteId, note.title || 'Untitled note');
    return map;
  }, [notes]);

  // Notes without a stored position (e.g. chat drafts) cascade near the top-left.
  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    let cascade = 0;
    for (const note of notes) {
      const stored = layout[note.noteId];
      if (stored) {
        map.set(note.noteId, stored);
      } else {
        map.set(note.noteId, { x: 48 + cascade * 36, y: 48 + cascade * 36 });
        cascade += 1;
      }
    }
    return map;
  }, [notes, layout]);

  const edges = useMemo(() => {
    const seen = new Set<string>();
    const pairs: Array<{ from: string; to: string }> = [];
    for (const note of notes) {
      for (const target of note.links) {
        if (!titles.has(target)) continue;
        const key = [note.noteId, target].sort().join('~');
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ from: note.noteId, to: target });
      }
    }
    return pairs;
  }, [notes, titles]);

  if (session.phase !== 'ready') return null;
  const name = session.agent.name;

  const pushInfo = (title: string, detail: string) => {
    toastCounter.current += 1;
    setToasts((prev) => [...prev, { id: `canvas-toast-${toastCounter.current}`, variant: 'info', title, detail }]);
  };
  const dismissToast = (id: string) => setToasts((prev) => prev.filter((toast) => toast.id !== id));

  const newNote = () => {
    navigate(`/app/notes/${createNote()}`);
  };

  const onCardPointerDown = (event: React.PointerEvent<HTMLDivElement>, noteId: string) => {
    const origin = positions.get(noteId);
    if (!origin) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      noteId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: origin.x,
      originY: origin.y,
      moved: false,
    };
  };

  const onCardPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    setDraggingId(drag.noteId);
    moveNote(drag.noteId, Math.max(0, drag.originX + dx), Math.max(0, drag.originY + dy));
  };

  const onCardPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDraggingId(null);
    if (drag.moved) {
      // Final position: moveNote applied it live; the debounced save pulses once.
      moveNote(
        drag.noteId,
        Math.max(0, drag.originX + (event.clientX - drag.startClientX)),
        Math.max(0, drag.originY + (event.clientY - drag.startClientY)),
      );
    } else {
      navigate(`/app/notes/${drag.noteId}`);
    }
  };

  return (
    <section className="canvas-page" aria-label="Canvas">
      <div className="canvas-stage">
        {CONSTELLATION.map((star) => (
          <span key={`${star.left}-${star.top}`} className="constellation" style={star} aria-hidden="true">
            ✦
          </span>
        ))}

        {notes.length === 0 ? (
          <div className="empty">
            <span className="ghost" aria-hidden="true">✦</span>
            <div className="et">An empty sky</div>
            <div className="ed">Your memories will land here as cards.</div>
            <Button variant="primary" onClick={newNote}>
              New note
            </Button>
          </div>
        ) : (
          <>
            <svg className="canvas-edges" aria-hidden="true">
              {edges.map((edge) => {
                const from = positions.get(edge.from);
                const to = positions.get(edge.to);
                if (!from || !to) return null;
                return (
                  <line
                    key={`${edge.from}~${edge.to}`}
                    x1={from.x + CARD_WIDTH / 2}
                    y1={from.y + CARD_CENTER_Y}
                    x2={to.x + CARD_WIDTH / 2}
                    y2={to.y + CARD_CENTER_Y}
                    stroke="#9AA7C4"
                    strokeOpacity="0.25"
                    strokeWidth="1.5"
                  />
                );
              })}
            </svg>

            {notes.map((note) => {
              const pos = positions.get(note.noteId);
              if (!pos) return null;
              const byAgent = note.author.startsWith('agent');
              const classes = [
                'note',
                byAgent ? 'byagent' : '',
                draggingId === note.noteId ? 'dragging' : '',
                materializedNoteId === note.noteId ? 'materialize' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <div
                  key={note.noteId}
                  className={classes}
                  style={{ left: pos.x, top: pos.y }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${note.title || 'Untitled note'}`}
                  onPointerDown={(event) => onCardPointerDown(event, note.noteId)}
                  onPointerMove={onCardPointerMove}
                  onPointerUp={onCardPointerUp}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      navigate(`/app/notes/${note.noteId}`);
                    }
                  }}
                >
                  {materializedNoteId === note.noteId ? (
                    <span className="glint" aria-hidden="true">✦</span>
                  ) : null}
                  <div className="nt">{note.title || 'Untitled note'}</div>
                  <div className="nb">{excerptOf(note, titles)}</div>
                  {byAgent ? (
                    <div className="agline">
                      <span style={{ color: 'var(--orange-500)', fontSize: 10 }} aria-hidden="true">✧</span>
                      <span className="mono">
                        {name.toLowerCase()} · {shortAge(note.updatedAt)}
                      </span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </>
        )}

        {peers.map((peer) => (
          <PeerCursor key={peer.id} peer={peer} />
        ))}

        <div className="avstack canvas-presence" aria-label={`Mira, ${name} and you are on this board`}>
          <span className="av" style={{ background: 'var(--pink-500)' }}>M</span>
          <span className="av agent" aria-hidden="true">✧</span>
          <span className="av" style={{ background: 'var(--blue-600)' }}>Y</span>
        </div>

        {savingLayout ? (
          <span className="pill pill-ink canvas-saving">
            <span className="spinstar" aria-hidden="true">✦</span> saving layout…
          </span>
        ) : null}

        {notes.length > 0 ? (
          <div className="toolbar canvas-tools" aria-label="Canvas tools">
            <button
              type="button"
              aria-label="Select"
              onClick={() => pushInfo('Select is on its way', 'Multi-select lands with the live canvas.')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 3l7 18 2.5-7.5L20 11Z" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Draw"
              onClick={() => pushInfo('Drawing is on its way', 'Freehand ink lands with the live canvas.')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
            </button>
            <button type="button" aria-label="New note" onClick={newNote}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
            </button>
          </div>
        ) : null}
      </div>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </section>
  );
}
