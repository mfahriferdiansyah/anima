import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { createNote } from '@/hooks/useVault';
import { useVaultSession } from '@/hooks/useVaultSession';
import './home.css';

/* ---------- calendar data (demo week, anchored to June 2026) ---------- */

type EventKind = 'seal' | 'agent' | 'gcal';
interface CalEvent {
  t: string;
  s: number;
  e: number;
  k: EventKind;
  src: string;
  /** Source memory; present only on seals + Nova's notes, so they open their note. */
  note?: string;
}

const TODAY = new Date(2026, 5, 11);

const EVENTS: Record<string, CalEvent[]> = {
  '2026-06-08': [
    { t: 'Seal access control', s: 10, e: 10.5, k: 'seal', src: 'sealed to the vault', note: 'n-seal' },
    { t: 'Pitch narrative', s: 15, e: 15.5, k: 'seal', src: 'sealed to the vault', note: 'n-pitch' },
    { t: 'Team standup', s: 9, e: 9.5, k: 'gcal', src: 'Google Calendar' },
  ],
  '2026-06-09': [
    { t: 'Walrus storage notes', s: 9.5, e: 10.25, k: 'seal', src: 'sealed to the vault', note: 'n-walrus' },
    { t: 'Quilt batching model', s: 14, e: 14.5, k: 'agent', src: 'Nova condensed 3 notes', note: 'n-quilts' },
    { t: 'Demo script outline', s: 16.5, e: 17.5, k: 'seal', src: 'sealed to the vault', note: 'n-demo' },
  ],
  '2026-06-10': [
    { t: 'Standup notes', s: 9, e: 9.5, k: 'agent', src: 'Nova drafted from the week', note: 'n-standup' },
    { t: 'Team standup', s: 9, e: 9.5, k: 'gcal', src: 'Google Calendar' },
    { t: 'Shared sky · live session', s: 15, e: 16, k: 'gcal', src: '2 humans · 1 agent' },
  ],
  '2026-06-11': [
    { t: 'Cafe shortlist', s: 8.5, e: 9, k: 'agent', src: 'Nova sealed while away', note: 'n-lisbon' },
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

const ALLDAY: Record<string, { t: string; n: string; note: string }> = {
  '2026-06-18': { t: 'Top up WAL', n: 'Standup notes, week 24', note: 'n-standup' },
  '2026-06-21': { t: 'Demo day', n: 'Demo script outline', note: 'n-demo' },
  '2026-06-24': { t: 'Fly to Lisbon', n: 'Flight options', note: 'n-flights' },
  '2026-06-28': { t: 'Return flight', n: 'Flight options', note: 'n-flights' },
};

const DAY_NAMES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

type ViewMode = 'week' | 'month';

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/** Monday-anchored start of the week containing d. */
function startOfWeek(d: Date): Date {
  const dow = (d.getDay() + 6) % 7;
  return addDays(d, -dow);
}

function fmtHour(t: number): string {
  const h = Math.floor(t);
  const m = Math.round((t - h) * 60);
  const hr = h <= 12 ? h : h - 12;
  return `${hr}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
}

function CalIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function WeekCalendar() {
  const navigate = useNavigate();
  const [view, setView] = useState<ViewMode>('month');
  const [cursor, setCursor] = useState(() => new Date(2026, 5, 11));
  const [layers, setLayers] = useState({ seal: true, agent: true, gcal: true });
  const scrollRef = useRef<HTMLDivElement>(null);

  // A fresh view or a new week starts at the top of the list.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [view, cursor]);

  const todayKey = dateKey(TODAY);
  const weekStart = startOfWeek(cursor);
  const weekEnd = addDays(weekStart, 6);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const monthLabel = `${cursor.toLocaleString('en', { month: 'long' })} 2026`;
  const weekLabel =
    weekStart.getMonth() === weekEnd.getMonth()
      ? `${weekStart.toLocaleString('en', { month: 'long' })} ${weekStart.getDate()} – ${weekEnd.getDate()}`
      : `${weekStart.toLocaleString('en', { month: 'short' })} ${weekStart.getDate()} – ${weekEnd.toLocaleString('en', { month: 'short' })} ${weekEnd.getDate()}`;
  const headLabel = view === 'week' ? weekLabel : monthLabel;

  const layerOn = (ev: CalEvent) => layers[ev.k];
  const toggleLayer = (k: EventKind) => setLayers((prev) => ({ ...prev, [k]: !prev[k] }));
  const openNote = (note?: string) => {
    if (note) navigate(`/app/notes/${note}`);
  };

  const goToday = () => setCursor(new Date(2026, 5, 11));
  const goPrev = () => setCursor(view === 'week' ? addDays(cursor, -7) : addMonths(cursor, -1));
  const goNext = () => setCursor(view === 'week' ? addDays(cursor, 7) : addMonths(cursor, 1));

  // Month grid: the weeks that contain the cursor's month (Monday-anchored).
  const monthFirst = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const monthStart = startOfWeek(monthFirst);
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const monthWeeks = Math.ceil(((monthFirst.getDay() + 6) % 7 + daysInMonth) / 7);
  const monthCells = Array.from({ length: monthWeeks * 7 }, (_, i) => addDays(monthStart, i));

  const segBtn = (mode: ViewMode, label: string) => (
    <button type="button" className={view === mode ? 'on' : undefined} onClick={() => setView(mode)}>
      {label}
    </button>
  );

  return (
    <div className="pgcal">
      <div className="pgcal-t">
        <div>
          <b>Your schedule</b>
          <span>What happened and what is scheduled, one place. Click a memory to open its source.</span>
        </div>
        <span className="sp" />
        <button type="button" className="pgbtn" onClick={goToday}>
          Today
        </button>
        <button type="button" className="pgcal-nav" aria-label="Previous" onClick={goPrev}>
          <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 1 3 5l4 4" /></svg>
        </button>
        <button type="button" className="pgcal-nav" aria-label="Next" onClick={goNext}>
          <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 1 4 4-4 4" /></svg>
        </button>
        <span className="pgcal-seg">
          {segBtn('week', 'Week')}
          {segBtn('month', 'Month')}
        </span>
      </div>
      <div className="pgcal-h">
        <b>{headLabel}</b>
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

      {view === 'month' ? (
        <div className="pgcal-month-wrap">
          <div className="pgcal-mhead">
            {DAY_NAMES.map((n) => (
              <span key={n}>{n}</span>
            ))}
          </div>
          <div className="pgcal-month" style={{ gridTemplateRows: `repeat(${monthWeeks}, minmax(0, 1fr))` }}>
            {monthCells.map((d, i) => {
              const k = dateKey(d);
              const inMonth = d.getMonth() === cursor.getMonth();
              const isToday = k === todayKey;
              const ad = ALLDAY[k];
              const timed = (EVENTS[k] ?? []).filter(layerOn);
              const items: Array<{ t: string; k: EventKind; note?: string }> = [
                ...(ad ? [{ t: ad.t, k: 'agent' as EventKind, note: ad.note }] : []),
                ...timed.map((ev) => ({ t: ev.t, k: ev.k, note: ev.note })),
              ];
              const shown = items.slice(0, 3);
              const extra = items.length - shown.length;
              return (
                <button
                  type="button"
                  key={i}
                  className={`pgcm-cell${inMonth ? '' : ' dim'}${isToday ? ' tdy' : ''}`}
                  onClick={() => {
                    setCursor(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
                    setView('week');
                  }}
                >
                  <span className="pgcm-d">{d.getDate()}</span>
                  {shown.map((it, j) => (
                    <span
                      key={j}
                      className={`pgcm-ev ${it.k}${it.note ? ' link' : ''}`}
                      onClick={(e) => {
                        if (!it.note) return;
                        e.stopPropagation();
                        openNote(it.note);
                      }}
                    >
                      <i className="cdot" aria-hidden="true" />
                      {it.t}
                    </span>
                  ))}
                  {extra > 0 ? <span className="pgcm-more">+{extra} more</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="pgcal-gridscroll pgag-scroll" ref={scrollRef}>
          <div className="pgag">
            {weekDays.map((d) => {
              const k = dateKey(d);
              const isToday = k === todayKey;
              const ad = ALLDAY[k];
              const evs = (EVENTS[k] ?? []).filter(layerOn).sort((a, b) => a.s - b.s || a.e - b.e);
              const empty = !ad && evs.length === 0;
              return (
                <div key={k} className="pgag-day">
                  <div className={isToday ? 'pgagd tdy' : 'pgagd'}>
                    <span className="dn">{DAY_NAMES[(d.getDay() + 6) % 7]}</span>
                    <span className="dd">
                      {d.toLocaleString('en', { month: 'short' })} {d.getDate()}
                    </span>
                    {isToday ? <span className="tpill">TODAY</span> : null}
                    <span className="hr" />
                  </div>
                  {ad ? (
                    <button type="button" className="pgagrow agent link" title={`plan found in ${ad.n}`} onClick={() => openNote(ad.note)}>
                      <i className="cdot" aria-hidden="true" />
                      <span className="bd">
                        <b>{ad.t}</b>
                        <small>plan from {ad.n}</small>
                      </span>
                      <span className="tm">all day</span>
                      <span className="arr" aria-hidden="true">↗</span>
                    </button>
                  ) : null}
                  {evs.map((ev, i) => (
                    <button
                      type="button"
                      key={i}
                      className={`pgagrow ${ev.k}${ev.note ? ' link' : ''}`}
                      title={`${ev.t} · ${fmtHour(ev.s)} – ${fmtHour(ev.e)}${ev.note ? ' · open source' : ''}`}
                      onClick={() => openNote(ev.note)}
                    >
                      <i className="cdot" aria-hidden="true" />
                      <span className="bd">
                        <b>{ev.t}</b>
                        <small>{ev.src}</small>
                      </span>
                      <span className="tm">{fmtHour(ev.s)}</span>
                      <span className="arr" aria-hidden="true">{ev.note ? '↗' : ''}</span>
                    </button>
                  ))}
                  {empty ? <div className="pgag-empty">Nothing scheduled.</div> : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
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
  const navigate = useNavigate();
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
            <button type="button" key={k} className="plrow" onClick={() => navigate(`/app/notes/${p.note}`)}>
              <span className="pld">JUN {d.getDate()}</span>
              <span className="plt">{p.t}</span>
              <span className="pls">{p.n}</span>
            </button>
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
 * general quick starts, then the calendar — day / week / month, with seals,
 * Nova's work and Google events layered together and a suggestions rail.
 * Memory blocks (and the plans rail) open their source note on click.
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
