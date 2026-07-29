import { useLiveData } from '../../components/live-data.ts';
import { useState } from 'react';
import { type WeightUnit, fromKilograms, kilograms, toKilograms } from '@ferrum/domain';
import { type RoutineRecord, type RoutineSlotRecord } from '../../db/ferrum-db.ts';
import { ExerciseSearchPanel } from '../workout/ExerciseSearchPanel.tsx';
import { Stepper } from '../../components/Stepper.tsx';
import { displayStep } from '../../data/settings-store.ts';
import {
  deleteRoutine,
  getRoutine,
  newRoutine,
  putRoutine,
  slotFromDefinition,
} from '../../data/routine-store.ts';
import { ScreenShell } from '../../components/ScreenShell.tsx';
import { button, card, eyebrow } from '../../ui.ts';

export function RoutineBuilderScreen({
  routineId,
  unit,
  onDone,
}: {
  routineId: string | null;
  unit: WeightUnit;
  onDone: () => void;
}) {
  const stored = useLiveData(
    async () => (routineId == null ? null : ((await getRoutine(routineId)) ?? null)),
    [routineId]
  );

  if (stored === undefined) {
    return (
      <main className="p-6 text-ash" data-testid="builder-loading">
        Loading…
      </main>
    );
  }

  return (
    <RoutineEditor
      routineId={routineId}
      initial={stored ?? newRoutine(Date.now())}
      unit={unit}
      onDone={onDone}
    />
  );
}

function RoutineEditor({
  routineId,
  initial,
  unit,
  onDone,
}: {
  routineId: string | null;
  initial: RoutineRecord;
  unit: WeightUnit;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [searchOpen, setSearchOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const patchSlot = (index: number, patch: Partial<RoutineSlotRecord>) => {
    setDraft({
      ...draft,
      slots: draft.slots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)),
    });
  };

  const moveSlot = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= draft.slots.length) return;
    const slots = [...draft.slots];
    const [moved] = slots.splice(index, 1);
    if (moved === undefined) return;
    slots.splice(target, 0, moved);
    setDraft({ ...draft, slots });
  };

  const save = () => {
    void putRoutine(sanitized(draft, Date.now())).then(onDone);
  };

  return (
    <ScreenShell
      title={routineId == null ? 'New routine' : 'Edit routine'}
      testId="routine-builder"
      action={
        <button
          type="button"
          className={button({ intent: 'quiet', className: 'px-4' })}
          data-testid="builder-cancel"
          onClick={onDone}
        >
          Cancel
        </button>
      }
    >
      <label className="flex flex-col gap-1">
        <span className={eyebrow()}>Name</span>
        <input
          type="text"
          className={card({
            className: 'tap-target px-4 text-base text-chalk outline-none placeholder:text-ash',
          })}
          value={draft.name}
          placeholder="Routine name"
          onChange={event => {
            setDraft({ ...draft, name: event.target.value });
          }}
          data-testid="routine-name-input"
        />
      </label>

      {draft.slots.map((slot, index) => (
        <SlotEditor
          key={`${slot.exerciseDefinitionId}-${String(index)}`}
          slot={slot}
          index={index}
          unit={unit}
          isFirst={index === 0}
          isLast={index === draft.slots.length - 1}
          onPatch={patch => {
            patchSlot(index, patch);
          }}
          onMove={delta => {
            moveSlot(index, delta);
          }}
          onRemove={() => {
            setDraft({ ...draft, slots: draft.slots.filter((_, i) => i !== index) });
          }}
        />
      ))}

      <button
        type="button"
        className={button({ intent: 'secondary' })}
        data-testid="builder-add-exercise"
        onClick={() => {
          setSearchOpen(true);
        }}
      >
        + Add exercise
      </button>

      <button
        type="button"
        className={button({ size: 'lg', className: 'w-full' })}
        data-testid="builder-save"
        onClick={save}
      >
        Save routine
      </button>

      {routineId != null &&
        (confirmingDelete ? (
          <button
            type="button"
            className="tap-target rounded-md border border-plate-red text-base font-medium text-plate-red"
            data-testid="builder-delete-confirm"
            onClick={() => {
              void deleteRoutine(routineId).then(onDone);
            }}
          >
            Really delete this routine
          </button>
        ) : (
          <button
            type="button"
            className={button({ intent: 'quiet' })}
            data-testid="builder-delete"
            onClick={() => {
              setConfirmingDelete(true);
            }}
          >
            Delete routine
          </button>
        ))}

      {searchOpen && (
        <ExerciseSearchPanel
          onPick={definition => {
            setDraft({ ...draft, slots: [...draft.slots, slotFromDefinition(definition)] });
            setSearchOpen(false);
          }}
          onClose={() => {
            setSearchOpen(false);
          }}
        />
      )}
    </ScreenShell>
  );
}

