import { useLiveData } from '../../components/live-data.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useIsScrolled } from '../../platform/use-scrolled.ts';
import {
  groupBy,
  isCountedForVolume,
  type ComparisonSignature,
  type ExerciseDefinition,
  type SessionExerciseId,
  type SessionId,
  type WeightUnit,
} from '@ferrum/domain';
import { type EquipmentRecord } from '../../db/ferrum-db.ts';
import { loadSession } from '../../db/event-store.ts';
import { type LastPerformance, lastPerformances } from '../../db/history.ts';
import { WakeLockController, type WakeLockState } from '../../platform/wake-lock.ts';
import { listAllEquipment, toEquipmentInstance } from '../../data/equipment-store.ts';
import { loadSessionPlanSlots } from '../../data/routine-store.ts';
import { canonicalDefinitionId, planExercise, resolveDefinition } from './exercise-plan.ts';
import { ExerciseSearchPanel } from './ExerciseSearchPanel.tsx';
import { ExerciseSection } from './ExerciseSection.tsx';
import { RestDial } from './RestDial.tsx';
import {
  adjustRestTimer,
  dismissRestTimer,
  loadRestTimer,
  startRestTimer,
  viewTimer,
} from '../../data/rest-timer.ts';
import {
  addExercise,
  amendSet,
  deleteSession,
  deleteSet,
  finishSession,
  logSet,
  removeExercise,
  reorderExercises,
} from '../../data/session-controller.ts';
import { button, card } from '../../ui.ts';
import { formatDuration } from '../history/session-view.ts';
import { ReorderSheet } from './ReorderSheet.tsx';
import { TimerSheet } from './TimerSheet.tsx';

