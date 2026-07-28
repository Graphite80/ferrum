import {
  addLoad,
  formatLoad,
  grams,
  isPresent,
  sameLoad,
  scaleLoad,
  type Kilograms,
  type LinearLoadRule,
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
  type RecommendationDraft,
} from '../evaluation.ts';
import {
  type ComparableSession,
  type PrescriptionContext,
  type ProgressionPolicy,
  type ProposedPrescription,
  type Recommendation,
} from '../types.ts';

export const LINEAR_LOAD_POLICY_ID = 'linear_load';
export const LINEAR_LOAD_POLICY_VERSION = 1;

// `LinearLoadRule.failuresBeforeBackoff` is validated as >= 1 by the domain, and 1 is
// a legal program. It is not a legal deload trigger: one missed session is a bad
// night's sleep, not a stalled lift. The engine's own floor overrides the rule's,
// and it only ever raises the requirement.
const MINIMUM_FAILING_SESSIONS_BEFORE_REDUCTION = 2;
const SHORT_REST_FRACTION = 0.75;

export const linearLoadPolicy: ProgressionPolicy<LinearLoadRule> = {
  policyId: LINEAR_LOAD_POLICY_ID,
  policyVersion: LINEAR_LOAD_POLICY_VERSION,
  ruleType: 'linear_load',

  evaluate(prescription, history, current, equipment, signals): Recommendation {
    const evidence = evidenceTrail(history, current);
    const emit = (draft: RecommendationDraft): Recommendation =>
      recommendation(LINEAR_LOAD_POLICY_ID, LINEAR_LOAD_POLICY_VERSION, evidence, draft);

    if (current == null || current.sets.length === 0) {
      return emit({
        action: 'insufficient_data',
        proposedPrescription: null,
        reasonCodes: ['no_comparable_sets'],
        explanation:
          current == null
            ? 'No session has been performed against this prescription yet, so there is nothing to compare.'
            : `Every set on ${current.localDate} was excluded from the evidence, so there is no ` +
              `comparable performance to reason from.`,
        confidence: 'low',
        warnings: [],
      });
    }

    const { rule } = prescription;
    const workingLoad = minLoad(current.sets);
    if (workingLoad == null) {
      return emit({
        action: 'insufficient_data',
        proposedPrescription: null,
        reasonCodes: ['no_comparable_sets'],
        explanation: `No resolvable load on ${current.localDate}.`,
        confidence: 'low',
        warnings: [],
      });
    }

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
          `Sets on ${current.localDate} were flagged with pain level ${pain}. The next decision ` +
          `is about the exercise, not about the load.`,
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
    const propose = (sets: number, load: Kilograms | null): ProposedPrescription =>
      proposal(prescription, sets, load);

    const missed = performedSets < rule.sets || lowestReps < rule.reps;

    if (missed) {
      const failedAtThisLoad = (session: ComparableSession): boolean =>
        session.sets.length < rule.sets || minReps(session.sets) < rule.reps;
      const failures = 1 + countTrailingSessions(priorSessions, failedAtThisLoad);
      const required = Math.max(
        rule.failuresBeforeBackoff,
        MINIMUM_FAILING_SESSIONS_BEFORE_REDUCTION
      );

      if (failures >= required) {
        const reduced = roundLoad(scaleLoad(workingLoad, rule.backoffFraction), equipment, 'down');
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
              `${failures} sessions in a row missed ${rule.sets}x${rule.reps} at ` +
              `${formatLoad(workingLoad)} and the equipment offers nothing lighter.`,
            confidence,
            warnings,
          });
        }
        return emit({
          action: 'reduce_load',
          proposedPrescription: propose(rule.sets, reduced),
          reasonCodes: [...shared, 'reps_below_range', 'repeated_failure'],
          explanation:
            `${failures} sessions in a row missed ${rule.sets}x${rule.reps} at ` +
            `${formatLoad(workingLoad)} (lowest set ${lowestReps} reps across ${performedSets} ` +
            `sets). Backing off to ${formatLoad(reduced)}, ${Math.round(
              rule.backoffFraction * 100
            )}% of the stalled load.`,
          confidence,
          warnings,
        });
      }

      const restEvidence = restShortfall(current, prescription.prescribedRestSeconds);
      if (restEvidence != null) {
        return emit({
          action: 'increase_rest',
          proposedPrescription: propose(rule.sets, workingLoad),
          reasonCodes: [...shared, 'reps_below_range', 'rest_shorter_than_prescribed'],
          explanation:
            `${rule.sets}x${rule.reps} at ${formatLoad(workingLoad)} was missed after a mean ` +
            `rest of ${restEvidence.observedSeconds}s against ${restEvidence.prescribedSeconds}s ` +
            `prescribed. Rest is the cheapest variable to fix before touching load.`,
          confidence,
          warnings,
        });
      }

      return emit({
        action: 'repeat',
        proposedPrescription: propose(rule.sets, workingLoad),
        reasonCodes: [
          ...shared,
          'reps_below_range',
          ...(current.sets.every(set => set.restSeconds == null)
            ? (['rest_not_recorded'] as const)
            : []),
        ],
        explanation:
          `${rule.sets}x${rule.reps} at ${formatLoad(workingLoad)} was missed (lowest set ` +
          `${lowestReps} reps across ${performedSets} sets). That is ${failures} of the ` +
          `${required} failing sessions this engine requires before it reduces anything.`,
        confidence,
        warnings,
      });
    }

    if (effort === 'unknown') {
      return emit({
        action: 'hold',
        proposedPrescription: propose(rule.sets, workingLoad),
        reasonCodes: [...shared, 'effort_unknown'],
        explanation:
          `${rule.sets}x${rule.reps} at ${formatLoad(workingLoad)} was completed, but no RIR or ` +
          `RPE was recorded, so there is no evidence the effort was inside the ` +
          `${rule.targetRir[0]}-${rule.targetRir[1]} RIR target. Load stays where it is.`,
        confidence: 'low',
        warnings,
      });
    }

    if (effort !== 'inside') {
      return emit({
        action: 'hold',
        proposedPrescription: propose(rule.sets, workingLoad),
        reasonCodes: [
          ...shared,
          effort === 'harder' ? 'effort_harder_than_target' : 'effort_easier_than_target',
        ],
        explanation:
          `${rule.sets}x${rule.reps} at ${formatLoad(workingLoad)} was completed at ` +
          `${effortSummary(current.sets)}, outside the ${rule.targetRir[0]}-${rule.targetRir[1]} ` +
          `RIR target. Repeat the load until effort and prescription agree.`,
        confidence,
        warnings,
      });
    }

    const step = increment(equipment);
    if (step == null) {
      return emit({
        action: 'hold',
        proposedPrescription: propose(rule.sets, workingLoad),
        reasonCodes: [...shared, 'effort_inside_target_band', 'increment_unknown'],
        explanation:
          `${rule.sets}x${rule.reps} at ${formatLoad(workingLoad)} was completed inside the RIR ` +
          `target, but no smallest available increment is known for this equipment.`,
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
        proposedPrescription: propose(rule.sets, workingLoad),
        reasonCodes: [...shared, 'effort_inside_target_band', 'readiness_low'],
        explanation:
          `${rule.sets}x${rule.reps} at ${formatLoad(workingLoad)} was completed inside the RIR ` +
          `target, but readiness was reported low; the jump waits one session.`,
        confidence,
        warnings,
      });
    }

    const target = roundLoad(addLoad(workingLoad, step.kilograms), equipment, 'nearest');
    if (sameLoad(target, workingLoad)) {
      return emit({
        action: 'hold',
        proposedPrescription: propose(rule.sets, workingLoad),
        reasonCodes: [...shared, 'effort_inside_target_band', 'equipment_maximum_reached'],
        explanation:
          `${rule.sets}x${rule.reps} at ${formatLoad(workingLoad)} was completed inside the RIR ` +
          `target, but that is the maximum this equipment offers.`,
        confidence,
        warnings,
      });
    }

    return emit({
      action: 'increase_load',
      proposedPrescription: propose(rule.sets, target),
      reasonCodes: [...shared, 'effort_inside_target_band'],
      explanation:
        `${rule.sets}x${rule.reps} at ${formatLoad(workingLoad)} was completed at ` +
        `${effortSummary(current.sets)}, inside the ${rule.targetRir[0]}-${rule.targetRir[1]} RIR ` +
        `target. Adding the smallest available increment (${formatLoad(step.kilograms)}, ` +
        `${step.source}) gives ${formatLoad(target)}.`,
      confidence,
      warnings,
    });
  },
};

