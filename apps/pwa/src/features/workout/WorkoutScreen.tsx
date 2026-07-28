import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type ExerciseDefinition,
  type ExerciseDefinitionId,
  type SessionExerciseId,
  type SessionId,
  type SessionProjection,
  type WorkoutSet,
} from '@ferrum/domain';
import { loadSession, subscribe } from '../../db/event-store.ts';
import { type RestTimerRecord } from '../../db/ferrum-db.ts';
import { type LastPerformance, lastPerformances } from '../../db/history.ts';
import { WakeLockController, type WakeLockState } from '../../platform/wake-lock.ts';
import { planExercise } from './exercise-plan.ts';
import { ExerciseSearchPanel } from './ExerciseSearchPanel.tsx';
import { ExerciseSection } from './ExerciseSection.tsx';
import {
  dismissRestTimer,
  formatClock,
  loadRestTimer,
  startRestTimer,
  viewTimer,
} from './rest-timer.ts';
import {
  addExercise,
  amendSet,
  deleteSet,
  finishSession,
  logSet,
  removeExercise,
  restoreSet,
} from './session-controller.ts';

export function WorkoutScreen({
  sessionId,
  onFinished,
}: {
  sessionId: SessionId;
  onFinished: () => void;
}) {
  const [projection, setProjection] = useState<SessionProjection | null>(null);
  const [timer, setTimer] = useState<RestTimerRecord | null>(null);
  const [nowMillis, setNowMillis] = useState(() => Date.now());
  const [wakeLock, setWakeLock] = useState<WakeLockState | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [lastTimes, setLastTimes] = useState<
    ReadonlyMap<ExerciseDefinitionId, LastPerformance | null>
  >(new Map());

  const wakeLockRef = useRef<WakeLockController | null>(null);
  if (wakeLockRef.current == null) wakeLockRef.current = new WakeLockController(setWakeLock);
  const controller = wakeLockRef.current;

  const refresh = useCallback(async () => {
    setProjection(await loadSession(sessionId));
    setTimer(await loadRestTimer(sessionId));
  }, [sessionId]);

  useEffect(() => {
    void refresh();
    return subscribe(changed => {
      if (changed === sessionId) void refresh();
    });
  }, [refresh, sessionId]);

  useEffect(() => {
    setWakeLock(controller.state);
    const onVisible = () => {
      controller.handleVisibilityChange();
      setNowMillis(Date.now());
      void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [controller, refresh]);

  useEffect(() => {
    const handle = window.setInterval(() => {
      setNowMillis(Date.now());
    }, 500);
    return () => {
      window.clearInterval(handle);
    };
  }, []);

  useEffect(() => {
    const wanted = (projection?.exercises ?? [])
      .map(exercise => exercise.exerciseDefinitionId)
      .filter(definitionId => !lastTimes.has(definitionId));
    if (wanted.length === 0) return;
    void lastPerformances(wanted, sessionId).then(found => {
      setLastTimes(previous => {
        const next = new Map(previous);
        for (const [definitionId, performance] of found) next.set(definitionId, performance);
        return next;
      });
    });
  }, [projection, lastTimes, sessionId]);

  const liveSetsByExercise = useMemo(
    () => groupBySessionExercise(projection?.sets ?? []),
    [projection]
  );
  const allSetsByExercise = useMemo(
    () => groupBySessionExercise([...(projection?.sets ?? []), ...(projection?.deletedSets ?? [])]),
    [projection]
  );

  if (projection?.session == null) {
    return (
      <main className="p-6 text-neutral-400" data-testid="loading-workout">
        Loading workout…
      </main>
    );
  }

  const timerView = timer == null ? null : viewTimer(timer, nowMillis);

  // Reload-safe undo target: the newest live set by its time-ordered ULID, derived
  // from the projection so it survives a restart, unlike component state.
  const undoTarget = projection.sets.reduce<WorkoutSet | null>(
    (newest, set) => (newest == null || set.id > newest.id ? set : newest),
    null
  );

  const nextOrderIndex = (sessionExerciseId: SessionExerciseId): number => {
    const recorded = allSetsByExercise.get(sessionExerciseId) ?? [];
    return recorded.reduce((max, set) => Math.max(max, set.orderIndex + 1), 0);
  };

  const handlePick = (definition: ExerciseDefinition) => {
    void (async () => {
      await addExercise(sessionId, definition.id, projection.exercises.length, Date.now());
      setSearchOpen(false);
    })();
  };

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col gap-4 p-4 pb-32">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold" data-testid="session-title">
          {projection.session.title ?? 'Workout'}
        </h1>
        <span className="text-xs text-neutral-500" data-testid="set-count">
          {projection.sets.length} sets
        </span>
      </header>

      <WakeLockBanner
        state={wakeLock}
        onEnable={() => {
          void controller.request();
        }}
      />

      {projection.exercises.map(exercise => {
        const plan = planExercise(exercise, allSetsByExercise.get(exercise.id) ?? []);
        return (
          <ExerciseSection
            key={exercise.id}
            exercise={exercise}
            plan={plan}
            liveSets={liveSetsByExercise.get(exercise.id) ?? []}
            lastTime={lastTimes.get(exercise.exerciseDefinitionId)}
            onLog={values => {
              void (async () => {
                const now = Date.now();
                await logSet(
                  {
                    sessionId,
                    sessionExerciseId: exercise.id,
                    orderIndex: nextOrderIndex(exercise.id),
                    loadKg: values.loadKg,
                    reps: values.reps,
                    rir: values.rir,
                    comparisonSignature: plan.comparisonSignature,
                    prescription: plan.prescription,
                  },
                  now
                );
                setTimer(await startRestTimer(sessionId, plan.restSeconds, now));
                setNowMillis(now);
              })();
            }}
            onAmend={(setId, patch) => {
              void amendSet(sessionId, setId, patch, Date.now());
            }}
            onDelete={setId => {
              void deleteSet(sessionId, setId, Date.now());
            }}
            onRemove={() => {
              void removeExercise(sessionId, exercise.id, Date.now());
            }}
          />
        );
      })}

      <button
        type="button"
        className="tap-target rounded-xl border border-edge text-base"
        data-testid="add-exercise"
        onClick={() => {
          setSearchOpen(true);
        }}
      >
        + Add exercise
      </button>

      <button
        type="button"
        className="tap-target rounded-xl border border-edge text-base"
        data-testid="finish-session"
        onClick={() => {
          void (async () => {
            await finishSession(sessionId, Date.now());
            await dismissRestTimer(sessionId);
            onFinished();
          })();
        }}
      >
        Finish workout
      </button>

      {undoTarget != null && (
        <button
          type="button"
          className="tap-target rounded-xl border border-edge text-sm text-neutral-300"
          data-testid="undo-last-set"
          onClick={() => {
            void deleteSet(sessionId, undoTarget.id, Date.now());
          }}
        >
          Undo last set
        </button>
      )}

      {projection.deletedSets.length > 0 && (
        <button
          type="button"
          className="tap-target rounded-xl border border-edge text-sm text-neutral-300"
          data-testid="restore-deleted-set"
          onClick={() => {
            void (async () => {
              const restorable = projection.deletedSets.at(-1);
              if (restorable != null) await restoreSet(sessionId, restorable.id, Date.now());
            })();
          }}
        >
          Restore deleted set ({projection.deletedSets.length})
        </button>
      )}

      {searchOpen && (
        <ExerciseSearchPanel
          onPick={handlePick}
          onClose={() => {
            setSearchOpen(false);
          }}
        />
      )}

      {timerView != null && (
        <div
          className="fixed inset-x-0 bottom-0 mx-auto max-w-md border-t border-edge bg-surface-raised p-4"
          data-testid="rest-timer"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-400">
              {timerView.finished ? 'Rest finished' : 'Resting'}
            </span>
            <span className="text-2xl font-bold" data-testid="rest-timer-value">
              {timerView.finished
                ? `+${formatClock(timerView.overdueSeconds)}`
                : formatClock(timerView.remainingSeconds)}
            </span>
            <button
              type="button"
              className="tap-target rounded-lg border border-edge px-4"
              data-testid="dismiss-timer"
              onClick={() => {
                void (async () => {
                  await dismissRestTimer(sessionId);
                  setTimer(null);
                })();
              }}
            >
              Skip
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function groupBySessionExercise(sets: readonly WorkoutSet[]): Map<SessionExerciseId, WorkoutSet[]> {
  const map = new Map<SessionExerciseId, WorkoutSet[]>();
  for (const set of sets) {
    const existing = map.get(set.sessionExerciseId);
    if (existing == null) map.set(set.sessionExerciseId, [set]);
    else existing.push(set);
  }
  return map;
}

function WakeLockBanner({
  state,
  onEnable,
}: {
  state: WakeLockState | null;
  onEnable: () => void;
}) {
  if (state == null) return null;

  if (state.support.kind === 'silently_broken') {
    return (
      <p
        className="rounded-xl border border-edge bg-surface p-3 text-xs text-amber-300"
        data-testid="wake-lock-broken"
      >
        iOS {state.support.iosVersion} accepts a screen lock request in an installed web app and
        ignores it. Set Settings &rarr; Display &amp; Brightness &rarr; Auto-Lock to Never for this
        workout, or update to iOS 18.4.
      </p>
    );
  }

  if (state.support.kind === 'absent') {
    return (
      <p
        className="rounded-xl border border-edge bg-surface p-3 text-xs text-neutral-400"
        data-testid="wake-lock-absent"
      >
        This browser cannot keep the screen awake.
      </p>
    );
  }

  return (
    <button
      type="button"
      className="tap-target rounded-xl border border-edge bg-surface p-3 text-left text-xs"
      data-testid="wake-lock-toggle"
      onClick={onEnable}
    >
      Screen stays on: <strong>{state.held ? 'on' : 'tap to enable'}</strong>
      {state.lastError != null && <span className="block text-amber-400">{state.lastError}</span>}
    </button>
  );
}
