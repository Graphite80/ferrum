import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type SessionId, type SessionProjection, type WorkoutSetId } from '@ferrum/domain';
import { listSessionIds, loadSession, subscribe, unacknowledgedCount } from './db/event-store.ts';
import { type RestTimerRecord } from './db/ferrum-db.ts';
import {
  deleteSet,
  finishSession,
  logSet,
  restoreSet,
  sessionExerciseIdFor,
  startSession,
} from './features/workout/session-controller.ts';
import {
  dismissRestTimer,
  formatClock,
  loadRestTimer,
  startRestTimer,
  viewTimer,
} from './features/workout/rest-timer.ts';
import { SEED_ROUTINE, type RoutineSlot } from './features/workout/routine.ts';
import { SetRow } from './features/workout/SetRow.tsx';
import { WakeLockController, type WakeLockState } from './platform/wake-lock.ts';

type Screen = { name: 'home' } | { name: 'workout'; sessionId: SessionId } | { name: 'history' };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [booted, setBooted] = useState(false);

  // Resuming happens before anything is painted. A user who force-quit mid-workout
  // must land back inside that workout, not on a home screen that implies it is gone.
  useEffect(() => {
    void (async () => {
      for (const sessionId of await listSessionIds()) {
        const projection = await loadSession(sessionId);
        if (projection.session?.status === 'active') {
          setScreen({ name: 'workout', sessionId });
          break;
        }
      }
      setBooted(true);
    })();
  }, []);

  if (!booted) {
    return (
      <main className="p-6 text-neutral-400" data-testid="booting">
        Restoring…
      </main>
    );
  }

  switch (screen.name) {
    case 'home':
      return <HomeScreen onNavigate={setScreen} />;
    case 'workout':
      return (
        <WorkoutScreen
          sessionId={screen.sessionId}
          onFinished={() => {
            setScreen({ name: 'history' });
          }}
        />
      );
    case 'history':
      return <HistoryScreen onNavigate={setScreen} />;
  }
}

