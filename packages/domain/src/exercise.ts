import { type Kilograms } from './units.ts';

export type MovementId = string & { readonly __brand: 'MovementId' };
export type ExerciseDefinitionId = string & { readonly __brand: 'ExerciseDefinitionId' };
export type MuscleId = string & { readonly __brand: 'MuscleId' };

export type MovementPattern =
  | 'horizontal_push'
  | 'horizontal_pull'
  | 'vertical_push'
  | 'vertical_pull'
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'carry'
  | 'elbow_flexion'
  | 'elbow_extension'
  | 'shoulder_abduction'
  // A front raise is shoulder flexion, not abduction: same deltoid, different
  // joint action, so folding it into the raise family would make two unlike
  // movements look like substitutes for each other.
  | 'shoulder_flexion'
  | 'shoulder_elevation'
  | 'shoulder_external_rotation'
  | 'wrist_flexion'
  | 'knee_flexion'
  | 'knee_extension'
  | 'ankle_plantarflexion'
  | 'trunk_flexion'
  | 'trunk_antiextension'
  | 'hip_abduction'
  | 'hip_adduction';

export type EquipmentType =
  | 'barbell'
  | 'dumbbell'
  | 'machine_stack'
  | 'machine_plate_loaded'
  | 'smith_machine'
  | 'cable'
  | 'bodyweight'
  | 'kettlebell'
  | 'band'
  | 'sled'
  | 'other';

export type Laterality = 'bilateral' | 'unilateral_alternating' | 'unilateral_isolated';

export type LoadSemantics =
  | 'external'
  | 'bodyweight'
  | 'bodyweight_plus_external'
  | 'bodyweight_minus_assistance'
  | 'machine_stack'
  | 'band'
  | 'chain'
  | 'time'
  | 'distance'
  | 'repetitions_only';

export type LoadEntryMode = 'total' | 'per_hand' | 'per_side' | 'added_only';

export type RepCountMode = 'total' | 'per_side' | 'alternating_total';

export type MuscleRole = 'primary' | 'secondary' | 'stabilizer';

export interface ExerciseMuscleRole {
  readonly muscleId: MuscleId;
  readonly role: MuscleRole;
}

export interface ExerciseDefinition {
  readonly id: ExerciseDefinitionId;
  readonly movementId: MovementId;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly equipmentType: EquipmentType;
  readonly laterality: Laterality;
  readonly loadSemantics: LoadSemantics;
  readonly loadEntryMode: LoadEntryMode;
  readonly repCountMode: RepCountMode;
  readonly rangeOfMotionVariant: string;
  readonly tempoVariant: string;
  readonly bodyweightFraction: number;
  readonly muscleRoles: readonly ExerciseMuscleRole[];
  readonly defaultRestSeconds: number;
  readonly defaultIncrementKg: Kilograms | null;
  readonly userCreated: boolean;
  readonly revision: number;
}

export interface Movement {
  readonly id: MovementId;
  readonly name: string;
  readonly pattern: MovementPattern;
}

// Editing any of these changes what a logged set MEANS, so history recorded under
// the old value is no longer comparable. The domain refuses the edit and the UI
// offers "create a variation" instead. Everything not listed here is presentational
// and may be revised in place.
export const IDENTITY_DEFINING_FIELDS = [
  'loadSemantics',
  'loadEntryMode',
  'repCountMode',
  'laterality',
  'rangeOfMotionVariant',
  'tempoVariant',
  'equipmentType',
  'bodyweightFraction',
] as const satisfies readonly (keyof ExerciseDefinition)[];

export type IdentityDefiningField = (typeof IDENTITY_DEFINING_FIELDS)[number];

export type DefinitionChangeVerdict =
  | { readonly kind: 'no_change' }
  | { readonly kind: 'revision'; readonly next: ExerciseDefinition }
  | {
      readonly kind: 'requires_new_definition';
      readonly changedFields: readonly IdentityDefiningField[];
    };

export function classifyDefinitionChange(
  current: ExerciseDefinition,
  proposed: Partial<ExerciseDefinition>
): DefinitionChangeVerdict {
  const changedIdentityFields = IDENTITY_DEFINING_FIELDS.filter(
    field => field in proposed && proposed[field] !== current[field]
  );

  if (changedIdentityFields.length > 0) {
    return { kind: 'requires_new_definition', changedFields: changedIdentityFields };
  }

  const merged = { ...current, ...proposed, id: current.id, revision: current.revision };
  if (!hasPresentationalDifference(current, merged)) {
    return { kind: 'no_change' };
  }

  return { kind: 'revision', next: { ...merged, revision: current.revision + 1 } };
}

export class IdentityFieldEditRejected extends Error {
  constructor(readonly changedFields: readonly IdentityDefiningField[]) {
    super(
      `Cannot edit identity-defining field(s) ${changedFields.join(', ')} in place: ` +
        `existing history would silently stop being comparable. Create a new definition instead.`
    );
    this.name = 'IdentityFieldEditRejected';
  }
}

export function reviseDefinition(
  current: ExerciseDefinition,
  proposed: Partial<ExerciseDefinition>
): ExerciseDefinition {
  const verdict = classifyDefinitionChange(current, proposed);
  switch (verdict.kind) {
    case 'requires_new_definition':
      throw new IdentityFieldEditRejected(verdict.changedFields);
    case 'no_change':
      return current;
    case 'revision':
      return verdict.next;
  }
}

function hasPresentationalDifference(a: ExerciseDefinition, b: ExerciseDefinition): boolean {
  if (
    a.name !== b.name ||
    a.movementId !== b.movementId ||
    a.defaultRestSeconds !== b.defaultRestSeconds ||
    a.defaultIncrementKg !== b.defaultIncrementKg ||
    a.userCreated !== b.userCreated
  ) {
    return true;
  }
  if (
    a.aliases.length !== b.aliases.length ||
    a.aliases.some((alias, i) => alias !== b.aliases[i])
  ) {
    return true;
  }
  if (a.muscleRoles.length !== b.muscleRoles.length) return true;
  return a.muscleRoles.some((role, i) => {
    const other = b.muscleRoles[i];
    return other === undefined || role.muscleId !== other.muscleId || role.role !== other.role;
  });
}
