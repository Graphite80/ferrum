import {
  grams,
  isPresent,
  type Kilograms,
  type LocalDate,
  type PrescriptionRule,
} from '@ferrum/domain';
import { heaviestSet, minLoad, minReps } from './evaluation.ts';
import {
  CONFIDENCE_LEVELS,
  PROGRESSION_ACTIONS,
  type ComparableHistory,
  type ComparableSession,
  type Confidence,
  type EquipmentConstraints,
  type OptionalSignals,
  type PrescriptionContext,
  type ProgressionAction,
  type ProgressionPolicy,
  type ProposedPrescription,
  type Recommendation,
} from './types.ts';

export type NextSessionOutcome = 'met' | 'not_met' | 'no_target_to_check' | 'no_next_session';

export interface ReplayStep {
  readonly evaluatedAfterDate: LocalDate;
  readonly priorSessionCount: number;
  readonly targetLoadInForceKg: Kilograms | null;
  readonly recommendation: Recommendation;
  readonly nextSessionDate: LocalDate | null;
  readonly nextSessionOutcome: NextSessionOutcome;
  readonly failingSessionsEndingHere: number;
}

export interface ConfidenceOutcome {
  readonly met: number;
  readonly notMet: number;
  readonly unobserved: number;
}

export interface ReplayReport {
  readonly policyId: string;
  readonly policyVersion: number;
  readonly signature: string;
  readonly sessionCount: number;
  readonly recommendationCount: number;
  readonly insufficientDataCount: number;
  readonly insufficientDataShare: number;
  readonly actionCounts: Readonly<Record<ProgressionAction, number>>;
  readonly falseRaises: number;
  readonly reductionsAfterSingleBadSession: number;
  readonly confidenceOutcomes: Readonly<Record<Confidence, ConfidenceOutcome>>;
  readonly steps: readonly ReplayStep[];
}

export interface ReplayInput<R extends PrescriptionRule> {
  readonly policy: ProgressionPolicy<R>;
  readonly initialPrescription: PrescriptionContext<R>;
  readonly history: ComparableHistory;
  readonly equipment: EquipmentConstraints;
  readonly signals?: OptionalSignals;
}

export function replayPolicy<R extends PrescriptionRule>(input: ReplayInput<R>): ReplayReport {
  const { history, policy, equipment } = input;
  const sessions = history.sessions;
  const steps: ReplayStep[] = [];
  let prescription = input.initialPrescription;

  for (let index = 0; index < sessions.length; index += 1) {
    const current = sessions[index];
    if (current === undefined) continue;

    const priorHistory: ComparableHistory = {
      signature: history.signature,
      sessions: sessions.slice(0, index),
      exclusions: sessions.slice(0, index).flatMap(session => session.exclusions),
      indeterminateReasons: history.indeterminateReasons,
    };

    const recommendation = policy.evaluate(
      prescription,
      priorHistory,
      current,
      equipment,
      input.signals
    );

    const next = sessions[index + 1] ?? null;
    steps.push({
      evaluatedAfterDate: current.localDate,
      priorSessionCount: priorHistory.sessions.filter(session => session.sets.length > 0).length,
      targetLoadInForceKg: prescription.currentTargetLoadKg,
      recommendation,
      nextSessionDate: next?.localDate ?? null,
      nextSessionOutcome: outcomeOf(recommendation.proposedPrescription, next),
      failingSessionsEndingHere: countFailingSessionsEndingAt(
        sessions.slice(0, index + 1),
        prescription,
        prescription.currentTargetLoadKg
      ),
    });

    prescription = adopt(prescription, recommendation.proposedPrescription);
  }

  return summarise(policy.policyId, policy.policyVersion, history, steps);
}

// The corpus never followed these recommendations, so "met" cannot mean compliance.
// It means the session that actually happened next would have cleared the bar this
// recommendation set. That is the strongest counterfactual a replay over real history
// can honestly report, and it is what makes a raise "false": we asked for more and
// the athlete, on that day, did less.
function outcomeOf(
  proposal: ProposedPrescription | null,
  next: ComparableSession | null
): NextSessionOutcome {
  if (next == null) return 'no_next_session';
  if (proposal == null || next.sets.length === 0) return 'no_target_to_check';

  const targetLoads = proposal.sets.map(set => set.targetLoadKg).filter(isPresent);
  const targetReps = proposal.sets.map(set => set.targetRepMin).filter(isPresent);
  if (targetLoads.length !== proposal.sets.length || targetReps.length !== proposal.sets.length) {
    return 'no_target_to_check';
  }

  const requiredLoad = targetLoads.reduce((lowest, load) =>
    grams(load) < grams(lowest) ? load : lowest
  );
  const requiredReps = Math.min(...targetReps);
  const achievedLoad = minLoad(next.sets);
  if (achievedLoad == null) return 'no_target_to_check';

  const met =
    next.sets.length >= proposal.sets.length &&
    grams(achievedLoad) >= grams(requiredLoad) &&
    minReps(next.sets) >= requiredReps;
  return met ? 'met' : 'not_met';
}

// Written against the rule rather than by asking the policy, so that the "never
// deload after one bad session" number in the report is not produced by the same code
// it is checking. Sessions that are not evidence at the load in force (nothing
// comparable logged, or lighter work) neither count as failures nor end the run.
function countFailingSessionsEndingAt(
  sessions: readonly ComparableSession[],
  prescription: PrescriptionContext,
  loadInForce: Kilograms | null
): number {
  const target = requirementOf(prescription.rule);
  let failures = 0;
  for (let index = sessions.length - 1; index >= 0; index -= 1) {
    const session = sessions[index];
    if (session === undefined) continue;
    const verdict = judge(session, target, loadInForce, prescription.rule);
    if (verdict === 'skip') continue;
    if (verdict === 'pass') return failures;
    failures += 1;
  }
  return failures;
}

