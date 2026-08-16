import { useMemo, useState } from 'react';
import { type SessionId, type SessionProjection } from '@ferrum/domain';
import { useIsScrolled } from '../../platform/use-scrolled.ts';
import { listSessions } from '../../db/event-store.ts';
import { purgeSession, restoreSession } from '../../data/session-controller.ts';
import { sessionDisplayTitle } from './session-view.ts';
import { mono, button } from '../../ui.ts';
import { useLiveData } from '../../components/live-data.ts';

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function formatEntryDate(millis: number): string {
  const d = new Date(millis);
  const day = DAYS[d.getDay()];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `${day}, ${dd}.${mm}.${yy}`;
}

function toLocalDayKey(millis: number): string {
  const d = new Date(millis);
  return `${String(d.getFullYear())}-${String(d.getMonth())}-${String(d.getDate())}`;
}

function toMonthKey(millis: number): string {
  const d = new Date(millis);
  return `${String(d.getFullYear())}-${String(d.getMonth())}`;
}

function monthLabel(key: string): string {
  const [, monthStr] = key.split('-');
  return MONTHS[parseInt(monthStr ?? '0', 10)] ?? 'JAN';
}

/** Count workouts per calendar month (last 8 months) for bar chart. */
function buildMonthlyBars(sessions: readonly SessionProjection[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  const now = new Date();
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    counts.set(`${String(d.getFullYear())}-${String(d.getMonth())}`, 0);
  }
  for (const s of sessions) {
    if (s.session?.startedAt == null) continue;
    const key = toMonthKey(s.session.startedAt);
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([key, count]) => ({ label: monthLabel(key), count }));
}

type ListItem =
  | { type: 'session'; projection: SessionProjection }
  | { type: 'rest' }
  | { type: 'monthHeader'; label: string; count: number };

function buildListItems(live: readonly SessionProjection[]): ListItem[] {
  if (live.length === 0) return [];
  // Sorted newest first, already from DB
  const items: ListItem[] = [];
  let prevMonthKey = '';
  let prevDayKey = '';

  for (let i = 0; i < live.length; i++) {
    const s = live[i];
    if (s == null) continue;
    const ts = s.session?.startedAt ?? 0;
    const monthKey = toMonthKey(ts);
    const dayKey = toLocalDayKey(ts);

    // Month header on change
    if (monthKey !== prevMonthKey) {
      const monthCount = live.filter(p => p.session?.startedAt != null && toMonthKey(p.session.startedAt) === monthKey).length;
      items.push({ type: 'monthHeader', label: monthLabel(monthKey), count: monthCount });
      prevMonthKey = monthKey;
      prevDayKey = '';
    }

    // REST DAY if there's a day gap within same month
    if (prevDayKey !== '' && prevDayKey !== dayKey) {
      items.push({ type: 'rest' });
    }

    items.push({ type: 'session', projection: s as SessionProjection });
    prevDayKey = dayKey;
  }
  return items;
}

