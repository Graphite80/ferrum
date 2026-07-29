import { useLiveData } from '../../components/live-data.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  groupBy,
  type ComparisonSignature,
  type ExerciseDefinition,
  type SessionExerciseId,
  type SessionId,
  type WeightUnit,
  type WorkoutSet,
} from '@ferrum/domain';
import { type EquipmentRecord } from '../../db/ferrum-db.ts';
import { loadSession } from '../../db/event-store.ts';
import { type LastPerformance, lastPerformances } from '../../db/history.ts';
import { WakeLockController, type WakeLockState } from '../../platform/wake-lock.ts';
import { listAllEquipment, toEquipmentInstance } from '../../data/equipment-store.ts';
import { loadSessionPlanSlots } from '../../data/routine-store.ts';
import { planExercise, resolveDefinition } from './exercise-plan.ts';
import { ExerciseSearchPanel } from './ExerciseSearchPanel.tsx';
import { ExerciseSection } from './ExerciseSection.tsx';
import {
  dismissRestTimer,
  formatClock,
  loadRestTimer,
  startRestTimer,
  viewTimer,
} from '../../data/rest-timer.ts';
import {
  addExercise,
  amendSet,
  deleteSet,
  finishSession,
  logSet,
  removeExercise,
  restoreSet,
} from '../../data/session-controller.ts';
import { ScreenShell } from '../../components/ScreenShell.tsx';
import { button, card, eyebrow, mono } from '../../ui.ts';

