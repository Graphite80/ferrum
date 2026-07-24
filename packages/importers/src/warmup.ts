import type { SetType } from '@ferrum/domain';

export interface WarmupCandidate {
  readonly orderIndex: number;
  readonly load: number | null;
  readonly reps: number | null;
}

export interface WarmupPolicy {
  readonly minimumSetsInGroup: number;
  readonly maximumWarmupFraction: number;
  readonly decisiveLoadRatio: number;
  readonly supportedLoadRatio: number;
  readonly supportingRepRatio: number;
}

// Tuned to be wrong in one direction only. A missed warmup costs the user a slightly
// pessimistic working-set average; a falsely demoted working set silently deletes a
// real data point from every progression decision downstream. Every threshold here is
// therefore set where a human would still call the verdict obvious.
export const DEFAULT_WARMUP_POLICY: WarmupPolicy = {
  minimumSetsInGroup: 3,
  maximumWarmupFraction: 0.5,
  decisiveLoadRatio: 0.7,
  supportedLoadRatio: 0.85,
  supportingRepRatio: 1.25,
};

export interface SetTypeDecision {
  readonly setType: SetType;
  readonly reclassified: boolean;
  readonly reason: string | null;
}

const WORKING: SetTypeDecision = { setType: 'working', reclassified: false, reason: null };

// Sources that do not carry a warmup flag (life-as-code, Strong exports A/B/D/E) mark
// every set "normal", including the 30 kg x 20 opener before a 65 kg x 12 top set.
// Importing those as working sets poisons every volume and e1RM figure derived from
// them, so they have to be classified — but only from evidence that exists inside the
// same exercise on the same day. No exercise-name table, no cross-session baseline, no
// absolute kilogram thresholds: those would encode the author's gym rather than the
// user's, and would silently misfire for a beginner, for a unit-converted export, or
// for a machine whose "50" is a stack marking.
//
// The evidence used is exactly what a coach reads off the sheet: a set is a warmup if
// it comes before the heavy work, is far lighter than the heaviest set of that exercise
// that day, and is not itself the last word on the exercise. A moderate load gap counts
// only when it is paired with markedly higher reps, which is the other half of the
// warmup signature. Everything else stays a working set.
export function classifySetType(
  candidate: WarmupCandidate,
  group: readonly WarmupCandidate[],
  policy: WarmupPolicy = DEFAULT_WARMUP_POLICY
): SetTypeDecision {
  const ordered = [...group].sort((a, b) => a.orderIndex - b.orderIndex);
  if (ordered.length < policy.minimumSetsInGroup) return WORKING;

  const position = ordered.findIndex(set => set.orderIndex === candidate.orderIndex);
  if (position < 0) return WORKING;

  const maximumWarmups = Math.floor(ordered.length * policy.maximumWarmupFraction);
  if (position >= maximumWarmups || position === ordered.length - 1) return WORKING;

  const heaviest = heaviestSet(ordered);
  if (heaviest == null || heaviest.load == null || heaviest.load <= 0) return WORKING;

  // A warmup is a leading run. The first set that looks like work ends it, so a light
  // back-off set after the top set is never mistaken for a warmup.
  for (let index = 0; index <= position; index += 1) {
    const set = ordered[index];
    if (set === undefined) return WORKING;
    const verdict = qualifies(set, heaviest.load, heaviest.reps, policy);
    if (verdict == null) return WORKING;
    if (index === position) {
      return { setType: 'warmup', reclassified: true, reason: verdict };
    }
  }

  return WORKING;
}

export function classifyGroupSetTypes(
  group: readonly WarmupCandidate[],
  policy: WarmupPolicy = DEFAULT_WARMUP_POLICY
): ReadonlyMap<number, SetTypeDecision> {
  return new Map(group.map(set => [set.orderIndex, classifySetType(set, group, policy)]));
}

function qualifies(
  set: WarmupCandidate,
  topLoad: number,
  topReps: number | null,
  policy: WarmupPolicy
): string | null {
  if (set.load == null || set.reps == null || set.reps <= 0) return null;

  const loadRatio = set.load / topLoad;
  if (loadRatio >= 1) return null;

  const loadShare = `${Math.round(loadRatio * 100)}% of the session top load for this exercise`;

  if (loadRatio <= policy.decisiveLoadRatio) {
    return `leading set at ${loadShare} (${set.load} vs ${topLoad})`;
  }

  if (
    topReps != null &&
    topReps > 0 &&
    loadRatio <= policy.supportedLoadRatio &&
    set.reps / topReps >= policy.supportingRepRatio
  ) {
    return `leading set at ${loadShare} (${set.load} vs ${topLoad}) with ${set.reps} reps against ${topReps} on the top set`;
  }

  return null;
}

function heaviestSet(ordered: readonly WarmupCandidate[]): WarmupCandidate | null {
  let best: WarmupCandidate | null = null;
  for (const set of ordered) {
    if (set.load == null) continue;
    if (best?.load == null || set.load > best.load) best = set;
  }
  return best;
}
