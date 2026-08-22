import type { BalustradeSpec, ChamberDressing, RoomShell, SalchangSpec, ShelfRunSpec } from "./chamber";

/** Two points and a wear level, which is what most routes are. */
export function route(
  id: string,
  points: { x: number; z: number }[],
  wear = 1,
  actor: "past" | "present" = "present",
  glows = false,
): ChamberDressing["routes"][number] {
  return { id, points, wear, actor, glows };
}

/** Shelving stops here; salchang and plaster carry the wall above it. */
export const SHELF_HEIGHT = 2.72;

/** How wide a standard-row window is, and so how far apart two of them must be. */
const WINDOW_WIDTH = 2.6;

export interface StandardDressingOptions {
  /** Extra structure this room has beyond the shell. */
  blocks?: ChamberDressing["blocks"];
  /** Rooms that leave through their own wall rather than down a corridor. */
  corridor?: boolean;
  /** Runs this room adds to the standard pair, such as an alcove lining. */
  extraShelves?: ShelfRunSpec[];
  /** Offsets every seed, so two chambers of the same shape are not the same room. */
  seedBase: number;
  sealColour?: ChamberDressing["sealColour"];
  openBox?: ChamberDressing["openBox"];
  sign?: ChamberDressing["sign"];
  /** Where the windows sit along each long wall. */
  windows?: number[];
  /**
   * How tall the window band is. Defaults to everything between the shelving
   * and the ceiling, which is right for a one-storey hall and wrong for 04:
   * a seven-metre room got a near-four-metre window that read as venetian
   * blinds. A tall room wants a band and a second storey, not a taller band.
   */
  salchangHeight?: number;
  /** Windows this room adds to the standard row, such as a gallery band. */
  extraSalchang?: SalchangSpec[];
  /** Open railings, for a room with a gallery to fall off. */
  balustrades?: BalustradeSpec[];
  /** The one-shot sync beat. Only 04 has somewhere to look down from. */
  warmBand?: ChamberDressing["warmBand"];
  /** Sets behind the west windows. Only the ending corridor has them. */
  dioramas?: boolean;
  /** Windows looking into another room. 04's gallery looks at 01. */
  views?: ChamberDressing["views"];
  /** Paper with holes in it. Only 07. */
  tornPaper?: boolean;
  /**
   * The pair of full-length runs down the long walls. On by default, because
   * every room is a stack room — except the ending corridor, which is a gallery:
   * its west wall is windows all the way down and shelving there would board up
   * the only thing in it worth looking at.
   */
  longShelves?: boolean;
  /** Worn floor inlay, for rooms whose route is not a straight line to the far wall. */
  routes?: ChamberDressing["routes"];
  /** Lean applied to both long runs. Only 07 uses it. */
  tiltRadians?: number;
  /** Fraction of cases missing from both long runs. Only 07 uses it. */
  decay?: number;
}

/**
 * The dressing every hall-and-corridor chamber shares: cases down both long
 * walls, a row of windows above them, and a shallow run following you out.
 *
 * A chamber that wants a different building says so by not calling this. What it
 * must not do is re-describe the same building slightly differently, which is
 * how three windows ended up hardcoded in three separate functions.
 */
export function standardDressing(shell: RoomShell, options: StandardDressingOptions): ChamberDressing {
  const windows = options.windows ?? [2.6, 6, 9.4];
  // Two openings closer together than one is wide are not two windows, they are
  // one hole with two sets of slats and two frames intersecting inside it. It
  // shipped that way in 07 and was only found by photographing the wall, so it
  // is an authoring error now rather than something to notice later.
  for (let index = 1; index < windows.length; index += 1) {
    const gap = (windows[index] ?? 0) - (windows[index - 1] ?? 0);
    if (gap < WINDOW_WIDTH) {
      throw new Error(
        `windows ${windows[index - 1]} and ${windows[index]} are ${gap.toFixed(2)} m apart `
        + `on a ${WINDOW_WIDTH} m opening — they would overlap`,
      );
    }
  }
  const seed = options.seedBase;

  const corridor = options.corridor ?? true;
  const longShelves = options.longShelves ?? true;
  const shelves: ShelfRunSpec[] = [
    ...(longShelves ? [{
      id: "west",
      x: -shell.halfWidth,
      facing: 1,
      fromZ: 0.55,
      toZ: shell.depth - 0.55,
      height: SHELF_HEIGHT,
      seed: seed + 4211,
      ...(options.tiltRadians === undefined ? {} : { tiltRadians: options.tiltRadians }),
      ...(options.decay === undefined ? {} : { decay: options.decay }),
    },
    {
      id: "east",
      x: shell.halfWidth,
      facing: -1,
      fromZ: 0.55,
      toZ: shell.depth - 0.55,
      height: SHELF_HEIGHT,
      seed: seed + 8123,
      ...(options.tiltRadians === undefined ? {} : { tiltRadians: -options.tiltRadians }),
      ...(options.decay === undefined ? {} : { decay: options.decay }),
    }] satisfies ShelfRunSpec[] : []),
    ...(corridor
      ? [{
        id: "corridor",
        x: -shell.corridorHalfWidth,
        facing: 1 as const,
        fromZ: shell.depth + 0.6,
        toZ: shell.corridorEnd - 1.4,
        height: 1.94,
        seed: seed + 5309,
        depth: 0.3,
      }]
      : []),
    ...(options.extraShelves ?? []),
  ];

  const salchang: SalchangSpec[] = [
    ...windows.flatMap((centreZ): SalchangSpec[] =>
      ([-1, 1] as const).map((side) => ({
        id: `${side < 0 ? "west" : "east"}-${centreZ}`,
        x: side * shell.halfWidth,
        facing: (side < 0 ? 1 : -1) as 1 | -1,
        centreZ,
        width: WINDOW_WIDTH,
        sillY: SHELF_HEIGHT + 0.24,
        height: options.salchangHeight ?? shell.height - SHELF_HEIGHT - 0.52,
        seed: seed + 100 + centreZ,
        // West is the sun side.
        castsBands: side < 0,
      })),
    ),
    ...(corridor
      ? [{
        id: "corridor",
        x: shell.corridorHalfWidth,
        facing: -1 as const,
        centreZ: (shell.depth + shell.corridorEnd) / 2,
        width: 2.2,
        sillY: 1.62,
        height: 0.86,
        seed: seed + 611,
        castsBands: false,
      }]
      : []),
    ...(options.extraSalchang ?? []),
  ];

  return {
    shelves,
    salchang,
    blocks: options.blocks ?? [],
    corridor,
    sealColour: options.sealColour ?? "red",
    openBox: options.openBox ?? null,
    sign: options.sign ?? null,
    balustrades: options.balustrades ?? [],
    warmBand: options.warmBand ?? null,
    dioramas: options.dioramas ?? false,
    views: options.views ?? [],
    tornPaper: options.tornPaper ?? false,
    routes: options.routes ?? [],
  };
}
