import {
  comparisonSignature,
  validateRule,
  type DomainEvent,
  type DoubleProgressionRule,
  type ExerciseDefinition,
  type ProgressionRuleId,
  type SetPrescriptionSnapshot,
  type WorkoutSet,
} from '@ferrum/domain';
import { type ExerciseLibrary } from '@ferrum/exercise-library';
import {
  policyFor,
  selectComparableHistory,
  sessionsWithEvidence,
  type ComparableHistory,
  type ComparableSession,
  type PrescriptionContext,
  type Recommendation,
} from '@ferrum/progression-engine';
import { allProjectedSets } from './history.ts';

export type NextOutcome =
  | { readonly kind: 'unknown_exercise'; readonly query: string }
  | { readonly kind: 'no_history'; readonly name: string; readonly assuming: string | null }
  | {
      readonly kind: 'no_prescription';
      readonly name: string;
      readonly assuming: string | null;
      readonly sessions: readonly ComparableSession[];
    }
  | {
      readonly kind: 'recommendation';
      readonly name: string;
      readonly assuming: string | null;
      readonly recommendation: Recommendation;
    };

export function nextForExercise(
  library: ExerciseLibrary,
  events: readonly DomainEvent[],
  query: string
): NextOutcome {
  const resolved = library.resolveAlias(query);
  const definition = resolved ?? library.search(query)[0];
  if (definition === undefined) return { kind: 'unknown_exercise', query };
  const assuming = resolved === undefined ? definition.name : null;

  const signature = comparisonSignature(definition, null);
  const sets = allProjectedSets(events);
  const history = selectComparableHistory({ signature, definition, instance: null, sets });
  const evidenced = sessionsWithEvidence(history);
  if (evidenced.length === 0) {
    return { kind: 'no_history', name: definition.name, assuming };
  }

  const derived = derivePrescription(definition, sets, signature);
  if (derived == null) {
    return { kind: 'no_prescription', name: definition.name, assuming, sessions: evidenced };
  }

  const current = evidenced[evidenced.length - 1];
  if (current === undefined) return { kind: 'no_history', name: definition.name, assuming };
  const currentIndex = history.sessions.indexOf(current);
  const prior: ComparableHistory = {
    signature: history.signature,
    sessions: history.sessions.slice(0, currentIndex),
    exclusions: history.sessions.slice(0, currentIndex).flatMap(session => session.exclusions),
    indeterminateReasons: history.indeterminateReasons,
  };

  const recommendation = policyFor(derived.rule).evaluate(derived, prior, current, {
    instance: null,
    definitionDefaultIncrementKg: definition.defaultIncrementKg,
  });
  return { kind: 'recommendation', name: definition.name, assuming, recommendation };
}

type DerivedPrescription = PrescriptionContext<DoubleProgressionRule>;

function derivePrescription(
  definition: ExerciseDefinition,
  sets: readonly WorkoutSet[],
  signature: ReturnType<typeof comparisonSignature>
): DerivedPrescription | null {
  const prescribed = sets
    .filter(set => set.comparisonSignature === signature && set.prescriptionSnapshot != null)
    .sort((a, b) =>
      a.localDate < b.localDate ? -1 : a.localDate > b.localDate ? 1 : a.recordedAt - b.recordedAt
    );
  const latest = prescribed[prescribed.length - 1];
  const snapshot = latest?.prescriptionSnapshot;
  if (latest === undefined || snapshot == null) return null;
  if (snapshot.targetRepMin == null || snapshot.targetRepMax == null) return null;

  const setCount = prescribed.filter(
    set => set.sessionExerciseId === latest.sessionExerciseId
  ).length;
  const rule: DoubleProgressionRule = {
    type: 'double_progression',
    sets: Math.max(1, setCount),
    repRange: [snapshot.targetRepMin, snapshot.targetRepMax],
    targetRir: snapshot.targetRir ?? [1, 3],
    incrementPolicy: 'smallest_available',
  };
  validateRule(rule);

  return {
    ruleId: ruleIdOf(snapshot),
    ruleVersion: snapshot.ruleVersion ?? 1,
    rule,
    signature,
    currentTargetLoadKg: snapshot.targetLoadKg,
    prescribedRestSeconds: definition.defaultRestSeconds,
  };
}

function ruleIdOf(snapshot: SetPrescriptionSnapshot): ProgressionRuleId {
  return snapshot.ruleId ?? ('tg-derived-double-progression' as ProgressionRuleId);
}
