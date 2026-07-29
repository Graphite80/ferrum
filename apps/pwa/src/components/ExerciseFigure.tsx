import { useEffect, useMemo, useState } from 'react';
import { type ExerciseDefinition } from '@ferrum/domain';
import {
  type Shape,
  type ShapeRole,
  cyclePosition,
  resolveAnimation,
  sceneAt,
} from '@ferrum/exercise-media';
import { usePrefersReducedMotion } from './reduced-motion.ts';

const ROLE_STROKE: Record<ShapeRole, string> = {
  ground: 'stroke-seam',
  apparatus: 'stroke-frame',
  'apparatus-accent': 'stroke-frame-lit',
  'body-far': 'stroke-limb-far',
  body: 'stroke-chalk',
  implement: 'stroke-plate-red',
  trace: 'stroke-ash',
};

const ROLE_FILL: Record<ShapeRole, string> = {
  ground: 'fill-seam',
  apparatus: 'fill-frame',
  'apparatus-accent': 'fill-frame-lit',
  'body-far': 'fill-limb-far',
  body: 'fill-chalk',
  implement: 'fill-plate-red',
  trace: 'fill-ash',
};

export interface ExerciseFigureProps {
  readonly definition: ExerciseDefinition;
  readonly size: number;
  readonly animated?: boolean;
  readonly showTrace?: boolean;
  // A fixed position in the rep, 0 = stretched and 1 = contracted. Supplying it turns the
  // figure into a scrubbable still and overrides the animation.
  readonly phase?: number;
  readonly title?: string;
  readonly variant?: 'full' | 'thumbnail';
}

export function ExerciseFigure(props: ExerciseFigureProps) {
  const spec = useMemo(() => resolveAnimation(props.definition), [props.definition]);
  const reducedMotion = usePrefersReducedMotion();
  const [clockPhase, setClockPhase] = useState(1);

  const scrubbed = props.phase;
  const playing = props.animated === true && !reducedMotion && scrubbed === undefined;

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      setClockPhase(cyclePosition(now - started, spec.durationMs));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [playing, spec]);

  const thumbnail = props.variant === 'thumbnail';
  const scene = sceneAt(spec, scrubbed ?? (playing ? clockPhase : 1), {
    showTrace: props.showTrace === true,
    bare: thumbnail,
    crop: thumbnail,
  });

  return (
    <svg
      viewBox={scene.viewBox}
      width={props.size}
      height={props.size}
      role="img"
      aria-label={props.title ?? `${props.definition.name} technique diagram`}
      data-testid="exercise-figure"
    >
      {scene.shapes.map((shape, index) => renderShape(shape, index))}
    </svg>
  );
}

function renderShape(shape: Shape, index: number) {
  const stroke = ROLE_STROKE[shape.role];
  const common = { strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

  switch (shape.kind) {
    case 'line':
      return (
        <line
          key={index}
          x1={shape.a[0]}
          y1={shape.a[1]}
          x2={shape.b[0]}
          y2={shape.b[1]}
          strokeWidth={shape.width}
          className={`${stroke} fill-none`}
          {...common}
        />
      );
    case 'circle':
      return (
        <circle
          key={index}
          cx={shape.center[0]}
          cy={shape.center[1]}
          r={shape.radius}
          strokeWidth={shape.width ?? 3}
          className={`${stroke} ${shape.filled ? ROLE_FILL[shape.role] : 'fill-none'}`}
          {...common}
        />
      );
    case 'rect':
      return (
        <rect
          key={index}
          x={shape.origin[0]}
          y={shape.origin[1]}
          width={shape.size[0]}
          height={shape.size[1]}
          rx={shape.radius}
          strokeWidth={3}
          className={`${stroke} ${shape.filled ? ROLE_FILL[shape.role] : 'fill-none'}`}
          {...common}
        />
      );
    case 'polyline':
      return (
        <polyline
          key={index}
          points={shape.points.map(point => `${point[0]},${point[1]}`).join(' ')}
          strokeWidth={shape.width}
          strokeDasharray={shape.dashed ? '4 5' : undefined}
          className={`${stroke} fill-none`}
          {...common}
        />
      );
  }
}
