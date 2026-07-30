import {
  type EquipmentType,
  type ExerciseDefinition,
  type ExerciseDefinitionId,
  type ExerciseMuscleRole,
  type Kilograms,
  type Laterality,
  type LoadEntryMode,
  type LoadSemantics,
  type Movement,
  type MovementId,
  type MovementPattern,
  type MuscleId,
  type MuscleRole,
  type RepCountMode,
  kilograms,
} from '@ferrum/domain';
import { RAW_EXERCISES, RAW_MOVEMENTS, RAW_MUSCLES } from './generated/library.gen.ts';
import { type RawExercise, type RawMovement, type RawMuscle } from './shapes.ts';

export interface Muscle {
  readonly id: MuscleId;
  readonly name: string;
}

export interface ExerciseLibrary {
  readonly all: readonly ExerciseDefinition[];
  readonly byId: ReadonlyMap<ExerciseDefinitionId, ExerciseDefinition>;
  readonly byName: ReadonlyMap<string, ExerciseDefinition>;
  readonly movements: ReadonlyMap<MovementId, Movement>;
  readonly muscles: ReadonlyMap<MuscleId, Muscle>;
  resolveAlias(name: string): ExerciseDefinition | undefined;
  search(query: string): readonly ExerciseDefinition[];
}

export class LibraryValidationError extends Error {
  constructor(
    readonly recordId: string,
    readonly field: string,
    reason: string
  ) {
    super(`Exercise library record "${recordId}" field "${field}": ${reason}`);
    this.name = 'LibraryValidationError';
  }
}

const MOVEMENT_PATTERNS: readonly MovementPattern[] = [
  'horizontal_push',
  'horizontal_pull',
  'vertical_push',
  'vertical_pull',
  'squat',
  'hinge',
  'lunge',
  'carry',
  'elbow_flexion',
  'elbow_extension',
  'shoulder_abduction',
  'shoulder_flexion',
  'shoulder_elevation',
  'shoulder_external_rotation',
  'wrist_flexion',
  'knee_flexion',
  'knee_extension',
  'ankle_plantarflexion',
  'trunk_flexion',
  'trunk_antiextension',
  'hip_abduction',
  'hip_adduction',
];

const EQUIPMENT_TYPES: readonly EquipmentType[] = [
  'barbell',
  'dumbbell',
  'machine_stack',
  'machine_plate_loaded',
  'smith_machine',
  'cable',
  'bodyweight',
  'kettlebell',
  'band',
  'sled',
  'other',
];

const LATERALITIES: readonly Laterality[] = [
  'bilateral',
  'unilateral_alternating',
  'unilateral_isolated',
];

const LOAD_SEMANTICS: readonly LoadSemantics[] = [
  'external',
  'bodyweight',
  'bodyweight_plus_external',
  'bodyweight_minus_assistance',
  'machine_stack',
  'band',
  'chain',
  'time',
  'distance',
  'repetitions_only',
];

const LOAD_ENTRY_MODES: readonly LoadEntryMode[] = ['total', 'per_hand', 'per_side', 'added_only'];

const REP_COUNT_MODES: readonly RepCountMode[] = ['total', 'per_side', 'alternating_total'];

const MUSCLE_ROLES: readonly MuscleRole[] = ['primary', 'secondary', 'stabilizer'];

const BODYWEIGHT_SEMANTICS: readonly LoadSemantics[] = [
  'bodyweight',
  'bodyweight_plus_external',
  'bodyweight_minus_assistance',
];

const HAND_HELD_EQUIPMENT: readonly EquipmentType[] = ['dumbbell', 'kettlebell'];

// Alias matching drops everything that is not a letter or a digit, so "T-Bar Row",
// "t bar row" and " T BAR ROW! " are one key. Importers see the same exercise spelled
// differently by every source, and a near-miss silently forks an exercise history.
export function normalizeExerciseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

let cached: ExerciseLibrary | null = null;

export function loadExerciseLibrary(): ExerciseLibrary {
  cached ??= buildLibrary(RAW_MOVEMENTS, RAW_MUSCLES, RAW_EXERCISES);
  return cached;
}

