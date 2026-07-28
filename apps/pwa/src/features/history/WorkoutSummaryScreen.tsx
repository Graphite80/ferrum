import { useEffect, useState } from 'react';
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
import { type RoutineSlotRecord } from '../../db/ferrum-db.ts';
import { type TopSet, bestPriorSets, topWorkingSet } from '../../db/history.ts';
import { loadSessionPlan } from '../routines/routine-store.ts';
import { exerciseDisplayName, formatDuration } from './session-view.ts';
import { BTN_PRIMARY, CARD, EYEBROW, MONO } from '../../ui.ts';

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
}: {
  sessionId: SessionId;
  unit: WeightUnit;
  onHome: () => void;
}) {
  const [projection, setProjection] = useState<SessionProjection | null>(null);
  const [lines, setLines] = useState<readonly ExerciseSummary[]>([]);

  useEffect(() => {
    void (async () => {
      const [loaded, plan] = await Promise.all([
        loadSession(sessionId),
        loadSessionPlan(sessionId),
      ]);
      setLines(await summarize(loaded, plan?.slots ?? [], unit, sessionId));
      setProjection(loaded);
    })();
  }, [sessionId, unit]);

  if (projection?.session == null) {
    return (
      <main className="p-6 text-ash" data-testid="summary-loading">
        Loading…
      </main>
    );
  }

  const session = projection.session;
  const workingSets = projection.sets.filter(isWorkingSet);
  const volumeKg = workingSets.reduce(
    (sum, set) =>
      sum + (set.measurements.canonicalExternalLoadKg ?? 0) * (set.measurements.reps ?? 0),
    0
  );

  return (
    <main
      className="mx-auto flex min-h-full max-w-md flex-col gap-4 p-4"
      data-testid="workout-summary"
    >
      <header className="border-b border-seam pb-3">
        <p className={EYEBROW}>Workout complete</p>
        <h1 className="font-display text-3xl font-bold tracking-[0.04em] uppercase">
          {session.title ?? 'Workout'}
        </h1>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <SummaryStat
          label="Duration"
          value={
            session.finishedAt == null ? '—' : formatDuration(session.startedAt, session.finishedAt)
          }
          testId="summary-duration"
        />
        <SummaryStat label="Sets" value={String(workingSets.length)} testId="summary-total-sets" />
        <SummaryStat
          label="Volume"
          value={formatLoad(kilograms(volumeKg), unit, 0)}
          testId="summary-volume"
        />
      </div>

      {lines.length > 0 && (
        <ul className="flex flex-col gap-2">
          {lines.map(line => (
            <li key={line.key} className={`${CARD} p-3`} data-testid="summary-exercise">
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
                  <span className={EYEBROW}>Prescribed</span>
                  <span className={`${MONO} font-medium text-ash`} data-testid="summary-prescribed">
                    {line.prescribed ?? '—'}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={EYEBROW}>Done</span>
                  <span className={`${MONO} font-medium text-chalk`} data-testid="summary-actual">
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
        className={`${BTN_PRIMARY} w-full text-lg`}
        data-testid="summary-home"
        onClick={onHome}
      >
        Home
      </button>
    </main>
  );
}

function SummaryStat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className={`${CARD} flex flex-col gap-1 p-3`}>
      <span className={EYEBROW}>{label}</span>
      <span className={`${MONO} text-lg leading-none font-bold text-chalk`} data-testid={testId}>
        {value}
      </span>
    </div>
  );
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
    slot.targetLoadKg == null ? '' : ` @ ${formatLoad(kilograms(slot.targetLoadKg), unit)}`;
  return `${String(slot.sets)} × ${String(slot.targetRepMin)}–${String(slot.targetRepMax)}${load}`;
}

function actualLabel(workingCount: number, top: TopSet | null, unit: WeightUnit): string {
  const sets = `${String(workingCount)} ${workingCount === 1 ? 'set' : 'sets'}`;
  if (top == null) return sets;
  return `${sets} · top ${formatLoad(kilograms(top.loadKg), unit)} × ${String(top.reps)}`;
}

function beatsPrior(top: TopSet, prior: TopSet | null): boolean {
  if (prior == null) return true;
  return top.loadKg > prior.loadKg || (top.loadKg === prior.loadKg && top.reps > prior.reps);
}
