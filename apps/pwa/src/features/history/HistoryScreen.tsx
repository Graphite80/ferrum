import { useState } from 'react';
import { type SessionId, type SessionProjection } from '@ferrum/domain';
import { listSessions, unacknowledgedCount } from '../../db/event-store.ts';
import { restoreSession } from '../../data/session-controller.ts';
import { ScreenShell } from '../../components/ScreenShell.tsx';
import { button, card, mono } from '../../ui.ts';
import { useLiveData } from '../../components/live-data.ts';

export function HistoryScreen({
  onHome,
  onOpenSession,
}: {
  onHome: () => void;
  onOpenSession: (sessionId: SessionId) => void;
}) {
  const sessions = useLiveData(listSessions);
  const pending = useLiveData(unacknowledgedCount);
  const [showDeleted, setShowDeleted] = useState(false);

  const live = sessions?.filter(projection => projection.session?.deleted !== true);
  const deleted = sessions?.filter(projection => projection.session?.deleted === true);

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

      {live == null || deleted == null ? (
        <p className="text-ash">Loading…</p>
      ) : live.length === 0 && deleted.length === 0 ? (
        <p className="text-ash" data-testid="history-empty">
          No sessions yet.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2" data-testid="history-list">
            {live.map(projection => (
              <li key={projection.sessionId}>
                <button
                  type="button"
                  className={card({ className: 'tap-target block w-full p-3 text-left' })}
                  data-testid="history-item"
                  onClick={() => {
                    onOpenSession(projection.sessionId);
                  }}
                >
                  <SessionSummary projection={projection} />
                </button>
              </li>
            ))}
          </ul>

          {deleted.length > 0 && (
            <button
              type="button"
              className={button({ intent: 'quiet', className: 'self-start px-4' })}
              data-testid="show-deleted-toggle"
              onClick={() => {
                setShowDeleted(current => !current);
              }}
            >
              {showDeleted ? 'Hide deleted' : `Show deleted (${String(deleted.length)})`}
            </button>
          )}

          {showDeleted && deleted.length > 0 && (
            <ul className="flex flex-col gap-2" data-testid="deleted-history-list">
              {deleted.map(projection => (
                <li
                  key={projection.sessionId}
                  className={card({ className: 'flex items-center gap-3 p-3' })}
                  data-testid="deleted-history-item"
                >
                  <div className="min-w-0 flex-1 line-through opacity-60">
                    <SessionSummary projection={projection} />
                  </div>
                  <button
                    type="button"
                    className={button({ intent: 'quiet', className: 'shrink-0 px-4' })}
                    data-testid="restore-session"
                    onClick={() => {
                      void restoreSession(projection.sessionId, Date.now());
                    }}
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </ScreenShell>
  );
}

function SessionSummary({ projection }: { projection: SessionProjection }) {
  return (
    <>
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
        {projection.deletedSets.length > 0 && ` · ${String(projection.deletedSets.length)} deleted`}
      </div>
    </>
  );
}