function SlotEditor({
  slot,
  index,
  unit,
  isFirst,
  isLast,
  onPatch,
  onMove,
  onRemove,
}: {
  slot: RoutineSlotRecord;
  index: number;
  unit: WeightUnit;
  isFirst: boolean;
  isLast: boolean;
  onPatch: (patch: Partial<RoutineSlotRecord>) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const prefix = `slot-${String(index)}`;
  const loadStep = displayStep(kilograms(slot.incrementKg), unit);

  return (
    <section className={card({ className: 'flex flex-col gap-2 p-3' })} data-testid="builder-slot">
      <header className="flex items-center justify-between gap-2">
        <h2 className="min-w-0 font-display text-lg leading-tight font-semibold uppercase">
          {slot.name}
        </h2>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            className="tap-target rounded-md px-3 text-lg text-ash disabled:opacity-30"
            aria-label={`Move ${slot.name} up`}
            disabled={isFirst}
            data-testid={`${prefix}-up`}
            onClick={() => {
              onMove(-1);
            }}
          >
            &uarr;
          </button>
          <button
            type="button"
            className="tap-target rounded-md px-3 text-lg text-ash disabled:opacity-30"
            aria-label={`Move ${slot.name} down`}
            disabled={isLast}
            data-testid={`${prefix}-down`}
            onClick={() => {
              onMove(1);
            }}
          >
            &darr;
          </button>
          <button
            type="button"
            className="tap-target rounded-md px-3 text-lg text-ash"
            aria-label={`Remove ${slot.name}`}
            data-testid={`${prefix}-remove`}
            onClick={onRemove}
          >
            &times;
          </button>
        </div>
      </header>

      <Stepper
        label="Sets"
        value={slot.sets}
        step={1}
        onChange={next => {
          onPatch({ sets: Math.max(1, Math.round(next)) });
        }}
        testId={`${prefix}-sets`}
      />
      <Stepper
        label="Rep −"
        value={slot.targetRepMin}
        step={1}
        onChange={next => {
          const min = Math.max(1, Math.round(next));
          onPatch({ targetRepMin: min, targetRepMax: Math.max(min, slot.targetRepMax) });
        }}
        testId={`${prefix}-repmin`}
      />
      <Stepper
        label="Rep +"
        value={slot.targetRepMax}
        step={1}
        onChange={next => {
          const max = Math.max(1, Math.round(next));
          onPatch({ targetRepMax: max, targetRepMin: Math.min(max, slot.targetRepMin) });
        }}
        testId={`${prefix}-repmax`}
      />
      <Stepper
        label="RIR −"
        value={slot.targetRirMin}
        step={1}
        onChange={next => {
          const min = Math.min(10, Math.max(0, Math.round(next)));
          onPatch({ targetRirMin: min, targetRirMax: Math.max(min, slot.targetRirMax) });
        }}
        testId={`${prefix}-rirmin`}
      />
      <Stepper
        label="RIR +"
        value={slot.targetRirMax}
        step={1}
        onChange={next => {
          const max = Math.min(10, Math.max(0, Math.round(next)));
          onPatch({ targetRirMax: max, targetRirMin: Math.min(max, slot.targetRirMin) });
        }}
        testId={`${prefix}-rirmax`}
      />

      {slot.targetLoadKg == null ? (
        <button
          type="button"
          className={button({ intent: 'quiet' })}
          data-testid={`${prefix}-set-target`}
          onClick={() => {
            onPatch({ targetLoadKg: toKilograms(loadStep * 4, unit) });
          }}
        >
          Set target load
        </button>
      ) : (
        <div className="flex items-stretch gap-2">
          {/* min-w-0 lets the stepper shrink below the number input's intrinsic
              width; without it the row overflows the 412px viewport and mobile
              tap coordinates land on the wrong elements. */}
          <div className="min-w-0 flex-1">
            <Stepper
              label={unit}
              value={Number(fromKilograms(kilograms(slot.targetLoadKg), unit).toFixed(2))}
              step={loadStep}
              onChange={next => {
                onPatch({ targetLoadKg: toKilograms(next, unit) });
              }}
              testId={`${prefix}-target`}
            />
          </div>
          <button
            type="button"
            className="tap-target shrink-0 rounded-md border border-seam px-3 text-sm text-ash"
            aria-label="Clear target load"
            data-testid={`${prefix}-clear-target`}
            onClick={() => {
              onPatch({ targetLoadKg: null });
            }}
          >
            Clear
          </button>
        </div>
      )}
    </section>
  );
}

function sanitized(draft: RoutineRecord, nowMillis: number): RoutineRecord {
  const name = draft.name.trim();
  return {
    ...draft,
    name: name.length > 0 ? name : 'Unnamed routine',
    updatedAtMillis: nowMillis,
  };
}
