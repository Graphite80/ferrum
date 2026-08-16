import { useLiveData } from '../../components/live-data.ts';
import { useState } from 'react';
import {
  type ComparisonSignature,
  type SessionId,
  type SessionProjection,
  type WeightUnit,
  formatLoad,
  isWorkingSet,
  kilograms,
} from '@ferrum/domain';
import { loadSession } from '../../db/event-store.ts';
import { type RoutineSlotRecord, type SessionPlanRecord } from '../../db/ferrum-db.ts';
import { type TopSet, bestPriorSets, topWorkingSet } from '../../db/history.ts';
import {
  getRoutine,
  loadSessionPlan,
  loadSessionPlanSlots,
  newRoutine,
  putRoutine,
  slotFromDefinition,
} from '../../data/routine-store.ts';
import { resolveDefinition } from '../workout/exercise-plan.ts';
import { exerciseDisplayName, formatDuration, sessionDisplayTitle } from './session-view.ts';
import { ScreenShell } from '../../components/ScreenShell.tsx';
import { StatCard } from '../../components/StatCard.tsx';
import { button, card, eyebrow, mono } from '../../ui.ts';
import { formatSetCount } from '../../data/labels.ts';

interface ExerciseSummary {
  readonly key: string;
  readonly name: string;
  readonly prescribed: string | null;
  readonly actual: string;
  readonly isRecord: boolean;
}

