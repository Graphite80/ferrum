import {
  addLoad,
  formatLoad,
  grams,
  sameLoad,
  scaleLoad,
  type DoubleProgressionRule,
  type Kilograms,
} from '@ferrum/domain';
import {
  commonWarnings,
  confidenceFrom,
  countTrailingSessions,
  effortSummary,
  effortVerdict,
  evidenceTrail,
  increment,
  minLoad,
  minReps,
  painSeverity,
  priorSessionsAtOrAboveLoad,
  recommendation,
  roundLoad,
  totalReps,
  type RecommendationDraft,
} from '../evaluation.ts';
import {
  type ComparableSession,
  type PrescriptionContext,
  type ProgressionPolicy,
  type ProposedPrescription,
  type ReasonCode,
  type Recommendation,
} from '../types.ts';

export const DOUBLE_PROGRESSION_POLICY_ID = 'double_progression';
export const DOUBLE_PROGRESSION_POLICY_VERSION = 1;

// Rep-range work exists to absorb bad days: a session at the bottom of the range is
// inside the prescription's own tolerance. Three consecutive sessions that fail to
// reach the bottom at the same load is a stall. A single one is a Tuesday.
const FAILING_SESSIONS_BEFORE_REDUCTION = 3;
const FAILING_SESSIONS_BEFORE_REDUCTION_AFTER_DROP = 2;
// Never 1: the floor on every reduction path in this engine is two sessions.
const SUBSTANTIAL_DROP_FRACTION = 0.7;
const STALL_BACKOFF_FRACTION = 0.9;
const SESSIONS_BELOW_SET_COUNT_BEFORE_REDUCING_SETS = 2;
const REPS_ABOVE_RANGE_BEFORE_RETARGET = 2;

