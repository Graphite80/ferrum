import { useState } from 'react';

type CheckVariant = 'warmup-planned' | 'warmup-completed' | 'completed' | 'planned';

function WhiteCheck() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12.5L10 17.5L19 7.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Colored rounded-square checkbox per design:
// warmup-planned = outlined orange border + orange check (not yet logged)
// warmup-completed = orange fill + white check (logged warmup)
// planned = outlined seam border + red check
// completed = red fill + white check
export function CheckSquare({
  variant,
  onClick,
  testId,
}: {
  readonly variant: CheckVariant;
  readonly onClick?: (() => void) | undefined;
  readonly testId?: string;
}) {
  const cls =
    variant === 'warmup-planned'
      ? 'border-2 border-seam text-plate-amber'
      : variant === 'warmup-completed'
        ? 'bg-plate-amber text-white'
        : variant === 'completed'
          ? 'bg-plate-red text-white'
          : 'border-2 border-seam text-plate-red';
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-label="Set type"
      className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] ${cls}`}
    >
      <WhiteCheck />
    </button>
  );
}

// Inline editable value column. Tapping opens the numeric keyboard directly.
// Unit sits on the same line, pushed right by the value's natural width.
// Underline is grey by default, turns white when focused.
export function ValueCell({
  value,
  unit,
  inputMode,
  accent,
  onChange,
  testId,
}: {
  readonly value: number;
  readonly unit: string;
  readonly inputMode: 'decimal' | 'numeric';
  readonly accent: string;
  readonly onChange: (next: number) => void;
  readonly testId?: string;
}) {
  const [focused, setFocused] = useState(false);
  // draft holds the raw string while typing so the field can be fully cleared.
  const [draft, setDraft] = useState<string | null>(null);
  const displayed = draft !== null ? draft : String(value);
  const borderColor = focused ? 'border-chalk' : 'border-seam';
  return (
    <label className={`flex flex-1 items-baseline gap-2 border-b-2 pb-1 cursor-text ${borderColor} ${accent}`}>
      <input
        type="text"
        inputMode={inputMode}
        data-testid={testId}
        value={displayed}
        size={displayed.length || 1}
        onFocus={() => { setFocused(true); setDraft(String(value)); }}
        onBlur={() => {
          setFocused(false);
          const n = parseFloat(draft ?? '');
          onChange(!isNaN(n) && n >= 0 ? n : 0);
          setDraft(null);
        }}
        onChange={e => {
          const raw = e.target.value;
          setDraft(raw);
          const n = parseFloat(raw);
          if (!isNaN(n) && n >= 0) onChange(n);
        }}
        className={`min-w-0 shrink bg-transparent font-display text-[14px] uppercase tracking-normal outline-none appearance-none ${accent}`}
        style={{ backgroundColor: 'transparent', WebkitAppearance: 'none', border: 'none', padding: 0, width: `${String(displayed.length || 1)}ch` }}
      />
      <span className="shrink-0 font-display text-[11px] uppercase">{unit}</span>
    </label>
  );
}
