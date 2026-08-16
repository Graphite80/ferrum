import { useState } from 'react';
import {
  type ExerciseDefinition,
  type SessionExercise,
  type SetType,
  type WeightUnit,
  type WorkoutSet,
  type WorkoutSetId,
  displayLoad,
  kilograms,
} from '@ferrum/domain';
import { type LastPerformance } from '../../db/history.ts';
import { type ExercisePlan } from './exercise-plan.ts';
import { type SetPatch } from '../../data/session-controller.ts';
import { DotsIcon } from '../../components/icons.tsx';
import { ActionSheet } from '../../components/ActionSheet.tsx';
import { prescriptionLine } from './set-format.ts';
import { SetSlot } from './SetSlot.tsx';

export interface ExerciseSectionProps {
  readonly exercise: SessionExercise;
  readonly definition: ExerciseDefinition | null;
  readonly plan: ExercisePlan;
  readonly unit: WeightUnit;
  readonly machine: null;
  readonly liveSets: readonly WorkoutSet[];
  readonly lastTime: LastPerformance | null | undefined;
  readonly onLog: (values: { load: number; reps: number; rir: number; setType: SetType; orderIndex: number }) => void;
  readonly onAmend: (setId: WorkoutSetId, patch: SetPatch) => void;
  readonly onDelete: (setId: WorkoutSetId) => void;
  readonly onRemove: () => void;
  readonly onReplace?: () => void;
  readonly onReorder?: () => void;
  readonly onTimer?: () => void;
}

export function ExerciseSection(props: ExerciseSectionProps) {
  const { plan, unit, liveSets, lastTime } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [extraSets, setExtraSets] = useState(0);
  const definition = props.definition;

  // Default values for planned slots come from last logged or last session.
  const lastLogged = liveSets.at(-1) ?? null;
  const defaultLoadKg =
    lastLogged?.measurements.canonicalExternalLoadKg ??
    lastTime?.loadKg ??
    plan.prescription?.targetLoadKg ??
    20;
  const defaultReps =
    lastLogged?.measurements.reps ?? lastTime?.reps ?? plan.prescription?.targetRepMin ?? 8;
  const defaultRir = lastLogged?.measurements.rirEntered ?? plan.prescription?.targetRir?.[1] ?? 2;

  const prescription = prescriptionLine(plan.prescription, unit);

  // Total visible slots: at least as many as are already logged, otherwise the plan.
  const totalSlots = Math.max(liveSets.length, (plan.targetSets ?? 1) + extraSets);

  return (
    <section className="flex flex-col gap-3" data-testid="exercise-section">
      <header className="flex items-center justify-between gap-3">
        <h2
          className="min-w-0 font-display text-[32px] font-semibold uppercase leading-[28px] text-plate-red"
          data-testid="exercise-title"
        >
          {definition == null ? (
            plan.name
          ) : (
            plan.name
          )}
        </h2>
        <button
          type="button"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[19px] border-2 border-seam text-ash"
          aria-label={`Options for ${plan.name}`}
          data-testid="exercise-menu"
          onClick={() => { setMenuOpen(open => !open); }}
        >
          <DotsIcon />
        </button>
      </header>

      {menuOpen && (
        <ActionSheet
          title={plan.name}
          onClose={() => { setMenuOpen(false); }}
          actions={[
            ...(props.onReplace != null
              ? [{ label: 'Replace', onClick: () => { props.onReplace?.(); } }]
              : []),
            ...(props.onReorder != null
              ? [{ label: 'Reorder', onClick: () => { props.onReorder?.(); } }]
              : []),
            ...(props.onTimer != null
              ? [{ label: 'Timer', onClick: () => { props.onTimer?.(); } }]
              : []),
            { label: 'Remove', onClick: () => { props.onRemove(); }, destructive: true },
          ]}
        />
      )}

      <ul className="flex flex-col gap-2">
        {Array.from({ length: totalSlots }).map((_, i) => {
          const loggedSet = liveSets.find(s => s.orderIndex === i) ?? null;
          return (
            <SetSlot
              key={i}
              slotIndex={i}
              unit={unit}
              defaultLoad={displayLoad(kilograms(defaultLoadKg), unit)}
              defaultReps={defaultReps}
              defaultRir={defaultRir}
              prescription={prescription}
              lastTime={lastTime}
              isWarmup={i === 0}
              loggedSet={loggedSet}
              onLog={values => { props.onLog({ ...values, orderIndex: i }); }}
              onUnlog={() => { if (loggedSet != null) props.onDelete(loggedSet.id); }}
              onAmend={patch => { if (loggedSet != null) props.onAmend(loggedSet.id, patch); }}
            />
          );
        })}
      </ul>

      <button
        type="button"
        className="tap-target w-full rounded-[20px] border-2 border-seam font-display text-sm uppercase tracking-normal text-ash"
        data-testid="add-set"
        onClick={() => { setExtraSets(n => n + 1); }}
      >
        + Add set
      </button>

    </section>
  );
}