export function WorkoutScreen({
  sessionId,
  unit,
  onFinished,
}: {
  sessionId: SessionId;
  unit: WeightUnit;
  onFinished: () => void;
}) {
  const projection = useLiveData(() => loadSession(sessionId), [sessionId]);
  const planSlots = useLiveData(() => loadSessionPlanSlots(sessionId), [sessionId]);
  const timer = useLiveData(() => loadRestTimer(sessionId), [sessionId]);
  const equipment = useLiveData(() => listAllEquipment(), []);
  const [nowMillis, setNowMillis] = useState(() => Date.now());
  const [wakeLock, setWakeLock] = useState<WakeLockState | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [lastTimes, setLastTimes] = useState<
    ReadonlyMap<ComparisonSignature, LastPerformance | null>
  >(new Map());

  const wakeLockRef = useRef<WakeLockController | null>(null);
  if (wakeLockRef.current == null) wakeLockRef.current = new WakeLockController(setWakeLock);
  const controller = wakeLockRef.current;

  // Only the wake lock and the timer's "now" need hand-wired visibility events;
  // the projection, plan and timer records repaint through their live queries.
  useEffect(() => {
    setWakeLock(controller.state);
    const onVisible = () => {
      controller.handleVisibilityChange();
      setNowMillis(Date.now());
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [controller]);

  useEffect(() => {
    const handle = window.setInterval(() => {
      setNowMillis(Date.now());
    }, 500);
    return () => {
      window.clearInterval(handle);
    };
  }, []);

  // The machine the user last touched for an exercise is the one they are standing at,
  // so it is what the plan is built against.
  const equipmentByDefinition = useMemo(() => {
    const newest = new Map<string, EquipmentRecord>();
    for (const record of equipment ?? []) {
      const held = newest.get(record.exerciseDefinitionId);
      if (held == null || record.lastUsedAtMillis > held.lastUsedAtMillis) {
        newest.set(record.exerciseDefinitionId, record);
      }
    }
    return newest;
  }, [equipment]);

  const liveSetsByExercise = useMemo(
    () => groupBy(projection?.sets ?? [], set => set.sessionExerciseId),
    [projection]
  );
  const allSetsByExercise = useMemo(
    () =>
      groupBy(
        [...(projection?.sets ?? []), ...(projection?.deletedSets ?? [])],
        set => set.sessionExerciseId
      ),
    [projection]
  );

  const plans = useMemo(
    () =>
      (projection?.exercises ?? []).map(exercise => {
        const definition = resolveDefinition(exercise.exerciseDefinitionId);
        const machine =
          definition == null ? null : (equipmentByDefinition.get(definition.id) ?? null);
        return {
          exercise,
          definition,
          machine,
          plan: planExercise(
            exercise,
            allSetsByExercise.get(exercise.id) ?? [],
            planSlots ?? [],
            machine == null ? null : toEquipmentInstance(machine)
          ),
        };
      }),
    [projection, allSetsByExercise, planSlots, equipmentByDefinition]
  );

  // Every plan input has to have resolved first. Looking up history against a signature
  // that is about to change replays every stored session for an answer that is thrown
  // away, and on a phone that is the most expensive thing this screen does.
  const plansSettled = planSlots !== undefined && equipment !== undefined;

  useEffect(() => {
    if (!plansSettled) return;
    const wanted = plans
      .filter(entry => !lastTimes.has(entry.plan.comparisonSignature))
      .map(entry => ({
        definitionId: entry.exercise.exerciseDefinitionId,
        signature: entry.plan.comparisonSignature,
      }));
    if (wanted.length === 0) return;
    void lastPerformances(wanted, sessionId).then(found => {
      setLastTimes(previous => {
        const next = new Map(previous);
        for (const [signature, performance] of found) next.set(signature, performance);
        return next;
      });
    });
  }, [plans, plansSettled, lastTimes, sessionId]);

  // The plan snapshot must be resolved before the first entry row mounts: SetRow
  // captures its defaults in state at mount, so a plan arriving late would leave
  // the prefill at the generic fallback instead of the routine's target. The
  // slots query resolves to [] when there is no plan, so undefined here always
  // means "still loading", never "planless session".
  //
  // The machine list is in the same gate for a harder reason: it feeds the comparison
  // signature. A set logged in the gap would be filed against no machine at all and
  // land in a bucket the user never chose (INVARIANTS §1a).
  if (projection?.session == null || !plansSettled) {
    return (
      <main className="p-6 text-ash" data-testid="loading-workout">
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
    <ScreenShell
      title={projection.session.title ?? 'Workout'}
      titleTestId="session-title"
      className="pb-32"
      headerClassName="items-baseline"
      action={
        <span
          className={mono({ className: 'text-xs font-medium text-ash' })}
          data-testid="set-count"
        >
          {projection.sets.length} sets
        </span>
      }
    >
      <WakeLockBanner
        state={wakeLock}
        onEnable={() => {
          void controller.request();
        }}
      />

      {plans.map(({ exercise, plan, machine, definition }) => {
        return (
          <ExerciseSection
            key={exercise.id}
            exercise={exercise}
            definition={definition}
            plan={plan}
            unit={unit}
            machine={machine}
            liveSets={liveSetsByExercise.get(exercise.id) ?? []}
            lastTime={lastTimes.get(plan.comparisonSignature)}
            onLog={values => {
              void (async () => {
                const now = Date.now();
                await logSet(
                  {
                    sessionId,
                    sessionExerciseId: exercise.id,
                    orderIndex: nextOrderIndex(exercise.id),
                    enteredLoad: values.load,
                    unit,
                    reps: values.reps,
                    rir: values.rir,
                    comparisonSignature: plan.comparisonSignature,
                    prescription: plan.prescription,
                  },
                  now
                );
                await startRestTimer(sessionId, plan.restSeconds, now);
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
        className={button({ intent: 'secondary' })}
        data-testid="add-exercise"
        onClick={() => {
          setSearchOpen(true);
        }}
      >
        + Add exercise
      </button>

      <button
        type="button"
        className={button({ className: 'w-full' })}
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
          className={button({ intent: 'quiet' })}
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
          className={button({ intent: 'quiet' })}
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
          className="fixed inset-x-0 bottom-0 mx-auto max-w-md border-t border-seam bg-forged p-4"
          data-testid="rest-timer"
        >
          <div className="flex items-center justify-between gap-3">
            <span className={eyebrow()}>{timerView.finished ? 'Rest finished' : 'Resting'}</span>
            <span
              className={mono({
                className: `text-[44px] leading-none font-bold ${
                  timerView.finished ? 'text-chalk' : 'text-plate-red'
                }`,
              })}
              data-testid="rest-timer-value"
            >
              {timerView.finished ? (
                <>
                  <span className="text-plate-red">+</span>
                  {formatClock(timerView.overdueSeconds)}
                </>
              ) : (
                formatClock(timerView.remainingSeconds)
              )}
            </span>
            <button
              type="button"
              className="tap-target rounded-md px-4 text-sm text-ash"
              data-testid="dismiss-timer"
              onClick={() => {
                void dismissRestTimer(sessionId);
              }}
            >
              Skip
            </button>
          </div>
        </div>
      )}
    </ScreenShell>
  );
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
      <p className={card({ className: 'p-3 text-xs text-chalk' })} data-testid="wake-lock-broken">
        iOS {state.support.iosVersion} accepts a screen lock request in an installed web app and
        ignores it. Set Settings &rarr; Display &amp; Brightness &rarr; Auto-Lock to Never for this
        workout, or update to iOS 18.4.
      </p>
    );
  }

  if (state.support.kind === 'absent') {
    return (
      <p className={card({ className: 'p-3 text-xs text-ash' })} data-testid="wake-lock-absent">
        This browser cannot keep the screen awake.
      </p>
    );
  }

  return (
    <button
      type="button"
      className={card({ className: 'tap-target p-3 text-left text-xs text-ash' })}
      data-testid="wake-lock-toggle"
      onClick={onEnable}
    >
      Screen stays on: <strong className="text-chalk">{state.held ? 'on' : 'tap to enable'}</strong>
      {state.lastError != null && <span className="block text-chalk">{state.lastError}</span>}
    </button>
  );
}
