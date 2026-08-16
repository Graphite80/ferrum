import { useRef, useState } from 'react';
import { type SetType, type WeightUnit, type WorkoutSet, displayLoad, formatLoad, kilograms } from '@ferrum/domain';
import { mono } from '../../ui.ts';
import { CheckSquare, ValueCell } from './set-cells.tsx';
import { type SetPatch } from '../../data/session-controller.ts';
import { type LastPerformance } from '../../db/history.ts';

interface SetSlotProps {
  readonly slotIndex: number;
  readonly unit: WeightUnit;
  readonly defaultLoad: number;
  readonly defaultReps: number;
  readonly defaultRir: number;
  readonly prescription: string | null;
  readonly lastTime: LastPerformance | null | undefined;
  readonly isWarmup: boolean;
  readonly loggedSet: WorkoutSet | null;
  readonly onLog: (values: { load: number; reps: number; rir: number; setType: SetType }) => void;
  readonly onUnlog: () => void;
  readonly onAmend: (patch: SetPatch) => void;
}

// Single row for both planned and logged states. Stable key = no DOM remount on log.
// Each value column is a direct inline input so mobile shows numeric keyboard immediately.
export function SetSlot(props: SetSlotProps) {
  const { loggedSet } = props;
  const isLogged = loggedSet != null;

  // Local editable state for planned sets; for logged sets we read from the DB record.
  const [load, setLoad] = useState(props.defaultLoad);
  const [reps, setReps] = useState(props.defaultReps);
  const [rir, setRir] = useState(props.defaultRir);
  const [swipeX, setSwipeX] = useState(0);
  const touchStart = useRef<number | null>(null);

  // Swipe left to delete a logged set; snap back if swipe is too short.
  const SWIPE_THRESHOLD = 80;
  const onTouchStart = (e: React.TouchEvent) => { touchStart.current = e.touches[0]?.clientX ?? 0; };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStart.current == null) return;
    const dx = (e.touches[0]?.clientX ?? 0) - touchStart.current;
    if (dx < 0) setSwipeX(Math.max(dx, -SWIPE_THRESHOLD * 1.2));
  };
  const onTouchEnd = () => {
    if (swipeX < -SWIPE_THRESHOLD) { props.onUnlog(); }
    setSwipeX(0);
    touchStart.current = null;
  };

  const loggedLoad = isLogged && loggedSet != null
    ? displayLoad((loggedSet.measurements.canonicalExternalLoadKg ?? 0) as Parameters<typeof displayLoad>[0], props.unit)
    : load;
  const loggedReps = isLogged && loggedSet != null ? (loggedSet.measurements.reps ?? 0) : reps;
  const loggedRir  = isLogged && loggedSet != null ? (loggedSet.measurements.rirEntered ?? 0) : rir;

  const checkVariant = props.isWarmup
    ? (isLogged ? 'warmup-completed' : 'warmup-planned')
    : (isLogged ? 'completed' : 'planned');

  const accent    = !isLogged ? 'text-chalk' : props.isWarmup ? 'text-plate-amber' : 'text-plate-red';
  const labelColor = !isLogged
    ? (props.isWarmup ? 'text-plate-amber' : 'text-ash')
    : props.isWarmup ? 'text-plate-amber' : 'text-plate-red';

  return (
    <li
      className="relative flex gap-3 overflow-hidden"
      data-testid={isLogged ? 'logged-set' : 'set-row'}
      style={{ transform: `translateX(${String(swipeX)}px)`, transition: swipeX === 0 ? 'transform 0.25s ease' : 'none' }}
      onTouchStart={isLogged ? onTouchStart : undefined}
      onTouchMove={isLogged ? onTouchMove : undefined}
      onTouchEnd={isLogged ? onTouchEnd : undefined}
    >
      <CheckSquare
        variant={checkVariant}
        onClick={() => {
          if (isLogged) { props.onUnlog(); return; }
          props.onLog({ load, reps, rir, setType: props.isWarmup ? 'warmup' : 'working' });
        }}
        testId={`set-${String(props.slotIndex)}-done`}
      />

      <div className="min-w-0 flex-1">
        <div className={mono({ className: `mb-1 text-[14px] uppercase ${labelColor}` })}>
          {props.isWarmup
            ? 'Warmup'
            : props.lastTime === null
              ? 'No previous data'
              : props.lastTime != null
                ? lastTimeHint(props.lastTime, props.unit)
                : (props.prescription ?? '')}
        </div>

        <div className="flex items-end gap-3">
          <ValueCell
            value={loggedLoad}
            unit={props.unit}
            inputMode="decimal"
            accent={accent}
            onChange={next => {
              if (isLogged) props.onAmend({ load: { entered: next, unit: props.unit } });
              else setLoad(next);
            }}
            testId={`set-${String(props.slotIndex)}-load`}
          />
          <ValueCell
            value={loggedReps}
            unit="reps"
            inputMode="numeric"
            accent={accent}
            onChange={next => {
              const n = Math.round(next);
              if (isLogged) props.onAmend({ reps: n });
              else setReps(n);
            }}
            testId={`set-${String(props.slotIndex)}-reps`}
          />
          <ValueCell
            value={loggedRir}
            unit="rir"
            inputMode="numeric"
            accent={accent}
            onChange={next => {
              const n = Math.round(next);
              if (isLogged) props.onAmend({ rir: n });
              else setRir(n);
            }}
            testId={`set-${String(props.slotIndex)}-rir`}
          />
        </div>
      </div>
    </li>
  );
}

function lastTimeHint(last: LastPerformance, unit: WeightUnit): string {
  const parts: string[] = [];
  if (last.loadKg != null) parts.push(formatLoad(kilograms(last.loadKg), { unit }).toUpperCase());
  if (last.reps != null) parts.push(`${String(last.reps)} REP`);
  return parts.join(' × ');
}
