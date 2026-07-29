import { useMemo, useState } from 'react';
import { type ExerciseDefinition } from '@ferrum/domain';
import { loadExerciseLibrary } from '@ferrum/exercise-library';
import { ExerciseDemoSheet } from './ExerciseDemoSheet.tsx';
import { ExerciseFigure } from '../../components/ExerciseFigure.tsx';
import { button, card } from '../../ui.ts';

export interface ExerciseSearchPanelProps {
  readonly onPick: (definition: ExerciseDefinition) => void;
  readonly onClose: () => void;
}

export function ExerciseSearchPanel(props: ExerciseSearchPanelProps) {
  const [query, setQuery] = useState('');
  const [demo, setDemo] = useState<ExerciseDefinition | null>(null);
  const results = useMemo(
    () => (query.trim().length === 0 ? [] : loadExerciseLibrary().search(query).slice(0, 30)),
    [query]
  );

  return (
    <div
      className="fixed inset-0 z-20 mx-auto flex max-w-md flex-col gap-3 bg-ingot p-4"
      data-testid="exercise-search"
    >
      <header className="flex items-center justify-between border-b border-seam pb-3">
        <h2 className="font-display text-2xl font-bold tracking-[0.04em] uppercase">
          Add exercise
        </h2>
        <button
          type="button"
          className={button({ intent: 'quiet', className: 'px-4' })}
          data-testid="close-exercise-search"
          onClick={props.onClose}
        >
          Close
        </button>
      </header>

      <input
        autoFocus
        type="search"
        className={card({
          className: 'tap-target px-4 text-base text-chalk outline-none placeholder:text-ash',
        })}
        placeholder="Search exercises"
        value={query}
        onChange={event => {
          setQuery(event.target.value);
        }}
        data-testid="exercise-search-input"
      />

      <ul className="flex flex-col gap-2 overflow-y-auto" data-testid="exercise-search-results">
        {query.trim().length > 0 && results.length === 0 && (
          <li className="p-3 text-sm text-ash" data-testid="exercise-search-empty">
            Nothing matches.
          </li>
        )}
        {results.map(definition => (
          <li key={definition.id} className="flex items-stretch gap-2">
            <button
              type="button"
              className={card({
                className: 'tap-target flex flex-1 items-center gap-3 px-3 py-2 text-left',
              })}
              data-testid="exercise-search-result"
              onClick={() => {
                props.onPick(definition);
              }}
            >
              <ExerciseFigure definition={definition} size={44} variant="thumbnail" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-chalk">{definition.name}</span>
                <span className="block text-xs text-ash">
                  {definition.equipmentType.replaceAll('_', ' ')}
                </span>
              </span>
            </button>
            <button
              type="button"
              className={button({ intent: 'quiet', className: 'px-4' })}
              aria-label={`How to do ${definition.name}`}
              data-testid="open-exercise-demo"
              onClick={() => {
                setDemo(definition);
              }}
            >
              How
            </button>
          </li>
        ))}
      </ul>

      {demo != null && (
        <ExerciseDemoSheet
          definition={demo}
          onClose={() => {
            setDemo(null);
          }}
        />
      )}
    </div>
  );
}
