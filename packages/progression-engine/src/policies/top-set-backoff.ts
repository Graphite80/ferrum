import {
  addLoad,
  formatLoad,
  grams,
  sameLoad,
  scaleLoad,
  type Kilograms,
  type TopSetBackoffRule,
} from '@ferrum/domain';
import {
  commonWarnings,
  confidenceFrom,
  countTrailingSessions,
  evidenceTrail,
  heaviestSet,
  increment,
  painSeverity,
  priorSessionsWithTopSetAtOrAboveLoad,
  recommendation,
  roundLoad,
  type RecommendationDraft,
} from '../evaluation.ts';
import {
  type ComparableSession,
  type ComparableSet,
  type EffortEvidence,
  type EquipmentConstraints,
  type PrescriptionContext,
  type ProgressionPolicy,
  type ProposedPrescription,
  type Recommendation,
} from '../types.ts';

export const TOP_SET_BACKOFF_POLICY_ID = 'top_set_backoff';
export const TOP_SET_BACKOFF_POLICY_VERSION = 1;

const FAILING_SESSIONS_BEFORE_REDUCTION = 2;
const STALL_BACKOFF_FRACTION = 0.9;
// The scale is coarse and self-reported; half a point either way is noise, not a
// signal to act on.
const RPE_TOLERANCE = 0.5;

