import { useMemo, useState } from 'react';
import { type ExerciseDefinition } from '@ferrum/domain';
import {
  type ExerciseGroup,
  type ExerciseVariant,
  loadExerciseLibrary,
} from '@ferrum/exercise-library';
import { ExerciseDemoSheet } from './ExerciseDemoSheet.tsx';
import { ExerciseFigure } from '../../components/ExerciseFigure.tsx';
import { useLiveData } from '../../components/live-data.ts';
import { listVariantChoices, rememberVariant } from '../../data/variant-choice-store.ts';
import { button, card, eyebrow } from '../../ui.ts';

export interface ExerciseSearchPanelProps {
  readonly onPick: (definition: ExerciseDefinition) => void;
  readonly onClose: () => void;
}

// One tile per family, the equipment chosen inside it. Six rows all reading
// "Bench Press (…)" is not a choice between exercises, it is the same choice
// spelled six times — and the one thing it made hard to see was which of them
// this lifter had actually been training.
export function ExerciseSearchPanel(props: ExerciseSearchPanelProps) {
  const [query, setQuery] = useState('');
  const [demo, setDemo] = useState<ExerciseDefinition | null>(null);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const choices = useLiveData(listVariantChoices, []);

  const results = useMemo(
    () => (query.trim().length === 0 ? [] : loadExerciseLibrary().searchGroups(query).slice(0, 30)),
    [query]
  );

  const lastUsedId = (group: ExerciseGroup): string | null =>
    choices?.find(choice => choice.groupId === group.id)?.definitionId ?? null;

  const preferred = (group: ExerciseGroup): ExerciseVariant => {
    const last = lastUsedId(group);
    return group.variants.find(variant => variant.definition.id === last) ?? group.variants[0];
  };

  const choose = (group: ExerciseGroup, definition: ExerciseDefinition) => {
    if (group.variants.length > 1) void rememberVariant(group.id, definition.id, Date.now());
    props.onPick(definition);
  };

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
          setOpenGroupId(null);
        }}
        data-testid="exercise-search-input"
      />

      <ul className="flex flex-col gap-2 overflow-y-auto" data-testid="exercise-search-results">
        {query.trim().length > 0 && results.length === 0 && (
          <li className="p-3 text-sm text-ash" data-testid="exercise-search-empty">
            Nothing matches.
          </li>
        )}
        {results.map(group => {
          const head = preferred(group);
          const single = group.variants.length === 1;
          const open = openGroupId === group.id;
          return (
            <li key={group.id} className="flex flex-col gap-2">
              <div className="flex items-stretch gap-2">
                <button
                  type="button"
                  aria-expanded={single ? undefined : open}
                  className={card({
                    className: 'tap-target flex flex-1 items-center gap-3 px-3 py-2 text-left',
                  })}
                  data-testid="exercise-search-result"
                  onClick={() => {
                    if (single) choose(group, head.definition);
                    else setOpenGroupId(current => (current === group.id ? null : group.id));
                  }}
                >
                  <ExerciseFigure definition={head.definition} size={44} variant="thumbnail" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-chalk">{group.name}</span>
                    <span className="block truncate text-xs text-ash">
                      {single
                        ? head.definition.equipmentType.replaceAll('_', ' ')
                        : group.variants.map(variant => variant.variantLabel).join(' · ')}
                    </span>
                  </span>
                </button>
                {single && (
                  <button
                    type="button"
                    className={button({ intent: 'quiet', className: 'px-4' })}
                    aria-label={`How to do ${head.definition.name}`}
                    data-testid="open-exercise-demo"
                    onClick={() => {
                      setDemo(head.definition);
                    }}
                  >
                    How
                  </button>
                )}
              </div>

              {!single && open && (
                <ul className="flex flex-col gap-2 pl-4" data-testid="exercise-variant-list">
                  {group.variants.map(variant => (
                    <li key={variant.definition.id} className="flex items-stretch gap-2">
                      <button
                        type="button"
                        className={card({
                          className:
                            'tap-target flex flex-1 items-center gap-3 px-3 py-2 text-left',
                        })}
                        data-testid="exercise-variant-option"
                        onClick={() => {
                          choose(group, variant.definition);
                        }}
                      >
                        <ExerciseFigure
                          definition={variant.definition}
                          size={36}
                          variant="thumbnail"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-chalk">
                            {variant.variantLabel}
                          </span>
                          <span className="block text-xs text-ash">
                            {variant.definition.equipmentType.replaceAll('_', ' ')}
                          </span>
                        </span>
                        {variant.definition.id === lastUsedId(group) && (
                          <span
                            className={eyebrow({
                              className: 'ml-auto shrink-0 rounded-[2px] border border-seam px-1.5',
                            })}
                            data-testid="exercise-variant-last-used"
                          >
                            Last used
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        className={button({ intent: 'quiet', className: 'px-4' })}
                        aria-label={`How to do ${variant.definition.name}`}
                        data-testid="open-exercise-demo"
                        onClick={() => {
                          setDemo(variant.definition);
                        }}
                      >
                        How
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
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