interface RestShortfall {
  readonly observedSeconds: number;
  readonly prescribedSeconds: number;
}

// Rest is only ever an explanation when it was actually measured. The imported
// history carries `actualRestSeconds: null` on every row, and a null there means
// "unknown", never "long enough".
function restShortfall(
  session: ComparableSession,
  prescribedSeconds: number | null
): RestShortfall | null {
  if (prescribedSeconds == null || prescribedSeconds <= 0) return null;
  const recorded = session.sets.map(set => set.restSeconds).filter(isPresent);
  if (recorded.length === 0 || recorded.length !== session.sets.length) return null;
  const mean = Math.round(recorded.reduce((sum, value) => sum + value, 0) / recorded.length);
  if (mean >= prescribedSeconds * SHORT_REST_FRACTION) return null;
  return { observedSeconds: mean, prescribedSeconds };
}

function proposal(
  prescription: PrescriptionContext<LinearLoadRule>,
  sets: number,
  load: Kilograms | null
): ProposedPrescription {
  return {
    ruleId: prescription.ruleId,
    ruleVersion: prescription.ruleVersion,
    restSecondsBetweenSets: prescription.prescribedRestSeconds,
    sets: Array.from({ length: sets }, () => ({
      setType: 'working' as const,
      targetLoadKg: load,
      targetRepMin: prescription.rule.reps,
      targetRepMax: prescription.rule.reps,
      targetRir: prescription.rule.targetRir,
      targetRpe: null,
    })),
  };
}
