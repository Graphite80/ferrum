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
import { RAW_EXERCISES, RAW_GROUPS, RAW_MOVEMENTS, RAW_MUSCLES } from './generated/library.gen.ts';
import { type RawExercise, type RawMovement, type RawMuscle } from './shapes.ts';

export { describeSession, regionsOf, type BodyRegion } from './session-label.ts';

export interface Muscle {
  readonly id: MuscleId;
  readonly name: string;
}

// A group is presentation only. The definitions inside it stay separate records with
// their own comparison signatures, because a barbell bench and a dumbbell bench do not
// mean the same thing by the number entered (INVARIANTS §1) — what the group collapses
// is six tiles reading "Bench Press (…)", not six histories.
export interface ExerciseVariant {
  readonly definition: ExerciseDefinition;
  readonly variantLabel: string | null;
}

export interface ExerciseGroup {
  readonly id: string;
  readonly name: string;
  readonly movementId: MovementId;
  // Non-empty by construction: a group is created by its first member, and a
  // declared group with fewer than two is rejected at load time.
  readonly variants: readonly [ExerciseVariant, ...ExerciseVariant[]];
}

export interface ExerciseLibrary {
  readonly all: readonly ExerciseDefinition[];
  readonly byId: ReadonlyMap<ExerciseDefinitionId, ExerciseDefinition>;
  readonly byName: ReadonlyMap<string, ExerciseDefinition>;
  readonly movements: ReadonlyMap<MovementId, Movement>;
  readonly muscles: ReadonlyMap<MuscleId, Muscle>;
  // Every definition belongs to exactly one group; an ungrouped one is a group of its
  // own so the picker has a single shape to render.
  readonly groups: readonly ExerciseGroup[];
  groupOf(id: ExerciseDefinitionId): ExerciseGroup | undefined;
  resolveAlias(name: string): ExerciseDefinition | undefined;
  search(query: string): readonly ExerciseDefinition[];
  searchGroups(query: string): readonly ExerciseGroup[];
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
  cached ??= buildLibrary(RAW_MOVEMENTS, RAW_MUSCLES, RAW_EXERCISES, RAW_GROUPS);
  return cached;
}

function buildLibrary(
  rawMovements: readonly RawMovement[],
  rawMuscles: readonly RawMuscle[],
  rawExercises: readonly RawExercise[],
  rawGroups: Readonly<Record<string, string>>
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

  const groups = buildGroups(rawExercises, byId, rawGroups);
  const groupByDefinition = new Map<ExerciseDefinitionId, ExerciseGroup>();
  for (const group of groups) {
    for (const variant of group.variants) groupByDefinition.set(variant.definition.id, group);
  }
  const groupSearchEntries = buildGroupSearchEntries(groups, searchEntries);

  return {
    all,
    byId,
    byName,
    movements,
    muscles,
    groups,
    groupOf: id => groupByDefinition.get(id),
    resolveAlias: name => byNormalizedName.get(normalizeExerciseName(name)),
    search: query => searchLibrary(searchEntries, query),
    searchGroups: query => searchGroupLibrary(groupSearchEntries, query),
  };
}