export const doubleProgressionPolicy: ProgressionPolicy<DoubleProgressionRule> = {
  policyId: DOUBLE_PROGRESSION_POLICY_ID,
  policyVersion: DOUBLE_PROGRESSION_POLICY_VERSION,
  ruleType: 'double_progression',

  evaluate(prescription, history, current, equipment, signals): Recommendation {
    const evidence = evidenceTrail(history, current);
    const emit = (draft: RecommendationDraft): Recommendation =>
      recommendation(
        DOUBLE_PROGRESSION_POLICY_ID,
        DOUBLE_PROGRESSION_POLICY_VERSION,
        evidence,
        draft
      );

    if (current == null || current.sets.length === 0) {
      return emit(insufficientData(current));
    }

    const { rule } = prescription;
    const [bottomOfRange, topOfRange] = rule.repRange;
    const workingLoad = minLoad(current.sets);
    if (workingLoad == null) return emit(insufficientData(current));

    const context = commonWarnings(current, equipment);
    const warnings = [...context.warnings];
    const shared = [...context.reasonCodes];

    const pain = painSeverity(current);
    if (pain >= 2) {
      return emit({
        action: 'review_exercise',
        proposedPrescription: null,
        reasonCodes: [...shared, 'pain_reported'],
        explanation:
          `Sets on ${current.localDate} were flagged with pain level ${pain}. Load selection is ` +
          `not the question to answer next; the exercise itself needs review.`,
        confidence: 'high',
        warnings,
      });
    }
    if (pain === 1) {
      warnings.push(
        `A set on ${current.localDate} carried a pain flag and was left out of the evidence.`
      );
    }

    const priorSessions = priorSessionsAtOrAboveLoad(history, workingLoad);
    const performedSets = current.sets.length;
    const lowestReps = minReps(current.sets);
    const effort = effortVerdict(current.sets, rule.targetRir);
    const confidence = confidenceFrom(priorSessions.length, effort);
    const propose = (
      sets: number,
      load: Kilograms | null,
      repMin: number,
      repMax: number
    ): ProposedPrescription => proposal(prescription, sets, load, repMin, repMax);

    if (priorSessions.length === 0) {
      warnings.push(
        'No earlier comparable session at this load; the decision rests on one session only.'
      );
    }

    if (performedSets < rule.sets) {
      const consecutive =
        1 + countTrailingSessions(priorSessions, session => session.sets.length < rule.sets);
      if (consecutive >= SESSIONS_BELOW_SET_COUNT_BEFORE_REDUCING_SETS) {
        return emit({
          action: 'reduce_sets',
          proposedPrescription: propose(performedSets, workingLoad, bottomOfRange, topOfRange),
          reasonCodes: [...shared, 'set_count_below_prescription', 'repeated_failure'],
          explanation:
            `${consecutive} sessions in a row finished ${performedSets} of ${rule.sets} ` +
            `prescribed sets at ${formatLoad(workingLoad)}. The prescription is asking for ` +
            `volume that is not being done; matching it to ${performedSets} sets is honest.`,
          confidence,
          warnings,
        });
      }
      return emit({
        action: 'repeat',
        proposedPrescription: propose(rule.sets, workingLoad, bottomOfRange, topOfRange),
        reasonCodes: [...shared, 'set_count_below_prescription'],
        explanation:
          `${performedSets} of ${rule.sets} prescribed sets were completed at ` +
          `${formatLoad(workingLoad)}. One short session is not a reason to change anything.`,
        confidence,
        warnings,
      });
    }

    if (lowestReps < bottomOfRange) {
      const failedAtThisLoad = (session: ComparableSession): boolean =>
        session.sets.length < rule.sets || minReps(session.sets) < bottomOfRange;
      const consecutiveFailures = 1 + countTrailingSessions(priorSessions, failedAtThisLoad);
      const bestPriorVolume = priorSessions.reduce(
        (best, session) => Math.max(best, totalReps(session.sets)),
        0
      );
      const currentVolume = totalReps(current.sets);
      const substantialDrop =
        bestPriorVolume > 0 && currentVolume < bestPriorVolume * SUBSTANTIAL_DROP_FRACTION;
      const threshold = substantialDrop
        ? FAILING_SESSIONS_BEFORE_REDUCTION_AFTER_DROP
        : FAILING_SESSIONS_BEFORE_REDUCTION;

      if (consecutiveFailures >= threshold) {
        const reduced = roundLoad(
          scaleLoad(workingLoad, STALL_BACKOFF_FRACTION),
          equipment,
          'down'
        );
        if (grams(reduced) <= 0 || sameLoad(reduced, workingLoad)) {
          return emit({
            action: 'review_exercise',
            proposedPrescription: null,
            reasonCodes: [
              ...shared,
              'reps_below_range',
              'repeated_failure',
              'cannot_reduce_further',
            ],
            explanation:
              `${consecutiveFailures} sessions in a row fell short of ${bottomOfRange} reps at ` +
              `${formatLoad(workingLoad)}, and the available equipment cannot go lower. The ` +
              `exercise or the equipment needs a decision a load change cannot make.`,
            confidence,
            warnings,
          });
        }
        return emit({
          action: 'reduce_load',
          proposedPrescription: propose(rule.sets, reduced, bottomOfRange, topOfRange),
          reasonCodes: [
            ...shared,
            'reps_below_range',
            'repeated_failure',
            ...(substantialDrop ? (['substantial_performance_drop'] as const) : []),
          ],
          explanation:
            `${consecutiveFailures} sessions in a row fell short of ${bottomOfRange} reps at ` +
            `${formatLoad(workingLoad)}${
              substantialDrop
                ? `, and total reps dropped from ${bestPriorVolume} to ${currentVolume}`
                : ''
            }. Dropping to ${formatLoad(reduced)} to rebuild the range.`,
          confidence,
          warnings,
        });
      }

      return emit({
        action: 'repeat',
        proposedPrescription: propose(rule.sets, workingLoad, bottomOfRange, topOfRange),
        reasonCodes: [...shared, 'reps_below_range'],
        explanation:
          `Lowest working set was ${lowestReps} reps, under the ${bottomOfRange}-rep floor, at ` +
          `${formatLoad(workingLoad)}. That is ${consecutiveFailures} short session in a row; ` +
          `${threshold} are needed before this engine reduces anything.`,
        confidence,
        warnings,
      });
    }

    if (lowestReps < topOfRange) {
      if (effort === 'harder') {
        return emit({
          action: 'hold',
          proposedPrescription: propose(rule.sets, workingLoad, bottomOfRange, topOfRange),
          reasonCodes: [...shared, 'reps_within_range', 'effort_harder_than_target'],
          explanation:
            `${lowestReps} reps at ${formatLoad(workingLoad)} is inside the ` +
            `${bottomOfRange}-${topOfRange} range but effort was ${effortSummary(current.sets)}, ` +
            `harder than the ${rule.targetRir[0]}-${rule.targetRir[1]} RIR target. Repeat before adding reps.`,
          confidence,
          warnings,
        });
      }
      return emit({
        action: 'increase_reps',
        proposedPrescription: propose(rule.sets, workingLoad, bottomOfRange, topOfRange),
        reasonCodes: [
          ...shared,
          'reps_within_range',
          ...(effort === 'unknown' ? (['effort_unknown'] as const) : []),
        ],
        explanation:
          `${lowestReps} reps at ${formatLoad(workingLoad)} is inside the ` +
          `${bottomOfRange}-${topOfRange} range. Add reps at this load before adding load.`,
        confidence,
        warnings,
      });
    }

    const atTop: readonly ReasonCode[] = [...shared, 'all_sets_at_top_of_range'];

    if (effort === 'unknown') {
      return emit({
        action: 'hold',
        proposedPrescription: propose(rule.sets, workingLoad, bottomOfRange, topOfRange),
        reasonCodes: [...atTop, 'effort_unknown'],
        explanation:
          `All ${performedSets} working sets reached ${topOfRange} reps at ` +
          `${formatLoad(workingLoad)}, but no RIR or RPE was recorded, so there is no evidence ` +
          `the effort was inside the ${rule.targetRir[0]}-${rule.targetRir[1]} RIR target. ` +
          `Missing effort is not proof of easy work.`,
        confidence: 'low',
        warnings,
      });
    }

    if (effort !== 'inside') {
      return emit({
        action: 'hold',
        proposedPrescription: propose(rule.sets, workingLoad, bottomOfRange, topOfRange),
        reasonCodes: [
          ...atTop,
          effort === 'harder' ? 'effort_harder_than_target' : 'effort_easier_than_target',
        ],
        explanation:
          `All working sets reached ${topOfRange} reps at ${formatLoad(workingLoad)}, but ` +
          `effort was ${effortSummary(current.sets)}, outside the ${rule.targetRir[0]}-` +
          `${rule.targetRir[1]} RIR target. Repeat the prescription until the two agree.`,
        confidence,
        warnings,
      });
    }

    const step = increment(equipment);
    if (step == null) {
      if (lowestReps >= topOfRange + REPS_ABOVE_RANGE_BEFORE_RETARGET) {
        const shift = lowestReps - topOfRange;
        return emit({
          action: 'change_rep_target',
          proposedPrescription: propose(
            rule.sets,
            workingLoad,
            bottomOfRange + shift,
            topOfRange + shift
          ),
          reasonCodes: [...atTop, 'reps_above_range', 'increment_unknown'],
          explanation:
            `Every set reached ${lowestReps} reps, ${shift} past the top of the range, and no load ` +
            `increment is available for this equipment. Move the range to ` +
            `${bottomOfRange + shift}-${topOfRange + shift} instead of pretending load can change.`,
          confidence,
          warnings,
        });
      }
      return emit({
        action: 'hold',
        proposedPrescription: propose(rule.sets, workingLoad, bottomOfRange, topOfRange),
        reasonCodes: [...atTop, 'effort_inside_target_band', 'increment_unknown'],
        explanation:
          `All working sets reached ${topOfRange} reps at ${formatLoad(workingLoad)} inside the ` +
          `RIR target, but no smallest available increment is known for this equipment, so there ` +
          `is no load to propose.`,
        confidence,
        warnings: [
          ...warnings,
          'Configure a stack, dumbbell or plate increment for this equipment to unlock load progression.',
        ],
      });
    }

    if (signals?.readiness === 'low') {
      return emit({
        action: 'hold',
        proposedPrescription: propose(rule.sets, workingLoad, bottomOfRange, topOfRange),
        reasonCodes: [...atTop, 'effort_inside_target_band', 'readiness_low'],
        explanation:
          `All working sets reached ${topOfRange} reps at ${formatLoad(workingLoad)} inside the ` +
          `RIR target, but readiness was reported low. Holding the load costs one session; a ` +
          `missed jump costs three.`,
        confidence,
        warnings,
      });
    }

    const target = roundLoad(addLoad(workingLoad, step.kilograms), equipment, 'nearest');
    if (sameLoad(target, workingLoad)) {
      return emit({
        action: 'hold',
        proposedPrescription: propose(rule.sets, workingLoad, bottomOfRange, topOfRange),
        reasonCodes: [...atTop, 'effort_inside_target_band', 'equipment_maximum_reached'],
        explanation:
          `All working sets reached ${topOfRange} reps at ${formatLoad(workingLoad)} inside the ` +
          `RIR target, but that is the maximum this equipment offers.`,
        confidence,
        warnings,
      });
    }

    return emit({
      action: 'increase_load',
      proposedPrescription: propose(rule.sets, target, bottomOfRange, topOfRange),
      reasonCodes: [...atTop, 'effort_inside_target_band'],
      explanation:
        `All ${performedSets} working sets reached ${topOfRange} reps at ` +
        `${formatLoad(workingLoad)} at ${effortSummary(current.sets)}, inside the ` +
        `${rule.targetRir[0]}-${rule.targetRir[1]} RIR target. Adding the smallest available ` +
        `increment (${formatLoad(step.kilograms)}, ${step.source}) gives ${formatLoad(target)}.`,
      confidence,
      warnings,
    });
  },
};

