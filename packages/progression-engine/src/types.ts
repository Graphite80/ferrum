import {
  type ComparisonSignature,
  type EquipmentInstance,
  type IndeterminateReason,
  type Kilograms,
  type LocalDate,
  type PrescriptionRule,
  type ProgressionRuleId,
  type SetType,
  type WorkoutSet,
} from '@ferrum/domain';

export const PROGRESSION_ACTIONS = [
  'increase_load',
  'increase_reps',
  'hold',
  'repeat',
  'reduce_load',
  'reduce_sets',
  'increase_rest',
  'change_rep_target',
  'review_exercise',
  'insufficient_data',
] as const;

// `hold` and `repeat` are not synonyms. `hold` keeps the prescription because the
// session was completed and nothing yet justifies a change. `repeat` keeps it
// because the session was NOT completed and the same work is still owed.
export type ProgressionAction = (typeof PROGRESSION_ACTIONS)[number];

// An ordinal, not a probability. Nothing here estimates a calibrated likelihood, so
// a number like "0.73" would claim a precision the inputs cannot support and would
// invite averaging, thresholding and other arithmetic the scale does not license.
// Three levels are what the evidence genuinely distinguishes: whether effort was
// recorded at all, and how many comparable sessions corroborate the decision.
export type Confidence = 'low' | 'medium' | 'high';

export const CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const satisfies readonly Confidence[];

export type ReasonCode =
  | 'no_comparable_sets'
  | 'no_prior_comparable_history'
  | 'single_session_evidence'
  | 'all_sets_at_top_of_range'
  | 'reps_within_range'
  | 'reps_above_range'
  | 'reps_below_range'
  | 'set_count_below_prescription'
  | 'effort_unknown'
  | 'effort_inside_target_band'
  | 'effort_easier_than_target'
  | 'effort_harder_than_target'
  | 'increment_unknown'
  | 'equipment_maximum_reached'
  | 'cannot_reduce_further'
  | 'repeated_failure'
  | 'substantial_performance_drop'
  | 'pain_reported'
  | 'mixed_loads_within_session'
  | 'load_off_equipment_grid'
  | 'rest_shorter_than_prescribed'
  | 'rest_not_recorded'
  | 'readiness_low'
  | 'top_set_reps_met'
  | 'top_set_reps_missed'
  | 'top_set_effort_above_target'
  | 'backoff_from_performed_top_set';

export type EffortEvidence =
  | { readonly kind: 'rir_entered'; readonly rir: number }
  // The 1-10 scale the entry UI offers is RIR-anchored: RPE 8 means two reps in
  // reserve. That is the only mapping the stored number can support.
  | { readonly kind: 'rpe_entered'; readonly rir: number; readonly rpe: number }
  | { readonly kind: 'unknown' };

export type ExclusionReason =
  | 'signature_mismatch'
  | 'not_completed'
  | 'warmup_or_technique'
  | 'pain_flagged'
  | 'no_reps_recorded'
  | 'no_load_recorded'
  | 'bodyweight_not_evidence'
  | 'indeterminate_load'
  | 'not_load_bearing'
  | 'zero_resolved_load';

export interface ExcludedSet {
  readonly set: WorkoutSet;
  readonly reason: ExclusionReason;
  readonly detail: string;
}

export interface ComparableSet {
  readonly set: WorkoutSet;
  readonly localDate: LocalDate;
  readonly systemLoadKg: Kilograms;
  readonly calibrated: boolean;
  readonly reps: number;
  readonly effort: EffortEvidence;
  readonly restSeconds: number | null;
}

export interface ComparableSession {
  readonly localDate: LocalDate;
  readonly sets: readonly ComparableSet[];
  readonly exclusions: readonly ExcludedSet[];
}

export interface ComparableHistory {
  readonly signature: ComparisonSignature;
  readonly sessions: readonly ComparableSession[];
  readonly exclusions: readonly ExcludedSet[];
  readonly indeterminateReasons: readonly IndeterminateReason[];
}

export interface EvidenceTrail {
  readonly signature: ComparisonSignature;
  readonly sessionDatesUsed: readonly LocalDate[];
  readonly includedSets: readonly ComparableSet[];
  readonly excludedSets: readonly ExcludedSet[];
}

export interface ProposedSet {
  readonly setType: SetType;
  readonly targetLoadKg: Kilograms | null;
  readonly targetRepMin: number | null;
  readonly targetRepMax: number | null;
  readonly targetRir: readonly [number, number] | null;
  readonly targetRpe: number | null;
}

export interface ProposedPrescription {
  readonly ruleId: ProgressionRuleId;
  readonly ruleVersion: number;
  readonly sets: readonly ProposedSet[];
  readonly restSecondsBetweenSets: number | null;
}

export interface Recommendation {
  readonly action: ProgressionAction;
  readonly proposedPrescription: ProposedPrescription | null;
  readonly reasonCodes: readonly ReasonCode[];
  readonly explanation: string;
  readonly evidence: EvidenceTrail;
  readonly confidence: Confidence;
  readonly warnings: readonly string[];
  readonly policyId: string;
  readonly policyVersion: number;
}

export interface PrescriptionContext<R extends PrescriptionRule = PrescriptionRule> {
  readonly ruleId: ProgressionRuleId;
  readonly ruleVersion: number;
  readonly rule: R;
  readonly signature: ComparisonSignature;
  readonly currentTargetLoadKg: Kilograms | null;
  readonly prescribedRestSeconds: number | null;
}

export interface EquipmentConstraints {
  readonly instance: EquipmentInstance | null;
  readonly definitionDefaultIncrementKg: Kilograms | null;
}

export type Readiness = 'low' | 'normal' | 'high';

export interface OptionalSignals {
  readonly readiness?: Readiness;
  readonly painReportedElsewhere?: boolean;
  readonly sessionNote?: string;
}

export interface ProgressionPolicy<R extends PrescriptionRule = PrescriptionRule> {
  readonly policyId: string;
  readonly policyVersion: number;
  readonly ruleType: R['type'];
  evaluate(
    prescription: PrescriptionContext<R>,
    comparableHistory: ComparableHistory,
    currentPerformance: ComparableSession | null,
    equipmentConstraints: EquipmentConstraints,
    optionalSignals?: OptionalSignals
  ): Recommendation;
}
