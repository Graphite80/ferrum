import { type Skeleton, type Vec2, type View, GROUND_Y, RIG, along, direction } from './rig.ts';

// Roles carry meaning, not colour: the renderer decides how a "far" limb or a loaded
// implement is painted, and a screenshot test can assert on structure instead of pixels.
export type ShapeRole =
  'ground' | 'apparatus' | 'apparatus-accent' | 'body-far' | 'body' | 'implement' | 'trace';

export interface LineShape {
  readonly kind: 'line';
  readonly role: ShapeRole;
  readonly a: Vec2;
  readonly b: Vec2;
  readonly width: number;
}

export interface CircleShape {
  readonly kind: 'circle';
  readonly role: ShapeRole;
  readonly center: Vec2;
  readonly radius: number;
  readonly filled: boolean;
  readonly width?: number;
}

export interface RectShape {
  readonly kind: 'rect';
  readonly role: ShapeRole;
  readonly origin: Vec2;
  readonly size: Vec2;
  readonly radius: number;
  readonly filled: boolean;
}

export interface PolylineShape {
  readonly kind: 'polyline';
  readonly role: ShapeRole;
  readonly points: readonly Vec2[];
  readonly width: number;
  readonly dashed: boolean;
}

export type Shape = LineShape | CircleShape | RectShape | PolylineShape;

const line = (role: ShapeRole, a: Vec2, b: Vec2, width: number): LineShape => ({
  kind: 'line',
  role,
  a,
  b,
  width,
});

const rect = (role: ShapeRole, origin: Vec2, size: Vec2, radius = 2, filled = true): RectShape => ({
  kind: 'rect',
  role,
  origin,
  size,
  radius,
  filled,
});

const circle = (
  role: ShapeRole,
  center: Vec2,
  radius: number,
  filled = true,
  width?: number
): CircleShape =>
  width === undefined
    ? { kind: 'circle', role, center, radius, filled }
    : { kind: 'circle', role, center, radius, filled, width };

export const shape = { line, rect, circle };

const BODY_WIDTH = { torso: 15, upperArm: 9, foreArm: 8, thigh: 12, shin: 10, foot: 6 } as const;

export function groundShapes(): readonly Shape[] {
  return [line('ground', [6, GROUND_Y], [194, GROUND_Y], 2)];
}

export function figureShapes(skeleton: Skeleton, view: View): readonly Shape[] {
  const far = limbShapes(skeleton, 1, 'body-far');
  const near = limbShapes(skeleton, 0, 'body');
  const trunk: readonly Shape[] = [
    line('body', skeleton.hip, skeleton.chest, BODY_WIDTH.torso),
    line('body', skeleton.chest, skeleton.headCenter, 7),
    circle('body', skeleton.headCenter, RIG.headRadius, true),
  ];
  // Front view has no near side: both limbs sit in the same plane and drawing one of
  // them dimmed would read as an injury rather than as depth.
  const farRole: ShapeRole = view === 'front' ? 'body' : 'body-far';
  return [...far.map(item => ({ ...item, role: farRole })), ...trunk, ...near];
}

function limbShapes(skeleton: Skeleton, side: 0 | 1, role: ShapeRole): readonly Shape[] {
  const arm = skeleton.arms[side];
  const leg = skeleton.legs[side];
  return [
    line(role, leg.root, leg.joint, BODY_WIDTH.thigh),
    line(role, leg.joint, leg.end, BODY_WIDTH.shin),
    line(role, leg.end, skeleton.toes[side], BODY_WIDTH.foot),
    line(role, arm.root, arm.joint, BODY_WIDTH.upperArm),
    line(role, arm.joint, arm.end, BODY_WIDTH.foreArm),
  ];
}

export type ApparatusKind =
  | 'none'
  | 'flat_bench'
  | 'incline_bench'
  | 'decline_bench'
  | 'seat'
  | 'preacher_pad'
  | 'overhead_bar'
  | 'dip_bars'
  | 'cable_high'
  | 'cable_low'
  | 'machine_frame'
  | 'leg_press_sled'
  | 'rack'
  | 'lying_pad';

export const CABLE_ANCHOR: Record<'cable_high' | 'cable_low', Vec2> = {
  cable_high: [176, 44],
  cable_low: [176, 168],
};

