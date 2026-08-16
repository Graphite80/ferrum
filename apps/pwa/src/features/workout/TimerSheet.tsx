import { useState } from 'react';

const PRESETS = [30, 60, 90, 120, 180, 240, 300];

interface TimerSheetProps {
  readonly currentSeconds: number;
  readonly onConfirm: (seconds: number) => void;
  readonly onClose: () => void;
}

// Bottom-sheet timer configurator: choose preset or enter custom value.
export function TimerSheet({ currentSeconds, onConfirm, onClose }: TimerSheetProps) {
  const [value, setValue] = useState(currentSeconds);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${String(m)}:${String(sec).padStart(2, '0')}` : `${String(sec)}s`;
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/60"
      data-testid="timer-sheet"
      onClick={onClose}
    >
      <div
        className="mx-auto mb-24 flex w-full max-w-md flex-col gap-2 px-3"
        onClick={e => { e.stopPropagation(); }}
      >
        <div className="overflow-hidden rounded-[20px] bg-[#1a1a1a]">
          {/* Presets */}
          <div className="flex flex-wrap gap-0">
            {PRESETS.map((s, i) => (
              <button
                key={s}
                type="button"
                onClick={() => { setValue(s); }}
                className={[
                  'flex-1 tap-target font-display text-sm uppercase tracking-normal',
                  i > 0 ? 'border-l-2 border-seam' : '',
                  value === s ? 'text-plate-red' : 'text-chalk',
                ].join(' ')}
              >
                {fmt(s)}
              </button>
            ))}
          </div>
          {/* Custom seconds */}
          <div className="flex items-center justify-between border-t-2 border-seam px-4 py-3">
            <span className="font-display text-sm uppercase tracking-normal text-ash">Custom</span>
            <input
              type="text"
              inputMode="numeric"
              value={String(value)}
              onChange={e => {
                const n = parseInt(e.target.value, 10);
                if (!isNaN(n) && n >= 0) setValue(n);
              }}
              className="w-20 bg-transparent text-right font-display text-base uppercase tracking-normal text-chalk outline-none"
              style={{ borderBottom: '2px solid #3a3a3a' }}
            />
          </div>
        </div>

        <button
          type="button"
          className="tap-target w-full rounded-[20px] bg-plate-red font-display text-base uppercase tracking-normal text-white active:bg-plate-red-pressed"
          onClick={() => { onConfirm(value); onClose(); }}
        >
          Set timer
        </button>
      </div>
    </div>
  );
}
