import { useState } from 'react';
import { type SessionId, type SessionProjection } from '@ferrum/domain';
import { listSessions, unacknowledgedCount } from '../../db/event-store.ts';
import { purgeSession, restoreSession } from '../../data/session-controller.ts';
import { sessionDisplayTitle } from './session-view.ts';
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
                <DeletedSessionRow key={projection.sessionId} projection={projection} />
              ))}
            </ul>
          )}
        </>
      )}
    </ScreenShell>
  );
}

// Restore is one tap because it is safe; erasing is two, and the second one says
// what it costs. This is the only action in the app that data cannot come back from,
// so it never sits one mis-tap away from Restore in its confirmed state.
function DeletedSessionRow({ projection }: { projection: SessionProjection }) {
  const [confirmingPurge, setConfirmingPurge] = useState(false);

  return (
    <li
      className={card({ className: 'flex items-center gap-3 p-3' })}
      data-testid="deleted-history-item"
    >
      <div className="min-w-0 flex-1 line-through opacity-60">
        <SessionSummary projection={projection} />
      </div>
      {confirmingPurge ? (
        <>
          <span className="shrink-0 text-xs text-ash">Erase permanently?</span>
          <button
            type="button"
            className={button({ intent: 'secondary', className: 'shrink-0 px-4' })}
            data-testid="confirm-purge-session"
            onClick={() => {
              void purgeSession(projection.sessionId, Date.now());
            }}
          >
            Erase
          </button>
          <button
            type="button"
            className={button({ intent: 'quiet', className: 'shrink-0 px-4' })}
            data-testid="cancel-purge-session"
            onClick={() => {
              setConfirmingPurge(false);
            }}
          >
            Cancel
          </button>
        </>
      ) : (
        <>
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
          <button
            type="button"
            className={button({ intent: 'quiet', className: 'shrink-0 px-4' })}
            data-testid="purge-session"
            onClick={() => {
              setConfirmingPurge(true);
            }}
          >
            Delete forever
          </button>
        </>
      )}
    </li>
  );
}

function SessionSummary({ projection }: { projection: SessionProjection }) {
  return (
    <>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-display text-base font-semibold uppercase">
          {sessionDisplayTitle(projection)}
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
