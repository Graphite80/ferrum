import { describe, expect, it } from 'vitest';
import { type Vec2 } from '@ferrum/exercise-media';
import {
  CANVAS,
  buildBodyMap,
  buildSkeleton,
  cyclePosition,
  mappedMuscleIds,
  normalizePose,
  resolveAnimation,
  sceneAt,
  tracePoints,
} from '@ferrum/exercise-media';
import { loadExerciseLibrary } from '@ferrum/exercise-library';

const library = loadExerciseLibrary();
const exercises = library.all;

function skeletonPoints(definitionIndex: number, t: number): readonly Vec2[] {
  const definition = exercises[definitionIndex]!;
  const spec = resolveAnimation(definition);
  const start = normalizePose(spec.start, spec.view);
  const finish = normalizePose(spec.finish, spec.view);
  const pose = t === 0 ? start : t === 1 ? finish : start;
  const skeleton = buildSkeleton(pose, spec.view);
  return [
    skeleton.hip,
    skeleton.chest,
    skeleton.headCenter,
    ...skeleton.arms.flatMap(limb => [limb.joint, limb.end]),
    ...skeleton.legs.flatMap(limb => [limb.joint, limb.end]),
    ...skeleton.toes,
  ];
}

describe('exercise media', () => {
  it('renders every exercise in the library', () => {
    for (const definition of exercises) {
      const spec = resolveAnimation(definition);
      expect(spec.implement, definition.id).not.toBe('auto');
      expect(spec.cue.length, definition.id).toBeGreaterThan(16);

      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const scene = sceneAt(spec, t, { showTrace: true });
        expect(scene.shapes.length, definition.id).toBeGreaterThan(8);
        for (const value of coordinates(scene.shapes)) {
          expect(Number.isFinite(value), `${definition.id} at ${String(t)}`).toBe(true);
        }
      }
    }
  });

  // A figure drawn outside its own box is a pose authored against nothing; the renderer
  // would silently clip it at whatever size the caller picked.
  it('keeps every joint inside the canvas', () => {
    for (const [index, definition] of exercises.entries()) {
      for (const t of [0, 1]) {
        for (const [x, y] of skeletonPoints(index, t)) {
          expect(x, `${definition.id} x`).toBeGreaterThan(-4);
          expect(x, `${definition.id} x`).toBeLessThan(CANVAS.width + 4);
          expect(y, `${definition.id} y`).toBeGreaterThan(-4);
          expect(y, `${definition.id} y`).toBeLessThan(CANVAS.height + 4);
        }
      }
    }
  });

  // The failure this guards is a copy-pasted override where start and finish are the same
  // pose: every assertion above still passes and the figure stands perfectly still.
  it('moves in every exercise', () => {
    for (const [index, definition] of exercises.entries()) {
      const start = skeletonPoints(index, 0);
      const finish = skeletonPoints(index, 1);
      const travel = Math.max(
        ...start.map((point, joint) => distance(point, finish[joint] ?? point))
      );
      expect(travel, definition.id).toBeGreaterThan(8);
    }
  });

  it('traces the loaded point across the range of motion', () => {
    for (const definition of exercises) {
      const points = tracePoints(resolveAnimation(definition));
      expect(points.length).toBeGreaterThan(8);
      expect(distance(points[0]!, points[points.length - 1]!), definition.id).toBeGreaterThan(2);
    }
  });

  it('is a pure function of the exercise and the phase', () => {
    for (const definition of exercises) {
      const spec = resolveAnimation(definition);
      expect(sceneAt(spec, 0.37)).toEqual(sceneAt(spec, 0.37));
    }
  });

  it('returns to the starting pose at the end of a cycle', () => {
    expect(cyclePosition(0, 2000)).toBeCloseTo(0);
    expect(cyclePosition(1000, 2000)).toBeCloseTo(1);
    expect(cyclePosition(2000, 2000)).toBeCloseTo(0);
    expect(cyclePosition(500, 2000)).toBeCloseTo(cyclePosition(1500, 2000));
  });

  it('maps every muscle the library can reference', () => {
    const mapped = new Set([...mappedMuscleIds('front'), ...mappedMuscleIds('back')]);
    for (const muscleId of library.muscles.keys()) {
      expect(mapped.has(muscleId), muscleId).toBe(true);
    }
  });

  it('highlights at least one region for every exercise', () => {
    for (const definition of exercises) {
      const front = buildBodyMap(definition.muscleRoles, 'front');
      const back = buildBodyMap(definition.muscleRoles, 'back');
      expect(front.muscles.length + back.muscles.length, definition.id).toBeGreaterThan(0);
      expect(front.silhouette.length).toBe(back.silhouette.length);
    }
  });

  it('shades every primary mover of an exercise', () => {
    for (const definition of exercises) {
      const primaries = definition.muscleRoles.filter(role => role.role === 'primary');
      const shaded = new Set(
        [
          ...buildBodyMap(definition.muscleRoles, 'front').muscles,
          ...buildBodyMap(definition.muscleRoles, 'back').muscles,
        ].map(muscle => muscle.muscleId)
      );
      for (const primary of primaries) {
        expect(shaded.has(primary.muscleId), `${definition.id}/${primary.muscleId}`).toBe(true);
      }
    }
  });
});

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function coordinates(shapes: ReturnType<typeof sceneAt>['shapes']): readonly number[] {
  return shapes.flatMap(shape => {
    switch (shape.kind) {
      case 'line':
        return [...shape.a, ...shape.b, shape.width];
      case 'circle':
        return [...shape.center, shape.radius];
      case 'rect':
        return [...shape.origin, ...shape.size];
      case 'polyline':
        return shape.points.flatMap(point => [...point]);
    }
  });
}
