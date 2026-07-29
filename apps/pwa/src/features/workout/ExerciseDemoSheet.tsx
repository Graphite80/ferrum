import { useState } from 'react';
import { type ExerciseDefinition, type MuscleRole, equipmentIdentityMatters } from '@ferrum/domain';
import { loadExerciseLibrary } from '@ferrum/exercise-library';
import { resolveAnimation } from '@ferrum/exercise-media';
import { ExerciseFigure } from '../../components/ExerciseFigure.tsx';
import { MuscleMap } from '../../components/MuscleMap.tsx';
import { usePrefersReducedMotion } from '../../components/reduced-motion.ts';
import { button, card, eyebrow } from '../../ui.ts';

const ROLE_ORDER: readonly MuscleRole[] = ['primary', 'secondary', 'stabilizer'];

const ROLE_DOT: Record<MuscleRole, string> = {
  primary: 'bg-plate-red',
  secondary: 'bg-plate-amber',
  stabilizer: 'bg-frame-lit',
};

export interface ExerciseDemoSheetProps {
  readonly definition: ExerciseDefinition;
  readonly onClose: () => void;
}

export function ExerciseDemoSheet(props: ExerciseDemoSheetProps) {
  const { definition } = props;
  const reducedMotion = usePrefersReducedMotion();
  // Scrubbing is the point of the still frame: the lifter can park the figure at the
  // position they are unsure about instead of waiting for the loop to pass it.
  const [scrub, setScrub] = useState<number | null>(reducedMotion ? 1 : null);
  const spec = resolveAnimation(definition);
  const library = loadExerciseLibrary();

  return (
    <div
      className="fixed inset-0 z-30 mx-auto flex max-w-md flex-col gap-3 overflow-y-auto bg-ingot p-4"
      data-testid="exercise-demo"
    >
      <header className="flex items-start justify-between gap-3 border-b border-seam pb-3">
        <h2 className="font-display text-xl leading-tight font-bold tracking-[0.04em] uppercase">
          {definition.name}
        </h2>
        <button
          type="button"
          className={button({ intent: 'quiet', className: 'shrink-0 px-4' })}
          data-testid="close-exercise-demo"
          onClick={props.onClose}
        >
          Close
        </button>
      </header>

      <div className={card({ className: 'flex justify-center p-2' })}>
        <ExerciseFigure
          definition={definition}
          size={260}
          animated
          showTrace
          {...(scrub === null ? {} : { phase: scrub })}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          className={button({ intent: 'quiet', className: 'px-4' })}
          data-testid="toggle-demo-playback"
          onClick={() => {
            setScrub(current => (current === null ? 1 : null));
          }}
        >
          {scrub === null ? 'Hold' : 'Play'}
        </button>
        <label className="flex flex-1 items-center gap-2 text-xs text-ash">
          <span className="sr-only">Position in the rep</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round((scrub ?? 1) * 100)}
            className="w-full accent-plate-red"
            data-testid="demo-scrub"
            onChange={event => {
              setScrub(Number(event.target.value) / 100);
            }}
          />
        </label>
      </div>

      <p className="text-sm text-chalk" data-testid="exercise-cue">
        {spec.cue}
      </p>

      {equipmentIdentityMatters(definition.equipmentType) && (
        <p className="text-xs text-ash" data-testid="equipment-warning">
          The number on this machine is a marking, not kilograms at the hands: it depends on the
          plate mass and pulley ratio its manufacturer chose. Ferrum compares it only against the
          same machine.
        </p>
      )}

      <section className={card({ className: 'flex items-center gap-3 p-3' })}>
        <MuscleMap definition={definition} side="front" height={150} />
        <MuscleMap definition={definition} side="back" height={150} />
        <ul className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
          {ROLE_ORDER.flatMap(role =>
            definition.muscleRoles
              .filter(entry => entry.role === role)
              .map(entry => (
                <li key={entry.muscleId} className="flex items-center gap-2 text-ash">
                  <span className={`size-2 shrink-0 rounded-full ${ROLE_DOT[role]}`} />
                  <span className="truncate">
                    {library.muscles.get(entry.muscleId)?.name ?? entry.muscleId}
                  </span>
                </li>
              ))
          )}
        </ul>
      </section>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <Fact label="Equipment" value={definition.equipmentType.replaceAll('_', ' ')} />
        <Fact label="Load entry" value={definition.loadEntryMode.replaceAll('_', ' ')} />
        <Fact label="Reps counted" value={definition.repCountMode.replaceAll('_', ' ')} />
        <Fact label="Default rest" value={`${String(definition.defaultRestSeconds)} s`} />
      </dl>
    </div>
  );
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className={card({ className: 'p-3' })}>
      <dt className={eyebrow()}>{label}</dt>
      <dd className="text-chalk">{value}</dd>
    </div>
  );
}
