import { eyebrow, mono } from '../ui.ts';

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
  // Every exit is finite and non-negative: a pasted "-1e306" plus one tap on
  // the increment overflows roundStep's precision multiply into -Infinity,
  // which the domain's kilograms() rightly refuses at log time.
  const emit = (next: number) => {
    if (Number.isFinite(next)) props.onChange(Math.max(0, next));
  };
  return (
    <div className="flex items-center gap-2 rounded-md border border-seam p-2">
      <span className={eyebrow({ className: 'w-12 shrink-0' })}>{props.label}</span>
      <button
        type="button"
        aria-label={`Decrease ${props.label}`}
        className="tap-target shrink-0 rounded border border-seam bg-ingot px-4 text-xl text-chalk"
        onClick={() => {
          emit(roundStep(props.value - props.step, props.step));
        }}
        data-testid={`${props.testId}-down`}
      >
        &minus;
      </button>
      <input
        type="number"
        inputMode="decimal"
        className={mono({
          className:
            'tap-target min-w-16 flex-1 rounded border border-seam bg-ingot text-center text-xl font-medium text-chalk outline-none',
        })}
        value={props.value}
        onChange={event => {
          emit(Number.parseFloat(event.target.value));
        }}
        aria-label={props.label}
        data-testid={`${props.testId}-input`}
      />
      <button
        type="button"
        aria-label={`Increase ${props.label}`}
        className="tap-target shrink-0 rounded border border-seam bg-ingot px-4 text-xl text-chalk"
        onClick={() => {
          emit(roundStep(props.value + props.step, props.step));
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
