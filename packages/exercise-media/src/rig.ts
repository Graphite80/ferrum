export type Vec2 = readonly [number, number];

export type View = 'side' | 'front';

// One stick rig, authored in a fixed 200x200 box, drawn at whatever size the caller
// wants. Segment lengths are the usual anthropometric fractions of standing height,
// so a pose authored for one exercise reads correctly in every other.
export const RIG = {
  torso: 46,
  neck: 9,
  headRadius: 10,
  upperArm: 28,
  foreArm: 26,
  thigh: 38,
  shin: 36,
  foot: 13,
} as const;

export const CANVAS = { width: 200, height: 200 } as const;
export const GROUND_Y = 188;

// A side view has no lateral axis on screen, so the far limb is offset by a couple of
// units purely as a depth cue. A front view spreads the same joints to real shoulder
// and hip width.
const SPREAD: Record<View, { readonly shoulder: number; readonly hip: number }> = {
  side: { shoulder: 3.5, hip: 2.5 },
  front: { shoulder: 13, hip: 8 },
};

export interface LimbAngles {
  readonly angles: readonly [number, number];
}

// A limb is authored either by where its end effector goes (the usual case: the hand
// holds a bar at a known height) or by joint angles (a hanging arm, a planted leg).
// Both normalize to a target point before anything else happens, so interpolation
// always moves hands and feet along straight lines instead of swinging joint angles
// through positions the lifter never occupies.
export type LimbSpec = Vec2 | LimbAngles;

export interface PoseSpec {
  readonly hip: Vec2;
  readonly torso: number;
  readonly head?: number;
  readonly hand?: LimbSpec | readonly [LimbSpec, LimbSpec];
  readonly foot?: LimbSpec | readonly [LimbSpec, LimbSpec];
  readonly elbow?: number | readonly [number, number];
  readonly knee?: number | readonly [number, number];
  readonly toe?: number | readonly [number, number];
}

export interface NormalizedPose {
  readonly hip: Vec2;
  readonly torso: number;
  readonly head: number;
  readonly hands: readonly [Vec2, Vec2];
  readonly feet: readonly [Vec2, Vec2];
  readonly elbow: readonly [number, number];
  readonly knee: readonly [number, number];
  readonly toe: readonly [number, number];
}

export interface Limb {
  readonly root: Vec2;
  readonly joint: Vec2;
  readonly end: Vec2;
}

export interface Skeleton {
  readonly hip: Vec2;
  readonly chest: Vec2;
  readonly headCenter: Vec2;
  readonly shoulders: readonly [Vec2, Vec2];
  readonly hips: readonly [Vec2, Vec2];
  readonly arms: readonly [Limb, Limb];
  readonly legs: readonly [Limb, Limb];
  readonly toes: readonly [Vec2, Vec2];
}

export function direction(degrees: number): Vec2 {
  const radians = (degrees * Math.PI) / 180;
  return [Math.cos(radians), -Math.sin(radians)];
}

export function along(from: Vec2, unit: Vec2, distance: number): Vec2 {
  return [from[0] + unit[0] * distance, from[1] + unit[1] * distance];
}

export function subtract(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]];
}

export function length(v: Vec2): number {
  return Math.hypot(v[0], v[1]);
}

