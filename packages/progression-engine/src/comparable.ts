import {
  MAX_EVIDENCE_AGE_DAYS,
  compareLocalDate,
  describeIncomparability,
  grams,
  groupBy,
  isComparable,
  kilograms,
  resolveLoad,
  totalRepsPerformed,
  type ComparisonSignature,
  type EquipmentInstance,
  type ExerciseDefinition,
  type IndeterminateReason,
  type LoadSemantics,
  type WorkoutSet,
} from '@ferrum/domain';
import {
  type ComparableHistory,
  type ComparableSession,
  type ComparableSet,
  type EffortEvidence,
  type ExcludedSet,
} from './types.ts';

export interface ComparableSelectionInput {
  readonly signature: ComparisonSignature;
  readonly definition: ExerciseDefinition;
  readonly instance: EquipmentInstance | null;
  readonly sets: readonly WorkoutSet[];
}

type Classified =
  | { readonly kind: 'included'; readonly comparable: ComparableSet }
  | { readonly kind: 'excluded'; readonly exclusion: ExcludedSet };

export function selectComparableHistory(input: ComparableSelectionInput): ComparableHistory {
  const included: ComparableSet[] = [];
  const allExclusions: ExcludedSet[] = [];
  const indeterminateReasons = new Set<IndeterminateReason>();

  for (const set of input.sets) {
    const classified = classifySet(set, input);
    if (classified.kind === 'included') {
      included.push(classified.comparable);
      continue;
    }
    // A signature mismatch is not an exclusion from this exercise's history, it is a
    // different exercise entirely; recording it would drown the trail in noise.
    if (classified.exclusion.reason === 'signature_mismatch') continue;
    allExclusions.push(classified.exclusion);
    const reason = indeterminateReasonOf(classified.exclusion);
    if (reason != null) indeterminateReasons.add(reason);
  }

  const includedByDate = groupBy(included, item => item.localDate);
  const excludedByDate = groupBy(allExclusions, item => item.set.localDate);

  const dates = [...new Set([...includedByDate.keys(), ...excludedByDate.keys()])].sort(
    compareLocalDate
  );

  const sessions: ComparableSession[] = dates.map(date => ({
    localDate: date,
    sets: [...(includedByDate.get(date) ?? [])].sort(
      (a, b) => a.set.orderIndex - b.set.orderIndex || compareIds(a, b)
    ),
    exclusions: excludedByDate.get(date) ?? [],
  }));

  return {
    signature: input.signature,
    sessions,
    exclusions: allExclusions,
    indeterminateReasons: [...indeterminateReasons].sort(),
  };
}

export function sessionsWithEvidence(history: ComparableHistory): readonly ComparableSession[] {
  return history.sessions.filter(session => session.sets.length > 0);
}

function classifySet(set: WorkoutSet, input: ComparableSelectionInput): Classified {
  const exclude = (exclusion: Omit<ExcludedSet, 'set'>): Classified => ({
    kind: 'excluded',
    exclusion: { set, ...exclusion },
  });

  if (!isComparable(set.comparisonSignature, input.signature)) {
    return exclude({
      reason: 'signature_mismatch',
      detail: describeIncomparability(set.comparisonSignature, input.signature).join('; '),
    });
  }

  if (set.status !== 'completed') {
    return exclude({ reason: 'not_completed', detail: `status ${set.status}` });
  }

  if (set.setType === 'warmup' || set.setType === 'technique') {
    return exclude({ reason: 'warmup_or_technique', detail: `set type ${set.setType}` });
  }

  if (set.qualifiers.painFlag > 0) {
    return exclude({
      reason: 'pain_flagged',
      detail: `pain flag ${set.qualifiers.painFlag}`,
    });
  }

  const reps = set.measurements.reps;
  if (reps == null || reps <= 0) {
    return exclude({ reason: 'no_reps_recorded', detail: 'no repetition count recorded' });
  }

  const semantics = input.definition.loadSemantics;

  if (usesBodyweight(semantics) && !bodyweightQualifiesAsEvidence(set)) {
    return exclude({
      reason: 'bodyweight_not_evidence',
      detail: `bodyweight source ${set.bodyweightSource ?? 'missing'} at age ${String(
        set.bodyweightAgeDays ?? 'unknown'
      )} days does not qualify as evidence`,
    });
  }

  const entered = set.measurements.canonicalExternalLoadKg;
  if (entered == null && needsEnteredLoad(semantics)) {
    return exclude({ reason: 'no_load_recorded', detail: `load semantics ${semantics}` });
  }

  const resolved = resolveLoad({
    enteredKg: entered ?? kilograms(0),
    definition: input.definition,
    instance: input.instance,
    bodyweightKg: set.bodyweightKgSnapshot,
  });

  if (resolved.kind === 'indeterminate') {
    return exclude({ reason: 'indeterminate_load', detail: resolved.reason });
  }
  if (resolved.kind === 'not_load_bearing') {
    return exclude({ reason: 'not_load_bearing', detail: `load semantics ${semantics}` });
  }
  // A load-bearing set that resolves to nothing is an unloaded machine sled or an
  // empty bar: real work, but not evidence about which load to prescribe next.
  if (grams(resolved.systemKg) === 0) {
    return exclude({ reason: 'zero_resolved_load', detail: 'resolved system load is 0 kg' });
  }

  return {
    kind: 'included',
    comparable: {
      set,
      localDate: set.localDate,
      systemLoadKg: resolved.systemKg,
      calibrated: resolved.calibrated,
      reps: totalRepsPerformed(reps, input.definition),
      effort: effortOf(set),
      restSeconds: set.measurements.actualRestSeconds,
    },
  };
}

function effortOf(set: WorkoutSet): EffortEvidence {
  const { rirEntered, rpeEntered } = set.measurements;
  if (rirEntered != null) return { kind: 'rir_entered', rir: rirEntered };
  if (rpeEntered != null) return { kind: 'rpe_entered', rir: 10 - rpeEntered, rpe: rpeEntered };
  return { kind: 'unknown' };
}

function usesBodyweight(semantics: LoadSemantics): boolean {
  return (
    semantics === 'bodyweight' ||
    semantics === 'bodyweight_plus_external' ||
    semantics === 'bodyweight_minus_assistance'
  );
}

function needsEnteredLoad(semantics: LoadSemantics): boolean {
  return (
    semantics === 'external' ||
    semantics === 'machine_stack' ||
    semantics === 'bodyweight_plus_external' ||
    semantics === 'bodyweight_minus_assistance'
  );
}

// The snapshot records the verdict `resolveBodyweight` reached when the set was
// logged; the interpolation span behind it is no longer reconstructable here, so the
// recorded source is trusted and only the age bound is re-checked.
function bodyweightQualifiesAsEvidence(set: WorkoutSet): boolean {
  if (set.bodyweightKgSnapshot == null || set.bodyweightSource == null) return false;
  switch (set.bodyweightSource) {
    case 'measured_today':
    case 'interpolated':
      return true;
    case 'last_known':
      return set.bodyweightAgeDays != null && set.bodyweightAgeDays <= MAX_EVIDENCE_AGE_DAYS;
    case 'default_profile':
      return false;
  }
}

function indeterminateReasonOf(exclusion: ExcludedSet): IndeterminateReason | null {
  return exclusion.reason === 'indeterminate_load'
    ? (exclusion.detail as IndeterminateReason)
    : null;
}

function compareIds(a: ComparableSet, b: ComparableSet): number {
  return a.set.id < b.set.id ? -1 : a.set.id > b.set.id ? 1 : 0;
}
