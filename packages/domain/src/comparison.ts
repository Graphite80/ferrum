import { type EquipmentInstance } from './equipment.ts';
import { type ExerciseDefinition } from './exercise.ts';

export type ComparisonSignature = string & { readonly __brand: 'ComparisonSignature' };

export const COMPARISON_SIGNATURE_VERSION = 1;

// The signature is a readable canonical string rather than a hash. A hash would be
// shorter and completely opaque: when two sets that should compare equal do not,
// the diff has to be visible in a debugger and in an exported CSV without a lookup
// table. Width is not a constraint at the volumes this app stores.
export function comparisonSignature(
  definition: ExerciseDefinition,
  instance: EquipmentInstance | null
): ComparisonSignature {
  const equipmentKey = instance == null ? '-' : (instance.equivalenceGroupId ?? instance.id);

  const parts = [
    `v${String(COMPARISON_SIGNATURE_VERSION)}`,
    `ex:${definition.id}`,
    `eq:${equipmentKey}`,
    `ls:${definition.loadSemantics}`,
    `lem:${definition.loadEntryMode}`,
    `rcm:${definition.repCountMode}`,
    `lat:${definition.laterality}`,
    `rom:${definition.rangeOfMotionVariant}`,
    `tempo:${definition.tempoVariant}`,
  ];

  return parts.join('|') as ComparisonSignature;
}

export function isComparable(a: ComparisonSignature, b: ComparisonSignature): boolean {
  return a === b;
}

export interface SignatureFacets {
  readonly version: number;
  readonly exerciseDefinitionId: string;
  readonly equipmentKey: string;
  readonly loadSemantics: string;
  readonly loadEntryMode: string;
  readonly repCountMode: string;
  readonly laterality: string;
  readonly rangeOfMotionVariant: string;
  readonly tempoVariant: string;
}

export function parseSignature(signature: ComparisonSignature): SignatureFacets {
  const parts = signature.split('|');
  if (parts.length !== 9) {
    throw new RangeError(`Malformed comparison signature "${signature}"`);
  }
  const value = (index: number): string => {
    const part = parts[index];
    if (part === undefined) throw new RangeError(`Malformed comparison signature "${signature}"`);
    return part.slice(part.indexOf(':') + 1);
  };
  const versionPart = parts[0];
  if (versionPart === undefined)
    throw new RangeError(`Malformed comparison signature "${signature}"`);

  return {
    version: Number.parseInt(versionPart.slice(1), 10),
    exerciseDefinitionId: value(1),
    equipmentKey: value(2),
    loadSemantics: value(3),
    loadEntryMode: value(4),
    repCountMode: value(5),
    laterality: value(6),
    rangeOfMotionVariant: value(7),
    tempoVariant: value(8),
  };
}

export function describeIncomparability(
  a: ComparisonSignature,
  b: ComparisonSignature
): readonly string[] {
  if (a === b) return [];
  const left = parseSignature(a);
  const right = parseSignature(b);
  const differences: string[] = [];
  for (const key of Object.keys(left) as (keyof SignatureFacets)[]) {
    if (left[key] !== right[key]) {
      differences.push(`${key}: ${String(left[key])} vs ${String(right[key])}`);
    }
  }
  return differences;
}
