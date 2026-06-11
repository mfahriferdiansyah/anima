import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Orb } from '@/components/Orb';
import { usePresence } from '@/hooks/usePresence';
import { sendOnOpen, useChat } from '@/hooks/useChat';
import { createNote, recentNotes, useVault } from '@/hooks/useVault';
import type { Note } from '@/hooks/useVault';
import { requestDraft, useAgentTimeline } from '@/hooks/useAgentTimeline';
import { useVaultSession } from '@/hooks/useVaultSession';
import './home.css';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function relativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/* ---------- graph preview: the canvas layout rendered as a static constellation ---------- */

const NODE_COLORS = { note: '#2F6BFF', leaf: '#4DA2FF', agent: '#FF5C1A' } as const;

function buildGraphData(notes: Note[]) {
  const ids = new Set(notes.map((note) => note.noteId));
  const links: Array<{ source: string; target: string }> = [];
  const degree = new Map<string, number>();
  const seen = new Set<string>();
  for (const note of notes) {
    for (const target of note.links) {
      if (!ids.has(target) || target === note.noteId) continue;
      const key = [note.noteId, target].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: note.noteId, target });
      degree.set(note.noteId, (degree.get(note.noteId) ?? 0) + 1);
      degree.set(target, (degree.get(target) ?? 0) + 1);
    }
  }
  const nodes = notes.map((note) => {
    const deg = degree.get(note.noteId) ?? 0;
    const title = note.title || 'Untitled note';
    return {
      id: note.noteId,
      label: title.length > 28 ? `${title.slice(0, 27)}…` : title,
      group: (note.author.startsWith('agent') ? 'agent' : deg > 1 ? 'note' : 'leaf') as keyof typeof NODE_COLORS,
      r: Math.min(5 + deg * 1.6, 11),
    };
  });
  const neighbors = new Map<string, Set<string>>();
  for (const link of links) {
    if (!neighbors.has(link.source)) neighbors.set(link.source, new Set());
    if (!neighbors.has(link.target)) neighbors.set(link.target, new Set());
    neighbors.get(link.source)!.add(link.target);
    neighbors.get(link.target)!.add(link.source);
  }
  return { nodes, links, neighbors };
}

/** Kit 4-point star path for agent nodes, centered at (x, y). */
function starPath(x: number, y: number, r: number): string {
  return [
    `M ${x} ${y - r}`,
    `L ${x + r * 0.24} ${y - r * 0.24}`,
    `L ${x + r} ${y}`,
    `L ${x + r * 0.24} ${y + r * 0.24}`,
    `L ${x} ${y + r}`,
    `L ${x - r * 0.24} ${y + r * 0.24}`,
    `L ${x - r} ${y}`,
    `L ${x - r * 0.24} ${y - r * 0.24}`,
    'Z',
  ].join(' ');
}

const VB_W = 860;
const VB_H = 240;
const VB_PAD = 40;

