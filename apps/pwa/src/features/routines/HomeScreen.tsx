import { useState } from 'react';
import { type SessionId, type WeightUnit, formatLoad, kilograms } from '@ferrum/domain';
import { startEmptySession, startSession } from '../../data/session-controller.ts';
import { activeSession } from '../../db/event-store.ts';
import { sessionDisplayTitle } from '../history/session-view.ts';
import { listRoutines } from '../../data/routine-store.ts';
import { ScreenShell } from '../../components/ScreenShell.tsx';
import { button, card, eyebrow, mono } from '../../ui.ts';
import { useLiveData } from '../../components/live-data.ts';

export function HomeScreen({
  unit,
  onWorkoutStarted,
  onResumeWorkout,
  onEditRoutine,
  onNewRoutine,
  onOpenHistory,
  onOpenSettings,
}: {
  unit: WeightUnit;
  onWorkoutStarted: (sessionId: SessionId) => void;
  onResumeWorkout: (sessionId: SessionId) => void;
  onEditRoutine: (routineId: string) => void;
  onNewRoutine: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
}) {
  const routines = useLiveData(listRoutines);
  const running = useLiveData(activeSession);
  // Flattened to what the card needs so the JSX carries no narrowing of its own.
  const resumable =
    running != null && running.session != null
      ? {
          id: running.session.id,
          title: sessionDisplayTitle(running),
          sets: running.sets.length,
        }
      : null;
  const [starting, setStarting] = useState(false);

  return (
    <ScreenShell
      title="Ferrum"
      titleClassName="text-4xl"
      action={
        <button
          type="button"
          className={button({ intent: 'quiet', className: 'px-4' })}
          aria-label="Settings"
          data-testid="open-settings"
          onClick={onOpenSettings}
        >
          Settings
        </button>
      }
    >
      {/* Leaving a workout is navigation, not an ending, so the way back in has
          to be the first thing on this screen. Without it a running session is
          invisible until the app is restarted. */}
      {resumable !== null && (
        <button
          type="button"
          className={card({
            className: 'flex items-baseline justify-between gap-3 border-plate-green p-4 text-left',
          })}
          data-testid="resume-workout"
          onClick={() => {
            onResumeWorkout(resumable.id);
          }}
        >
          <span className="min-w-0">
            <span className={eyebrow()}>In progress</span>
            <span className="mt-1 block font-display text-xl font-semibold uppercase">
              {resumable.title}
            </span>
          </span>
          <span className={mono({ className: 'shrink-0 text-xs font-medium text-ash' })}>
            {resumable.sets} sets
          </span>
        </button>
      )}

      {routines?.map(routine => (
        <div key={routine.id} className={card({ className: 'p-4' })} data-testid="routine-card">
          <div className="flex items-baseline justify-between gap-2">
            <div className="min-w-0">
              <p className={eyebrow()}>Routine</p>
              <p
                className="mt-1 font-display text-xl font-semibold uppercase"
                data-testid="routine-name"
              >
                {routine.name}
              </p>
            </div>
            <button
              type="button"
              className={button({ intent: 'quiet', className: 'px-4' })}
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
                  <span className={mono({ className: 'shrink-0 text-sm font-medium text-ash' })}>
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
            className={button({ size: 'lg', className: 'mt-3 w-full' })}
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
          className={button({ intent: 'secondary' })}
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
        className={button({ intent: 'secondary' })}
        data-testid="open-history"
        onClick={onOpenHistory}
      >
        History
      </button>
    </ScreenShell>
  );
}
