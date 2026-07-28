import { useEffect, useState } from 'react';
import { type SessionId, type SessionProjection } from '@ferrum/domain';
import { listSessionIds, loadSession, unacknowledgedCount } from '../../db/event-store.ts';
import { BTN_QUIET, CARD, MONO } from '../../ui.ts';

export function HistoryScreen({
  onHome,
  onOpenSession,
}: {
  onHome: () => void;
  onOpenSession: (sessionId: SessionId) => void;
}) {
  const [sessions, setSessions] = useState<SessionProjection[] | null>(null);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    void (async () => {
      const ids = await listSessionIds();
      setSessions(await Promise.all(ids.map(id => loadSession(id))));
      setPending(await unacknowledgedCount());
    })();
  }, []);

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col gap-3 p-4">
      <header className="flex items-center justify-between border-b border-seam pb-3">
        <h1 className="font-display text-2xl font-bold tracking-[0.04em] uppercase">History</h1>
        <button
          type="button"
          className={`${BTN_QUIET} px-4`}
          data-testid="back-home"
          onClick={onHome}
        >
          Home
        </button>
      </header>

      <p className="text-xs text-ash" data-testid="pending-events">
        <span className={`${MONO} font-medium`}>{pending}</span> events not yet synced
      </p>

      {sessions == null ? (
        <p className="text-ash">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="text-ash" data-testid="history-empty">
          No sessions yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="history-list">
          {sessions.map(projection => (
            <li key={projection.sessionId}>
              <button
                type="button"
                className={`${CARD} tap-target block w-full p-3 text-left`}
                data-testid="history-item"
                onClick={() => {
                  onOpenSession(projection.sessionId);
                }}
              >
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-display text-base font-semibold uppercase">
                    {projection.session?.title ?? 'Workout'}
                  </span>
                  <span className={`${MONO} text-xs font-medium text-ash`}>
                    {projection.session?.localDate}
                  </span>
                </div>
                <div className={`${MONO} mt-1 text-xs font-medium text-ash`}>
                  {projection.sets.length} sets · {projection.session?.status}
                  {projection.session?.amendedAfterFinish === true && ' · edited after finish'}
                  {projection.deletedSets.length > 0 &&
                    ` · ${String(projection.deletedSets.length)} deleted`}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