export function WorkoutScreen({
  sessionId,
  unit,
  onFinished,
  onDiscarded,
  onLeave,
}: {
  sessionId: SessionId;
  unit: WeightUnit;
  onFinished: () => void;
  onDiscarded: () => void;
  // Leaves the workout running rather than ending it. Without this the only way
  // off this screen is to finish or discard, and an installed PWA has no browser
  // back button to escape with.
  onLeave: () => void;
}) {
  void onLeave;
  const projection = useLiveData(() => loadSession(sessionId), [sessionId]);
  const planSlots = useLiveData(() => loadSessionPlanSlots(sessionId), [sessionId]);
  const timer = useLiveData(() => loadRestTimer(sessionId), [sessionId]);
  const equipment = useLiveData(() => listAllEquipment(), []);
  const [nowMillis, setNowMillis] = useState(() => Date.now());
  const [wakeLock, setWakeLock] = useState<WakeLockState | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  // Which exercise's timer settings are being edited.
  const timerExerciseRef = useRef<SessionExerciseId | null>(null);
  // Per-exercise rest duration overrides set by the user during this session.
  const [restOverrides, setRestOverrides] = useState<ReadonlyMap<SessionExerciseId, number>>(new Map());
  // When set, the next exercise picked from search replaces this one.
  const replaceTargetRef = useRef<SessionExerciseId | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [lastTimes, setLastTimes] = useState<
    ReadonlyMap<ComparisonSignature, LastPerformance | null>
  >(new Map());
  const scrolled = useIsScrolled();

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
    void lastPerformances(wanted, sessionId, canonicalDefinitionId).then(found => {
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

  // Reachable without discarding here: another tab, or another device through sync, can
  // tombstone the session while this screen is open. Logging into it would file sets under
  // a workout that no list shows, so the screen stops being an entry surface.
  if (projection.session.deleted) {
    return (
      <main className="flex flex-col gap-3 p-6" data-testid="workout-discarded">
        <p className="text-chalk">This workout was discarded.</p>
        <p className="text-sm text-ash">
          Its sets are kept — History under Show deleted can restore the whole session.
        </p>
        <button
          type="button"
          className={button({ intent: 'secondary', className: 'self-start px-4' })}
          data-testid="leave-discarded-workout"
          onClick={onDiscarded}
        >
          Home
        </button>
      </main>
    );
  }

  const timerView = timer == null ? null : viewTimer(timer, nowMillis);

  const handlePick = (definition: ExerciseDefinition) => {
    void (async () => {
      const replacing = replaceTargetRef.current;
      if (replacing != null) {
        await removeExercise(sessionId, replacing, Date.now());
        replaceTargetRef.current = null;
      }
      await addExercise(sessionId, definition.id, projection.exercises.length, Date.now());
      setSearchOpen(false);
    })();
  };

  // Volume = sum of load×reps for working sets
  const volumeKg = projection.sets
    .filter(isCountedForVolume)
    .reduce((sum, s) => {
      const kg = s.measurements.canonicalExternalLoadKg ?? 0;
      const reps = s.measurements.reps ?? 0;
      return sum + kg * reps;
    }, 0);

  const durationLabel = projection.session.startedAt != null
    ? (formatDuration(projection.session.startedAt, nowMillis) ?? '0 s')
    : null;

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col" data-testid="workout-screen">
      {/* Header: DURATION / VOLUME / FINISH */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b-2 border-seam bg-ingot px-4 py-3">
        <div className="flex gap-5">
          {durationLabel != null && (
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-widest text-ash">Duration</span>
              <span className="font-display text-sm font-medium uppercase tracking-normal text-chalk" data-testid="set-count">
                {durationLabel}
              </span>
            </div>
          )}
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-widest text-ash">Volume</span>
            <span className="font-display text-sm font-medium uppercase tracking-normal text-chalk">
              {volumeKg > 0 ? `${String(Math.round(volumeKg))} KG` : '—'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="tap-target rounded-[20px] bg-plate-red px-5 font-display text-sm uppercase tracking-normal text-white active:bg-plate-red-pressed"
            data-testid="finish-session"
            onClick={() => {
              void (async () => {
                await finishSession(sessionId, Date.now());
                await dismissRestTimer(sessionId);
                onFinished();
              })();
            }}
          >
            Finish
          </button>
        </div>
      </header>

      {/* Gradient fade: only visible once the user starts scrolling. */}
      <div className="pointer-events-none sticky top-[72px] z-[9] overflow-visible" style={{ height: 0 }} aria-hidden>
        <div className={`h-22 w-full bg-gradient-to-b from-black to-transparent transition-opacity duration-300 ${scrolled ? 'opacity-100' : 'opacity-0'}`} />
      </div>

      <div className="flex flex-col gap-10 px-4 pb-32 pt-4">
        <WakeLockBanner
          state={wakeLock}
          onEnable={() => { void controller.request(); }}
        />

        {plans.map(({ exercise, plan, definition }) => (
          <ExerciseSection
            key={exercise.id}
            exercise={exercise}
            definition={definition}
            plan={plan}
            unit={unit}
            machine={null}
            liveSets={liveSetsByExercise.get(exercise.id) ?? []}
            lastTime={lastTimes.get(plan.comparisonSignature)}
            onLog={values => {
              void (async () => {
                const now = Date.now();
                // First logged set is a user gesture: request the screen lock here
                // rather than through a persistent banner (not in the design).
                void controller.request();
                await logSet(
                  {
                    sessionId,
                    sessionExerciseId: exercise.id,
                    orderIndex: values.orderIndex,
                    enteredLoad: values.load,
                    unit,
                    reps: values.reps,
                    rir: values.rir,
                    comparisonSignature: plan.comparisonSignature,
                    prescription: plan.prescription,
                    setType: values.setType,
                  },
                  now
                );
                await startRestTimer(sessionId, restOverrides.get(exercise.id) ?? plan.restSeconds, now);
                setNowMillis(now);
              })();
            }}
            onAmend={(setId, patch) => { void amendSet(sessionId, setId, patch, Date.now()); }}
            onDelete={setId => { void deleteSet(sessionId, setId, Date.now()); }}
            onRemove={() => { void removeExercise(sessionId, exercise.id, Date.now()); }}
            onReplace={() => { replaceTargetRef.current = exercise.id; setSearchOpen(true); }}
            onReorder={() => { setReorderOpen(true); }}
            onTimer={() => { timerExerciseRef.current = exercise.id; setTimerOpen(true); }}
          />
        ))}

        <button
          type="button"
          className="tap-target w-full rounded-[20px] border-2 border-plate-red font-display text-sm uppercase tracking-normal text-chalk"
          data-testid="add-exercise"
          onClick={() => { setSearchOpen(true); }}
        >
          + Add exercise
        </button>

        {confirmingDiscard ? (
          <div className={card({ className: 'flex flex-col gap-2 p-3' })}>
            <span className="text-sm text-chalk" data-testid="discard-warning">
              {projection.sets.length === 0
                ? 'Discard this workout?'
                : `Discard this workout and its ${String(projection.sets.length)} logged ${
                    projection.sets.length === 1 ? 'set' : 'sets'
                  }?`}{' '}
              <span className="text-ash">Nothing is erased — it moves to History under Show deleted.</span>
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                className={button({ intent: 'secondary', className: 'flex-1' })}
                data-testid="confirm-discard-session"
                onClick={() => {
                  void (async () => {
                    await deleteSession(sessionId, null, Date.now());
                    await dismissRestTimer(sessionId);
                    onDiscarded();
                  })();
                }}
              >
                Discard
              </button>
              <button
                type="button"
                className={button({ intent: 'quiet', className: 'shrink-0 px-4' })}
                data-testid="cancel-discard-session"
                onClick={() => { setConfirmingDiscard(false); }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={button({ intent: 'quiet', className: 'w-full' })}
            data-testid="discard-session"
            onClick={() => { setConfirmingDiscard(true); }}
          >
            Discard workout
          </button>
        )}
      </div>

      {searchOpen && (
        <ExerciseSearchPanel
          onPick={handlePick}
          onClose={() => { setSearchOpen(false); }}
        />
      )}

      {timerOpen && (() => {
        const exId = timerExerciseRef.current;
        const currentPlan = plans.find(p => p.exercise.id === exId);
        const currentSeconds = exId != null
          ? (restOverrides.get(exId) ?? currentPlan?.plan.restSeconds ?? 90)
          : (timer?.durationSeconds ?? 90);
        return (
          <TimerSheet
            currentSeconds={currentSeconds}
            onConfirm={seconds => {
              if (exId != null) {
                setRestOverrides(prev => new Map(prev).set(exId, seconds));
              }
              setTimerOpen(false);
            }}
            onClose={() => { setTimerOpen(false); }}
          />
        );
      })()}

      {reorderOpen && (
        <ReorderSheet
          items={plans.map(({ exercise, plan }) => ({ id: exercise.id, name: plan.name }))}
          onConfirm={orderedIds => {
            void reorderExercises(
              sessionId,
              orderedIds as Parameters<typeof reorderExercises>[1],
              Date.now()
            );
          }}
          onClose={() => { setReorderOpen(false); }}
        />
      )}

      {/* Circular rest timer overlay */}
      {timerView != null && (
        <RestDial
          remainingSeconds={timerView.remainingSeconds}
          overdueSeconds={timerView.overdueSeconds}
          finished={timerView.finished}
          progress={
            timerView.durationSeconds > 0
              ? timerView.remainingSeconds / timerView.durationSeconds
              : 0
          }
          onAdd={() => { void adjustRestTimer(sessionId, 15, Date.now()); }}
          onSubtract={() => { void adjustRestTimer(sessionId, -15, Date.now()); }}
          onDismiss={() => { void dismissRestTimer(sessionId); }}
        />
      )}
    </main>
  );
}

function WakeLockBanner({
  state,
}: {
  state: WakeLockState | null;
  onEnable: () => void;
}) {
  if (state == null) return null;

  // Only surface genuine problems. The normal "tap to enable" affordance is not in
  // the design; the lock is requested silently on the first logged set instead.
  if (state.support.kind === 'silently_broken') {
    return (
      <p className={card({ bordered: true, className: 'p-3 text-xs text-chalk' })} data-testid="wake-lock-broken">
        iOS {state.support.iosVersion} accepts a screen lock request in an installed web app and
        ignores it. Set Settings &rarr; Display &amp; Brightness &rarr; Auto-Lock to Never for this
        workout, or update to iOS 18.4.
      </p>
    );
  }

  return null;
}
