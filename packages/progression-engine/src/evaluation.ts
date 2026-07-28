import {
  formatLoad,
  grams,
  roundToAvailableLoad,
  sameLoad,
  smallestAvailableIncrement,
  type Kilograms,
  type RoundingDirection,
  type SmallestIncrement,
} from '@ferrum/domain';
import { sessionsWithEvidence } from './comparable.ts';
import {
  type ComparableHistory,
  type ComparableSession,
  type ComparableSet,
  type Confidence,
  type EquipmentConstraints,
  type EvidenceTrail,
  type ProgressionAction,
  type ProposedPrescription,
  type ReasonCode,
  type Recommendation,
} from './types.ts';

export type EffortVerdict = 'inside' | 'easier' | 'harder' | 'unknown';

// Missing effort is not "effort was fine". A whole session logged without RPE or RIR
// under-determines the decision, and the engine has to say so instead of reading the
// gap as compliance.
export function effortVerdict(
  sets: readonly ComparableSet[],
  band: readonly [number, number]
): EffortVerdict {
  if (sets.length === 0) return 'unknown';
  const [minRir, maxRir] = band;
  const values: number[] = [];
  for (const set of sets) {
    if (set.effort.kind === 'unknown') return 'unknown';
    values.push(set.effort.rir);
  }
  if (values.some(rir => rir < minRir)) return 'harder';
  if (values.every(rir => rir > maxRir)) return 'easier';
  return 'inside';
}

export function effortSummary(sets: readonly ComparableSet[]): string {
  const values = sets.flatMap(set => (set.effort.kind === 'unknown' ? [] : [set.effort.rir]));
  if (values.length === 0) return 'no effort recorded';
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? `${min} RIR` : `${min}-${max} RIR`;
}

export function minLoad(sets: readonly ComparableSet[]): Kilograms | null {
  return sets.reduce<Kilograms | null>(
    (lowest, set) =>
      lowest == null || grams(set.systemLoadKg) < grams(lowest) ? set.systemLoadKg : lowest,
    null
  );
}

export function maxLoad(sets: readonly ComparableSet[]): Kilograms | null {
  return sets.reduce<Kilograms | null>(
    (highest, set) =>
      highest == null || grams(set.systemLoadKg) > grams(highest) ? set.systemLoadKg : highest,
    null
  );
}

export function minReps(sets: readonly ComparableSet[]): number {
  return sets.reduce((lowest, set) => Math.min(lowest, set.reps), Number.POSITIVE_INFINITY);
}

export function totalReps(sets: readonly ComparableSet[]): number {
  return sets.reduce((sum, set) => sum + set.reps, 0);
}

export function heaviestSet(sets: readonly ComparableSet[]): ComparableSet | null {
  return sets.reduce<ComparableSet | null>((best, set) => {
    if (best == null) return set;
    const byLoad = grams(set.systemLoadKg) - grams(best.systemLoadKg);
    if (byLoad !== 0) return byLoad > 0 ? set : best;
    if (set.reps !== best.reps) return set.reps > best.reps ? set : best;
    return set.set.orderIndex < best.set.orderIndex ? set : best;
  }, null);
}

export function increment(equipment: EquipmentConstraints): SmallestIncrement | null {
  return smallestAvailableIncrement(equipment.instance, equipment.definitionDefaultIncrementKg);
}

export function roundLoad(
  target: Kilograms,
  equipment: EquipmentConstraints,
  direction: RoundingDirection
): Kilograms {
  return roundToAvailableLoad(
    target,
    equipment.instance,
    equipment.definitionDefaultIncrementKg,
    direction
  );
}

export function isOnEquipmentGrid(load: Kilograms, equipment: EquipmentConstraints): boolean {
  return sameLoad(load, roundLoad(load, equipment, 'nearest'));
}

export function describeLoad(load: Kilograms): string {
  return formatLoad(load, 'kg');
}

// Walks backwards from the most recent session and stops at the first one that does
// not satisfy the predicate. A run of one is a bad day; that is the whole point of
// counting rather than reacting.
export function countTrailingSessions(
  sessions: readonly ComparableSession[],
  predicate: (session: ComparableSession) => boolean
): number {
  let count = 0;
  for (let index = sessions.length - 1; index >= 0; index -= 1) {
    const session = sessions[index];
    if (session === undefined || !predicate(session)) return count;
    count += 1;
  }
  return count;
}

