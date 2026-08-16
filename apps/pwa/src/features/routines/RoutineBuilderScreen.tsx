import { useLiveData } from '../../components/live-data.ts';
import { useEffect, useRef, useState } from 'react';
import { useIsScrolled } from '../../platform/use-scrolled.ts';
import { type WeightUnit, displayLoad, kilograms, toKilograms } from '@ferrum/domain';
import { type RoutineRecord, type RoutineSlotRecord } from '../../db/ferrum-db.ts';
import { ExerciseSearchPanel } from '../workout/ExerciseSearchPanel.tsx';
import { ValueCell } from '../workout/set-cells.tsx';
import { clampReps, clampRir } from '../../components/Stepper.tsx';
import { ActionSheet } from '../../components/ActionSheet.tsx';
import { DotsIcon } from '../../components/icons.tsx';
import {
  deleteRoutine,
  getRoutine,
  newRoutine,
  putRoutine,
  slotFromDefinition,
} from '../../data/routine-store.ts';
import { button, card } from '../../ui.ts';

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
  const scrolled = useIsScrolled();
  const headerRef = useRef<HTMLElement>(null);
  const [headerH, setHeaderH] = useState(72);
  useEffect(() => {
    if (headerRef.current) setHeaderH(headerRef.current.offsetHeight);
  }, [routineId]);

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
    <main className="mx-auto flex min-h-full max-w-md flex-col" data-testid="routine-builder">
      {/* Sticky header — orange outline title + SAVE, no bottom border */}
      <header ref={headerRef} className="sticky top-0 z-10 flex items-center justify-between bg-ingot px-4 py-3">
        <h1
          className="font-display text-[44px] uppercase leading-none"
          style={{ color: 'transparent', WebkitTextStroke: '1.5px #FF1C00' }}
        >
          {routineId == null ? 'New routine' : 'Edit routine'}
        </h1>
        <button
          type="button"
          className="tap-target shrink-0 rounded-[20px] bg-plate-red px-5 font-display text-sm uppercase tracking-normal text-white active:bg-plate-red-pressed"
          data-testid="builder-save"
          onClick={save}
        >
          Save
        </button>
      </header>

      <div className="pointer-events-none sticky z-[9] overflow-visible" style={{ top: headerH, height: 0 }} aria-hidden>
        <div className={`h-22 w-full bg-gradient-to-b from-black to-transparent transition-opacity duration-300 ${scrolled ? 'opacity-100' : 'opacity-0'}`} />
      </div>

      <div className="flex flex-col gap-10 px-4 pb-32 pt-4">
        {/* Routine name input at the top of the scroll area */}
        <input
          type="text"
          className={card({ className: 'tap-target bg-ingot px-4 text-base text-chalk outline-none placeholder:text-ash' })}
          value={draft.name}
          placeholder="Routine name"
          onChange={event => { setDraft({ ...draft, name: event.target.value }); }}
          data-testid="routine-name-input"
        />
        {draft.slots.map((slot, index) => (
          <SlotEditor
            key={`${slot.exerciseDefinitionId}-${String(index)}`}
            slot={slot}
            index={index}
            unit={unit}
            isFirst={index === 0}
            isLast={index === draft.slots.length - 1}
            onPatch={patch => { patchSlot(index, patch); }}
            onMove={delta => { moveSlot(index, delta); }}
            onRemove={() => { setDraft({ ...draft, slots: draft.slots.filter((_, i) => i !== index) }); }}
          />
        ))}

        <button
          type="button"
          className="tap-target w-full rounded-[20px] border-2 border-plate-red font-display text-sm uppercase tracking-normal text-chalk"
          data-testid="builder-add-exercise"
          onClick={() => { setSearchOpen(true); }}
        >
          + Add exercise
        </button>

        {routineId != null &&
          (confirmingDelete ? (
            <button
              type="button"
              className={button({ intent: 'quiet', className: 'w-full' })}
              data-testid="builder-delete-confirm"
              onClick={() => { void deleteRoutine(routineId).then(onDone); }}
            >
              Really delete this routine
            </button>
          ) : (
            <button
              type="button"
              className={button({ intent: 'quiet', className: 'w-full' })}
              data-testid="builder-delete"
              onClick={() => { setConfirmingDelete(true); }}
            >
              Delete routine
            </button>
          ))}
      </div>

      {searchOpen && (
        <ExerciseSearchPanel
          onPick={definition => {
            setDraft({ ...draft, slots: [...draft.slots, slotFromDefinition(definition)] });
            setSearchOpen(false);
          }}
          onClose={() => { setSearchOpen(false); }}
        />
      )}
    </main>
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
  const [menuOpen, setMenuOpen] = useState(false);
  const prefix = `slot-${String(index)}`;

  return (
    <section className="flex flex-col gap-3" data-testid="builder-slot">
      <header className="flex items-center justify-between gap-2">
        <h2 className="font-display text-[32px] leading-[28px] uppercase text-plate-red">
          {slot.name}
        </h2>
        <button
          type="button"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] border-2 border-seam"
          aria-label={`Options for ${slot.name}`}
          data-testid={`${prefix}-menu`}
          onClick={() => { setMenuOpen(true); }}
        >
          <DotsIcon />
        </button>
      </header>

      {menuOpen && (
        <ActionSheet
          title={slot.name}
          actions={[
            ...(!isFirst ? [{ label: 'Move up', onClick: () => { onMove(-1); setMenuOpen(false); } }] : []),
            ...(!isLast ? [{ label: 'Move down', onClick: () => { onMove(1); setMenuOpen(false); } }] : []),
            { label: 'Remove', destructive: true, onClick: () => { onRemove(); } },
          ]}
          onClose={() => { setMenuOpen(false); }}
        />
      )}

      {/* Set rows — N rows matching active-workout layout, number badge instead of checkbox */}
      <ul className="flex flex-col gap-2">
        {Array.from({ length: slot.sets }).map((_, i) => (
          <li key={i} className="flex items-center gap-3" data-testid={`${prefix}-set-${String(i)}`}>
            <button
              type="button"
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] border-2 border-seam font-display text-sm text-ash disabled:opacity-30"
              disabled={slot.sets <= 1}
              aria-label={`Remove set ${String(i + 1)}`}
              data-testid={`${prefix}-set-${String(i)}-remove`}
              onClick={() => { onPatch({ sets: slot.sets - 1 }); }}
            >
              {i + 1}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-end gap-3">
                {slot.targetLoadKg != null && (
                  <ValueCell
                    value={displayLoad(kilograms(slot.targetLoadKg), unit)}
                    unit={unit}
                    inputMode="decimal"
                    accent="text-chalk"
                    onChange={next => { onPatch({ targetLoadKg: toKilograms(next, unit) }); }}
                    testId={`${prefix}-set-${String(i)}-load`}
                  />
                )}
                <ValueCell
                  value={slot.targetRepMax}
                  unit="reps"
                  inputMode="numeric"
                  accent="text-chalk"
                  onChange={next => {
                    const v = Math.max(1, clampReps(next));
                    onPatch({ targetRepMax: v, targetRepMin: Math.min(v, slot.targetRepMin) });
                  }}
                  testId={`${prefix}-set-${String(i)}-reps`}
                />
                <ValueCell
                  value={slot.targetRirMin}
                  unit="rir"
                  inputMode="numeric"
                  accent="text-chalk"
                  onChange={next => {
                    const v = clampRir(next);
                    onPatch({ targetRirMin: v, targetRirMax: Math.max(v, slot.targetRirMax) });
                  }}
                  testId={`${prefix}-set-${String(i)}-rir`}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>

      <button
        type="button"
        className="tap-target w-full rounded-[20px] border-2 border-seam font-display text-sm uppercase tracking-normal text-ash"
        data-testid={`${prefix}-add-set`}
        onClick={() => { onPatch({ sets: slot.sets + 1 }); }}
      >
        + Add set
      </button>
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