export function mix(a: Vec2, b: Vec2, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function mirrorAbout(x: number, point: Vec2): Vec2 {
  return [2 * x - point[0], point[1]];
}

function pair<T>(value: T | readonly [T, T]): readonly [T, T] {
  return Array.isArray(value) ? (value as unknown as readonly [T, T]) : [value as T, value as T];
}

function isAngles(spec: LimbSpec): spec is LimbAngles {
  return !Array.isArray(spec);
}

function isLimbPair(
  value: LimbSpec | readonly [LimbSpec, LimbSpec]
): value is readonly [LimbSpec, LimbSpec] {
  return Array.isArray(value) && typeof value[0] !== 'number';
}

function limbPair(value: LimbSpec | readonly [LimbSpec, LimbSpec]): readonly [LimbSpec, LimbSpec] {
  return isLimbPair(value) ? value : [value, value];
}

function endEffector(root: Vec2, spec: LimbSpec, upper: number, lower: number): Vec2 {
  if (!isAngles(spec)) {
    return spec;
  }
  const [first, second] = spec.angles;
  const joint = along(root, direction(first), upper);
  return along(joint, direction(second), lower);
}

// Two-bone inverse kinematics. `bend` picks which side the joint falls on, because both
// solutions reach the same target and only one of them is a knee that bends forwards.
export function solveTwoBone(root: Vec2, target: Vec2, upper: number, lower: number, bend: number) {
  const delta = subtract(target, root);
  const raw = length(delta);
  const unit: Vec2 = raw < 1e-6 ? [0, 1] : [delta[0] / raw, delta[1] / raw];
  const reach = Math.min(raw, upper + lower - 1e-3);
  const end = along(root, unit, reach);
  const normal: Vec2 = [-unit[1] * Math.sign(bend || 1), unit[0] * Math.sign(bend || 1)];
  const projection = (upper * upper - lower * lower + reach * reach) / (2 * Math.max(reach, 1e-6));
  const offset = Math.sqrt(Math.max(0, upper * upper - projection * projection));
  const joint = along(along(root, unit, projection), normal, offset);
  return { root, joint, end } satisfies Limb;
}

function chestOf(pose: { hip: Vec2; torso: number }): Vec2 {
  return along(pose.hip, direction(pose.torso), RIG.torso);
}

function spreadPoints(center: Vec2, axis: number, distance: number): readonly [Vec2, Vec2] {
  const unit = direction(axis + 90);
  return [along(center, unit, distance), along(center, unit, -distance)];
}

export function normalizePose(spec: PoseSpec, view: View): NormalizedPose {
  const chest = chestOf(spec);
  const shoulders = spreadPoints(chest, spec.torso, SPREAD[view].shoulder);
  const hips = spreadPoints(spec.hip, spec.torso, SPREAD[view].hip);

  const handSpec = spec.hand ?? { angles: [spec.torso - 180, spec.torso - 180] };
  const footSpec = spec.foot ?? { angles: [-90, -90] };
  const [nearHand, farHand] = limbPair(handSpec);
  const [nearFoot, farFoot] = limbPair(footSpec);

  const mirror = view === 'front' && !isLimbPair(handSpec);
  const mirrorFeet = view === 'front' && !isLimbPair(footSpec);

  const resolvedHands: readonly [Vec2, Vec2] = [
    endEffector(shoulders[0], nearHand, RIG.upperArm, RIG.foreArm),
    endEffector(shoulders[1], farHand, RIG.upperArm, RIG.foreArm),
  ];
  const resolvedFeet: readonly [Vec2, Vec2] = [
    endEffector(hips[0], nearFoot, RIG.thigh, RIG.shin),
    endEffector(hips[1], farFoot, RIG.thigh, RIG.shin),
  ];

  return {
    hip: spec.hip,
    torso: spec.torso,
    head: spec.head ?? spec.torso,
    hands: mirror ? [resolvedHands[0], mirrorAbout(spec.hip[0], resolvedHands[1])] : resolvedHands,
    feet: mirrorFeet ? [resolvedFeet[0], mirrorAbout(spec.hip[0], resolvedFeet[1])] : resolvedFeet,
    elbow: pair(spec.elbow ?? -1),
    knee: pair(spec.knee ?? 1),
    toe: pair(spec.toe ?? 0),
  };
}

// Discrete fields (which way a joint bends) come from the start pose: interpolating them
// would flip an elbow inside out halfway through the rep.
export function lerpPose(a: NormalizedPose, b: NormalizedPose, t: number): NormalizedPose {
  return {
    hip: mix(a.hip, b.hip, t),
    torso: a.torso + (b.torso - a.torso) * t,
    head: a.head + (b.head - a.head) * t,
    hands: [mix(a.hands[0], b.hands[0], t), mix(a.hands[1], b.hands[1], t)],
    feet: [mix(a.feet[0], b.feet[0], t), mix(a.feet[1], b.feet[1], t)],
    elbow: a.elbow,
    knee: a.knee,
    toe: [a.toe[0] + (b.toe[0] - a.toe[0]) * t, a.toe[1] + (b.toe[1] - a.toe[1]) * t],
  };
}

export function buildSkeleton(pose: NormalizedPose, view: View): Skeleton {
  const chest = chestOf(pose);
  const shoulders = spreadPoints(chest, pose.torso, SPREAD[view].shoulder);
  const hips = spreadPoints(pose.hip, pose.torso, SPREAD[view].hip);
  const headCenter = along(chest, direction(pose.head), RIG.neck + RIG.headRadius);

  const arms: readonly [Limb, Limb] = [
    solveTwoBone(shoulders[0], pose.hands[0], RIG.upperArm, RIG.foreArm, pose.elbow[0]),
    solveTwoBone(shoulders[1], pose.hands[1], RIG.upperArm, RIG.foreArm, pose.elbow[1]),
  ];
  const legs: readonly [Limb, Limb] = [
    solveTwoBone(hips[0], pose.feet[0], RIG.thigh, RIG.shin, pose.knee[0]),
    solveTwoBone(hips[1], pose.feet[1], RIG.thigh, RIG.shin, pose.knee[1]),
  ];

  return {
    hip: pose.hip,
    chest,
    headCenter,
    shoulders,
    hips,
    arms,
    legs,
    toes: [
      along(legs[0].end, direction(pose.toe[0]), RIG.foot),
      along(legs[1].end, direction(pose.toe[1]), RIG.foot),
    ],
  };
}
