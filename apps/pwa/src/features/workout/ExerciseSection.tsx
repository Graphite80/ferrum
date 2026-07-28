import { useState } from 'react';
import {
  type SessionExercise,
  type SetPrescriptionSnapshot,
  type WorkoutSet,
  type WorkoutSetId,
} from '@ferrum/domain';
import { type LastPerformance } from '../../db/history.ts';
import { type ExercisePlan } from './exercise-plan.ts';
import { LoggedSetRow } from './LoggedSetRow.tsx';
import { type SetPatch } from './session-controller.ts';
import { SetRow } from './SetRow.tsx';

export interface ExerciseSectionProps {
  readonly exercise: SessionExercise;
  readonly plan: ExercisePlan;
  readonly liveSets: readonly WorkoutSet[];
  // undefined = history lookup still running; null = looked up, nothing found
  readonly lastTime: LastPerformance | null | undefined;
  readonly onLog: (values: { loadKg: number; reps: number; rir: number }) => void;
  readonly onAmend: (setId: WorkoutSetId, patch: SetPatch) => void;
  readonly onDelete: (setId: WorkoutSetId) => void;
  readonly onRemove: () => void;
}

export function ExerciseSection(props: ExerciseSectionProps) {
  const { plan, liveSets, lastTime } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);

  const lastLogged = liveSets.at(-1) ?? null;
  const lastTimeResolved = liveSets.length > 0 || lastTime !== undefined;
  const done = plan.targetSets != null && liveSets.length >= plan.targetSets;
  const showEntry = lastTimeResolved && (!done || extraOpen);

  const defaultLoadKg =
    lastLogged?.measurements.enteredLoad ??
    lastTime?.loadKg ??
    plan.prescription?.targetLoadKg ??
    20;
  const defaultReps =
    lastLogged?.measurements.reps ?? lastTime?.reps ?? plan.prescription?.targetRepMin ?? 8;
  const defaultRir = lastLogged?.measurements.rirEntered ?? plan.prescription?.targetRir?.[1] ?? 2;

  const previousLabel =
    lastLogged != null
      ? `Previous: ${String(lastLogged.measurements.enteredLoad ?? 0)} kg × ${String(lastLogged.measurements.reps ?? 0)}`
      : lastTime?.loadKg != null
        ? `Last time: ${String(lastTime.loadKg)} kg × ${String(lastTime.reps ?? 0)}`
        : 'no previous set';

  return (
    <section className="flex flex-col gap-2" data-testid="exercise-section">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold" data-testid="exercise-title">
          {plan.name}{' '}
          <span className="text-xs font-normal text-neutral-500" data-testid="exercise-set-count">
            {plan.targetSets == null
              ? `${String(liveSets.length)} sets`
              : `${String(liveSets.length)}/${String(plan.targetSets)}`}
          </span>
        </h2>
        {liveSets.length === 0 && (
          <button
            type="button"
            className="tap-target rounded-lg border border-edge px-4 text-lg text-neutral-400"
            aria-label={`Options for ${plan.name}`}
            data-testid="exercise-menu"
            onClick={() => {
              setMenuOpen(open => !open);
            }}
          >
            &#8943;
          </button>
        )}
      </header>

      {menuOpen && liveSets.length === 0 && (
        <button
          type="button"
          className="tap-target rounded-xl border border-edge text-sm text-red-300"
          data-testid="remove-exercise"
          onClick={() => {
            setMenuOpen(false);
            props.onRemove();
          }}
        >
          Remove exercise
        </button>
      )}

      <ul className="flex flex-col gap-2">
        {liveSets.map((set, index) => (
          <LoggedSetRow
            key={set.id}
            position={index + 1}
            set={set}
            incrementKg={plan.incrementKg}
            onAmend={patch => {
              props.onAmend(set.id, patch);
            }}
            onDelete={() => {
              props.onDelete(set.id);
            }}
          />
        ))}
        {showEntry && (
          <SetRow
            key={`entry-${String(liveSets.length)}-${lastTime == null ? 'none' : 'seen'}`}
            index={liveSets.length}
            previousLabel={previousLabel}
            targetLabel={targetLabel(plan.prescription)}
            defaultLoadKg={defaultLoadKg}
            defaultReps={defaultReps}
            defaultRir={defaultRir}
            incrementKg={plan.incrementKg}
            onComplete={props.onLog}
          />
        )}
      </ul>

      {lastTimeResolved && done && !extraOpen && (
        <>
          <p className="rounded-xl border border-done bg-done/20 p-3 text-sm">
            All {plan.targetSets} sets logged
          </p>
          <button
            type="button"
            className="tap-target rounded-xl border border-edge text-sm text-neutral-300"
            data-testid="add-set"
            onClick={() => {
              setExtraOpen(true);
            }}
          >
            + Add set
          </button>
        </>
      )}
    </section>
  );
}

function targetLabel(prescription: SetPrescriptionSnapshot | null): string | null {
  if (prescription == null) return null;
  const parts: string[] = [];
  if (prescription.targetLoadKg != null) parts.push(`${String(prescription.targetLoadKg)} kg`);
  if (prescription.targetRepMin != null && prescription.targetRepMax != null) {
    parts.push(`${String(prescription.targetRepMin)}–${String(prescription.targetRepMax)}`);
  }
  const joined = parts.join(' × ');
  const rir =
    prescription.targetRir != null
      ? `@ ${String(prescription.targetRir[0])}–${String(prescription.targetRir[1])} RIR`
      : '';
  const label = [joined, rir].filter(Boolean).join(' ');
  return label.length > 0 ? label : null;
}
