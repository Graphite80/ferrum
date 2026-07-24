// The generated data is typed with plain strings and numbers on purpose: the YAML is
// hand-edited, so every enum, cross-reference and range still has to be checked at load
// time. Typing the generated file with the domain unions would make TypeScript accept
// whatever the generator produced and move the failure to runtime, silently.
export interface RawMovement {
  readonly id: string;
  readonly name: string;
  readonly pattern: string;
}

export interface RawMuscle {
  readonly id: string;
  readonly name: string;
}

export interface RawMuscleRole {
  readonly muscleId: string;
  readonly role: string;
}

export interface RawExercise {
  readonly id: string;
  readonly movementId: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly equipmentType: string;
  readonly laterality: string;
  readonly loadSemantics: string;
  readonly loadEntryMode: string;
  readonly repCountMode: string;
  readonly rangeOfMotionVariant: string;
  readonly tempoVariant: string;
  readonly bodyweightFraction: number;
  readonly muscleRoles: readonly RawMuscleRole[];
  readonly defaultRestSeconds: number;
  readonly defaultIncrementKg: number | null;
  readonly userCreated: boolean;
  readonly revision: number;
}