export function WorkoutSummaryScreen({
  sessionId,
  unit,
  onHome,
  onSaveAsRoutine,
}: {
  sessionId: SessionId;
  unit: WeightUnit;
  onHome: () => void;
  onSaveAsRoutine?: (routineId: string) => void;
}) {
  const view = useLiveData(async () => {
    const [projection, planSlots, sessionPlan] = await Promise.all([
      loadSession(sessionId),
      loadSessionPlanSlots(sessionId),
      loadSessionPlan(sessionId),
    ]);
    return {
      projection,
      planSlots,
      sessionPlan,
      lines: await summarize(projection, planSlots, unit, sessionId),
    };
  }, [sessionId, unit]);

  const session = view?.projection.session;
  const [routineActionDone, setRoutineActionDone] = useState(false);
  if (view == null || session == null) {
    return (
      <main className="p-6 text-ash" data-testid="summary-loading">
        Loading…
      </main>
    );
  }

  const { projection, planSlots, sessionPlan, lines } = view;

  // Detect whether the session is an empty workout or a modified routine workout.
  const hasRoutine = sessionPlan != null;
  const isEmptyWorkout = !hasRoutine && projection.exercises.length > 0;
  const isModified = hasRoutine && detectModifications(projection, planSlots);
  const showRoutinePrompt = !routineActionDone && (isEmptyWorkout || isModified);
  const workingSets = projection.sets.filter(isWorkingSet);
  const volumeKg = workingSets.reduce(
    (sum, set) =>
      sum + (set.measurements.canonicalExternalLoadKg ?? 0) * (set.measurements.reps ?? 0),
    0
  );

  return (
    <ScreenShell
      title={sessionDisplayTitle(projection)}
      titleClassName="text-3xl"
      eyebrowText="Workout complete"
      testId="workout-summary"
    >
      <div className="grid grid-cols-3 gap-2">
        <StatCard
          label="Duration"
          value={
            (session.finishedAt == null
              ? null
              : formatDuration(session.startedAt, session.finishedAt)) ?? '—'
          }
          valueTestId="summary-duration"
        />
        <StatCard
          label="Sets"
          value={String(workingSets.length)}
          valueTestId="summary-total-sets"
        />
        <StatCard
          label="Volume"
          value={formatLoad(kilograms(volumeKg), { unit, fractionDigits: 0 })}
          valueTestId="summary-volume"
        />
      </div>

      {lines.length > 0 && (
        <ul className="flex flex-col gap-2">
          {lines.map(line => (
            <li
              key={line.key}
              className={card({ className: 'p-3' })}
              data-testid="summary-exercise"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="min-w-0 font-display text-lg leading-tight font-semibold uppercase">
                  {line.name}
                </h2>
                {line.isRecord && (
                  <span
                    className="shrink-0 rounded-[2px] bg-plate-green px-2 py-0.5 font-display text-[11px] font-semibold tracking-[0.06em] text-white uppercase"
                    data-testid="summary-pr-badge"
                  >
                    New PR
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-col gap-1 border-t border-seam pt-2 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={eyebrow()}>Prescribed</span>
                  <span
                    className={mono({ className: 'text-[14px] font-medium text-ash' })}
                    data-testid="summary-prescribed"
                  >
                    {line.prescribed ?? '—'}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={eyebrow()}>Done</span>
                  <span
                    className={mono({ className: 'text-[14px] font-medium text-chalk' })}
                    data-testid="summary-actual"
                  >
                    {line.actual}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className={button({ size: 'lg', className: 'w-full' })}
        data-testid="summary-home"
        onClick={onHome}
      >
        Home
      </button>

      {showRoutinePrompt && (
        isEmptyWorkout ? (
          <button
            type="button"
            className="tap-target w-full rounded-[20px] border-2 border-plate-red font-display text-sm uppercase tracking-normal text-chalk"
            data-testid="save-as-routine"
            onClick={() => {
              void (async () => {
                const routineId = await createRoutineFromSession(projection);
                if (routineId != null) {
                  setRoutineActionDone(true);
                  onSaveAsRoutine?.(routineId);
                }
              })();
            }}
          >
            Save as routine
          </button>
        ) : (
          <div className={card({ className: 'flex items-center justify-between gap-3 p-3' })}>
            <p className="text-sm text-chalk" data-testid="update-routine-prompt">
              Save changes to{' '}
              <span className="font-display uppercase">{sessionPlan?.routineName}</span>?
            </p>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                className={button({ intent: 'primary', className: 'px-4' })}
                data-testid="update-routine-confirm"
                onClick={() => {
                  void (async () => {
                    if (sessionPlan != null) {
                      await updateRoutineFromSession(sessionPlan, projection, planSlots);
                    }
                    setRoutineActionDone(true);
                  })();
                }}
              >
                Save
              </button>
              <button
                type="button"
                className={button({ intent: 'quiet', className: 'px-4' })}
                data-testid="update-routine-dismiss"
                onClick={() => { setRoutineActionDone(true); }}
              >
                Skip
              </button>
            </div>
          </div>
        )
      )}
    </ScreenShell>
  );
}

// Returns true when the workout's exercises or set counts diverge from the original plan.
function detectModifications(
  projection: SessionProjection,
  planSlots: readonly RoutineSlotRecord[]
): boolean {
  const planDefIds = new Set(planSlots.map(s => s.exerciseDefinitionId as string));
  const sessionDefIds = new Set(projection.exercises.map(e => e.exerciseDefinitionId as string));
  for (const id of planDefIds) if (!sessionDefIds.has(id)) return true;
  for (const id of sessionDefIds) if (!planDefIds.has(id)) return true;
  for (const slot of planSlots) {
    const exercise = projection.exercises.find(e => e.exerciseDefinitionId === slot.exerciseDefinitionId);
    if (exercise == null) continue;
    const logged = projection.sets.filter(s => s.sessionExerciseId === exercise.id && isWorkingSet(s)).length;
    if (logged > slot.sets) return true;
  }
  return false;
}

// Creates a new routine from an empty-workout session; returns the new routineId.
async function createRoutineFromSession(projection: SessionProjection): Promise<string | null> {
  const slots = projection.exercises
    .map(ex => {
      const def = resolveDefinition(ex.exerciseDefinitionId);
      return def != null ? slotFromDefinition(def) : null;
    })
    .filter((s): s is RoutineSlotRecord => s != null);
  if (slots.length === 0) return null;
  const routine = { ...newRoutine(Date.now()), name: sessionDisplayTitle(projection) || 'New routine', slots };
  await putRoutine(routine);
  return routine.id;
}

// Updates the original routine's exercise list and set counts from the session.
async function updateRoutineFromSession(
  sessionPlan: SessionPlanRecord,
  projection: SessionProjection,
  planSlots: readonly RoutineSlotRecord[]
): Promise<void> {
  const routine = await getRoutine(sessionPlan.routineId);
  if (routine == null) return;
  const slots = projection.exercises
    .map(exercise => {
      const original = planSlots.find(s => s.exerciseDefinitionId === exercise.exerciseDefinitionId);
      if (original != null) {
        const logged = projection.sets.filter(s => s.sessionExerciseId === exercise.id && isWorkingSet(s)).length;
        return { ...original, sets: Math.max(original.sets, logged) };
      }
      const def = resolveDefinition(exercise.exerciseDefinitionId);
      return def != null ? slotFromDefinition(def) : null;
    })
    .filter((s): s is RoutineSlotRecord => s != null);
  await putRoutine({ ...routine, slots, updatedAtMillis: Date.now() });
}

async function summarize(
  projection: SessionProjection,
  planSlots: readonly RoutineSlotRecord[],
  unit: WeightUnit,
  sessionId: SessionId
): Promise<ExerciseSummary[]> {
  const perExercise = projection.exercises
    .map(exercise => {
      const sets = projection.sets.filter(set => set.sessionExerciseId === exercise.id);
      const top = topWorkingSet(sets);
      const signature = sets.find(set => isWorkingSet(set))?.comparisonSignature ?? null;
      return { exercise, sets, top, signature };
    })
    .filter(entry => entry.sets.length > 0);

  const signatures = [
    ...new Set(
      perExercise
        .map(entry => entry.signature)
        .filter((signature): signature is ComparisonSignature => signature != null)
    ),
  ];
  const priorBests = await bestPriorSets(signatures, sessionId);

  return perExercise.map(({ exercise, sets, top, signature }) => {
    const slot = planSlots.find(s => s.exerciseDefinitionId === exercise.exerciseDefinitionId);
    const workingCount = sets.filter(isWorkingSet).length;
    const prior = signature == null ? null : (priorBests.get(signature) ?? null);
    return {
      key: exercise.id,
      name: exerciseDisplayName(exercise, planSlots),
      prescribed: slot == null ? null : prescribedLabel(slot, unit),
      actual: actualLabel(workingCount, top, unit),
      isRecord: top != null && beatsPrior(top, prior),
    };
  });
}

function prescribedLabel(slot: RoutineSlotRecord, unit: WeightUnit): string {
  const load =
    slot.targetLoadKg == null ? '' : ` @ ${formatLoad(kilograms(slot.targetLoadKg), { unit })}`;
  return `${String(slot.sets)} × ${String(slot.targetRepMin)}–${String(slot.targetRepMax)}${load}`;
}

function actualLabel(workingCount: number, top: TopSet | null, unit: WeightUnit): string {
  const sets = formatSetCount(workingCount);
  if (top == null) return sets;
  return `${sets} · top ${formatLoad(kilograms(top.loadKg), { unit })} × ${String(top.reps)}`;
}

function beatsPrior(top: TopSet, prior: TopSet | null): boolean {
  if (prior == null) return true;
  return top.loadKg > prior.loadKg || (top.loadKg === prior.loadKg && top.reps > prior.reps);
}
