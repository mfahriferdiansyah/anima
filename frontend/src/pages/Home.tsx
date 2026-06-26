import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { createNote, useVault } from '@/hooks/useVault';
import { useVaultSession } from '@/hooks/useVaultSession';
import { useAgentTimeline, requestDraft, clearSuggestion, draftPreparedNote } from '@/hooks/useAgentTimeline';
import { acceptSuggestion } from '@/web3/suggest';
import { Modal } from '@/components/Modal';
import { useCalendar, connectCalendar, disconnectCalendar, listEvents, type CalendarEvent } from '@/web3/calendar';
import './home.css';

/* ---------- calendar types ---------- */

type EventKind = 'gcal';
interface CalEvent {
  t: string;
  s: number;
  e: number;
  k: EventKind;
  src: string;
}

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

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

/** Convert a CalendarEvent to a timed CalEvent (s/e = fractional hours, local time). */
function gcalToCalEvent(ev: CalendarEvent): CalEvent {
  const parseHour = (iso: string): number => {
    const d = new Date(iso);
    return d.getHours() + d.getMinutes() / 60;
  };
  return {
    t: ev.title,
    s: parseHour(ev.start),
    e: parseHour(ev.end),
    k: 'gcal',
    src: 'Google Calendar',
  };
}

/** Build event maps keyed by dateKey from live CalendarEvent[]. */
function buildEventMaps(events: CalendarEvent[]): {
  timed: Record<string, CalEvent[]>;
  allDay: Record<string, { t: string }[]>;
} {
  const timed: Record<string, CalEvent[]> = {};
  const allDay: Record<string, { t: string }[]> = {};
  for (const ev of events) {
    const k = dateKey(new Date(ev.allDay ? `${ev.start}T00:00:00` : ev.start));
    if (ev.allDay) {
      (allDay[k] ??= []).push({ t: ev.title });
    } else {
      (timed[k] ??= []).push(gcalToCalEvent(ev));
    }
  }
  return { timed, allDay };
}

/** Relative sync time label ("synced 2m ago", "synced just now", etc.). */
function relativeSyncLabel(lastSyncedAt: string): string {
  const diff = Math.floor((Date.now() - new Date(lastSyncedAt).getTime()) / 1000);
  if (diff < 60) return 'synced just now';
  if (diff < 3600) return `synced ${Math.floor(diff / 60)}m ago`;
  return `synced ${Math.floor(diff / 3600)}h ago`;
}