function buildLibrary(
  rawMovements: readonly RawMovement[],
  rawMuscles: readonly RawMuscle[],
  rawExercises: readonly RawExercise[]
): ExerciseLibrary {
  const movements = buildMovements(rawMovements);
  const muscles = buildMuscles(rawMuscles);

  const byId = new Map<ExerciseDefinitionId, ExerciseDefinition>();
  const byName = new Map<string, ExerciseDefinition>();
  const byNormalizedName = new Map<string, ExerciseDefinition>();
  const all: ExerciseDefinition[] = [];
  const searchEntries: SearchEntry[] = [];

  for (const raw of rawExercises) {
    const definition = buildDefinition(raw, movements, muscles);

    if (byId.has(definition.id)) {
      throw new LibraryValidationError(raw.id, 'id', 'duplicate exercise id');
    }
    if (byName.has(definition.name)) {
      throw new LibraryValidationError(raw.id, 'name', `duplicate exercise name "${raw.name}"`);
    }
    byId.set(definition.id, definition);
    byName.set(definition.name, definition);
    all.push(definition);

    for (const [index, label] of [definition.name, ...definition.aliases].entries()) {
      const key = normalizeExerciseName(label);
      if (key.length === 0) {
        throw new LibraryValidationError(
          raw.id,
          'aliases',
          `alias "${label}" normalizes to nothing`
        );
      }
      const claimed = byNormalizedName.get(key);
      if (claimed !== undefined && claimed.id !== definition.id) {
        throw new LibraryValidationError(
          raw.id,
          index === 0 ? 'name' : 'aliases',
          `"${label}" collides with "${claimed.name}" once punctuation and case are dropped`
        );
      }
      byNormalizedName.set(key, definition);
    }

    const labels = [definition.name, ...definition.aliases];
    searchEntries.push({
      definition,
      labelWords: labels.map(labelTokens),
      joinedKeys: labels.map(normalizeExerciseName),
    });
  }

  return {
    all,
    byId,
    byName,
    movements,
    muscles,
    resolveAlias: name => byNormalizedName.get(normalizeExerciseName(name)),
    search: query => searchLibrary(searchEntries, query),
  };
}

interface SearchEntry {
  readonly definition: ExerciseDefinition;
  readonly labelWords: readonly (readonly string[])[];
  readonly joinedKeys: readonly string[];
}