export function priorSessionsAtOrAboveLoad(
  history: ComparableHistory,
  load: Kilograms | null
): readonly ComparableSession[] {
  const sessions = sessionsWithEvidence(history);
  if (load == null) return sessions;
  return sessions.filter(session => {
    const lowest = minLoad(session.sets);
    return lowest != null && grams(lowest) >= grams(load);
  });
}

// A top-set session's minimum load is its back-off work, so filtering by minimum
// would silently drop every prior top-set session and make repeated-failure
// detection unreachable. For top-set policies the heaviest set is the anchor.
export function priorSessionsWithTopSetAtOrAboveLoad(
  history: ComparableHistory,
  load: Kilograms | null
): readonly ComparableSession[] {
  const sessions = sessionsWithEvidence(history);
  if (load == null) return sessions;
  return sessions.filter(session => {
    const top = heaviestSet(session.sets);
    return top != null && grams(top.systemLoadKg) >= grams(load);
  });
}

export function confidenceFrom(corroboratingSessions: number, effort: EffortVerdict): Confidence {
  if (effort === 'unknown') return 'low';
  if (corroboratingSessions >= 2) return 'high';
  if (corroboratingSessions >= 1) return 'medium';
  return 'low';
}

export function evidenceTrail(
  history: ComparableHistory,
  current: ComparableSession | null
): EvidenceTrail {
  const priorSessions = sessionsWithEvidence(history);
  const sessions = current == null ? priorSessions : [...priorSessions, current];
  return {
    signature: history.signature,
    sessionDatesUsed: sessions.map(session => session.localDate),
    includedSets: sessions.flatMap(session => session.sets),
    excludedSets: [
      ...history.exclusions,
      ...(current == null
        ? []
        : current.exclusions.filter(item => !history.exclusions.includes(item))),
    ],
  };
}

export interface RecommendationDraft {
  readonly action: ProgressionAction;
  readonly proposedPrescription: ProposedPrescription | null;
  readonly reasonCodes: readonly ReasonCode[];
  readonly explanation: string;
  readonly confidence: Confidence;
  readonly warnings: readonly string[];
}

export function recommendation(
  policyId: string,
  policyVersion: number,
  evidence: EvidenceTrail,
  draft: RecommendationDraft
): Recommendation {
  return {
    action: draft.action,
    proposedPrescription: draft.proposedPrescription,
    reasonCodes: draft.reasonCodes,
    explanation: draft.explanation,
    evidence,
    confidence: draft.confidence,
    warnings: draft.warnings,
    policyId,
    policyVersion,
  };
}

export function commonWarnings(
  current: ComparableSession,
  equipment: EquipmentConstraints
): { readonly warnings: readonly string[]; readonly reasonCodes: readonly ReasonCode[] } {
  const warnings: string[] = [];
  const reasonCodes: ReasonCode[] = [];

  const lowest = minLoad(current.sets);
  const highest = maxLoad(current.sets);
  if (lowest != null && highest != null && !sameLoad(lowest, highest)) {
    reasonCodes.push('mixed_loads_within_session');
    warnings.push(
      `Working sets on ${current.localDate} used loads from ${describeLoad(lowest)} to ` +
        `${describeLoad(highest)}; the lowest was taken as the load achieved on every set.`
    );
  }

  if (lowest != null && !isOnEquipmentGrid(lowest, equipment)) {
    reasonCodes.push('load_off_equipment_grid');
    warnings.push(
      `${describeLoad(lowest)} is not on this equipment's configured increment grid; ` +
        `the proposal was rounded onto it.`
    );
  }

  if (current.sets.some(set => !set.calibrated)) {
    warnings.push(
      'Loads for this exercise are machine markings, not measured mass; they compare to ' +
        'themselves only.'
    );
  }

  return { warnings, reasonCodes };
}

export function painSeverity(session: ComparableSession): number {
  return session.exclusions.reduce(
    (worst, exclusion) =>
      exclusion.reason === 'pain_flagged'
        ? Math.max(worst, exclusion.set.qualifiers.painFlag)
        : worst,
    0
  );
}