export function HistoryScreen({
  onHome,
  onOpenSession,
}: {
  onHome: () => void;
  onOpenSession: (sessionId: SessionId) => void;
}) {
  void onHome;
  const sessions = useLiveData(listSessions);
  const [showDeleted, setShowDeleted] = useState(false);

  const live = useMemo(() => sessions?.filter(p => p.session?.deleted !== true) ?? [], [sessions]);
  const deleted = useMemo(() => sessions?.filter(p => p.session?.deleted === true) ?? [], [sessions]);
  const bars = useMemo(() => buildMonthlyBars(live), [live]);
  const listItems = useMemo(() => buildListItems(live), [live]);
  const maxBar = Math.max(...bars.map(b => b.count), 1);
  const scrolled = useIsScrolled();

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col px-4" data-testid="history">
      <div className="sticky top-0 z-10 bg-ingot pt-6 pb-3">
        <h1 className="title-outline font-display text-[44px] uppercase leading-none">
          History
        </h1>
      </div>
      {/* Gradient fade below sticky title */}
      <div className="pointer-events-none sticky top-[80px] z-[9] overflow-visible" style={{ height: 0 }} aria-hidden>
        <div className={`h-22 w-full bg-gradient-to-b from-black to-transparent transition-opacity duration-300 ${scrolled ? 'opacity-100' : 'opacity-0'}`} />
      </div>

      {/* Monthly bar chart */}
      {live.length > 0 && (
        <div className="mt-4 flex items-end gap-1" style={{ height: 56 }}>
          {bars.map(({ label, count }) => (
            <div key={label} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t-sm bg-plate-red/70"
                style={{ height: count === 0 ? 2 : Math.max(4, Math.round((count / maxBar) * 44)) }}
              />
              <span className={mono({ className: 'text-[14px] text-ash' })}>{label}</span>
            </div>
          ))}
        </div>
      )}

      {sessions == null ? (
        <p className="mt-6 text-ash">Loading…</p>
      ) : live.length === 0 && deleted.length === 0 ? (
        <p className="mt-6 text-ash" data-testid="history-empty">No sessions yet.</p>
      ) : (
        <ul className="mt-4 flex flex-col" data-testid="history-list">
          {listItems.map((item, idx) => {
            if (item.type === 'monthHeader') {
              return (
                <li key={`month-${item.label}-${String(idx)}`}>
                  <div className="flex items-center gap-3 py-2">
                    <div className="h-0.5 flex-1 bg-seam" />
                    <span className={mono({ className: 'text-[14px] uppercase text-ash' })}>
                      {item.label}: {item.count} workout{item.count !== 1 ? 's' : ''}
                    </span>
                    <div className="h-0.5 flex-1 bg-seam" />
                  </div>
                </li>
              );
            }
            if (item.type === 'rest') {
              return (
                <li key={`rest-${String(idx)}`} className="py-2">
                  <div className="flex items-center gap-3">
                    <div className="h-0.5 flex-1 bg-seam/50" />
                    <span className={mono({ className: 'text-[14px] uppercase text-seam' })}>
                      Rest day
                    </span>
                    <div className="h-0.5 flex-1 bg-seam/50" />
                  </div>
                </li>
              );
            }
            const { projection } = item;
            return (
              <li key={projection.sessionId}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 py-3 text-left"
                  data-testid="history-item"
                  onClick={() => { onOpenSession(projection.sessionId); }}
                >
                  <div className="min-w-0">
                    {projection.session?.startedAt != null && (
                      <p className={mono({ className: 'text-[14px] uppercase text-ash' })}>
                        {formatEntryDate(projection.session.startedAt)}
                      </p>
                    )}
                    <p className="font-display text-[32px] uppercase leading-[28px] text-plate-red">
                      {sessionDisplayTitle(projection)}
                    </p>
                  </div>
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] border-2 border-seam">
                    <svg width="14" height="22" viewBox="0 0 10 16" fill="none" aria-hidden>
                      <path d="M2 2L8 8L2 14" stroke="#FF1C00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {deleted.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            className={button({ intent: 'quiet', className: 'w-full' })}
            data-testid="show-deleted-toggle"
            onClick={() => { setShowDeleted(v => !v); }}
          >
            {showDeleted ? 'Hide deleted' : `Show deleted (${String(deleted.length)})`}
          </button>
          {showDeleted && (
            <ul className="mt-3 flex flex-col gap-2">
              {deleted.map(projection => (
                <DeletedSessionRow key={projection.sessionId} projection={projection} />
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="h-4" />
    </main>
  );
}

function DeletedSessionRow({ projection }: { projection: SessionProjection }) {
  const [confirmingPurge, setConfirmingPurge] = useState(false);

  return (
    <li className="flex flex-col gap-3 rounded-[20px] border-2 border-seam p-3" data-testid="deleted-history-item">
      <div className="min-w-0 flex-1 line-through opacity-40">
        <p className="font-display text-lg uppercase text-chalk">{sessionDisplayTitle(projection)}</p>
      </div>
      {confirmingPurge ? (
        <div className="flex items-center gap-2">
          <span className={mono({ className: 'shrink-0 text-[14px] uppercase text-ash' })}>Erase permanently?</span>
          <button type="button" className={button({ intent: 'primary', className: 'flex-1 px-3 text-sm' })} data-testid="confirm-purge-session" onClick={() => { void purgeSession(projection.sessionId, Date.now()); }}>Erase</button>
          <button type="button" className={button({ intent: 'quiet', className: 'flex-1 px-3 text-sm' })} data-testid="cancel-purge-session" onClick={() => { setConfirmingPurge(false); }}>Cancel</button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button type="button" className={button({ intent: 'quiet', className: 'flex-1 px-3 text-sm' })} data-testid="restore-session" onClick={() => { void restoreSession(projection.sessionId, Date.now()); }}>Restore</button>
          <button type="button" className={button({ intent: 'quiet', className: 'flex-1 px-3 text-sm' })} data-testid="purge-session" onClick={() => { setConfirmingPurge(true); }}>Delete forever</button>
        </div>
      )}
    </li>
  );
}