export const topSetBackoffPolicy: ProgressionPolicy<TopSetBackoffRule> = {
  policyId: TOP_SET_BACKOFF_POLICY_ID,
  policyVersion: TOP_SET_BACKOFF_POLICY_VERSION,
  ruleType: 'top_set_backoff',

  evaluate(prescription, history, current, equipment, signals): Recommendation {
    const evidence = evidenceTrail(history, current);
    const emit = (draft: RecommendationDraft): Recommendation =>
      recommendation(TOP_SET_BACKOFF_POLICY_ID, TOP_SET_BACKOFF_POLICY_VERSION, evidence, draft);

    const performedTopSet = current == null ? null : heaviestSet(current.sets);
    if (current == null || performedTopSet == null) {
      return emit({
        action: 'insufficient_data',
        proposedPrescription: null,
        reasonCodes: ['no_comparable_sets'],
        explanation:
          current == null
            ? 'No session has been performed against this prescription yet, so there is no top set to work from.'
            : `No comparable set survived exclusion on ${current.localDate}, so there is no ` +
              `performed top set to compute a back-off from.`,
        confidence: 'low',
        warnings: [],
      });
    }

    const { rule } = prescription;
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
          `Sets on ${current.localDate} were flagged with pain level ${pain}; the top set is not ` +
          `the variable to adjust next.`,
        confidence: 'high',
        warnings,
      });
    }
    if (pain === 1) {
      warnings.push(
        `A set on ${current.localDate} carried a pain flag and was left out of the evidence.`
      );
    }

    const performedLoad = performedTopSet.systemLoadKg;
    // The back-off is anchored to the load that was actually lifted, never to the load
    // that was asked for: a top set taken 5 kg under the plan makes every prescribed
    // back-off percentage wrong by the same 5 kg.
    const backoffLoad = roundLoad(
      scaleLoad(performedLoad, rule.backoff.loadFromTopSet),
      equipment,
      'down'
    );
    const propose = (topLoad: Kilograms): ProposedPrescription =>
      proposal(prescription, topLoad, backoffLoad);

    const priorSessions = priorSessionsWithTopSetAtOrAboveLoad(history, performedLoad);
    const rpe = rpeOf(performedTopSet.effort);
    const confidence = confidenceFrom(priorSessions.length, rpe == null ? 'unknown' : 'inside');
    const backoffNote =
      rule.backoff.sets > 0
        ? ` Back-off sets are ${Math.round(rule.backoff.loadFromTopSet * 100)}% of the ` +
          `${formatLoad(performedLoad)} actually lifted, rounded down to ` +
          `${formatLoad(backoffLoad)}.`
        : '';

    if (performedTopSet.reps < rule.topSet.reps) {
      const failures =
        1 +
        countTrailingSessions(priorSessions, (session: ComparableSession) => {
          const top = heaviestSet(session.sets);
          return top != null && top.reps < rule.topSet.reps;
        });

      if (failures >= FAILING_SESSIONS_BEFORE_REDUCTION) {
        const reduced = roundLoad(
          scaleLoad(performedLoad, STALL_BACKOFF_FRACTION),
          equipment,
          'down'
        );
        if (grams(reduced) <= 0 || sameLoad(reduced, performedLoad)) {
          return emit({
            action: 'review_exercise',
            proposedPrescription: null,
            reasonCodes: [
              ...shared,
              'top_set_reps_missed',
              'repeated_failure',
              'cannot_reduce_further',
            ],
            explanation:
              `${failures} sessions in a row missed ${rule.topSet.reps} reps on the top set at ` +
              `${formatLoad(performedLoad)} and the equipment offers nothing lighter.`,
            confidence,
            warnings,
          });
        }
        return emit({
          action: 'reduce_load',
          proposedPrescription: proposal(
            prescription,
            reduced,
            roundLoad(scaleLoad(reduced, rule.backoff.loadFromTopSet), equipment, 'down')
          ),
          reasonCodes: [...shared, 'top_set_reps_missed', 'repeated_failure'],
          explanation:
            `${failures} sessions in a row missed ${rule.topSet.reps} reps on the top set at ` +
            `${formatLoad(performedLoad)} (last attempt ${performedTopSet.reps} reps). ` +
            `Dropping the top set to ${formatLoad(reduced)}.`,
          confidence,
          warnings,
        });
      }

      return emit({
        action: 'repeat',
        proposedPrescription: propose(performedLoad),
        reasonCodes: [...shared, 'top_set_reps_missed', 'backoff_from_performed_top_set'],
        explanation:
          `The top set made ${performedTopSet.reps} of ${rule.topSet.reps} reps at ` +
          `${formatLoad(performedLoad)}. One missed top set is not a deload; repeat it.` +
          backoffNote,
        confidence,
        warnings,
      });
    }

    if (rpe == null) {
      return emit({
        action: 'hold',
        proposedPrescription: propose(performedLoad),
        reasonCodes: [
          ...shared,
          'top_set_reps_met',
          'effort_unknown',
          'backoff_from_performed_top_set',
        ],
        explanation:
          `The top set made ${performedTopSet.reps} reps at ${formatLoad(performedLoad)}, but no ` +
          `RPE was recorded, so there is no evidence it landed near the prescribed RPE ` +
          `${rule.topSet.targetRpe}. Load stays where it is.` +
          backoffNote,
        confidence: 'low',
        warnings,
      });
    }

    if (rpe > rule.topSet.targetRpe + RPE_TOLERANCE) {
      const tooHard =
        1 +
        countTrailingSessions(priorSessions, (session: ComparableSession) => {
          const top = heaviestSet(session.sets);
          const priorRpe = top == null ? null : rpeOf(top.effort);
          return priorRpe != null && priorRpe > rule.topSet.targetRpe + RPE_TOLERANCE;
        });

      if (tooHard >= FAILING_SESSIONS_BEFORE_REDUCTION) {
        const reduced = roundLoad(
          scaleLoad(performedLoad, STALL_BACKOFF_FRACTION),
          equipment,
          'down'
        );
        if (grams(reduced) > 0 && !sameLoad(reduced, performedLoad)) {
          return emit({
            action: 'reduce_load',
            proposedPrescription: proposal(
              prescription,
              reduced,
              roundLoad(scaleLoad(reduced, rule.backoff.loadFromTopSet), equipment, 'down')
            ),
            reasonCodes: [
              ...shared,
              'top_set_reps_met',
              'top_set_effort_above_target',
              'repeated_failure',
            ],
            explanation:
              `${tooHard} sessions in a row took the top set at RPE ${rpe} against a target of ` +
              `${rule.topSet.targetRpe}. Reps are being bought with effort that is not there; ` +
              `dropping to ${formatLoad(reduced)}.`,
            confidence,
            warnings,
          });
        }
      }

      return emit({
        action: 'hold',
        proposedPrescription: propose(performedLoad),
        reasonCodes: [
          ...shared,
          'top_set_reps_met',
          'top_set_effort_above_target',
          'backoff_from_performed_top_set',
        ],
        explanation:
          `The top set made ${performedTopSet.reps} reps at ${formatLoad(performedLoad)} but at ` +
          `RPE ${rpe}, above the prescribed ${rule.topSet.targetRpe}. Hold the load until it is ` +
          `earned.` +
          backoffNote,
        confidence,
        warnings,
      });
    }

    const step = increment(equipment);
    if (step == null) {
      return emit({
        action: 'hold',
        proposedPrescription: propose(performedLoad),
        reasonCodes: [
          ...shared,
          'top_set_reps_met',
          'increment_unknown',
          'backoff_from_performed_top_set',
        ],
        explanation:
          `The top set made ${performedTopSet.reps} reps at ${formatLoad(performedLoad)} at RPE ` +
          `${rpe}, but no smallest available increment is known for this equipment.` +
          backoffNote,
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
        proposedPrescription: propose(performedLoad),
        reasonCodes: [
          ...shared,
          'top_set_reps_met',
          'readiness_low',
          'backoff_from_performed_top_set',
        ],
        explanation:
          `The top set met ${rule.topSet.reps} reps at RPE ${rpe}, but readiness was reported low; ` +
          `the top set stays at ${formatLoad(performedLoad)}.` +
          backoffNote,
        confidence,
        warnings,
      });
    }

    const nextTop = roundLoad(addLoad(performedLoad, step.kilograms), equipment, 'nearest');
    if (sameLoad(nextTop, performedLoad)) {
      return emit({
        action: 'hold',
        proposedPrescription: propose(performedLoad),
        reasonCodes: [
          ...shared,
          'top_set_reps_met',
          'equipment_maximum_reached',
          'backoff_from_performed_top_set',
        ],
        explanation:
          `The top set met ${rule.topSet.reps} reps at RPE ${rpe}, but ` +
          `${formatLoad(performedLoad)} is the maximum this equipment offers.` +
          backoffNote,
        confidence,
        warnings,
      });
    }

    return emit({
      action: 'increase_load',
      proposedPrescription: propose(nextTop),
      reasonCodes: [...shared, 'top_set_reps_met', 'backoff_from_performed_top_set'],
      explanation:
        `The top set made ${performedTopSet.reps} reps at ${formatLoad(performedLoad)} at RPE ` +
        `${rpe}, at or under the prescribed ${rule.topSet.targetRpe}. Next top set is ` +
        `${formatLoad(nextTop)} (+${formatLoad(step.kilograms)}, ${step.source}).` +
        backoffNote,
      confidence,
      warnings,
    });
  },
};

