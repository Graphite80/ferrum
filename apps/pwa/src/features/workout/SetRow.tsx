import { useState } from 'react';

export interface SetRowProps {
  readonly index: number;
  readonly previousLabel: string;
  readonly targetLabel: string;
  readonly defaultLoadKg: number;
  readonly defaultReps: number;
  readonly defaultRir: number;
  readonly incrementKg: number;
  readonly onComplete: (values: { loadKg: number; reps: number; rir: number }) => void;
}

export function SetRow(props: SetRowProps) {
  const [loadKg, setLoadKg] = useState(props.defaultLoadKg);
  const [reps, setReps] = useState(props.defaultReps);
  const [rir, setRir] = useState(props.defaultRir);
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="rounded-xl border border-edge bg-surface p-3">
      <div className="mb-2 flex items-baseline justify-between text-xs text-neutral-400">
        <span>Set {props.index + 1}</span>
        <span data-testid="previous-label">{props.previousLabel}</span>
      </div>
      <div className="mb-3 text-xs text-neutral-400" data-testid="target-label">
        Target: {props.targetLabel}
      </div>

      <div className="flex items-stretch gap-2">
        <button
          type="button"
          className="tap-target flex-1 rounded-lg border border-edge bg-surface-raised px-2 text-lg font-semibold"
          onClick={() => {
            setExpanded(true);
          }}
          data-testid={`set-${String(props.index)}-load`}
        >
          {loadKg} kg
        </button>
        <button
          type="button"
          className="tap-target flex-1 rounded-lg border border-edge bg-surface-raised px-2 text-lg font-semibold"
          onClick={() => {
            setExpanded(true);
          }}
          data-testid={`set-${String(props.index)}-reps`}
        >
          {reps} reps
        </button>
        <button
          type="button"
          className="tap-target w-16 rounded-lg border border-edge bg-surface-raised text-lg font-semibold"
          onClick={() => {
            setExpanded(true);
          }}
          data-testid={`set-${String(props.index)}-rir`}
        >
          {rir}
        </button>
        <button
          type="button"
          className="tap-target flex-[1.4] rounded-lg bg-accent px-3 text-base font-bold text-black"
          onClick={() => {
            props.onComplete({ loadKg, reps, rir });
          }}
          data-testid={`set-${String(props.index)}-done`}
        >
          Done
        </button>
      </div>

      {expanded && (
        <div className="mt-3 flex flex-col gap-2" data-testid={`set-${String(props.index)}-editor`}>
          <Stepper
            label="Load"
            value={loadKg}
            step={props.incrementKg}
            onChange={setLoadKg}
            testId={`set-${String(props.index)}-load-stepper`}
          />
          <Stepper
            label="Reps"
            value={reps}
            step={1}
            onChange={setReps}
            testId={`set-${String(props.index)}-reps-stepper`}
          />
          <Stepper
            label="RIR"
            value={rir}
            step={1}
            onChange={setRir}
            testId={`set-${String(props.index)}-rir-stepper`}
          />
        </div>
      )}
    </li>
  );
}

interface StepperProps {
  readonly label: string;
  readonly value: number;
  readonly step: number;
  readonly onChange: (next: number) => void;
  readonly testId: string;
}

// One field per full-width row. The first version packed all three steppers into a
// three-column grid, which squeezed the number input to zero width on a 412px
// phone: the value was in the DOM, invisible, and untypeable. Found by the
// workout-loss drill, not by looking at a desktop viewport.
function Stepper(props: StepperProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-edge p-2">
      <span className="w-12 shrink-0 text-[11px] uppercase tracking-wide text-neutral-400">
        {props.label}
      </span>
      <button
        type="button"
        aria-label={`Decrease ${props.label}`}
        className="tap-target shrink-0 rounded bg-surface-raised px-4 text-xl"
        onClick={() => {
          props.onChange(Math.max(0, roundStep(props.value - props.step, props.step)));
        }}
        data-testid={`${props.testId}-down`}
      >
        &minus;
      </button>
      <input
        type="number"
        inputMode="decimal"
        className="tap-target min-w-16 flex-1 rounded bg-surface-raised text-center text-xl font-semibold outline-none"
        value={props.value}
        onChange={event => {
          const next = Number.parseFloat(event.target.value);
          if (Number.isFinite(next)) props.onChange(next);
        }}
        aria-label={props.label}
        data-testid={`${props.testId}-input`}
      />
      <button
        type="button"
        aria-label={`Increase ${props.label}`}
        className="tap-target shrink-0 rounded bg-surface-raised px-4 text-xl"
        onClick={() => {
          props.onChange(roundStep(props.value + props.step, props.step));
        }}
        data-testid={`${props.testId}-up`}
      >
        +
      </button>
    </div>
  );
}

function roundStep(value: number, step: number): number {
  const precision = step < 1 ? 1000 : 1;
  return Math.round(value * precision) / precision;
}
