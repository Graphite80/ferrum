import { type ExerciseMuscleRole, type MuscleId, type MuscleRole } from '@ferrum/domain';
import { type Vec2 } from './rig.ts';

export type BodySide = 'front' | 'back';

export const BODY_CANVAS = { width: 100, height: 210, axis: 50 } as const;

interface Region {
  readonly polygon: readonly Vec2[];
  readonly mirrored: boolean;
}

export interface MuscleShading {
  readonly muscleId: MuscleId;
  readonly polygon: readonly Vec2[];
  readonly role: MuscleRole;
}

export interface BodyMap {
  readonly side: BodySide;
  readonly viewBox: string;
  readonly head: { readonly center: Vec2; readonly radius: number };
  readonly silhouette: readonly (readonly Vec2[])[];
  readonly muscles: readonly MuscleShading[];
}

const HEAD = { center: [50, 15] as Vec2, radius: 11 };

const TORSO: readonly Vec2[] = [
  [31, 30],
  [69, 30],
  [72, 52],
  [66, 86],
  [64, 106],
  [36, 106],
  [34, 86],
  [28, 52],
];

const ARM: readonly Vec2[] = [
  [32, 32],
  [23, 40],
  [17, 66],
  [13, 100],
  [12, 116],
  [20, 117],
  [23, 100],
  [27, 66],
  [33, 46],
];

const LEG: readonly Vec2[] = [
  [35, 104],
  [49, 104],
  [49, 152],
  [47, 176],
  [46, 204],
  [35, 204],
  [33, 176],
  [31, 152],
  [32, 120],
];

function mirror(polygon: readonly Vec2[]): readonly Vec2[] {
  return polygon.map(([x, y]) => [BODY_CANVAS.axis * 2 - x, y] as Vec2);
}

const SILHOUETTE: readonly (readonly Vec2[])[] = [TORSO, ARM, mirror(ARM), LEG, mirror(LEG)];

const region = (polygon: readonly Vec2[], mirrored = true): Region => ({ polygon, mirrored });

const FRONT: Partial<Record<string, Region>> = {
  trapezius_upper: region(
    [
      [40, 27],
      [50, 25],
      [60, 27],
      [57, 37],
      [50, 34],
      [43, 37],
    ],
    false
  ),
  anterior_deltoid: region([
    [31, 33],
    [24, 40],
    [22, 53],
    [29, 51],
    [34, 41],
  ]),
  lateral_deltoid: region([
    [24, 40],
    [19, 51],
    [20, 63],
    [27, 59],
    [29, 49],
  ]),
  rotator_cuff: region([
    [28, 37],
    [34, 39],
    [33, 47],
    [27, 46],
  ]),
  pectoralis_major: region([
    [34, 39],
    [48, 42],
    [48, 63],
    [36, 63],
    [31, 51],
  ]),
  serratus_anterior: region([
    [34, 65],
    [41, 66],
    [40, 77],
    [33, 73],
  ]),
  biceps_brachii: region([
    [21, 58],
    [28, 59],
    [26, 78],
    [20, 77],
  ]),
  brachialis: region([
    [19, 76],
    [25, 77],
    [24, 86],
    [18, 85],
  ]),
  brachioradialis: region([
    [17, 85],
    [24, 86],
    [23, 97],
    [16, 96],
  ]),
  forearm_flexors: region([
    [15, 95],
    [22, 96],
    [21, 114],
    [14, 112],
  ]),
  rectus_abdominis: region(
    [
      [43, 65],
      [57, 65],
      [56, 102],
      [44, 102],
    ],
    false
  ),
  obliques: region([
    [37, 70],
    [42, 71],
    [43, 100],
    [36, 93],
  ]),
  hip_flexors: region([
    [39, 102],
    [48, 103],
    [46, 119],
    [38, 113],
  ]),
  quadriceps: region([
    [34, 112],
    [48, 112],
    [47, 152],
    [36, 152],
  ]),
  adductors: region([
    [44, 114],
    [49, 114],
    [49, 148],
    [43, 142],
  ]),
  gastrocnemius: region([
    [35, 158],
    [46, 158],
    [45, 178],
    [36, 178],
  ]),
  soleus: region([
    [36, 178],
    [45, 178],
    [44, 192],
    [37, 192],
  ]),
};

