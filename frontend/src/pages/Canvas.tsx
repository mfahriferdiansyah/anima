import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { createNote, useVault } from '@/hooks/useVault';
import type { Note } from '@/hooks/useVault';
import { moveNote, startPresence, stopPresence, usePresence } from '@/hooks/usePresence';
import type { Peer } from '@/hooks/usePresence';
import { scheduleAgentNote } from '@/hooks/useAgentTimeline';
import { useVaultSession } from '@/hooks/useVaultSession';

const CARD_WIDTH = 190;
/** Edge endpoints aim at the card's visual middle (title + two excerpt lines). */
const CARD_CENTER_Y = 44;
const DRAG_THRESHOLD_PX = 4;

/** Kit .aged format. */
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

function ToolIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const DECOR_TOOLS: Array<{ id: string; label: string; icon: ReactNode }> = [
  { id: 'select', label: 'Select', icon: <ToolIcon><path d="M5 3l14 7-6.5 1.5L9 18z" /></ToolIcon> },
  { id: 'hand', label: 'Pan', icon: <ToolIcon><path d="M18 11V6a2 2 0 0 0-4 0v5" /><path d="M14 10V4a2 2 0 0 0-4 0v6" /><path d="M10 10.5V6a2 2 0 0 0-4 0v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" /></ToolIcon> },
  { id: 'draw', label: 'Draw', icon: <ToolIcon><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></ToolIcon> },
  { id: 'arrow', label: 'Arrow', icon: <ToolIcon><line x1="5" y1="19" x2="19" y2="5" /><polyline points="9 5 19 5 19 15" /></ToolIcon> },
  { id: 'shape', label: 'Shape', icon: <ToolIcon><rect x="3" y="3" width="18" height="18" rx="2" /></ToolIcon> },
  { id: 'text', label: 'Text', icon: <ToolIcon><polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /></ToolIcon> },
];

function PeerCursor({ peer }: { peer: Peer }) {
  const style = { transform: `translate(${peer.x}px, ${peer.y}px)` };
  if (peer.kind === 'human') {
    return (
      <div className="pgcv-cursor human" style={style} aria-hidden="true">
        <svg viewBox="0 0 24 24"><path fill="#FF4D8D" d="M5 3l14 7-6.5 1.5L9 18z" /></svg>
        <span>{peer.label}</span>
      </div>
    );
  }
  return (
    <div className="pgcv-cursor agent" style={style} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="#FF5C1A" strokeWidth="2" strokeLinejoin="round">
        <path d="M12 3l1.9 5.7L19.6 10.6l-5.7 1.9L12 18.2l-1.9-5.7L4.4 10.6l5.7-1.9Z" />
      </svg>
      <span>
        ✧ {peer.label.toLowerCase()}
        {peer.isWriting ? <i> · is writing…</i> : null}
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
 * The shared sky (spec #page-canvas): memory cards on constellation paper,
 * faint link edges, live human + agent cursors, the Excalidraw toolbar
 * (decorative except drag + recall), and the saving whisper. Layout writes
 * go through moveNote, which debounces the mock save and pulses the pill.
 */
export function Canvas() {
  const session = useVaultSession();
  const navigate = useNavigate();
  const { notes } = useVault();
  const { peers, layout, savingLayout, materializedNoteId } = usePresence();
  const dragRef = useRef<DragState | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [tool, setTool] = useState('select');

  useEffect(() => {
    startPresence();
    return () => stopPresence();
  }, []);

  const titles = useMemo(() => {
    const map = new Map<string, string>();
    for (const note of notes) map.set(note.noteId, note.title || 'Untitled note');
    return map;
  }, [notes]);

  // Notes without a stored position (e.g. chat drafts) cascade near the top-left.
  // The fixture layout was authored for a wider board; scale it down to fit so
  // far-right cards don't clip the viewport (desktop-first).
  const positions = useMemo(() => {
    const TARGET_W = 1140;
    const TARGET_H = 660;
    const raw = new Map<string, { x: number; y: number }>();
    let cascade = 0;
    for (const note of notes) {
      const stored = layout[note.noteId];
      if (stored) {
        raw.set(note.noteId, stored);
      } else {
        raw.set(note.noteId, { x: 60 + cascade * 32, y: 60 + cascade * 32 });
        cascade += 1;
      }
    }
    let maxRight = 0;
    let maxBottom = 0;
    for (const p of raw.values()) {
      maxRight = Math.max(maxRight, p.x + CARD_WIDTH);
      maxBottom = Math.max(maxBottom, p.y + 110);
    }
    const scale = Math.min(1, TARGET_W / maxRight, TARGET_H / maxBottom);
    if (scale >= 1) return raw;
    const scaled = new Map<string, { x: number; y: number }>();
    for (const [id, p] of raw) scaled.set(id, { x: Math.round(p.x * scale), y: Math.round(p.y * scale) });
    return scaled;
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

  const newNote = () => navigate(`/app/notes/${createNote()}`);

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
    <div className="pged">
      <div className="pged-top">
        <span className="pgcrumb">
          <b>Canvas</b> · shared board
        </span>
        <span className="sp" />
        {savingLayout ? (
          <span className="pgcv-save">
            <span className="spin" aria-hidden="true">✦</span> saving layout…
          </span>
        ) : null}
        <button type="button" className="pgbtn">
          Share board
        </button>
      </div>
      <div className="pgcv">
        <svg className="pgcv-edges" aria-hidden="true">
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
                strokeOpacity="0.3"
                strokeWidth="1"
              />
            );
          })}
        </svg>

        <div className="pgcv-avs" aria-label={`Mira, ${name} and you are on this board`}>
          <span className="av m">M</span>
          <span className="av n" aria-hidden="true">✧</span>
          <span className="av y">Y</span>
        </div>

        {peers.map((peer) => (
          <PeerCursor key={peer.id} peer={peer} />
        ))}

        {notes.map((note) => {
          const pos = positions.get(note.noteId);
          if (!pos) return null;
          const byAgent = note.author.startsWith('agent');
          const classes = [
            'pgcv-note',
            byAgent ? 'byagent2' : '',
            draggingId === note.noteId ? 'drag2' : '',
            materializedNoteId === note.noteId ? 'pop2' : '',
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
              <div className="nt3">{note.title || 'Untitled note'}</div>
              <div className="nb3">{excerptOf(note, titles)}</div>
              {byAgent ? (
                <div className="na3">
                  <i>✧ {name.toLowerCase()} · {shortAge(note.updatedAt)}</i>
                </div>
              ) : null}
            </div>
          );
        })}

        <div className="pgcv-tools" aria-label="Canvas tools">
          {DECOR_TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tool === t.id ? 'on' : undefined}
              aria-label={t.label}
              onClick={() => setTool(t.id)}
            >
              {t.icon}
            </button>
          ))}
          <span className="tsep" />
          <button type="button" aria-label="New note card" onClick={newNote}>
            <ToolIcon>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </ToolIcon>
          </button>
          <button type="button" className="recall" onClick={() => scheduleAgentNote()}>
            <span aria-hidden="true">✧</span> Recall
          </button>
        </div>
      </div>
    </div>
  );
}
