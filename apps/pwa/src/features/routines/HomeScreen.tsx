import { useMemo, useState } from 'react';
import { type SessionId, type WeightUnit, type ExerciseMuscleRole } from '@ferrum/domain';
import { useIsScrolled } from '../../platform/use-scrolled.ts';
import { startEmptySession, startSession, addExercise } from '../../data/session-controller.ts';
import { deleteRoutine, duplicateRoutine, listRoutines } from '../../data/routine-store.ts';
import { loadExerciseLibrary } from '@ferrum/exercise-library';
import { MuscleMap } from '../../components/MuscleMap.tsx';
import { DotsIcon } from '../../components/icons.tsx';
import { ActionSheet } from '../../components/ActionSheet.tsx';
import { ExerciseSearchPanel } from '../workout/ExerciseSearchPanel.tsx';
import { mono } from '../../ui.ts';
import { useLiveData } from '../../components/live-data.ts';

// Loaded once at module level — the library is a pure in-memory structure.
const library = loadExerciseLibrary();

/** Merge primary muscles from all routine slots into one flat role list. */
function routineMuscleRoles(slotIds: readonly string[]): readonly ExerciseMuscleRole[] {
  const seen = new Set<string>();
  const roles: ExerciseMuscleRole[] = [];
  for (const id of slotIds) {
    const def = library.byId.get(id as Parameters<typeof library.byId.get>[0]);
    if (def == null) continue;
    for (const role of def.muscleRoles) {
      const key = `${role.muscleId}:${role.role}`;
      if (!seen.has(key)) {
        seen.add(key);
        roles.push(role);
      }
    }
  }
  return roles;
}

export function HomeScreen({
  unit,
  onWorkoutStarted,
  onResumeWorkout,
  onEditRoutine,
  onNewRoutine,
  onOpenHistory,
  onOpenSettings,
}: {
  unit: WeightUnit;
  onWorkoutStarted: (sessionId: SessionId) => void;
  onResumeWorkout: (sessionId: SessionId) => void;
  onEditRoutine: (routineId: string) => void;
  onNewRoutine: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
}) {
  void onOpenHistory;
  void onOpenSettings;
  void onResumeWorkout;
  void onNewRoutine;
  void unit;
  const routines = useLiveData(listRoutines);
  const [starting, setStarting] = useState(false);
  const [emptySearchOpen, setEmptySearchOpen] = useState(false);
  const scrolled = useIsScrolled();

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col gap-4 px-4">
      {/* Sticky title — pt-6 inside so sticky never causes a layout jump */}
      <div className="sticky top-0 z-10 -mx-4 bg-ingot px-4 pt-6 pb-3">
        <h1 className="title-outline font-display text-[44px] uppercase leading-none">
          Workouts
        </h1>
      </div>
      {/* Gradient fade below sticky title — -mt-4 cancels gap-4 */}
      <div className="pointer-events-none sticky top-[80px] z-[9] overflow-visible" style={{ height: 0 }} aria-hidden>
        <div className={`h-22 w-full bg-gradient-to-b from-black to-transparent transition-opacity duration-300 ${scrolled ? 'opacity-100' : 'opacity-0'}`} />
      </div>

      {/* Start empty workout — outlined, at top per design */}
      <button
        type="button"
        disabled={starting}
        className="flex h-[92px] flex-col items-center justify-center rounded-[20px] border-2 border-plate-red text-center disabled:opacity-50"
        data-testid="start-empty-workout"
        onClick={() => { setEmptySearchOpen(true); }}
      >
        <span className="font-display text-sm uppercase tracking-normal text-chalk">
          + Start empty workout
        </span>
        <span className="mt-0.5 font-mono text-[14px] uppercase tracking-normal text-ash">
          You can then save it as a new routine
        </span>
      </button>

      {/* Routine cards with more breathing room */}
      <div className="flex flex-col gap-8">
        {routines?.map(routine => (
          <RoutineCard
            key={routine.id}
            routine={routine}
            starting={starting}
            onEdit={() => { onEditRoutine(routine.id); }}
            onDuplicate={() => {
              void duplicateRoutine(routine.id, Date.now());
            }}
            onDelete={() => {
              void deleteRoutine(routine.id);
            }}
            onStart={() => {
              setStarting(true);
              void startSession(routine, Date.now()).then(id => { onWorkoutStarted(id); });
            }}
          />
        ))}
      </div>

      {/* Bottom padding for nav bar */}
      <div className="h-4" />

      {emptySearchOpen && (
        <ExerciseSearchPanel
          onPick={definition => {
            setStarting(true);
            setEmptySearchOpen(false);
            const now = Date.now();
            void startEmptySession(now).then(sessionId => {
              void addExercise(sessionId, definition.id, 0, now).then(() => {
                onWorkoutStarted(sessionId);
              });
            });
          }}
          onClose={() => { setEmptySearchOpen(false); }}
        />
      )}
    </main>
  );
}

function RoutineCard({
  routine,
  starting,
  onEdit,
  onDuplicate,
  onDelete,
  onStart,
}: {
  routine: { id: string; name: string; slots: readonly { exerciseDefinitionId: string; name: string; sets: number; targetRepMin: number; targetRepMax: number }[] };
  starting: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onStart: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const muscleRoles = useMemo(
    () => routineMuscleRoles(routine.slots.map(s => s.exerciseDefinitionId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routine.slots.map(s => s.exerciseDefinitionId).join(',')]
  );

  return (
    <div data-testid="routine-card">
      {/* Card header */}
      <div className="flex items-center justify-between">
        <h2
          className="font-display text-[32px] uppercase leading-[28px] text-plate-red"
          data-testid="routine-name"
        >
          {routine.name}
        </h2>
        <button
          type="button"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[19px] border-2 border-seam text-ash"
          aria-label="Routine options"
          data-testid="edit-routine"
          onClick={() => { setMenuOpen(true); }}
        >
          <DotsIcon />
        </button>
      </div>

      {menuOpen && (
        <ActionSheet
          title={routine.name}
          actions={[
            { label: 'Edit', onClick: () => { onEdit(); } },
            { label: 'Duplicate', onClick: () => { onDuplicate(); } },
            { label: 'Delete', destructive: true, onClick: () => { onDelete(); } },
          ]}
          onClose={() => { setMenuOpen(false); }}
        />
      )}

      {/* Muscle map + exercise list */}
      {routine.slots.length > 0 && (
        <div className="mt-3 flex gap-3">
          {/* Dual muscle map front + back */}
          <div className="flex shrink-0 gap-1">
            <MuscleMap muscleRoles={muscleRoles} side="front" height={120} />
            <MuscleMap muscleRoles={muscleRoles} side="back" height={120} />
          </div>
          {/* Exercise list */}
          <ul className="flex flex-col justify-center gap-1.5">
            {routine.slots.map(slot => (
              <li
                key={slot.exerciseDefinitionId}
                className={mono({ className: 'text-[14px] uppercase text-ash' })}
              >
                {slot.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Start button */}
      <button
        type="button"
        disabled={starting || routine.slots.length === 0}
        className="tap-target mt-3 w-full rounded-[20px] bg-plate-red font-display text-sm uppercase tracking-normal text-white disabled:opacity-50 active:bg-plate-red-pressed"
        data-testid="start-routine"
        onClick={onStart}
      >
        Start training
      </button>
    </div>
  );
}