interface Requirement {
  readonly sets: number;
  readonly reps: number;
}

function requirementOf(rule: PrescriptionRule): Requirement {
  switch (rule.type) {
    case 'double_progression':
      return { sets: rule.sets, reps: rule.repRange[0] };
    case 'linear_load':
      return { sets: rule.sets, reps: rule.reps };
    case 'top_set_backoff':
      return { sets: 1, reps: rule.topSet.reps };
  }
}

function judge(
  session: ComparableSession,
  target: Requirement,
  loadInForce: Kilograms | null,
  rule: PrescriptionRule
): 'pass' | 'fail' | 'skip' {
  if (session.sets.length === 0) return 'skip';

  // A top-set session's minimum load is its back-off work; gating on the minimum
  // would skip every real top-set session. The rule's own anchor is the top set.
  if (rule.type === 'top_set_backoff') {
    const top = heaviestSet(session.sets);
    if (top == null) return 'skip';
    if (loadInForce != null && grams(top.systemLoadKg) < grams(loadInForce)) return 'skip';
    return top.reps >= target.reps ? 'pass' : 'fail';
  }

  const lowest = minLoad(session.sets);
  if (lowest == null) return 'skip';
  if (loadInForce != null && grams(lowest) < grams(loadInForce)) return 'skip';

  return session.sets.length >= target.sets && minReps(session.sets) >= target.reps
    ? 'pass'
    : 'fail';
}

// A proposal that changes the shape of the prescription (fewer sets, a moved rep
// range) is a program edit, not a load edit; the replay records it and carries only
// the load forward, because rewriting the rule mid-replay would silently change what
// every later step was evaluated against.
function adopt<R extends PrescriptionRule>(
  prescription: PrescriptionContext<R>,
  proposal: ProposedPrescription | null
): PrescriptionContext<R> {
  if (proposal == null) return prescription;
  // When the proposal names a top set, that is the load in force; taking the
  // minimum across the sets would adopt the back-off load instead.
  const anchorSets = proposal.sets.some(set => set.setType === 'top')
    ? proposal.sets.filter(set => set.setType === 'top')
    : proposal.sets;
  const loads = anchorSets.map(set => set.targetLoadKg).filter(isPresent);
  if (loads.length === 0) return prescription;
  const lowest = loads.reduce((best, load) => (grams(load) < grams(best) ? load : best));
  return { ...prescription, currentTargetLoadKg: lowest };
}

function summarise(
  policyId: string,
  policyVersion: number,
  history: ComparableHistory,
  steps: readonly ReplayStep[]
): ReplayReport {
  const actionCounts = Object.fromEntries(PROGRESSION_ACTIONS.map(action => [action, 0])) as Record<
    ProgressionAction,
    number
  >;
  const confidenceOutcomes = Object.fromEntries(
    CONFIDENCE_LEVELS.map(level => [level, { met: 0, notMet: 0, unobserved: 0 }])
  ) as Record<Confidence, { met: number; notMet: number; unobserved: number }>;

  let falseRaises = 0;
  let reductionsAfterSingleBadSession = 0;

  for (const step of steps) {
    const { action, confidence } = step.recommendation;
    actionCounts[action] += 1;

    if (action === 'increase_load' && step.nextSessionOutcome === 'not_met') falseRaises += 1;
    if (
      (action === 'reduce_load' || action === 'reduce_sets') &&
      step.failingSessionsEndingHere <= 1
    ) {
      reductionsAfterSingleBadSession += 1;
    }

    const bucket = confidenceOutcomes[confidence];
    if (step.nextSessionOutcome === 'met')
      confidenceOutcomes[confidence] = { ...bucket, met: bucket.met + 1 };
    else if (step.nextSessionOutcome === 'not_met')
      confidenceOutcomes[confidence] = { ...bucket, notMet: bucket.notMet + 1 };
    else confidenceOutcomes[confidence] = { ...bucket, unobserved: bucket.unobserved + 1 };
  }

  const insufficientDataCount = actionCounts.insufficient_data;

  return {
    policyId,
    policyVersion,
    signature: history.signature,
    sessionCount: history.sessions.length,
    recommendationCount: steps.length,
    insufficientDataCount,
    insufficientDataShare: steps.length === 0 ? 0 : insufficientDataCount / steps.length,
    actionCounts,
    falseRaises,
    reductionsAfterSingleBadSession,
    confidenceOutcomes,
    steps,
  };
}

export function formatReplayReport(report: ReplayReport): string {
  const actions = PROGRESSION_ACTIONS.filter(action => report.actionCounts[action] > 0)
    .map(action => `${action}=${report.actionCounts[action]}`)
    .join(' ');
  const confidence = CONFIDENCE_LEVELS.map(level => {
    const outcome = report.confidenceOutcomes[level];
    return `${level}(met=${outcome.met} notMet=${outcome.notMet} unobserved=${outcome.unobserved})`;
  }).join(' ');

  return [
    `policy=${report.policyId} v${report.policyVersion}`,
    `signature=${report.signature}`,
    `sessions=${report.sessionCount} recommendations=${report.recommendationCount}`,
    `insufficient_data=${report.insufficientDataCount} (${(report.insufficientDataShare * 100).toFixed(1)}%)`,
    `actions: ${actions}`,
    `falseRaises=${report.falseRaises} reductionsAfterSingleBadSession=${report.reductionsAfterSingleBadSession}`,
    `confidence vs next session: ${confidence}`,
  ].join('\n  ');
}
