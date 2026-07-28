import { useEffect, useState } from 'react';
import { type SessionId, type WeightUnit, formatLoad, kilograms } from '@ferrum/domain';
import { type RoutineRecord } from '../../db/ferrum-db.ts';
import { startEmptySession, startSession } from '../../data/session-controller.ts';
import { listRoutines } from '../../data/routine-store.ts';
import { BTN_PRIMARY, BTN_QUIET, BTN_SECONDARY, CARD, EYEBROW, MONO } from '../../ui.ts';

export function HomeScreen({
  unit,
  onWorkoutStarted,
  onEditRoutine,
  onNewRoutine,
  onOpenHistory,
  onOpenSettings,
}: {
  unit: WeightUnit;
  onWorkoutStarted: (sessionId: SessionId) => void;
  onEditRoutine: (routineId: string) => void;
  onNewRoutine: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
}) {
  const [routines, setRoutines] = useState<RoutineRecord[] | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    void listRoutines().then(setRoutines);
  }, []);

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between border-b border-seam pb-3">
        <h1 className="font-display text-4xl font-bold tracking-[0.04em] uppercase">Ferrum</h1>
        <button
          type="button"
          className={`${BTN_QUIET} px-4`}
          aria-label="Settings"
          data-testid="open-settings"
          onClick={onOpenSettings}
        >
          Settings
        </button>
      </header>

      {routines?.map(routine => (
        <div key={routine.id} className={`${CARD} p-4`} data-testid="routine-card">
          <div className="flex items-baseline justify-between gap-2">
            <div className="min-w-0">
              <p className={EYEBROW}>Routine</p>
              <p
                className="mt-1 font-display text-xl font-semibold uppercase"
                data-testid="routine-name"
              >
                {routine.name}
              </p>
            </div>
            <button
              type="button"
              className={`${BTN_QUIET} px-4`}
              data-testid="edit-routine"
              onClick={() => {
                onEditRoutine(routine.id);
              }}
            >
              Edit
            </button>
          </div>
          {routine.slots.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2 border-t border-seam pt-3 text-sm">
              {routine.slots.map(slot => (
                <li
                  key={slot.exerciseDefinitionId}
                  className="flex items-baseline justify-between gap-2"
                >
                  <span className="min-w-0">{slot.name}</span>
                  <span className={`${MONO} shrink-0 text-sm font-medium text-ash`}>
                    {slot.sets} × {slot.targetRepMin}–{slot.targetRepMax}
                    {slot.targetLoadKg != null &&
                      ` @ ${formatLoad(kilograms(slot.targetLoadKg), { unit })}`}
                    {` · RIR ${String(slot.targetRirMin)}–${String(slot.targetRirMax)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled={starting || routine.slots.length === 0}
            className={`${BTN_PRIMARY} mt-3 w-full text-lg`}
            data-testid="start-routine"
            onClick={() => {
              setStarting(true);
              void (async () => {
                const sessionId = await startSession(routine, Date.now());
                onWorkoutStarted(sessionId);
              })();
            }}
          >
            Start {routine.name}
          </button>
        </div>
      ))}

      {routines != null && (
        <button
          type="button"
          className={BTN_SECONDARY}
          data-testid="new-routine"
          onClick={onNewRoutine}
        >
          + New routine
        </button>
      )}

      <button
        type="button"
        disabled={starting}
        className="tap-target rounded-md border border-chalk/35 text-base text-chalk disabled:opacity-50"
        data-testid="start-empty-workout"
        onClick={() => {
          setStarting(true);
          void (async () => {
            const sessionId = await startEmptySession(Date.now());
            onWorkoutStarted(sessionId);
          })();
        }}
      >
        Start empty workout
      </button>
      <button
        type="button"
        className={BTN_SECONDARY}
        data-testid="open-history"
        onClick={onOpenHistory}
      >
        History
      </button>
    </main>
  );
}
