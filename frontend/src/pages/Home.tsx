import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ForceGraph from 'force-graph';
import type { LinkObject, NodeObject } from 'force-graph';
import { Orb } from '@/components/Orb';
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

/* ---------- graph preview (kit section 10, simplified: hover-only, click opens canvas) ---------- */

const NODE_COLORS = { note: '#2F6BFF', leaf: '#4DA2FF', agent: '#FF5C1A' } as const;

interface GraphNode extends NodeObject {
  id: string;
  label: string;
  group: keyof typeof NODE_COLORS;
  val: number;
  labeled: boolean;
}
type GraphLink = LinkObject<GraphNode>;

/** A sim link endpoint is a string id before the engine runs and a node object after. */
function endId(end: GraphLink['source']): string {
  return typeof end === 'object' && end !== null ? String(end.id) : String(end);
}

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
  const labelAll = notes.length <= 12;
  const nodes: GraphNode[] = notes.map((note) => {
    const deg = degree.get(note.noteId) ?? 0;
    const title = note.title || 'Untitled note';
    return {
      id: note.noteId,
      label: title.length > 24 ? `${title.slice(0, 23)}…` : title,
      group: note.author.startsWith('agent') ? 'agent' : deg > 1 ? 'note' : 'leaf',
      val: 2 + deg * 2,
      labeled: labelAll || deg > 1,
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

/** Kit 4-point star for agent nodes (stroke only). */
function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, width: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.24, y - r * 0.24);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x + r * 0.24, y + r * 0.24);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r * 0.24, y + r * 0.24);
  ctx.lineTo(x - r, y);
  ctx.lineTo(x - r * 0.24, y - r * 0.24);
  ctx.closePath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function GraphPreview({ notes }: { notes: Note[] }) {
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const { nodes, links, neighbors } = buildGraphData(notes);
    let hover: string | null = null;
    const openCanvas = () => navigate('/app/canvas');

    const graph = new ForceGraph<GraphNode, GraphLink>(el)
      .width(el.clientWidth)
      .height(el.clientHeight)
      .backgroundColor('rgba(0,0,0,0)')
      .nodeVal('val')
      .nodeLabel(() => '')
      .linkColor((l) => {
        const hot = hover !== null && (endId(l.source) === hover || endId(l.target) === hover);
        if (hot) return 'rgba(58,66,84,.6)';
        return hover ? 'rgba(154,167,196,.07)' : 'rgba(154,167,196,.3)';
      })
      .linkWidth((l) => (hover !== null && (endId(l.source) === hover || endId(l.target) === hover) ? 1.6 : 1))
      .nodeCanvasObjectMode(() => 'replace')
      .nodeCanvasObject((n, ctx, scale) => {
        const r = 3 + Math.sqrt(n.val) * 2;
        const hot = hover === n.id;
        const dim = hover !== null && !hot && !neighbors.get(hover)?.has(n.id);
        ctx.globalAlpha = dim ? 0.16 : 1;
        if (n.group === 'agent') {
          drawStar(ctx, n.x!, n.y!, r * (hot ? 1.25 : 1) + 2, NODE_COLORS.agent, 1.6);
        } else {
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, r * (hot ? 1.25 : 1), 0, 2 * Math.PI);
          ctx.fillStyle = NODE_COLORS[n.group];
          if (hot) {
            ctx.shadowColor = 'rgba(47,107,255,.55)';
            ctx.shadowBlur = 12;
          }
          ctx.fill();
          ctx.shadowBlur = 0;
        }
        if (n.labeled) {
          const fs = Math.max(9 / scale, 3);
          ctx.font = `600 ${fs}px "JetBrains Mono", monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = '#3A4254';
          ctx.fillText(n.label + (n.group === 'agent' ? ' ✧' : ''), n.x!, n.y! + r + 3);
        }
        ctx.globalAlpha = 1;
      })
      .nodePointerAreaPaint((n, color, ctx) => {
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, 9 + Math.sqrt(n.val) * 2, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
      })
      .autoPauseRedraw(false)
      .enableNodeDrag(false)
      .enableZoomInteraction(false)
      .enablePanInteraction(false)
      .onNodeHover((n) => {
        hover = n ? n.id : null;
      })
      .onNodeClick(openCanvas)
      .onBackgroundClick(openCanvas)
      .cooldownTime(8000)
      .graphData({ nodes, links });

    // squishy physics (kit section 10)
    graph.d3Force('charge')?.strength(-260);
    graph.d3Force('link')?.distance(75).strength(0.35);
    graph.d3AlphaDecay(0.014).d3VelocityDecay(0.24);
    // keep the view fitted while the squishy sim settles, then stop refitting
    let settled = false;
    const fit = window.setInterval(() => graph.zoomToFit(180, 28), 450);
    graph.onEngineStop(() => {
      if (settled) return;
      settled = true;
      window.clearInterval(fit);
      graph.zoomToFit(300, 28);
    });
    const ro = new ResizeObserver(() => {
      graph.width(el.clientWidth).height(el.clientHeight);
      graph.zoomToFit(0, 28);
    });
    ro.observe(el);

    return () => {
      window.clearInterval(fit);
      ro.disconnect();
      graph._destructor?.();
    };
  }, [notes, navigate]);

  return (
    <div className="hcard hgraph" ref={boxRef} role="link" aria-label="Open the canvas">
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