function insufficientData(current: ComparableSession | null): RecommendationDraft {
  const excluded = current?.exclusions ?? [];
  const reasons = [...new Set(excluded.map(item => item.reason))].sort();
  return {
    action: 'insufficient_data',
    proposedPrescription: null,
    reasonCodes: ['no_comparable_sets'],
    explanation:
      current == null
        ? 'No session has been performed against this prescription yet, so there is nothing to compare.'
        : `Every set on ${current.localDate} was excluded from the evidence (${
            reasons.length === 0 ? 'no candidate sets at all' : reasons.join(', ')
          }). Guessing a load from no comparable set is the one thing this engine will not do.`,
    confidence: 'low',
    warnings: [],
  };
}

function proposal(
  prescription: PrescriptionContext<DoubleProgressionRule>,
  sets: number,
  load: Kilograms | null,
  repMin: number,
  repMax: number
): ProposedPrescription {
  return {
    ruleId: prescription.ruleId,
    ruleVersion: prescription.ruleVersion,
    restSecondsBetweenSets: prescription.prescribedRestSeconds,
    sets: Array.from({ length: sets }, () => ({
      setType: 'working' as const,
      targetLoadKg: load,
      targetRepMin: repMin,
      targetRepMax: repMax,
      targetRir: prescription.rule.targetRir,
      targetRpe: null,
    })),
  };
}
