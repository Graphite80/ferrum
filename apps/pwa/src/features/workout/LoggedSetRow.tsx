import { useState } from 'react';
import { type WorkoutSet } from '@ferrum/domain';
import { type SetPatch } from './session-controller.ts';
import { Stepper } from './SetRow.tsx';

export interface LoggedSetRowProps {
  readonly position: number;
  readonly set: WorkoutSet;
  readonly incrementKg: number;
  readonly onAmend: (patch: SetPatch) => void;
  readonly onDelete: () => void;
}

export function LoggedSetRow(props: LoggedSetRowProps) {
  const measurements = props.set.measurements;
  const [editing, setEditing] = useState(false);
  const [loadKg, setLoadKg] = useState(0);
  const [reps, setReps] = useState(0);
  const [rir, setRir] = useState(0);

  const openEditor = () => {
    setLoadKg(measurements.enteredLoad ?? 0);
    setReps(measurements.reps ?? 0);
    setRir(measurements.rirEntered ?? 0);
    setEditing(true);
  };

  const save = () => {
    const patch: SetPatch = {};
    if (loadKg !== (measurements.enteredLoad ?? 0)) patch.loadKg = loadKg;
    if (reps !== (measurements.reps ?? 0)) patch.reps = reps;
    if (rir !== (measurements.rirEntered ?? 0)) patch.rir = rir;
    setEditing(false);
    if (Object.keys(patch).length > 0) props.onAmend(patch);
  };

  return (
    <li className="rounded-xl border border-edge bg-surface" data-testid="logged-set">
      <button
        type="button"
        className="tap-target flex w-full items-center justify-between gap-2 px-3 text-sm"
        data-testid="logged-set-summary"
        onClick={() => {
          if (editing) setEditing(false);
          else openEditor();
        }}
      >
        <span className="text-neutral-400">Set {props.position}</span>
        {props.set.setType === 'warmup' && (
          <span
            className="rounded bg-surface-raised px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-amber-300"
            data-testid="warmup-marker"
          >
            Warmup
          </span>
        )}
        <span className="font-semibold" data-testid="logged-set-values">
          {measurements.enteredLoad == null ? '—' : `${String(measurements.enteredLoad)} kg`} ×{' '}
          {measurements.reps ?? '—'}
        </span>
        <span className="text-neutral-400">
          RIR {measurements.rirEntered == null ? '—' : String(measurements.rirEntered)}
        </span>
      </button>

      {editing && (
        <div className="flex flex-col gap-2 p-3 pt-0" data-testid="logged-set-editor">
          <Stepper
            label="Load"
            value={loadKg}
            step={props.incrementKg}
            onChange={setLoadKg}
            testId="amend-load"
          />
          <Stepper label="Reps" value={reps} step={1} onChange={setReps} testId="amend-reps" />
          <Stepper label="RIR" value={rir} step={1} onChange={setRir} testId="amend-rir" />
          <div className="flex items-stretch gap-2">
            <button
              type="button"
              className="tap-target flex-1 rounded-lg border border-edge text-sm text-red-300"
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
              className="tap-target flex-[1.4] rounded-lg bg-accent text-base font-bold text-black"
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
