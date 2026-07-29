import { useState } from 'react';
import {
  type ExerciseDefinition,
  type SessionExercise,
  type SetPrescriptionSnapshot,
  type WeightUnit,
  type WorkoutSet,
  type WorkoutSetId,
  displayLoad,
  formatLoad,
  kilograms,
} from '@ferrum/domain';
import { type EquipmentRecord } from '../../db/ferrum-db.ts';
import { describeEquipment } from '../../data/equipment-store.ts';
import { EquipmentPickerSheet } from './EquipmentPickerSheet.tsx';
import { type LastPerformance } from '../../db/history.ts';
import { displayStep } from '../../data/settings-store.ts';
import { ExerciseDemoSheet } from './ExerciseDemoSheet.tsx';
import { ExerciseFigure } from '../../components/ExerciseFigure.tsx';
import { type ExercisePlan } from './exercise-plan.ts';
import { LoggedSetRow } from './LoggedSetRow.tsx';
import { PlateSleeve } from './PlateSleeve.tsx';
import { type SetPatch } from '../../data/session-controller.ts';
import { SetRow } from './SetRow.tsx';
import { button, mono } from '../../ui.ts';

export interface ExerciseSectionProps {
  readonly exercise: SessionExercise;
  // Resolved once by the screen so the plan, the machine and the diagram cannot
  // disagree about which library definition this exercise is.
  readonly definition: ExerciseDefinition | null;
  readonly plan: ExercisePlan;
  readonly unit: WeightUnit;
  readonly machine: EquipmentRecord | null;
  readonly liveSets: readonly WorkoutSet[];
  // undefined = history lookup still running; null = looked up, nothing found
  readonly lastTime: LastPerformance | null | undefined;
  readonly onLog: (values: { load: number; reps: number; rir: number }) => void;
  readonly onAmend: (setId: WorkoutSetId, patch: SetPatch) => void;
  readonly onDelete: (setId: WorkoutSetId) => void;
  readonly onRemove: () => void;
}

export function ExerciseSection(props: ExerciseSectionProps) {
  const { plan, unit, liveSets, lastTime } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [machineOpen, setMachineOpen] = useState(false);
  const definition = props.definition;

  const lastLogged = liveSets.at(-1) ?? null;
  const lastTimeResolved = liveSets.length > 0 || lastTime !== undefined;
  const done = plan.targetSets != null && liveSets.length >= plan.targetSets;
  const showEntry = lastTimeResolved && (!done || extraOpen);

  const defaultLoadKg =
    lastLogged?.measurements.canonicalExternalLoadKg ??
    lastTime?.loadKg ??
    plan.prescription?.targetLoadKg ??
    20;
  const defaultReps =
    lastLogged?.measurements.reps ?? lastTime?.reps ?? plan.prescription?.targetRepMin ?? 8;
  const defaultRir = lastLogged?.measurements.rirEntered ?? plan.prescription?.targetRir?.[1] ?? 2;

  const previousLabel =
    lastLogged != null
      ? `Previous: ${formatLoad(lastLogged.measurements.canonicalExternalLoadKg, { unit })} × ${String(lastLogged.measurements.reps ?? 0)}`
      : lastTime?.loadKg != null
        ? `${lastTime.sameEquipment ? 'Last time' : 'Other machine'}: ${formatLoad(kilograms(lastTime.loadKg), { unit })} × ${String(lastTime.reps ?? 0)}`
        : 'no previous set';

  return (
    <section className="flex flex-col gap-2" data-testid="exercise-section">
      <header className="flex items-center justify-between gap-3">
        <h2
          className="min-w-0 font-display text-lg leading-tight font-semibold uppercase"
          data-testid="exercise-title"
        >
          {definition == null ? (
            plan.name
          ) : (
            <button
              type="button"
              className="flex min-h-11 items-center gap-2 text-left uppercase"
              aria-label={`How to do ${plan.name}`}
              data-testid="open-exercise-demo"
              onClick={() => {
                setDemoOpen(true);
              }}
            >
              <ExerciseFigure definition={definition} size={48} variant="thumbnail" />
              <span className="min-w-0">{plan.name}</span>
            </button>
          )}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          <PlateSleeve completed={liveSets.length} target={plan.targetSets} />
          <span
            className={mono({ className: 'text-xs font-medium text-ash' })}
            data-testid="exercise-set-count"
          >
            {plan.targetSets == null
              ? `${String(liveSets.length)} sets`
              : `${String(liveSets.length)}/${String(plan.targetSets)}`}
          </span>
          {liveSets.length === 0 && (
            <button
              type="button"
              className="tap-target rounded-md px-3 text-lg text-ash"
              aria-label={`Options for ${plan.name}`}
              data-testid="exercise-menu"
              onClick={() => {
                setMenuOpen(open => !open);
              }}
            >
              &#8943;
            </button>
          )}
        </div>
      </header>

      {menuOpen && liveSets.length === 0 && (
        <button
          type="button"
          className={button({ intent: 'quiet' })}
          data-testid="remove-exercise"
          onClick={() => {
            setMenuOpen(false);
            props.onRemove();
          }}
        >
          Remove exercise
        </button>
      )}

      {plan.needsEquipment && definition != null && (
        <button
          type="button"
          className={button({
            intent: 'quiet',
            className: 'flex items-center justify-between gap-2 px-3 text-left',
          })}
          data-testid="open-equipment-picker"
          onClick={() => {
            setMachineOpen(true);
          }}
        >
          <span className="truncate">
            {props.machine == null ? 'Which machine?' : describeEquipment(props.machine)}
          </span>
          <span className="shrink-0 text-xs text-ash">
            {props.machine == null ? 'not set' : 'change'}
          </span>
        </button>
      )}

      <ul className="flex flex-col gap-2">
        {liveSets.map((set, index) => (
          <LoggedSetRow
            key={set.id}
            position={index + 1}
            set={set}
            unit={unit}
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
            unit={unit}
            previousLabel={previousLabel}
            targetLabel={targetLabel(plan.prescription, unit)}
            defaultLoad={displayLoad(kilograms(defaultLoadKg), unit)}
            defaultReps={defaultReps}
            defaultRir={defaultRir}
            incrementStep={displayStep(plan.incrementKg, unit)}
            onComplete={props.onLog}
          />
        )}
      </ul>

      {lastTimeResolved && done && !extraOpen && (
        <>
          <p className="rounded-md border border-plate-green bg-plate-green/15 p-3 text-sm text-chalk">
            All {plan.targetSets} sets logged
          </p>
          <button
            type="button"
            className={button({ intent: 'quiet' })}
            data-testid="add-set"
            onClick={() => {
              setExtraOpen(true);
            }}
          >
            + Add set
          </button>
        </>
      )}

      {machineOpen && definition != null && (
        <EquipmentPickerSheet
          definition={definition}
          selectedId={props.machine?.id ?? null}
          onClose={() => {
            setMachineOpen(false);
          }}
        />
      )}

      {demoOpen && definition != null && (
        <ExerciseDemoSheet
          definition={definition}
          onClose={() => {
            setDemoOpen(false);
          }}
        />
      )}
    </section>
  );
}

function targetLabel(
  prescription: SetPrescriptionSnapshot | null,
  unit: WeightUnit
): string | null {
  if (prescription == null) return null;
  const parts: string[] = [];
  if (prescription.targetLoadKg != null)
    parts.push(formatLoad(prescription.targetLoadKg, { unit }));
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