function HomeScreen({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  const [starting, setStarting] = useState(false);

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold">Ferrum</h1>
      <p className="text-sm text-neutral-400">{SEED_ROUTINE.name}</p>
      <ul className="text-sm text-neutral-300">
        {SEED_ROUTINE.slots.map(slot => (
          <li key={slot.exerciseDefinitionId} className="py-1">
            {slot.name} — {slot.sets} × {slot.targetRepMin}–{slot.targetRepMax}
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={starting}
        className="tap-target rounded-xl bg-accent text-lg font-bold text-black disabled:opacity-50"
        data-testid="start-routine"
        onClick={() => {
          setStarting(true);
          void (async () => {
            const sessionId = await startSession(SEED_ROUTINE, Date.now());
            onNavigate({ name: 'workout', sessionId });
          })();
        }}
      >
        Start {SEED_ROUTINE.name}
      </button>
      <button
        type="button"
        className="tap-target rounded-xl border border-edge text-base"
        data-testid="open-history"
        onClick={() => {
          onNavigate({ name: 'history' });
        }}
      >
        History
      </button>
    </main>
  );
}

function WorkoutScreen({
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
  const [lastSetId, setLastSetId] = useState<WorkoutSetId | null>(null);

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

  const setsByExercise = useMemo(() => {
    const map = new Map<string, SessionProjection['sets'][number][]>();
    for (const set of projection?.sets ?? []) {
      const existing = map.get(set.sessionExerciseId);
      if (existing == null) map.set(set.sessionExerciseId, [set]);
      else existing.push(set);
    }
    return map;
  }, [projection]);

  if (projection?.session == null) {
    return (
      <main className="p-6 text-neutral-400" data-testid="loading-workout">
        Loading workout…
      </main>
    );
  }

  const timerView = timer == null ? null : viewTimer(timer, nowMillis);

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

      {SEED_ROUTINE.slots.map((slot, slotIndex) => {
        const sessionExerciseId = sessionExerciseIdFor(sessionId, slotIndex);
        const logged = setsByExercise.get(sessionExerciseId) ?? [];
        return (
          <ExerciseBlock
            key={slot.exerciseDefinitionId}
            slot={slot}
            loggedCount={logged.length}
            lastLoadKg={logged.at(-1)?.measurements.enteredLoad ?? null}
            lastReps={logged.at(-1)?.measurements.reps ?? null}
            onLog={values => {
              void (async () => {
                const now = Date.now();
                const setId = await logSet(
                  {
                    sessionId,
                    sessionExerciseId,
                    slot,
                    orderIndex: logged.length,
                    loadKg: values.loadKg,
                    reps: values.reps,
                    rir: values.rir,
                  },
                  now
                );
                setLastSetId(setId);
                setTimer(await startRestTimer(sessionId, slot.restSeconds, now));
                setNowMillis(now);
              })();
            }}
          />
        );
      })}

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

      {lastSetId != null && (
        <button
          type="button"
          className="tap-target rounded-xl border border-edge text-sm text-neutral-300"
          data-testid="undo-last-set"
          onClick={() => {
            void (async () => {
              await deleteSet(sessionId, lastSetId, Date.now());
              setLastSetId(null);
            })();
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

function ExerciseBlock({
  slot,
  loggedCount,
  lastLoadKg,
  lastReps,
  onLog,
}: {
  slot: RoutineSlot;
  loggedCount: number;
  lastLoadKg: number | null;
  lastReps: number | null;
  onLog: (values: { loadKg: number; reps: number; rir: number }) => void;
}) {
  const done = loggedCount >= slot.sets;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">
        {slot.name}{' '}
        <span className="text-xs font-normal text-neutral-500">
          {loggedCount}/{slot.sets}
        </span>
      </h2>
      {done ? (
        <p className="rounded-xl border border-done bg-done/20 p-3 text-sm">
          All {slot.sets} sets logged
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          <SetRow
            index={loggedCount}
            previousLabel={
              lastLoadKg == null
                ? 'no previous set'
                : `Previous: ${String(lastLoadKg)} kg × ${String(lastReps ?? 0)}`
            }
            targetLabel={`${String(slot.targetLoadKg)} kg × ${String(slot.targetRepMin)}–${String(slot.targetRepMax)} @ ${String(slot.targetRir[0])}–${String(slot.targetRir[1])} RIR`}
            defaultLoadKg={lastLoadKg ?? slot.targetLoadKg}
            defaultReps={lastReps ?? slot.targetRepMin}
            defaultRir={slot.targetRir[1]}
            incrementKg={slot.incrementKg}
            onComplete={onLog}
          />
        </ul>
      )}
    </section>
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

function HistoryScreen({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
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
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">History</h1>
        <button
          type="button"
          className="tap-target rounded-lg border border-edge px-4 text-sm"
          data-testid="back-home"
          onClick={() => {
            onNavigate({ name: 'home' });
          }}
        >
          Home
        </button>
      </header>

      <p className="text-xs text-neutral-500" data-testid="pending-events">
        {pending} events not yet synced
      </p>

      {sessions == null ? (
        <p className="text-neutral-400">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="text-neutral-400" data-testid="history-empty">
          No sessions yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="history-list">
          {sessions.map(projection => (
            <li
              key={projection.sessionId}
              className="rounded-xl border border-edge bg-surface p-3"
              data-testid="history-item"
            >
              <div className="flex justify-between text-sm">
                <span>{projection.session?.title ?? 'Workout'}</span>
                <span className="text-neutral-400">{projection.session?.localDate}</span>
              </div>
              <div className="mt-1 text-xs text-neutral-500">
                {projection.sets.length} sets · {projection.session?.status}
                {projection.session?.amendedAfterFinish === true && ' · edited after finish'}
                {projection.deletedSets.length > 0 &&
                  ` · ${String(projection.deletedSets.length)} deleted`}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
