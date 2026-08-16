import { type ExerciseDefinition, type ExerciseMuscleRole, type MuscleRole } from '@ferrum/domain';
import { type BodySide } from '@ferrum/exercise-media';
import { BACK_PATHS, FRONT_PATHS } from './muscle-paths.ts';

// Path indices in design/front.svg — verified against bounding boxes (viewBox 0 0 51 124).
const FRONT_MUSCLE: Partial<Record<string, readonly number[]>> = {
  // Neck/clavicle area: 24(x:22-29,y:14-27), 50(y:17-21), 51(y:17-21)
  trapezius_upper:    [24, 50, 51],
  // Chest: central x:13-38, y:21-48 — excludes outer-shoulder paths 18,20
  pectoralis_major:   [0, 1, 34, 35, 38, 39, 40, 42, 44, 45, 53, 55, 58],
  // Shoulder: outer paths only — 0,1 are chest, not shoulder
  anterior_deltoid:   [18, 20, 52, 54],
  lateral_deltoid:    [18, 20, 52, 54],
  rotator_cuff:       [18, 20],
  // Biceps: outer-arm paths only — 48,49,56,57 are pectoral zone (x:16-35, y:40-47), excluded
  biceps_brachii:     [8, 9, 27, 28],
  brachialis:         [8, 9],
  brachioradialis:    [14, 16, 22, 23],
  forearm_flexors:    [14, 16, 22, 23, 27, 28],
  // Serratus: side under arm y:46-62 — 12(x:28-36), 13(x:15-23), 46,47
  serratus_anterior:  [12, 13, 46, 47],
  obliques:           [4, 5, 19, 21, 25, 26],
  rectus_abdominis:   [2, 36, 37, 40, 42],
  hip_flexors:        [32, 33, 36, 37],
  adductors:          [32, 33],
  // Upper-thigh quads: 4,5,19,21,25,26 outer (y:56-82); 32,33 inner; 15,17,36,37 lower thigh/knee
  quadriceps:         [4, 5, 15, 17, 19, 21, 25, 26, 32, 33, 36, 37],
  // Lower-leg paths y:87-111 are shin/front of calf from front; gastrocnemius is posterior, shown in back view only
  gastrocnemius:      [],
  soleus:             [],
};

// Path indices in design/back.svg — verified against bounding boxes (viewBox 0 0 51 123).
const BACK_MUSCLE: Partial<Record<string, readonly number[]>> = {
  // Upper trap/neck: 6,7(x:25-35/15-25,y:12-37), 42,43(tiny y:16-21)
  trapezius_upper:    [6, 7, 42, 43],
  // Mid trap: 5(x:19-31,y:37-56), 14,15(x:29-38/12-21,y:21-31), 44,45(tiny)
  trapezius_middle:   [5, 14, 15, 44, 45],
  trapezius_lower:    [1, 2, 5],
  rhomboids:          [5, 14, 15],
  // Posterior delt: outer shoulder 12(x:37-45), 13(x:4-13), 22(x:34-43), 24(x:7-16), 60,61
  posterior_deltoid:  [12, 13, 22, 24, 60, 61],
  // Lats: sides 1,2(y:51-66), 3,4(y:29-48), 26,27(y:56-82)
  latissimus_dorsi:   [1, 2, 3, 4, 26, 27],
  teres_major:        [3, 4, 14, 15],
  erector_spinae:     [23, 25, 28, 29],
  rotator_cuff:       [12, 13],
  serratus_anterior:  [26, 27],
  // Triceps: back of arm — outer 12,13,20,21,30,31,60,61 + inner 34-39,46,47
  triceps_brachii:    [12, 13, 20, 21, 30, 31, 34, 35, 36, 37, 38, 39, 46, 47, 60, 61],
  brachioradialis:    [32, 33, 48, 49],
  forearm_flexors:    [32, 33, 48, 49],
  // Glutes: 8,9(x:31-37/13-19,y:65-88), 40,41(y:82-86)
  gluteus_maximus:    [8, 9, 40, 41],
  gluteus_medius:     [8, 9],
  // Hamstrings: back of thigh 8,9 + 18,19(y:87-103) + 28,29(inner y:70-90)
  hamstrings:         [8, 9, 18, 19, 28, 29],
  gastrocnemius:      [10, 11, 16, 17, 18, 19],
  soleus:             [10, 11, 16, 17],
  adductors:          [28, 29],
};

const ROLE_COLOR: Record<MuscleRole, string> = {
  primary:    '#FF1C00',
  secondary:  '#FF7300',
  stabilizer: '#993300',
};

const DIM = '#8A8A89';

type MuscleMapProps = {
  readonly side: BodySide;
  readonly height: number;
  readonly ariaLabel?: string;
} & (
  | { readonly definition: ExerciseDefinition; readonly muscleRoles?: never }
  | { readonly muscleRoles: readonly ExerciseMuscleRole[]; readonly definition?: never }
);

export type { MuscleMapProps };

export function MuscleMap(props: MuscleMapProps) {
  const roles = props.muscleRoles ?? props.definition.muscleRoles;
  const label = props.ariaLabel ?? (
    props.definition != null
      ? `${props.definition.name}, muscles worked, ${props.side} view`
      : `Muscles worked, ${props.side} view`
  );

  const isFront = props.side === 'front';
  const paths = isFront ? FRONT_PATHS : BACK_PATHS;
  const muscleMap = isFront ? FRONT_MUSCLE : BACK_MUSCLE;
  const viewBox = isFront ? '0 0 51 124' : '0 0 51 123';

  // Build pathIndex → fill color (primary wins over secondary over stabilizer).
  const fillMap = new Map<number, string>();
  for (const { muscleId, role } of roles) {
    const indices = muscleMap[muscleId as string];
    if (indices == null) continue;
    const color = ROLE_COLOR[role];
    for (const idx of indices) {
      const existing = fillMap.get(idx);
      if (
        existing == null ||
        (existing === ROLE_COLOR.stabilizer && role !== 'stabilizer') ||
        (existing === ROLE_COLOR.secondary && role === 'primary')
      ) {
        fillMap.set(idx, color);
      }
    }
  }

  return (
    <svg
      viewBox={viewBox}
      height={props.height}
      role="img"
      aria-label={label}
      data-testid={`muscle-map-${props.side}`}
    >
      {paths.map((d, i) => (
        <path key={i} d={d} fill={fillMap.get(i) ?? DIM} />
      ))}
    </svg>
  );
}
