import { useState } from 'react';
import {
  type WeightUnit,
  type WorkoutSet,
  displayLoad,
  formatLoad,
  kilograms,
} from '@ferrum/domain';
import { displayStep } from '../../data/settings-store.ts';
import { type SetPatch } from '../../data/session-controller.ts';
import { Stepper } from '../../components/Stepper.tsx';
import { button, eyebrow, mono } from '../../ui.ts';

export interface LoggedSetRowProps {
  readonly position: number;
  readonly set: WorkoutSet;
  readonly unit: WeightUnit;
  readonly incrementKg: number;
  readonly onAmend: (patch: SetPatch) => void;
  readonly onDelete: () => void;
}

export function LoggedSetRow(props: LoggedSetRowProps) {
  const measurements = props.set.measurements;
  const [editing, setEditing] = useState(false);
  const [load, setLoad] = useState(0);
  const [reps, setReps] = useState(0);
  const [rir, setRir] = useState(0);

  const displayedLoad =
    measurements.canonicalExternalLoadKg == null
      ? 0
      : displayLoad(measurements.canonicalExternalLoadKg, props.unit);

  const openEditor = () => {
    setLoad(displayedLoad);
    setReps(measurements.reps ?? 0);
    setRir(measurements.rirEntered ?? 0);
    setEditing(true);
  };

  const save = () => {
    const patch: SetPatch = {};
    if (load !== displayedLoad) patch.load = { entered: load, unit: props.unit };
    if (reps !== (measurements.reps ?? 0)) patch.reps = reps;
    if (rir !== (measurements.rirEntered ?? 0)) patch.rir = rir;
    setEditing(false);
    if (Object.keys(patch).length > 0) props.onAmend(patch);
  };

  return (
    <li
      className="rounded-md border border-seam border-l-2 border-l-plate-green bg-forged"
      data-testid="logged-set"
    >
      <button
        type="button"
        className="tap-target flex w-full items-center justify-between gap-2 px-3 text-sm"
        data-testid="logged-set-summary"
        onClick={() => {
          if (editing) setEditing(false);
          else openEditor();
        }}
      >
        <span className={eyebrow()}>Set {props.position}</span>
        {props.set.setType === 'warmup' && (
          <span
            className={eyebrow({ className: 'rounded-[2px] border border-seam px-1.5 py-0.5' })}
            data-testid="warmup-marker"
          >
            Warmup
          </span>
        )}
        <span
          className={mono({ className: 'font-medium text-chalk' })}
          data-testid="logged-set-values"
        >
          {formatLoad(measurements.canonicalExternalLoadKg, { unit: props.unit })} ×{' '}
          {measurements.reps ?? '—'}
        </span>
        <span className={mono({ className: 'text-xs font-medium text-ash' })}>
          RIR {measurements.rirEntered == null ? '—' : String(measurements.rirEntered)}
        </span>
      </button>

      {editing && (
        <div className="flex flex-col gap-2 p-3 pt-0" data-testid="logged-set-editor">
          <Stepper
            label="Load"
            value={load}
            step={displayStep(kilograms(props.incrementKg), props.unit)}
            onChange={setLoad}
            testId="amend-load"
          />
          <Stepper label="Reps" value={reps} step={1} onChange={setReps} testId="amend-reps" />
          <Stepper label="RIR" value={rir} step={1} onChange={setRir} testId="amend-rir" />
          <div className="flex items-stretch gap-2">
            <button
              type="button"
              className={button({ intent: 'quiet', className: 'flex-1' })}
              data-testid="delete-set"
              onClick={() => {
                setEditing(false);
                props.onDelete();
              }}
            >
              Delete
            </button>
            <button
              type="button"
              className="tap-target flex-[1.4] rounded-md bg-chalk text-base font-semibold text-ingot active:shadow-[inset_0_2px_6px_rgba(0,0,0,0.25)]"
              data-testid="save-set-edit"
              onClick={save}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