function labelTokens(label: string): readonly string[] {
  return label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Ranked, not fuzzy: an exact name or alias beats a per-word prefix match, which beats a
// bare substring hit, and a query that matches nothing returns nothing rather than a guess.
function searchLibrary(
  entries: readonly SearchEntry[],
  query: string
): readonly ExerciseDefinition[] {
  const normalizedQuery = normalizeExerciseName(query);
  if (normalizedQuery.length === 0) {
    return [];
  }
  const tokens = labelTokens(query);

  const ranked: { definition: ExerciseDefinition; score: number }[] = [];
  for (const entry of entries) {
    const score = scoreEntry(entry, tokens, normalizedQuery);
    if (score > 0) {
      ranked.push({ definition: entry.definition, score });
    }
  }
  ranked.sort((a, b) => b.score - a.score || a.definition.name.localeCompare(b.definition.name));
  return ranked.map(item => item.definition);
}

function scoreEntry(
  entry: SearchEntry,
  tokens: readonly string[],
  normalizedQuery: string
): number {
  let best = 0;
  for (const [index, joined] of entry.joinedKeys.entries()) {
    if (joined === normalizedQuery) {
      return 3;
    }
    const words = entry.labelWords[index] ?? [];
    if (tokens.every(token => words.some(word => word.startsWith(token)))) {
      best = Math.max(best, 2);
    } else if (tokens.every(token => joined.includes(token))) {
      best = Math.max(best, 1);
    }
  }
  return best;
}

function buildMovements(rawMovements: readonly RawMovement[]): ReadonlyMap<MovementId, Movement> {
  const movements = new Map<MovementId, Movement>();
  for (const raw of rawMovements) {
    const id = raw.id as MovementId;
    if (movements.has(id)) {
      throw new LibraryValidationError(raw.id, 'id', 'duplicate movement id');
    }
    requireNonEmpty(raw.id, 'name', raw.name);
    movements.set(id, {
      id,
      name: raw.name,
      pattern: requireMember(MOVEMENT_PATTERNS, raw.pattern, raw.id, 'pattern'),
    });
  }
  return movements;
}

function buildMuscles(rawMuscles: readonly RawMuscle[]): ReadonlyMap<MuscleId, Muscle> {
  const muscles = new Map<MuscleId, Muscle>();
  for (const raw of rawMuscles) {
    const id = raw.id as MuscleId;
    if (muscles.has(id)) {
      throw new LibraryValidationError(raw.id, 'id', 'duplicate muscle id');
    }
    requireNonEmpty(raw.id, 'name', raw.name);
    muscles.set(id, { id, name: raw.name });
  }
  return muscles;
}

function buildDefinition(
  raw: RawExercise,
  movements: ReadonlyMap<MovementId, Movement>,
  muscles: ReadonlyMap<MuscleId, Muscle>
): ExerciseDefinition {
  requireNonEmpty(raw.id, 'id', raw.id);
  requireNonEmpty(raw.id, 'name', raw.name);

  const movementId = raw.movementId as MovementId;
  if (!movements.has(movementId)) {
    throw new LibraryValidationError(raw.id, 'movementId', `unknown movement "${raw.movementId}"`);
  }

  const equipmentType = requireMember(EQUIPMENT_TYPES, raw.equipmentType, raw.id, 'equipmentType');
  const loadSemantics = requireMember(LOAD_SEMANTICS, raw.loadSemantics, raw.id, 'loadSemantics');
  const loadEntryMode = requireMember(LOAD_ENTRY_MODES, raw.loadEntryMode, raw.id, 'loadEntryMode');

  requireBodyweightFraction(raw, loadSemantics);
  requirePerHandIsHandHeld(raw, loadEntryMode, equipmentType);

  if (!Number.isInteger(raw.defaultRestSeconds) || raw.defaultRestSeconds <= 0) {
    throw new LibraryValidationError(
      raw.id,
      'defaultRestSeconds',
      `expected a positive whole number of seconds, received ${raw.defaultRestSeconds}`
    );
  }

  if (raw.defaultIncrementKg !== null && !(raw.defaultIncrementKg > 0)) {
    throw new LibraryValidationError(
      raw.id,
      'defaultIncrementKg',
      `expected a positive increment or null, received ${String(raw.defaultIncrementKg)}`
    );
  }

  if (!Number.isInteger(raw.revision) || raw.revision < 1) {
    throw new LibraryValidationError(
      raw.id,
      'revision',
      `expected a revision of at least 1, received ${raw.revision}`
    );
  }

  return {
    id: raw.id as ExerciseDefinitionId,
    movementId,
    name: raw.name,
    aliases: raw.aliases,
    equipmentType,
    laterality: requireMember(LATERALITIES, raw.laterality, raw.id, 'laterality'),
    loadSemantics,
    loadEntryMode,
    repCountMode: requireMember(REP_COUNT_MODES, raw.repCountMode, raw.id, 'repCountMode'),
    rangeOfMotionVariant: requireNonEmpty(raw.id, 'rangeOfMotionVariant', raw.rangeOfMotionVariant),
    tempoVariant: requireNonEmpty(raw.id, 'tempoVariant', raw.tempoVariant),
    bodyweightFraction: raw.bodyweightFraction,
    muscleRoles: buildMuscleRoles(raw, muscles),
    defaultRestSeconds: raw.defaultRestSeconds,
    defaultIncrementKg: toIncrement(raw.defaultIncrementKg),
    userCreated: raw.userCreated,
    revision: raw.revision,
  };
}

function buildMuscleRoles(
  raw: RawExercise,
  muscles: ReadonlyMap<MuscleId, Muscle>
): readonly ExerciseMuscleRole[] {
  if (raw.muscleRoles.length === 0) {
    throw new LibraryValidationError(raw.id, 'muscleRoles', 'at least one muscle role is required');
  }

  const seen = new Set<string>();
  return raw.muscleRoles.map(entry => {
    const muscleId = entry.muscleId as MuscleId;
    if (!muscles.has(muscleId)) {
      throw new LibraryValidationError(raw.id, 'muscleRoles', `unknown muscle "${entry.muscleId}"`);
    }
    if (seen.has(entry.muscleId)) {
      throw new LibraryValidationError(
        raw.id,
        'muscleRoles',
        `muscle "${entry.muscleId}" is listed twice`
      );
    }
    seen.add(entry.muscleId);
    return { muscleId, role: requireMember(MUSCLE_ROLES, entry.role, raw.id, 'muscleRoles.role') };
  });
}

function requireBodyweightFraction(raw: RawExercise, loadSemantics: LoadSemantics): void {
  const carriesBodyweight = BODYWEIGHT_SEMANTICS.includes(loadSemantics);
  const fraction = raw.bodyweightFraction;

  if (carriesBodyweight && !(fraction > 0 && fraction <= 1)) {
    throw new LibraryValidationError(
      raw.id,
      'bodyweightFraction',
      `${loadSemantics} needs a fraction in (0, 1], received ${fraction}`
    );
  }
  if (!carriesBodyweight && fraction !== 0) {
    throw new LibraryValidationError(
      raw.id,
      'bodyweightFraction',
      `${loadSemantics} moves no bodyweight, expected 0, received ${fraction}`
    );
  }
}

function requirePerHandIsHandHeld(
  raw: RawExercise,
  loadEntryMode: LoadEntryMode,
  equipmentType: EquipmentType
): void {
  if (loadEntryMode === 'per_hand' && !HAND_HELD_EQUIPMENT.includes(equipmentType)) {
    throw new LibraryValidationError(
      raw.id,
      'loadEntryMode',
      `per_hand only describes hand-held implements, not ${equipmentType}`
    );
  }
}

function toIncrement(value: number | null): Kilograms | null {
  return value === null ? null : kilograms(value);
}

function requireMember<T extends string>(
  allowed: readonly T[],
  value: string,
  recordId: string,
  field: string
): T {
  const match = allowed.find(candidate => candidate === value);
  if (match === undefined) {
    throw new LibraryValidationError(
      recordId,
      field,
      `expected one of ${allowed.join(' | ')}, received "${value}"`
    );
  }
  return match;
}

function requireNonEmpty(recordId: string, field: string, value: string): string {
  if (value.trim().length === 0) {
    throw new LibraryValidationError(recordId, field, 'must not be empty');
  }
  return value;
}
