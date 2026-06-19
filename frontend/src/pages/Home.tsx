import { useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { createNote } from '@/hooks/useVault';
import { useVaultSession } from '@/hooks/useVaultSession';

/* ---------- calendar data (demo week, anchored to June 2026) ---------- */

type EventKind = 'seal' | 'agent' | 'gcal';
interface CalEvent {
  t: string;
  s: number;
  e: number;
  k: EventKind;
  src: string;
}

const TODAY = new Date(2026, 5, 11);
const DAY = 86400000;
const H0 = 8;
const H1 = 18;
const PX = 52;
const GRID_H = (H1 - H0) * PX;

const EVENTS: Record<string, CalEvent[]> = {
  '2026-06-08': [
    { t: 'Seal access control', s: 10, e: 10.5, k: 'seal', src: 'sealed to the vault' },
    { t: 'Pitch narrative', s: 15, e: 15.5, k: 'seal', src: 'sealed to the vault' },
    { t: 'Team standup', s: 9, e: 9.5, k: 'gcal', src: 'Google Calendar' },
  ],
  '2026-06-09': [
    { t: 'Walrus storage notes', s: 9.5, e: 10.25, k: 'seal', src: 'sealed to the vault' },
    { t: 'Quilt batching model ✧', s: 14, e: 14.5, k: 'agent', src: 'Nova condensed 3 notes' },
    { t: 'Demo script outline', s: 16.5, e: 17.5, k: 'seal', src: 'sealed to the vault' },
  ],
  '2026-06-10': [
    { t: 'Standup notes ✧', s: 9, e: 9.5, k: 'agent', src: 'Nova drafted from the week' },
    { t: 'Team standup', s: 9, e: 9.5, k: 'gcal', src: 'Google Calendar' },
    { t: 'Shared sky · live session', s: 15, e: 16, k: 'gcal', src: '2 humans · 1 agent' },
  ],
  '2026-06-11': [
    { t: 'Cafe shortlist ✧', s: 8.5, e: 9, k: 'agent', src: 'Nova sealed while away' },
    { t: 'Dentist', s: 13, e: 14, k: 'gcal', src: 'Google Calendar' },
  ],
  '2026-06-12': [
    { t: 'Team standup', s: 9, e: 9.5, k: 'gcal', src: 'Google Calendar' },
    { t: 'Lisbon planning call', s: 15, e: 16, k: 'gcal', src: 'Google Calendar' },
  ],
  '2026-06-15': [{ t: 'Team standup', s: 9, e: 9.5, k: 'gcal', src: 'Google Calendar' }],
  '2026-06-17': [{ t: 'Slides review w/ Mira', s: 14, e: 15, k: 'gcal', src: 'Google Calendar' }],
  '2026-06-19': [{ t: 'Team standup', s: 9, e: 9.5, k: 'gcal', src: 'Google Calendar' }],
};

const ALLDAY: Record<string, { t: string; n: string }> = {
  '2026-06-18': { t: 'Top up WAL', n: 'Standup notes, week 24' },
  '2026-06-21': { t: 'Demo day', n: 'Demo script outline' },
  '2026-06-24': { t: 'Fly to Lisbon', n: 'Flight options' },
  '2026-06-28': { t: 'Return flight', n: 'Flight options' },
};

const DAY_NAMES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtHour(t: number): string {
  const h = Math.floor(t);
  const m = Math.round((t - h) * 60);
  const hr = h <= 12 ? h : h - 12;
  return `${hr}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
}

/** Interval-graph column layout so overlapping events split width within their cluster. */
function placeEvents(evs: CalEvent[]): Array<CalEvent & { col: number; total: number }> {
  const sorted = [...evs].sort((a, b) => a.s - b.s || a.e - b.e);
  const out: Array<CalEvent & { col: number; total: number }> = [];
  let cluster: CalEvent[] = [];
  let clusterEnd = -1;
  const flush = () => {
    if (!cluster.length) return;
    const colEnds: number[] = [];
    const placed = cluster.map((ev) => {
      let col = colEnds.findIndex((end) => end <= ev.s);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(ev.e);
      } else {
        colEnds[col] = ev.e;
      }
      return { ev, col };
    });
    const total = colEnds.length;
    placed.forEach((p) => out.push({ ...p.ev, col: p.col, total }));
    cluster = [];
    clusterEnd = -1;
  };
  for (const ev of sorted) {
    if (cluster.length && ev.s < clusterEnd) {
      cluster.push(ev);
      clusterEnd = Math.max(clusterEnd, ev.e);
    } else {
      flush();
      cluster = [ev];
      clusterEnd = ev.e;
    }
  }
  flush();
  return out;
}

function CalIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function WeekCalendar() {
  const [weekStart, setWeekStart] = useState(() => new Date(2026, 5, 8));
  const [layers, setLayers] = useState({ seal: true, agent: true, gcal: true });

  const monthLabel = `${weekStart.toLocaleString('en', { month: 'long' })} 2026`;
  const todayKey = dateKey(TODAY);
  const cols = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * DAY));
  const adActive = cols.some((d) => ALLDAY[dateKey(d)]);
  const tIdx = Math.round((TODAY.getTime() - weekStart.getTime()) / DAY);

  const toggleLayer = (k: EventKind) => setLayers((prev) => ({ ...prev, [k]: !prev[k] }));

  return (
    <div className="pgcal">
      <div className="pgcal-t">
        <div>
          <b>Your week</b>
          <span>What happened and what is scheduled, one grid. Click any block to open its source.</span>
        </div>
        <span className="sp" />
        <button type="button" className="pgbtn" onClick={() => setWeekStart(new Date(2026, 5, 8))}>
          Today
        </button>
        <button type="button" className="pgcal-nav" aria-label="Previous week" onClick={() => setWeekStart(new Date(weekStart.getTime() - 7 * DAY))}>
          <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 1 3 5l4 4" /></svg>
        </button>
        <button type="button" className="pgcal-nav" aria-label="Next week" onClick={() => setWeekStart(new Date(weekStart.getTime() + 7 * DAY))}>
          <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 1 4 4-4 4" /></svg>
        </button>
        <span className="pgcal-seg">
          <button type="button">Day</button>
          <button type="button" className="on">Week</button>
          <button type="button">Month</button>
        </span>
      </div>
      <div className="pgcal-h">
        <b>{monthLabel}</b>
        <span className="sp" />
        <button type="button" className={layers.seal ? 'srcchip on' : 'srcchip'} onClick={() => toggleLayer('seal')}>
          <span className="ld tl" />Seals
        </button>
        <button type="button" className={layers.agent ? 'srcchip on' : 'srcchip'} onClick={() => toggleLayer('agent')}>
          <span className="ld or" />Nova
        </button>
        <button type="button" className={layers.gcal ? 'srcchip on' : 'srcchip'} onClick={() => toggleLayer('gcal')}>
          <span className="ld bl" />Google
        </button>
        <span className="pgcal-g">
          <CalIcon>
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </CalIcon>{' '}
          synced 2m ago
        </span>
      </div>
      <div className="pgcal-scroll">
      <div className="pgcal-days">
        <span />
        {cols.map((d, i) => (
          <span key={i} className={dateKey(d) === todayKey ? 'dcell tdy' : 'dcell'}>
            {DAY_NAMES[i]} <b>{d.getDate()}</b>
          </span>
        ))}
      </div>
      <div className={adActive ? 'pgcal-allday' : 'pgcal-allday empty'}>
        <span className="adlbl">ALL DAY</span>
        {cols.map((d, i) => {
          const ad = ALLDAY[dateKey(d)];
          return (
            <div key={i}>
              {ad ? (
                <span className="adchip" style={{ display: 'block' }} title={`plan found in ${ad.n}`}>
                  <i>✧</i>
                  {ad.t}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="pgcal-grid" style={{ height: GRID_H }}>
        <div style={{ position: 'relative' }}>
          {Array.from({ length: H1 - H0 }, (_, idx) => {
            const h = H0 + idx;
            return (
              <div key={h} className="hlbl" style={{ position: 'absolute', top: idx * PX, right: 8 }}>
                {(h <= 12 ? h : h - 12) + (h < 12 ? ' AM' : ' PM')}
              </div>
            );
          })}
        </div>
        {cols.map((d, i) => {
          const k = dateKey(d);
          const isToday = k === todayKey;
          const events = placeEvents((EVENTS[k] ?? []).filter((ev) => layers[ev.k]));
          return (
            <div key={i} className={isToday ? 'gcol tdy' : 'gcol'} style={{ position: 'relative', height: GRID_H }}>
              {Array.from({ length: H1 - H0 - 1 }, (_, idx) => (
                <div key={idx} className="hline" style={{ top: (idx + 1) * PX }} />
              ))}
              {events.map((ev, idx) => {
                const top = (ev.s - H0) * PX;
                const height = Math.max((ev.e - ev.s) * PX - 3, 18);
                const tall = (ev.e - ev.s) * PX >= 42;
                const width = 100 / ev.total;
                return (
                  <div
                    key={idx}
                    className={`cev ${ev.k}`}
                    style={{ top, height, left: `calc(${ev.col * width}% + 2px)`, width: `calc(${width}% - 4px)` }}
                    title={`${ev.t} · ${fmtHour(ev.s)} – ${fmtHour(ev.e)}`}
                  >
                    <b>{ev.t}</b>
                    {tall ? <small>{fmtHour(ev.s)} – {fmtHour(ev.e)}</small> : null}
                  </div>
                );
              })}
            </div>
          );
        })}
        {tIdx >= 0 && tIdx < 7 ? <div className="nowline2" style={{ top: (11.4 - H0) * PX, left: 52, right: 0 }} /> : null}
      </div>
      </div>
    </div>
  );
}

/* ---------- suggestions + plans rail ---------- */

interface Suggestion {
  id: string;
  title: string;
  meta: string;
  draft: boolean;
}

const SUGGESTIONS: Suggestion[] = [
  { id: 'slides', title: 'Draft the demo day slides', meta: 'Demo day · Jun 21 · 9 days out', draft: true },
  { id: 'call', title: 'Prep questions for the Lisbon call', meta: 'tomorrow 15:00 · from Google Calendar', draft: true },
  { id: 'wal', title: 'Top up WAL before the trip', meta: 'balance covers about 3 weeks', draft: false },
];

function SuggestRail() {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const mark = (id: string) => setDone((prev) => ({ ...prev, [id]: true }));

  return (
    <aside className="pgh6-rail">
      <div className="pgh6-sugg">
        <div className="railt">
          <b>Nova suggests</b>
          <span>Preparation she thinks you will thank yourself for. Tick it done, or let her draft it.</span>
        </div>
        {SUGGESTIONS.map((s) => (
          <div key={s.id} className={done[s.id] ? 'sg done' : 'sg'}>
            <label className="sgc">
              <input type="checkbox" checked={!!done[s.id]} onChange={() => setDone((p) => ({ ...p, [s.id]: !p[s.id] }))} />
            </label>
            <div className="sgb">
              <b>{s.title}</b>
              <span>{s.meta}</span>
              {s.draft ? (
                <button type="button" className="pgbtn sgd" onClick={() => mark(s.id)}>
                  ✧ Let Nova draft
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <div className="pgh6-plans">
        <div className="railt">
          <b>Plans she found</b>
          <span>Dates pulled from your own notes. Each one opens its source.</span>
        </div>
        {Object.entries(ALLDAY).map(([k, p]) => {
          const d = new Date(`${k}T00:00:00`);
          return (
            <div key={k} className="plrow">
              <span className="pld">JUN {d.getDate()}</span>
              <span className="plt">{p.t}</span>
              <span className="pls">{p.n}</span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/* ---------- page ---------- */

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Home: the week, remembered and suggested (spec #page-home). Greeting, three
 * general quick starts, then the calendar where seals (teal), Nova's work
 * (orange) and Google events (blue) land together, with a suggestions rail.
 */
export function Home() {
  const session = useVaultSession();
  const navigate = useNavigate();
  if (session.phase !== 'ready') return null;

  const name = session.agent.name;
  const count = session.index.count;
  const dateLabel = `${DOW[TODAY.getDay()]} ${MON[TODAY.getMonth()]} ${TODAY.getDate()} · ${count} MEMORIES`;

  const newNote = () => {
    const id = createNote();
    navigate(`/app/notes/${id}`);
  };

  return (
    <div className="pged pghpaper">
      <div className="pged-scroll">
        <div className="pghcol6">
          <div className="pgh5-hello">
            <span className="gorb" aria-hidden="true">✦</span>
            <div>
              <h2>{greeting()}</h2>
              <p className="pgh5-sub">Here is your week, as the vault remembers it.</p>
            </div>
            <span className="pgh5-date">{dateLabel}</span>
          </div>

          <div className="pgh-quick pgh6-quick">
            <button type="button" onClick={newNote}>
              <CalIcon>
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="12" x2="12" y2="18" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </CalIcon>
              <b>New note</b>
              <span>A fresh memory, sealed when ready</span>
            </button>
            <button type="button" onClick={() => navigate('/app/canvas')}>
              <CalIcon>
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </CalIcon>
              <b>Open canvas</b>
              <span>The constellation, live</span>
            </button>
            <button type="button" onClick={() => navigate('/app/companion')}>
              <CalIcon>
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
              </CalIcon>
              <b>Chat with {name}</b>
              <span>She reads the vault before answering</span>
            </button>
          </div>

          <div className="pgh6">
            <WeekCalendar />
            <SuggestRail />
          </div>
        </div>
      </div>
    </div>
  );
}