function rpeOf(effort: EffortEvidence): number | null {
  switch (effort.kind) {
    case 'rpe_entered':
      return effort.rpe;
    case 'rir_entered':
      return 10 - effort.rir;
    case 'unknown':
      return null;
  }
}

function proposal(
  prescription: PrescriptionContext<TopSetBackoffRule>,
  topLoad: Kilograms,
  backoffLoad: Kilograms
): ProposedPrescription {
  const { rule } = prescription;
  const backoffReps = Math.max(1, rule.topSet.reps + rule.backoff.repDelta);
  return {
    ruleId: prescription.ruleId,
    ruleVersion: prescription.ruleVersion,
    restSecondsBetweenSets: prescription.prescribedRestSeconds,
    sets: [
      {
        setType: 'top' as const,
        targetLoadKg: topLoad,
        targetRepMin: rule.topSet.reps,
        targetRepMax: rule.topSet.reps,
        targetRir: null,
        targetRpe: rule.topSet.targetRpe,
      },
      ...Array.from({ length: rule.backoff.sets }, () => ({
        setType: 'backoff' as const,
        targetLoadKg: backoffLoad,
        targetRepMin: backoffReps,
        targetRepMax: backoffReps,
        targetRir: null,
        targetRpe: null,
      })),
    ],
  };
}

export function backoffLoadFromPerformedTopSet(
  performedTopSet: ComparableSet,
  rule: TopSetBackoffRule,
  equipment: EquipmentConstraints
): Kilograms {
  return roundLoad(
    scaleLoad(performedTopSet.systemLoadKg, rule.backoff.loadFromTopSet),
    equipment,
    'down'
  );
}