export function apparatusShapes(kind: ApparatusKind): readonly Shape[] {
  switch (kind) {
    case 'none':
      return [];
    case 'flat_bench':
      return [
        rect('apparatus', [46, 128], [104, 9]),
        line('apparatus', [58, 137], [58, GROUND_Y], 5),
        line('apparatus', [138, 137], [138, GROUND_Y], 5),
      ];
    case 'incline_bench':
      return [
        {
          kind: 'polyline',
          role: 'apparatus',
          points: [
            [52, 152],
            [140, 108],
          ],
          width: 9,
          dashed: false,
        },
        rect('apparatus', [44, 148], [26, 8]),
        line('apparatus', [60, 156], [60, GROUND_Y], 5),
        line('apparatus', [132, 118], [132, GROUND_Y], 5),
      ];
    case 'decline_bench':
      return [
        {
          kind: 'polyline',
          role: 'apparatus',
          points: [
            [54, 112],
            [146, 146],
          ],
          width: 9,
          dashed: false,
        },
        line('apparatus', [66, 118], [66, GROUND_Y], 5),
        line('apparatus', [136, 146], [136, GROUND_Y], 5),
      ];
    case 'seat':
      return [
        rect('apparatus', [72, 132], [58, 9]),
        {
          kind: 'polyline',
          role: 'apparatus',
          points: [
            [128, 132],
            [136, 78],
          ],
          width: 9,
          dashed: false,
        },
        line('apparatus', [86, 141], [86, GROUND_Y], 5),
        line('apparatus', [124, 141], [124, GROUND_Y], 5),
      ];
    case 'preacher_pad':
      return [
        rect('apparatus', [70, 130], [46, 9]),
        {
          kind: 'polyline',
          role: 'apparatus',
          points: [
            [112, 122],
            [146, 96],
          ],
          width: 10,
          dashed: false,
        },
        line('apparatus', [84, 139], [84, GROUND_Y], 5),
        line('apparatus', [126, 118], [126, GROUND_Y], 5),
      ];
    case 'overhead_bar':
      return [
        line('apparatus', [40, 30], [160, 30], 5),
        line('apparatus', [46, 30], [46, GROUND_Y], 4),
        line('apparatus', [154, 30], [154, GROUND_Y], 4),
      ];
    case 'dip_bars':
      return [
        line('apparatus', [60, 106], [150, 106], 5),
        line('apparatus', [70, 106], [70, GROUND_Y], 4),
        line('apparatus', [142, 106], [142, GROUND_Y], 4),
      ];
    case 'cable_high':
      return [
        line('apparatus', [176, 26], [176, GROUND_Y], 5),
        circle('apparatus-accent', CABLE_ANCHOR.cable_high, 6, false, 3),
        rect('apparatus', [166, 96], [20, 60], 2, false),
      ];
    case 'cable_low':
      return [
        line('apparatus', [176, 26], [176, GROUND_Y], 5),
        circle('apparatus-accent', CABLE_ANCHOR.cable_low, 6, false, 3),
        rect('apparatus', [166, 60], [20, 60], 2, false),
      ];
    case 'machine_frame':
      return [
        line('apparatus', [168, 40], [168, GROUND_Y], 5),
        rect('apparatus', [158, 78], [20, 74], 2, false),
        line('apparatus-accent', [158, 96], [178, 96], 3),
        line('apparatus-accent', [158, 106], [178, 106], 3),
        line('apparatus-accent', [158, 116], [178, 116], 3),
      ];
    case 'leg_press_sled':
      return [
        {
          kind: 'polyline',
          role: 'apparatus',
          points: [
            [150, 172],
            [40, 84],
          ],
          width: 4,
          dashed: false,
        },
        rect('apparatus', [112, 160], [76, 9]),
        line('apparatus', [126, 169], [126, GROUND_Y], 5),
        line('apparatus', [180, 169], [180, GROUND_Y], 5),
      ];
    case 'rack':
      return [
        line('apparatus', [44, 62], [44, GROUND_Y], 5),
        line('apparatus', [156, 62], [156, GROUND_Y], 5),
        line('apparatus', [44, 66], [58, 66], 4),
        line('apparatus', [142, 66], [156, 66], 4),
      ];
    case 'lying_pad':
      return [
        rect('apparatus', [40, 140], [120, 9]),
        line('apparatus', [52, 149], [52, GROUND_Y], 5),
        line('apparatus', [148, 149], [148, GROUND_Y], 5),
      ];
  }
}

export type ImplementKind =
  | 'none'
  | 'barbell'
  | 'ez_bar'
  | 'dumbbell'
  | 'kettlebell'
  | 'handle'
  | 'rope'
  | 'lat_bar'
  | 'plate'
  | 'machine_handle'
  | 'ankle_pad'
  | 'shoulder_pad'
  | 'hip_pad'
  | 'body_bar';