function WeekCalendar() {
  const calendar = useCalendar();
  const [view, setView] = useState<ViewMode>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // A fresh view or a new week starts at the top of the list.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [view, cursor]);

  const today = new Date();
  const todayKey = dateKey(today);
  const weekStart = startOfWeek(cursor);
  const weekEnd = addDays(weekStart, 6);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const monthLabel = `${cursor.toLocaleString('en', { month: 'long' })} ${cursor.getFullYear()}`;
  const weekLabel =
    weekStart.getMonth() === weekEnd.getMonth()
      ? `${weekStart.toLocaleString('en', { month: 'long' })} ${weekStart.getDate()} – ${weekEnd.getDate()}`
      : `${weekStart.toLocaleString('en', { month: 'short' })} ${weekStart.getDate()} – ${weekEnd.toLocaleString('en', { month: 'short' })} ${weekEnd.getDate()}`;
  const headLabel = view === 'week' ? weekLabel : monthLabel;

  const goToday = () => setCursor(new Date());
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

  const { timed: timedEvents, allDay: allDayEvents } = buildEventMaps(calendar.events);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await connectCalendar();
    } finally {
      setConnecting(false);
    }
  };

  // Re-fetch the next 14 days from Google. A dead token surfaces via listEvents'
  // own 401 → status:'error' path (the indicator then shows Reconnect), so there
  // is no separate error UI here — just the in-flight spinner.
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await listEvents();
    } finally {
      setRefreshing(false);
    }
  };

  // Calendar sync status indicator (three states: connected / error / unconfigured / disconnected)
  const syncIndicator = (() => {
    if (calendar.status === 'connected' && calendar.lastSyncedAt) {
      return (
        <span className="pgcal-g">
          <CalIcon>
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </CalIcon>{' '}
          {relativeSyncLabel(calendar.lastSyncedAt)}
          <button
            type="button"
            className={`pgcal-nav refresh${refreshing ? ' refreshing' : ''}`}
            aria-label="Refresh calendar"
            title="Refresh from Google Calendar"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
          >
            <RefreshIcon />
          </button>
          <button
            type="button"
            className="pgbtn"
            style={{ marginLeft: 2, fontSize: 11 }}
            onClick={() => disconnectCalendar()}
          >
            Disconnect
          </button>
        </span>
      );
    }
    if (calendar.status === 'error') {
      return (
        <span className="pgcal-g">
          <button type="button" className="pgbtn" onClick={() => void handleConnect()} disabled={connecting}>
            {connecting ? 'Reconnecting…' : 'Reconnect Google Calendar'}
          </button>
        </span>
      );
    }
    if (calendar.status === 'unconfigured') {
      return (
        <span className="pgcal-g" style={{ color: 'var(--gray-400)' }}>
          Calendar sync not configured
        </span>
      );
    }
    // disconnected
    return (
      <span className="pgcal-g">
        <button type="button" className="pgbtn" onClick={() => void handleConnect()} disabled={connecting}>
          {connecting ? 'Connecting…' : 'Connect Google Calendar'}
        </button>
      </span>
    );
  })();

  return (
    <div className="pgcal">
      <div className="pgcal-t">
        <div>
          <b>Your schedule</b>
          <span>What happened and what is scheduled, one place.</span>
        </div>
        <span className="sp" />
        <button type="button" className="pgcal-nav" aria-label="Previous" onClick={goPrev}>
          <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 1 3 5l4 4" /></svg>
        </button>
        <button type="button" className="pgcal-nav" aria-label="Next" onClick={goNext}>
          <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 1 4 4-4 4" /></svg>
        </button>
        <button type="button" className="pgbtn" onClick={goToday}>
          Today
        </button>
        <span className="pgcal-seg">
          {segBtn('week', 'Week')}
          {segBtn('month', 'Month')}
        </span>
      </div>
      <div className="pgcal-h">
        <b>{headLabel}</b>
        <span className="sp" />
        <button type="button" className={calendar.status === 'connected' ? 'srcchip on' : 'srcchip'} onClick={() => void handleConnect()}>
          <span className="ld bl" />Google
        </button>
        {syncIndicator}
      </div>

      {view === 'month' ? (
        <div className="pgcal-month-wrap">
          <div className="pgcal-mhead">
            {DAY_NAMES.map((n) => (
              <span key={n}>{n}</span>
            ))}
          </div>
          <div className="pgcal-month">
            {monthCells.map((d, i) => {
              const k = dateKey(d);
              const inMonth = d.getMonth() === cursor.getMonth();
              const isToday = k === todayKey;
              const ads = allDayEvents[k] ?? [];
              const timed = (timedEvents[k] ?? []).sort((a, b) => a.s - b.s);
              const items: Array<{ t: string; k: EventKind }> = [
                ...ads.map((ad) => ({ t: ad.t, k: 'gcal' as EventKind })),
                ...timed.map((ev) => ({ t: ev.t, k: ev.k })),
              ];
              const shown = items.slice(0, 2);
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
                    <span key={j} className={`pgcm-ev ${it.k}`}>
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
              const ads = allDayEvents[k] ?? [];
              const evs = (timedEvents[k] ?? []).sort((a, b) => a.s - b.s || a.e - b.e);
              const empty = ads.length === 0 && evs.length === 0;
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
                  {ads.map((ad, j) => (
                    <div key={j} className="pgagrow gcal">
                      <i className="cdot" aria-hidden="true" />
                      <span className="bd">
                        <b>{ad.t}</b>
                        <small>Google Calendar</small>
                      </span>
                      <span className="tm">all day</span>
                    </div>
                  ))}
                  {evs.map((ev, i) => (
                    <div
                      key={i}
                      className={`pgagrow ${ev.k}`}
                      title={`${ev.t} · ${fmtHour(ev.s)} – ${fmtHour(ev.e)}`}
                    >
                      <i className="cdot" aria-hidden="true" />
                      <span className="bd">
                        <b>{ev.t}</b>
                        <small>{ev.src}</small>
                      </span>
                      <span className="tm">{fmtHour(ev.s)}</span>
                      <span className="arr" aria-hidden="true" />
                    </div>
                  ))}
                  {empty ? (
                    <div className="pgag-empty">
                      {calendar.status === 'disconnected' || calendar.status === 'unconfigured'
                        ? 'Connect Google Calendar to see events.'
                        : 'Nothing scheduled.'}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- suggestions rail ---------- */

function SuggestRail() {
  const navigate = useNavigate();
  const { events, draftRequested, suggestion, prep } = useAgentTimeline();
  const { notes } = useVault();
  const [accepting, setAccepting] = useState(false);
  const [draftingId, setDraftingId] = useState<string | null>(null);
  // Local "ticked" state for the prep checklist (cleared on refresh — the item
  // is handled). The preview is non-interactive, so this only fires in the app.
  const [done, setDone] = useState<Record<string, boolean>>({});

  // "Let Nova draft" → ask /draft for a full prepared note grounded in the prep
  // item + vault + calendar, then open it as an UNSAVED draft for the owner to
  // review and save manually (never auto-sealed). Guarded so rapid clicks can't
  // spawn duplicate notes, with a per-item loading state.
  const draftPrep = async (item: { id: string; title: string }) => {
    if (draftingId) return;
    setDraftingId(item.id);
    let prepared: { title: string; body: string } | null = null;
    try {
      prepared = await draftPreparedNote(item.title);
    } finally {
      setDraftingId(null);
    }
    const id = createNote(undefined, prepared ?? { title: item.title, body: `# ${item.title}\n\n` });
    navigate(`/app/notes/${id}`, { state: { novaDraft: true } });
  };

  // "Recent notes" rail: the live vault notes (already recency-sorted), newest
  // first, each row opens its source note. Real data, never fabricated.
  const recent = notes.slice(0, 6);
  const draftingItem = draftingId ? prep.find((p) => p.id === draftingId) ?? null : null;

  const handleAccept = () => {
    if (!suggestion) return;
    setAccepting(true);
    acceptSuggestion(suggestion);
    setAccepting(false);
  };

  const handleDismiss = () => {
    clearSuggestion();
  };

  return (
    <aside className="pgh6-rail">
      <Modal open={draftingId !== null} onClose={() => {}}>
        <div className="dh pgdraft">
          <div className="spin" aria-hidden="true">✦</div>
          <div className="dt">Nova is drafting{draftingItem ? ` “${draftingItem.title}”` : ''}</div>
          <div className="dd2">
            Pulling your notes, canvas and calendar into a prepared note. It opens in a moment.
          </div>
        </div>
      </Modal>
      <div className="pgh6-sugg">
        {prep.length > 0 ? (
          <>
            <div className="railt railt-hdr">
              <div className="railt-txt">
                <b>Nova suggests</b>
                <span>Preparation she thinks you will thank yourself for. Tick it done, or let her draft it.</span>
              </div>
              <button
                type="button"
                className={`pgcal-nav refresh${draftRequested ? ' refreshing' : ''}`}
                aria-label="Refresh Nova's suggestions"
                title="Ask Nova for fresh suggestions"
                onClick={() => requestDraft()}
                disabled={draftRequested}
              >
                <RefreshIcon />
              </button>
            </div>
            {prep.map((p) => (
              <div key={p.id} className={done[p.id] ? 'sg done' : 'sg'}>
                <label className="sgc">
                  <input
                    type="checkbox"
                    checked={!!done[p.id]}
                    onChange={() => setDone((d) => ({ ...d, [p.id]: !d[p.id] }))}
                  />
                </label>
                <div className="sgb">
                  <b>{p.title}</b>
                  <span>{p.meta}</span>
                  {p.draft ? (
                    <button
                      type="button"
                      className="pgbtn sgd"
                      onClick={() => draftPrep(p)}
                      disabled={draftingId !== null}
                    >
                      {draftingId === p.id ? '✧ Drafting…' : '✧ Let Nova draft'}
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
        <div className="railt railt-hdr">
          <div className="railt-txt">
            <b>Nova suggests</b>
            <span>What she thinks you should do next, drawn from your vault.</span>
          </div>
          <button
            type="button"
            className={`pgcal-nav refresh${draftRequested ? ' refreshing' : ''}`}
            aria-label="Refresh Nova's suggestion"
            title="Ask Nova for a fresh suggestion"
            onClick={() => requestDraft()}
            disabled={draftRequested}
          >
            <RefreshIcon />
          </button>
        </div>

        {suggestion ? (
          <div className="sg">
            <div className="sgb">
              <b>{suggestion.title}</b>
              <span>{suggestion.summary}</span>
              <div className="sact" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="pgbtn primary sgd"
                  onClick={handleAccept}
                  disabled={accepting}
                >
                  {accepting ? 'Adding…' : 'Add to vault'}
                </button>
                <button type="button" className="pgbtn sgd" onClick={handleDismiss}>
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        ) : draftRequested ? (
          <div className="sg">
            <div className="sgb">
              <span style={{ color: 'var(--gray-500)' }}>
                <span aria-hidden="true">✧</span> Nova is thinking…
              </span>
            </div>
          </div>
        ) : events.length === 0 ? (
          <div className="sg">
            <div className="sgb">
              <span style={{ color: 'var(--gray-500)' }}>
                Nova has no suggestions yet — she reads your notes when you chat.
              </span>
            </div>
          </div>
        ) : (
          <>
            <div className="sg">
              <div className="sgb">
                <button type="button" className="pgbtn sgd" onClick={() => requestDraft()}>
                  ✧ Let Nova draft
                </button>
                <span style={{ color: 'var(--gray-500)', marginTop: 4, display: 'block' }}>Ask Nova to propose a next step from your vault.</span>
              </div>
            </div>
            {events.slice(0, 4).map((ev) => (
              <div key={ev.id} className="sg">
                <div className="sgb">
                  <b style={{ fontWeight: 500 }}>{ev.summary}</b>
                  <span style={{ color: 'var(--gray-500)' }}>{ev.at.slice(0, 10)}</span>
                </div>
              </div>
            ))}
          </>
        )}
          </>
        )}
      </div>

      <div className="pgh6-plans">
        <div className="railt">
          <b>Recent notes</b>
          <span>Your latest memories, newest first. Each one opens its source.</span>
        </div>
        {recent.length === 0 ? (
          <span className="pgag-empty" style={{ padding: 0 }}>
            Nothing found yet. Your notes will show here.
          </span>
        ) : (
          recent.map((n) => {
            const d = new Date(n.updatedAt);
            return (
              <button type="button" key={n.noteId} className="plrow" onClick={() => navigate(`/app/notes/${n.noteId}`)}>
                <span className="pld">{MON[d.getMonth()]} {d.getDate()}</span>
                <span className="plt">{n.title || 'Untitled'}</span>
                <span className="pls">{n.tags[0] ?? 'note'}</span>
              </button>
            );
          })
        )}
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
 * general quick starts, then the calendar — week / month view, driven by live
 * Google Calendar events via useCalendar() — and a Nova suggestions rail.
 */
export function Home() {
  const session = useVaultSession();
  const navigate = useNavigate();
  if (session.phase !== 'ready') return null;

  const name = session.agent.name;
  const count = session.index.count;
  const today = new Date();
  const dateLabel = `${DOW[today.getDay()]} ${MON[today.getMonth()]} ${today.getDate()} · ${count} MEMORIES`;

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
