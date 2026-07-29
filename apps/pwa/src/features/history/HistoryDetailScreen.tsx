import { useState } from 'react';
import { type SessionId, type WeightUnit, type WorkoutSet, formatLoad } from '@ferrum/domain';
import { loadSession } from '../../db/event-store.ts';
import { deleteSession } from '../../data/session-controller.ts';
import { loadSessionPlanSlots } from '../../data/routine-store.ts';
import { exerciseDisplayName, formatDuration, setsForExercise } from './session-view.ts';
import { ScreenShell } from '../../components/ScreenShell.tsx';
import { button, card, eyebrow, mono } from '../../ui.ts';
import { useLiveData } from '../../components/live-data.ts';

export function HistoryDetailScreen({
  sessionId,
  unit,
  onBack,
}: {
  sessionId: SessionId;
  unit: WeightUnit;
  onBack: () => void;
}) {
  const projection = useLiveData(() => loadSession(sessionId), [sessionId]);
  const planSlots = useLiveData(() => loadSessionPlanSlots(sessionId), [sessionId]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (projection?.session == null || planSlots === undefined) {
    return (
      <main className="p-6 text-ash" data-testid="history-detail-loading">
        Loading…
      </main>
    );
  }

  const session = projection.session;

  return (
    <ScreenShell
      title={session.title ?? 'Workout'}
      titleClassName="min-w-0"
      className="gap-3"
      testId="history-detail"
      action={
        <button
          type="button"
          className={button({ intent: 'quiet', className: 'px-4' })}
          data-testid="detail-back"
          onClick={onBack}
        >
          History
        </button>
      }
    >
      <div
        className={mono({
          className: 'flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-ash',
        })}
      >
        <span data-testid="detail-date">{session.localDate}</span>
        {session.finishedAt != null && (
          <span data-testid="detail-duration">
            {formatDuration(session.startedAt, session.finishedAt)}
          </span>
        )}
        <span>{session.status}</span>
      </div>

      {projection.amendments.length > 0 && (
        <p className="text-xs text-ash" data-testid="detail-amendments">
          <span className={mono({ className: 'font-medium' })}>{projection.amendments.length}</span>{' '}
          {projection.amendments.length === 1 ? 'amendment' : 'amendments'}
        </p>
      )}

      {projection.exercises.map(exercise => {
        const { live, deleted } = setsForExercise(projection, exercise.id);
        if (live.length === 0 && deleted.length === 0) return null;
        return (
          <section
            key={exercise.id}
            className={card({ className: 'p-3' })}
            data-testid="detail-exercise"
          >
            <h2 className="font-display text-lg leading-tight font-semibold uppercase">
              {exerciseDisplayName(exercise, planSlots)}
            </h2>
            <ul className="mt-2 flex flex-col gap-1 border-t border-seam pt-2">
              {live.map((set, index) => (
                <DetailSetRow key={set.id} position={index + 1} set={set} unit={unit} />
              ))}
              {deleted.map(set => (
                <DetailSetRow key={set.id} position={null} set={set} unit={unit} />
              ))}
            </ul>
          </section>
        );
      })}

      {/* Destructive but quiet on purpose: plate-red is reserved for the primary action,
          and deleting a workout is a tombstone the History list can restore. */}
      {!session.deleted &&
        (confirmingDelete ? (
          <div className={card({ className: 'flex items-center gap-3 p-3' })}>
            <span className="min-w-0 flex-1 text-sm text-chalk">Delete this workout?</span>
            <button
              type="button"
              className={button({
                intent: 'secondary',
                className: 'shrink-0 px-4',
              })}
              data-testid="confirm-delete-workout"
              onClick={() => {
                void deleteSession(sessionId, null, Date.now()).then(onBack);
              }}
            >
              Delete
            </button>
            <button
              type="button"
              className={button({ intent: 'quiet', className: 'shrink-0 px-4' })}
              data-testid="cancel-delete-workout"
              onClick={() => {
                setConfirmingDelete(false);
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={button({ intent: 'quiet', className: 'self-start px-4' })}
            data-testid="delete-workout"
            onClick={() => {
              setConfirmingDelete(true);
            }}
          >
            Delete workout
          </button>
        ))}
    </ScreenShell>
  );
}

function DetailSetRow({
  position,
  set,
  unit,
}: {
  position: number | null;
  set: WorkoutSet;
  unit: WeightUnit;
}) {
  const measurements = set.measurements;
  const deleted = position == null;
  return (
    <li
      className={`flex items-baseline justify-between gap-2 text-sm ${
        deleted ? 'text-ash line-through' : 'text-chalk'
      }`}
      data-testid={deleted ? 'detail-set-deleted' : 'detail-set'}
    >
      <span className={eyebrow()}>{deleted ? 'Deleted' : `Set ${String(position)}`}</span>
      {set.setType === 'warmup' && (
        <span
          className={eyebrow({ className: 'rounded-[2px] border border-seam px-1.5 py-0.5' })}
          data-testid="detail-warmup-marker"
        >
          Warmup
        </span>
      )}
      <span className={mono({ className: 'font-medium' })} data-testid="detail-set-values">
        {formatLoad(measurements.canonicalExternalLoadKg, { unit })} × {measurements.reps ?? '—'}
      </span>
      <span className={mono({ className: 'text-xs font-medium text-ash' })}>
        RIR {measurements.rirEntered == null ? '—' : String(measurements.rirEntered)}
      </span>
    </li>
  );
}
