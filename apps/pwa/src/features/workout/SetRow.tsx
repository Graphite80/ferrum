import { useState } from 'react';
import { type WeightUnit } from '@ferrum/domain';
import { BTN_PRIMARY, EYEBROW, MONO } from '../../ui.ts';

export interface SetRowProps {
  readonly index: number;
  readonly unit: WeightUnit;
  readonly previousLabel: string;
  readonly targetLabel: string | null;
  readonly defaultLoad: number;
  readonly defaultReps: number;
  readonly defaultRir: number;
  readonly incrementStep: number;
  readonly onComplete: (values: { load: number; reps: number; rir: number }) => void;
}

// `defaultLoad` and `incrementStep` arrive already converted to the display unit;
// the value handed back through onComplete is what the user saw and accepted, in
// that same unit. Conversion to canonical kilograms happens at the event boundary.
export function SetRow(props: SetRowProps) {
  const [load, setLoad] = useState(props.defaultLoad);
  const [reps, setReps] = useState(props.defaultReps);
  const [rir, setRir] = useState(props.defaultRir);
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="rounded-md border border-seam bg-forged p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className={EYEBROW}>Set {props.index + 1}</span>
        <span className="text-xs text-ash" data-testid="previous-label">
          {props.previousLabel}
        </span>
      </div>
      {props.targetLabel != null && (
        <div className="mb-3 flex items-baseline gap-2" data-testid="target-label">
          <span className={EYEBROW}>Target: </span>
          <span className={`${MONO} text-xs font-medium text-chalk`}>{props.targetLabel}</span>
        </div>
      )}

      <div className="flex items-stretch gap-2">
        <button
          type="button"
          className={`${MONO} tap-target flex-1 rounded-md border border-seam bg-ingot px-2 text-lg font-medium whitespace-nowrap text-chalk`}
          onClick={() => {
            setExpanded(true);
          }}
          data-testid={`set-${String(props.index)}-load`}
        >
          {load} <span className="text-xs text-ash">{props.unit}</span>
        </button>
        <button
          type="button"
          className={`${MONO} tap-target flex-1 rounded-md border border-seam bg-ingot px-2 text-lg font-medium whitespace-nowrap text-chalk`}
          onClick={() => {
            setExpanded(true);
          }}
          data-testid={`set-${String(props.index)}-reps`}
        >
          {reps} <span className="text-xs text-ash">reps</span>
        </button>
        <button
          type="button"
          className={`${MONO} tap-target w-16 rounded-md border border-seam bg-ingot text-lg font-medium text-chalk`}
          onClick={() => {
            setExpanded(true);
          }}
          data-testid={`set-${String(props.index)}-rir`}
        >
          {rir}
        </button>
        <button
          type="button"
          className={`${BTN_PRIMARY} flex-[1.4] px-3 font-semibold`}
          onClick={() => {
            props.onComplete({ load, reps, rir });
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
            value={load}
            step={props.incrementStep}
            onChange={setLoad}
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

export interface StepperProps {
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
export function Stepper(props: StepperProps) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-seam p-2">
      <span className={`${EYEBROW} w-12 shrink-0`}>{props.label}</span>
      <button
        type="button"
        aria-label={`Decrease ${props.label}`}
        className="tap-target shrink-0 rounded border border-seam bg-ingot px-4 text-xl text-chalk"
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
        className={`${MONO} tap-target min-w-16 flex-1 rounded border border-seam bg-ingot text-center text-xl font-medium text-chalk outline-none`}
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
        className="tap-target shrink-0 rounded border border-seam bg-ingot px-4 text-xl text-chalk"
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
  const precision = Number.isInteger(step) ? 1 : 1000;
  return Math.round(value * precision) / precision;
}