const BACK: Partial<Record<string, Region>> = {
  trapezius_upper: region(
    [
      [40, 27],
      [50, 25],
      [60, 27],
      [58, 41],
      [50, 39],
      [42, 41],
    ],
    false
  ),
  trapezius_middle: region(
    [
      [38, 43],
      [62, 43],
      [60, 59],
      [40, 59],
    ],
    false
  ),
  trapezius_lower: region(
    [
      [42, 59],
      [58, 59],
      [53, 78],
      [47, 78],
    ],
    false
  ),
  posterior_deltoid: region([
    [31, 33],
    [22, 42],
    [21, 57],
    [29, 53],
    [34, 42],
  ]),
  rotator_cuff: region([
    [28, 40],
    [35, 43],
    [34, 51],
    [28, 50],
  ]),
  teres_major: region([
    [32, 52],
    [40, 55],
    [38, 63],
    [31, 61],
  ]),
  rhomboids: region([
    [40, 44],
    [48, 44],
    [48, 60],
    [40, 59],
  ]),
  latissimus_dorsi: region([
    [31, 60],
    [44, 62],
    [43, 88],
    [35, 82],
    [29, 70],
  ]),
  erector_spinae: region(
    [
      [45, 60],
      [55, 60],
      [56, 102],
      [44, 102],
    ],
    false
  ),
  triceps_brachii: region([
    [20, 56],
    [27, 57],
    [26, 81],
    [19, 79],
  ]),
  brachioradialis: region([
    [16, 85],
    [23, 86],
    [22, 97],
    [15, 95],
  ]),
  forearm_flexors: region([
    [14, 95],
    [21, 96],
    [20, 114],
    [13, 112],
  ]),
  obliques: region([
    [33, 76],
    [38, 76],
    [39, 98],
    [33, 92],
  ]),
  gluteus_medius: region([
    [32, 99],
    [40, 101],
    [39, 111],
    [31, 109],
  ]),
  gluteus_maximus: region([
    [36, 103],
    [50, 103],
    [50, 128],
    [37, 126],
    [33, 113],
  ]),
  hamstrings: region([
    [35, 130],
    [48, 130],
    [47, 158],
    [36, 158],
  ]),
  adductors: region([
    [44, 120],
    [49, 120],
    [49, 152],
    [43, 148],
  ]),
  gastrocnemius: region([
    [35, 158],
    [46, 158],
    [45, 178],
    [36, 178],
  ]),
  soleus: region([
    [36, 178],
    [45, 178],
    [44, 192],
    [37, 192],
  ]),
};

const REGIONS: Record<BodySide, Partial<Record<string, Region>>> = { front: FRONT, back: BACK };

export function buildBodyMap(roles: readonly ExerciseMuscleRole[], side: BodySide): BodyMap {
  const muscles: MuscleShading[] = [];
  for (const entry of roles) {
    const found = REGIONS[side][entry.muscleId];
    if (found === undefined) continue;
    muscles.push({ muscleId: entry.muscleId, polygon: found.polygon, role: entry.role });
    if (found.mirrored) {
      muscles.push({ muscleId: entry.muscleId, polygon: mirror(found.polygon), role: entry.role });
    }
  }

  return {
    side,
    viewBox: `0 0 ${BODY_CANVAS.width} ${BODY_CANVAS.height}`,
    head: HEAD,
    silhouette: SILHOUETTE,
    muscles,
  };
}

export function mappedMuscleIds(side: BodySide): readonly string[] {
  return Object.keys(REGIONS[side]);
}
