import { useMemo, useState } from 'react';
import { type ExerciseDefinition } from '@ferrum/domain';
import {
  type ExerciseGroup,
  type ExerciseVariant,
  loadExerciseLibrary,
} from '@ferrum/exercise-library';
import { useLiveData } from '../../components/live-data.ts';
import { listVariantChoices, rememberVariant } from '../../data/variant-choice-store.ts';
import { card, eyebrow } from '../../ui.ts';

export interface ExerciseSearchPanelProps {
  readonly onPick: (definition: ExerciseDefinition) => void;
  readonly onClose: () => void;
}

const library = loadExerciseLibrary();

// One tile per family, the equipment chosen inside it.
export function ExerciseSearchPanel(props: ExerciseSearchPanelProps) {
  const [query, setQuery] = useState('');
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const choices = useLiveData(listVariantChoices, []);

  // Empty query → show all groups in library order (popularity); query → search.
  const results = useMemo(
    () =>
      query.trim().length === 0
        ? library.groups.slice(0, 60)
        : library.searchGroups(query).slice(0, 30),
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
      <header className="flex items-center gap-2">
        {/* Back chevron */}
        <button
          type="button"
          className="flex h-14 w-14 shrink-0 items-center justify-center"
          data-testid="close-exercise-search"
          onClick={props.onClose}
          aria-label="Back"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M15 19L8 12L15 5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h2 className="font-display text-2xl font-bold tracking-[0.04em] uppercase" style={{ color: '#FF1C00' }}>
          Add exercise
        </h2>
      </header>

      <input
        autoFocus
        type="text"
        className={card({
          className: 'tap-target bg-ingot px-4 text-base text-chalk outline-none placeholder:text-ash',
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
        {results.map(group => {
          const head = preferred(group);
          const single = group.variants.length === 1;
          const open = openGroupId === group.id;
          return (
            <li key={group.id} className="flex flex-col gap-2">
              <button
                type="button"
                aria-expanded={single ? undefined : open}
                className={card({
                  className: 'tap-target flex w-full items-center gap-3 px-3 py-2 text-left',
                })}
                data-testid="exercise-search-result"
                onClick={() => {
                  if (single) choose(group, head.definition);
                  else setOpenGroupId(current => (current === group.id ? null : group.id));
                }}
              >
                <span className="min-w-0">
                  <span className="block font-display text-[14px] uppercase tracking-normal text-chalk">{group.name}</span>
                  <span className="block truncate text-xs text-ash">
                    {single
                      ? head.definition.equipmentType.replaceAll('_', ' ')
                      : group.variants.map(variant => variant.variantLabel).join(' · ')}
                  </span>
                </span>
              </button>

              {!single && open && (
                <ul className="flex flex-col gap-2 pl-4" data-testid="exercise-variant-list">
                  {group.variants.map(variant => (
                    <li key={variant.definition.id}>
                      <button
                        type="button"
                        className={card({
                          className: 'tap-target flex w-full items-center gap-3 px-3 py-2 text-left',
                        })}
                        data-testid="exercise-variant-option"
                        onClick={() => {
                          choose(group, variant.definition);
                        }}
                      >
                        <span className="min-w-0">
                          <span className="block font-display text-[14px] uppercase tracking-normal text-chalk">
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
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
