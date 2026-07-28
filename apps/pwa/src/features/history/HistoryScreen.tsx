import { useLiveQuery } from 'dexie-react-hooks';
import { type SessionId } from '@ferrum/domain';
import { listSessions, unacknowledgedCount } from '../../db/event-store.ts';
import { ScreenShell } from '../../components/ScreenShell.tsx';
import { button, card, mono } from '../../ui.ts';

export function HistoryScreen({
  onHome,
  onOpenSession,
}: {
  onHome: () => void;
  onOpenSession: (sessionId: SessionId) => void;
}) {
  const sessions = useLiveQuery(listSessions);
  const pending = useLiveQuery(unacknowledgedCount);

  return (
    <ScreenShell
      title="History"
      className="gap-3"
      action={
        <button
          type="button"
          className={button({ intent: 'quiet', className: 'px-4' })}
          data-testid="back-home"
          onClick={onHome}
        >
          Home
        </button>
      }
    >
      {pending !== undefined && (
        <p className="text-xs text-ash" data-testid="pending-events">
          <span className={mono({ className: 'font-medium' })}>{pending}</span> events not yet
          synced
        </p>
      )}

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
                className={card({ className: 'tap-target block w-full p-3 text-left' })}
                data-testid="history-item"
                onClick={() => {
                  onOpenSession(projection.sessionId);
                }}
              >
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-display text-base font-semibold uppercase">
                    {projection.session?.title ?? 'Workout'}
                  </span>
                  <span className={mono({ className: 'text-xs font-medium text-ash' })}>
                    {projection.session?.localDate}
                  </span>
                </div>
                <div className={mono({ className: 'mt-1 text-xs font-medium text-ash' })}>
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
    </ScreenShell>
  );
}