function GraphPreview({ notes }: { notes: Note[] }) {
  const navigate = useNavigate();
  const { layout } = usePresence();
  const [hover, setHover] = useState<string | null>(null);

  const { nodes, links, neighbors } = buildGraphData(notes);
  const placed = nodes.filter((n) => layout[n.id]);
  if (placed.length === 0) return null;

  // map the canvas layout into the preview viewBox: this previews the real constellation
  const xs = placed.map((n) => layout[n.id].x);
  const ys = placed.map((n) => layout[n.id].y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const px = (x: number) => VB_PAD + ((x - minX) / Math.max(maxX - minX, 1)) * (VB_W - VB_PAD * 2);
  const py = (y: number) => VB_PAD + ((y - minY) / Math.max(maxY - minY, 1)) * (VB_H - VB_PAD * 2);
  const pos = new Map(placed.map((n) => [n.id, { x: px(layout[n.id].x), y: py(layout[n.id].y) }]));

  const dimmed = (id: string) => hover !== null && hover !== id && !neighbors.get(hover)?.has(id);
  const hovered = hover ? placed.find((n) => n.id === hover) : null;
  const hoverPos = hover ? pos.get(hover) : null;

  return (
    <div
      className="hcard hgraph"
      role="link"
      aria-label="Open the canvas"
      onClick={() => navigate('/app/canvas')}
      onMouseLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid meet">
        {links.map((l) => {
          const a = pos.get(l.source);
          const b = pos.get(l.target);
          if (!a || !b) return null;
          const hot = hover === l.source || hover === l.target;
          const faded = hover !== null && !hot;
          return (
            <line
              key={`${l.source}|${l.target}`}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={hot ? 'rgba(58,66,84,.55)' : 'rgba(154,167,196,.35)'}
              strokeWidth={hot ? 1.6 : 1.1}
              opacity={faded ? 0.18 : 1}
            />
          );
        })}
        {placed.map((n) => {
          const p = pos.get(n.id)!;
          const hot = hover === n.id;
          const r = n.r * (hot ? 1.25 : 1);
          return (
            <g
              key={n.id}
              opacity={dimmed(n.id) ? 0.18 : 1}
              onMouseEnter={() => setHover(n.id)}
              style={{ transition: 'opacity 180ms ease' }}
            >
              {n.group === 'agent' ? (
                <path d={starPath(p.x, p.y, r + 3)} fill="none" stroke={NODE_COLORS.agent} strokeWidth={1.8} strokeLinejoin="round" />
              ) : (
                <circle cx={p.x} cy={p.y} r={r} fill={NODE_COLORS[n.group]} />
              )}
            </g>
          );
        })}
        {hovered && hoverPos && (
          <text
            x={Math.min(Math.max(hoverPos.x, 90), VB_W - 90)}
            y={hoverPos.y > VB_H - 36 ? hoverPos.y - hovered.r - 10 : hoverPos.y + hovered.r + 16}
            textAnchor="middle"
            fontFamily="'JetBrains Mono', monospace"
            fontSize="11"
            fontWeight="600"
            fill="#3A4254"
          >
            {hovered.label}{hovered.group === 'agent' ? ' ✧' : ''}
          </text>
        )}
      </svg>
      <span className="hgraph-hint">click to open canvas</span>
    </div>
  );
}

/* ---------- quick-start row ---------- */

function QuickIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/* ---------- page ---------- */

/**
 * The living dashboard (R6/R7): hero strip with the orb and the latest
 * companion activity, a graph preview of the vault, quick starts, and
 * recents. First run drops the graph and recents and leads with hello.
 */
export function Home() {
  const session = useVaultSession();
  const chat = useChat();
  const { notes } = useVault();
  const { events } = useAgentTimeline();
  const navigate = useNavigate();
  const [ask, setAsk] = useState('');

  if (session.phase !== 'ready') return null;
  const name = session.agent.name;
  const latest = events[0];
  const empty = notes.length === 0;
  const recents = recentNotes(notes, 5);

  const submitAsk = (event: FormEvent) => {
    event.preventDefault();
    if (!ask.trim()) return;
    sendOnOpen(ask);
    setAsk('');
  };

  const newNote = () => {
    const noteId = createNote();
    navigate(`/app/notes/${noteId}`);
  };

  const letDraft = () => {
    requestDraft();
    navigate('/app/notes');
  };

  return (
    <section className="home">
      <div className="hcard hhero">
        <div className="hhero-top">
          <Orb size="md" working={chat.thinking} label={chat.thinking ? `${name} is working` : `${name} is idle`} />
          <div>
            <h1 className="hgreet">{greeting()}</h1>
            {empty || !latest ? (
              <p className="hactivity">Say hello and start your first memory</p>
            ) : (
              <p className="hactivity">
                <span className="glyph" aria-hidden="true">✧</span>
                {latest.summary} · <Link to="/app/notes">view changes</Link>
              </p>
            )}
          </div>
        </div>
        <form className="hask" onSubmit={submitAsk}>
          <input
            type="text"
            value={ask}
            onChange={(event) => setAsk(event.target.value)}
            placeholder={`Ask ${name} anything`}
            aria-label={`Ask ${name}`}
          />
          <button type="submit" aria-label="Send" disabled={!ask.trim()}>
            ➤
          </button>
        </form>
      </div>

      {!empty ? (
        <div>
          <div className="hlabel">Memory graph</div>
          <GraphPreview notes={notes} />
        </div>
      ) : null}

      <div>
        <div className="hlabel">Quick start</div>
        <div className="hquick">
          <button type="button" className="hqcard" onClick={newNote}>
            <QuickIcon>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
              <path d="M12 12v6" />
              <path d="M9 15h6" />
            </QuickIcon>
            <span className="qt">New note</span>
            <span className="qd">Start a fresh memory and seal it when ready</span>
          </button>
          <button type="button" className="hqcard" onClick={() => navigate('/app/canvas')}>
            <QuickIcon>
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </QuickIcon>
            <span className="qt">Open canvas</span>
            <span className="qd">See your memories laid out as a constellation</span>
          </button>
          <button type="button" className="hqcard" onClick={letDraft}>
            <QuickIcon>
              <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
            </QuickIcon>
            <span className="qt">Let {name} draft</span>
            <span className="qd">{name} suggests a draft for you in notes</span>
          </button>
        </div>
        {empty ? (
          <div className="empty">
            <span className="ghost" aria-hidden="true">✦</span>
            <div className="et">No memories yet</div>
            <div className="ed">Ask {name} anything or start a note. Everything you keep is sealed to your vault.</div>
          </div>
        ) : null}
      </div>

      {recents.length > 0 ? (
        <div>
          <div className="hlabel">Recent memories</div>
          <div className="hcard hrecents">
            {recents.map((note) => (
              <button
                key={note.noteId}
                type="button"
                className="hrow"
                onClick={() => navigate(`/app/notes/${note.noteId}`)}
              >
                <span className="ht">{note.title || 'Untitled note'}</span>
                {note.author.startsWith('agent') ? (
                  <span className="hg" title={`Written by ${name}`} aria-label={`Written by ${name}`}>✧</span>
                ) : null}
                <span className="hage">{relativeTime(note.updatedAt)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
