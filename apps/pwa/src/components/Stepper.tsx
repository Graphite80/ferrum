import { useState } from 'react';
import { eyebrow, mono } from '../ui.ts';

export interface StepperProps {
  readonly label: string;
  readonly value: number;
  readonly step: number;
  readonly onChange: (next: number) => void;
  readonly testId: string;
}

const DRAFT_PATTERN = /^\d*\.?\d*$/;

// One field per full-width row. The first version packed all three steppers into a
// three-column grid, which squeezed the number input to zero width on a 412px
// phone: the value was in the DOM, invisible, and untypeable. Found by the
// workout-loss drill, not by looking at a desktop viewport.
export function Stepper(props: StepperProps) {
  // The input is `text`, not `number`, because a number input's value getter
  // reports "" for every interim string a person types on the way to a number
  // ("12.", "-", "1e"). Rendering a number straight back into a controlled input
  // meant the last digit could never be deleted: backspacing to "" parsed as NaN,
  // the change was dropped, and React restored the digit. The draft holds whatever
  // is being typed; the committed number is what everything else sees.
  const [draft, setDraft] = useState<string | null>(null);

  // Every exit is finite and non-negative: a pasted "-1e306" plus one tap on
  // the increment overflows the precision multiply into -Infinity, which the
  // domain's kilograms() rightly refuses at log time.
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
          emit(stepValue(props.value, props.step, -1));
        }}
        data-testid={`${props.testId}-down`}
      >
        &minus;
      </button>
      <input
        type="text"
        inputMode="decimal"
        className={mono({
          className:
            'tap-target min-w-16 flex-1 rounded border border-seam bg-ingot text-center text-xl font-medium text-chalk outline-none',
        })}
        value={draft ?? String(props.value)}
        onFocus={event => {
          setDraft(String(props.value));
          event.target.select();
        }}
        onChange={event => {
          const raw = event.target.value;
          if (!DRAFT_PATTERN.test(raw)) return;
          setDraft(raw);
          // Committing on every keystroke that parses keeps the parent current
          // without waiting for a blur that a tap on +, − or Done never gives us.
          const parsed = Number.parseFloat(raw);
          if (!Number.isNaN(parsed)) emit(parsed);
        }}
        onBlur={() => {
          setDraft(null);
        }}
        aria-label={props.label}
        data-testid={`${props.testId}-input`}
      />
      <button
        type="button"
        aria-label={`Increase ${props.label}`}
        className="tap-target shrink-0 rounded border border-seam bg-ingot px-4 text-xl text-chalk"
        onClick={() => {
          emit(stepValue(props.value, props.step, 1));
        }}
        data-testid={`${props.testId}-up`}
      >
        +
      </button>
    </div>
  );
}

// The arrows move along a grid of multiples of `step`, so where they land never
// depends on what was typed: 47 kg with a 2.5 kg increment steps up to 47.5 and
// then 50, not to 49.5 and 52. Adding the step to the current value instead made
// the two arrows disagree about the fraction — from 8.5 reps, + reached 10 while
// − reached 8.
const GRID_EPSILON = 1e-9;

function stepValue(value: number, step: number, direction: 1 | -1): number {
  const ratio = value / step;
  const index =
    direction === 1 ? Math.floor(ratio + GRID_EPSILON) + 1 : Math.ceil(ratio - GRID_EPSILON) - 1;
  return roundToStepPrecision(index * step, step);
}

function roundToStepPrecision(value: number, step: number): number {
  const decimals = Math.min(3, step.toString().split('.')[1]?.length ?? 0);
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// A Stepper accepts any number a person can type, so the domain of each field is
// the caller's to state. Zero reps is a legitimate entry — an attempt that failed
// — while half a rep is not, and an RIR of 12 is a typo in a scale that ends at 10.
export const clampLoad = (value: number) => Math.round(Math.max(0, value) * 100) / 100;
export const clampReps = (value: number) => Math.max(0, Math.round(value));
export const clampRir = (value: number) => Math.min(10, Math.max(0, Math.round(value)));
