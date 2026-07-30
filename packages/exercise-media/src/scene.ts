import { type AnchorKind, type AnimationSpec } from './animations.ts';
import {
  type NormalizedPose,
  type Skeleton,
  type Vec2,
  CANVAS,
  buildSkeleton,
  lerpPose,
  mix,
  normalizePose,
} from './rig.ts';
import {
  type Shape,
  CABLE_ANCHOR,
  apparatusShapes,
  figureShapes,
  groundShapes,
  implementShapes,
  traceShape,
} from './shapes.ts';

export interface Scene {
  readonly viewBox: string;
  readonly shapes: readonly Shape[];
  readonly cue: string;
  readonly durationMs: number;
}

const TRACE_SAMPLES = 24;

// A rep is not a linear ramp: it slows at both ends. Easing the interpolation is what
// separates "two poses crossfading" from something that reads as a lift.
export function ease(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5 ? 2 * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 2) / 2;
}

// One full cycle is concentric then eccentric, so the figure returns to where it started
// and the loop has no visible seam.
export function cyclePosition(elapsedMs: number, durationMs: number): number {
  const phase = (elapsedMs % durationMs) / durationMs;
  return ease(phase < 0.5 ? phase * 2 : 2 - phase * 2);
}

function poseFor(spec: AnimationSpec, t: number): NormalizedPose {
  const start = normalizePose(spec.start, spec.view);
  const finish = normalizePose(spec.finish, spec.view);
  return lerpPose(start, finish, t);
}

export function anchorPoint(skeleton: Skeleton, anchor: AnchorKind): Vec2 {
  switch (anchor) {
    case 'hands':
      return mix(skeleton.arms[0].end, skeleton.arms[1].end, 0.5);
    case 'near-hand':
      return skeleton.arms[0].end;
    case 'hips':
      return skeleton.hip;
    case 'ankles':
      return mix(skeleton.legs[0].end, skeleton.legs[1].end, 0.5);
    case 'near-ankle':
      return skeleton.legs[0].end;
    case 'knees':
      return mix(skeleton.legs[0].joint, skeleton.legs[1].joint, 0.5);
    case 'toes':
      return mix(skeleton.toes[0], skeleton.toes[1], 0.5);
    case 'chest':
      return skeleton.chest;
    case 'upper-back':
      return mix(skeleton.chest, skeleton.headCenter, 0.35);
    case 'head':
      return skeleton.headCenter;
  }
}

function cableSource(spec: AnimationSpec): Vec2 | null {
  if (spec.apparatus.includes('cable_high')) return CABLE_ANCHOR.cable_high;
  if (spec.apparatus.includes('cable_low')) return CABLE_ANCHOR.cable_low;
  return null;
}

export function tracePoints(spec: AnimationSpec): readonly Vec2[] {
  const points: Vec2[] = [];
  for (let index = 0; index <= TRACE_SAMPLES; index += 1) {
    const skeleton = buildSkeleton(poseFor(spec, index / TRACE_SAMPLES), spec.view);
    points.push(anchorPoint(skeleton, spec.trace ?? spec.anchor));
  }
  return points;
}

export interface SceneOptions {
  readonly showTrace?: boolean;
  // A list thumbnail is 40 pixels wide. Bench uprights and a weight stack at that size are
  // three grey specks, so the small variant drops the gym and frames the lifter tightly.
  readonly bare?: boolean;
  readonly crop?: boolean;
}

export function sceneAt(spec: AnimationSpec, t: number, options: SceneOptions = {}): Scene {
  const skeleton = buildSkeleton(poseFor(spec, t), spec.view);
  const anchor = anchorPoint(skeleton, spec.anchor);
  const bare = options.bare === true;

  const shapes = [
    ...(bare ? [] : groundShapes()),
    ...(bare ? [] : spec.apparatus.flatMap(apparatusShapes)),
    ...figureShapes(skeleton, spec.view),
    ...(options.showTrace === true ? [traceShape(tracePoints(spec))] : []),
    ...implementShapes(spec.implement === 'auto' ? 'none' : spec.implement, {
      anchor,
      hands: [skeleton.arms[0].end, skeleton.arms[1].end],
      view: spec.view,
      cableFrom: bare ? null : cableSource(spec),
    }),
  ];

  return {
    viewBox: options.crop === true ? cropBox(spec) : `0 0 ${CANVAS.width} ${CANVAS.height}`,
    cue: spec.cue,
    durationMs: spec.durationMs,
    shapes,
  };
}

// The crop is taken over the whole rep, not the current frame: a box that tracked the
// figure would make a thumbnail zoom in and out while it loops.
function cropBox(spec: AnimationSpec): string {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let index = 0; index <= TRACE_SAMPLES; index += 1) {
    const skeleton = buildSkeleton(poseFor(spec, index / TRACE_SAMPLES), spec.view);
    const points: readonly Vec2[] = [
      skeleton.hip,
      skeleton.chest,
      skeleton.headCenter,
      ...skeleton.arms.flatMap(limb => [limb.joint, limb.end]),
      ...skeleton.legs.flatMap(limb => [limb.joint, limb.end]),
      ...skeleton.toes,
    ];
    for (const [x, y] of points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  const margin = 10;
  const size = Math.max(maxX - minX, maxY - minY) + margin * 2;
  const originX = (minX + maxX) / 2 - size / 2;
  const originY = (minY + maxY) / 2 - size / 2;
  return `${round(originX)} ${round(originY)} ${round(size)} ${round(size)}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