function buildGroups(
  rawExercises: readonly RawExercise[],
  byId: ReadonlyMap<ExerciseDefinitionId, ExerciseDefinition>,
  rawGroups: Readonly<Record<string, string>>
): readonly ExerciseGroup[] {
  const members = new Map<string, [ExerciseVariant, ...ExerciseVariant[]]>();
  const groups: ExerciseGroup[] = [];

  for (const raw of rawExercises) {
    const definition = byId.get(raw.id as ExerciseDefinitionId);
    if (definition === undefined) continue;

    if (raw.group === undefined || raw.variantLabel === undefined) {
      if (raw.group !== undefined || raw.variantLabel !== undefined) {
        throw new LibraryValidationError(
          raw.id,
          raw.group === undefined ? 'group' : 'variantLabel',
          'group and variantLabel are declared together or not at all'
        );
      }
      // Its own group of one: the picker renders every tile the same way, and a
      // definition that later joins a family only changes these two lines.
      groups.push({
        id: definition.id,
        name: definition.name,
        movementId: definition.movementId,
        variants: [{ definition, variantLabel: null }],
      });
      continue;
    }

    if (!Object.hasOwn(rawGroups, raw.group)) {
      throw new LibraryValidationError(raw.id, 'group', `undeclared group "${raw.group}"`);
    }
    const existing = members.get(raw.group);
    if (existing === undefined) {
      const variants: [ExerciseVariant, ...ExerciseVariant[]] = [
        { definition, variantLabel: raw.variantLabel },
      ];
      members.set(raw.group, variants);
      groups.push({
        id: raw.group,
        name: requireNonEmpty(raw.group, 'groups', rawGroups[raw.group] ?? ''),
        movementId: definition.movementId,
        variants,
      });
      continue;
    }
    const first = existing[0].definition;
    if (first.movementId !== definition.movementId) {
      throw new LibraryValidationError(
        raw.id,
        'group',
        `group "${raw.group}" spans movements ${first.movementId} and ${definition.movementId}`
      );
    }
    const labelKey = normalizeExerciseName(raw.variantLabel);
    if (existing.some(variant => normalizeExerciseName(variant.variantLabel ?? '') === labelKey)) {
      throw new LibraryValidationError(
        raw.id,
        'variantLabel',
        `"${raw.variantLabel}" is already used inside group "${raw.group}"`
      );
    }
    existing.push({ definition, variantLabel: raw.variantLabel });
  }

  for (const [id, name] of Object.entries(rawGroups)) {
    const variants = members.get(id);
    // A group of one is a group nobody needed, and a group of none is a typo that
    // would otherwise sit in the file forever unnoticed.
    if (variants === undefined || variants.length < 2) {
      throw new LibraryValidationError(id, 'groups', `group "${name}" has fewer than two members`);
    }
  }

  return groups;
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

interface GroupSearchEntry {
  readonly group: ExerciseGroup;
  readonly memberEntries: readonly SearchEntry[];
  readonly nameKey: string;
  readonly nameWords: readonly string[];
}

function buildGroupSearchEntries(
  groups: readonly ExerciseGroup[],
  searchEntries: readonly SearchEntry[]
): readonly GroupSearchEntry[] {
  const byDefinition = new Map(searchEntries.map(entry => [entry.definition.id, entry]));
  return groups.map(group => ({
    group,
    memberEntries: group.variants
      .map(variant => byDefinition.get(variant.definition.id))
      .filter((entry): entry is SearchEntry => entry !== undefined),
    nameKey: normalizeExerciseName(group.name),
    nameWords: labelTokens(group.name),
  }));
}

// A group scores as well as its best member, plus the group's own display name, so
// "bench press" ranks the family whose members are all spelled "Bench Press (…)".
function searchGroupLibrary(
  entries: readonly GroupSearchEntry[],
  query: string
): readonly ExerciseGroup[] {
  const normalizedQuery = normalizeExerciseName(query);
  if (normalizedQuery.length === 0) {
    return [];
  }
  const tokens = labelTokens(query);

  const ranked: { group: ExerciseGroup; score: number }[] = [];
  for (const entry of entries) {
    let score = 0;
    if (entry.nameKey === normalizedQuery) score = 3;
    else if (tokens.every(token => entry.nameWords.some(word => word.startsWith(token)))) score = 2;
    for (const member of entry.memberEntries) {
      score = Math.max(score, scoreEntry(member, tokens, normalizedQuery));
    }
    if (score > 0) ranked.push({ group: entry.group, score });
  }
  ranked.sort((a, b) => b.score - a.score || a.group.name.localeCompare(b.group.name));
  return ranked.map(item => item.group);
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