export interface ImplementContext {
  readonly anchor: Vec2;
  readonly hands: readonly [Vec2, Vec2];
  readonly view: View;
  readonly cableFrom: Vec2 | null;
}

export function implementShapes(kind: ImplementKind, context: ImplementContext): readonly Shape[] {
  const { anchor, view } = context;
  const cable = context.cableFrom === null ? [] : [line('implement', context.cableFrom, anchor, 2)];

  switch (kind) {
    case 'none':
      return cable;
    case 'barbell':
    case 'ez_bar':
      return view === 'side'
        ? [
            ...cable,
            circle('implement', anchor, 13, false, 4),
            circle('implement', anchor, 4, true),
          ]
        : [
            ...cable,
            line('implement', [anchor[0] - 62, anchor[1]], [anchor[0] + 62, anchor[1]], 4),
            circle('implement', [anchor[0] - 56, anchor[1]], 11, false, 4),
            circle('implement', [anchor[0] + 56, anchor[1]], 11, false, 4),
          ];
    case 'body_bar':
      return [line('implement', [anchor[0] - 34, anchor[1]], [anchor[0] + 34, anchor[1]], 4)];
    case 'lat_bar':
      return [
        ...cable,
        line('implement', [anchor[0] - 34, anchor[1]], [anchor[0] + 34, anchor[1]], 4),
        line('implement', [anchor[0] - 34, anchor[1]], [anchor[0] - 40, anchor[1] + 10], 4),
        line('implement', [anchor[0] + 34, anchor[1]], [anchor[0] + 40, anchor[1] + 10], 4),
      ];
    case 'dumbbell':
      return context.hands.flatMap((hand, index) =>
        index === 1 && view === 'side' ? [] : dumbbellAt(hand, view)
      );
    case 'kettlebell':
      return context.hands.flatMap((hand, index) =>
        index === 1 && view === 'side'
          ? []
          : [
              circle('implement', [hand[0], hand[1] + 13], 9, true),
              circle('implement', [hand[0], hand[1] + 2], 6, false, 3),
            ]
      );
    case 'handle':
      return [
        ...cable,
        ...gripPoints(context).map(point =>
          rect('implement', [point[0] - 3, point[1] - 7], [6, 14], 3)
        ),
      ];
    case 'rope':
      return [
        ...cable,
        line('implement', anchor, [anchor[0] - 12, anchor[1] + 16], 3),
        line('implement', anchor, [anchor[0] + 12, anchor[1] + 16], 3),
      ];
    case 'plate':
      return [circle('implement', anchor, 12, false, 4)];
    // A machine's linkage only exists on the screen in a side view; drawn in a front
    // view it becomes a bar through the lifter's chest.
    case 'machine_handle':
      return [
        ...gripPoints(context).map(point =>
          rect('implement', [point[0] - 4, point[1] - 9], [8, 18], 4)
        ),
        ...(view === 'side' ? [line('implement', anchor, [168, anchor[1]], 3)] : []),
      ];
    case 'ankle_pad':
      return [
        circle('implement', anchor, 8, true),
        ...(view === 'side' ? [line('implement', anchor, [168, anchor[1]], 3)] : []),
      ];
    case 'shoulder_pad':
      return [rect('implement', [anchor[0] - 16, anchor[1] - 6], [32, 12], 6)];
    case 'hip_pad':
      return view === 'side'
        ? [circle('implement', anchor, 13, false, 4), circle('implement', anchor, 4, true)]
        : [line('implement', [anchor[0] - 40, anchor[1]], [anchor[0] + 40, anchor[1]], 5)];
  }
}

// A front view shows two independent grips; a side view shows one, because the far hand
// sits exactly behind the near one.
function gripPoints(context: ImplementContext): readonly Vec2[] {
  return context.view === 'front' ? [context.hands[0], context.hands[1]] : [context.anchor];
}

function dumbbellAt(hand: Vec2, view: View): readonly Shape[] {
  const axis = view === 'side' ? direction(90) : direction(90);
  const top = along(hand, axis, 11);
  const bottom = along(hand, axis, -11);
  return [
    line('implement', top, bottom, 3),
    line('implement', along(top, direction(0), -7), along(top, direction(0), 7), 7),
    line('implement', along(bottom, direction(0), -7), along(bottom, direction(0), 7), 7),
  ];
}

export function traceShape(points: readonly Vec2[]): PolylineShape {
  return { kind: 'polyline', role: 'trace', points, width: 2, dashed: true };
}
