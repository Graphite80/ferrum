import { type ExerciseDefinition, type MuscleRole } from '@ferrum/domain';
import { type BodySide, buildBodyMap } from '@ferrum/exercise-media';

const ROLE_FILL: Record<MuscleRole, string> = {
  primary: 'fill-plate-red',
  secondary: 'fill-plate-amber',
  stabilizer: 'fill-frame-lit',
};

const ROLE_OPACITY: Record<MuscleRole, number> = {
  primary: 1,
  secondary: 0.85,
  stabilizer: 0.7,
};

export interface MuscleMapProps {
  readonly definition: ExerciseDefinition;
  readonly side: BodySide;
  readonly height: number;
}

export function MuscleMap(props: MuscleMapProps) {
  const map = buildBodyMap(props.definition.muscleRoles, props.side);

  return (
    <svg
      viewBox={map.viewBox}
      height={props.height}
      role="img"
      aria-label={`${props.definition.name}, muscles worked, ${props.side} view`}
      data-testid={`muscle-map-${props.side}`}
    >
      <circle
        cx={map.head.center[0]}
        cy={map.head.center[1]}
        r={map.head.radius}
        className="fill-seam"
      />
      {map.silhouette.map((part, index) => (
        <polygon key={`body-${String(index)}`} points={points(part)} className="fill-seam" />
      ))}
      {map.muscles.map((muscle, index) => (
        <polygon
          key={`${muscle.muscleId}-${String(index)}`}
          points={points(muscle.polygon)}
          className={ROLE_FILL[muscle.role]}
          fillOpacity={ROLE_OPACITY[muscle.role]}
        />
      ))}
    </svg>
  );
}

function points(polygon: readonly (readonly [number, number])[]): string {
  return polygon.map(point => `${point[0]},${point[1]}`).join(' ');
}
