import { useMemo, useState } from 'react';
import { type ExerciseDefinition } from '@ferrum/domain';
import { loadExerciseLibrary } from '@ferrum/exercise-library';

export interface ExerciseSearchPanelProps {
  readonly onPick: (definition: ExerciseDefinition) => void;
  readonly onClose: () => void;
}

export function ExerciseSearchPanel(props: ExerciseSearchPanelProps) {
  const [query, setQuery] = useState('');
  const results = useMemo(
    () => (query.trim().length === 0 ? [] : loadExerciseLibrary().search(query).slice(0, 30)),
    [query]
  );

  return (
    <div
      className="fixed inset-0 z-20 mx-auto flex max-w-md flex-col gap-3 bg-ink p-4"
      data-testid="exercise-search"
    >
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Add exercise</h2>
        <button
          type="button"
          className="tap-target rounded-lg border border-edge px-4 text-sm"
          data-testid="close-exercise-search"
          onClick={props.onClose}
        >
          Close
        </button>
      </header>

      <input
        autoFocus
        type="search"
        className="tap-target rounded-xl border border-edge bg-surface px-4 text-base outline-none"
        placeholder="Search exercises"
        value={query}
        onChange={event => {
          setQuery(event.target.value);
        }}
        data-testid="exercise-search-input"
      />

      <ul className="flex flex-col gap-2 overflow-y-auto" data-testid="exercise-search-results">
        {query.trim().length > 0 && results.length === 0 && (
          <li className="p-3 text-sm text-neutral-400" data-testid="exercise-search-empty">
            Nothing matches.
          </li>
        )}
        {results.map(definition => (
          <li key={definition.id}>
            <button
              type="button"
              className="tap-target w-full rounded-xl border border-edge bg-surface px-4 text-left"
              data-testid="exercise-search-result"
              onClick={() => {
                props.onPick(definition);
              }}
            >
              <span className="block text-sm font-semibold">{definition.name}</span>
              <span className="block text-xs text-neutral-500">
                {definition.equipmentType.replaceAll('_', ' ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
