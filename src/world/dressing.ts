import type { ChamberDressing, RoomShell, SalchangSpec, ShelfRunSpec } from "./chamber";

/** Shelving stops here; salchang and plaster carry the wall above it. */
export const SHELF_HEIGHT = 2.72;

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
  /** Lean applied to both long runs. Only 07 uses it. */
  tiltRadians?: number;
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
  const seed = options.seedBase;

  const corridor = options.corridor ?? true;
  const shelves: ShelfRunSpec[] = [
    {
      id: "west",
      x: -shell.halfWidth,
      facing: 1,
      fromZ: 0.55,
      toZ: shell.depth - 0.55,
      height: SHELF_HEIGHT,
      seed: seed + 4211,
      ...(options.tiltRadians === undefined ? {} : { tiltRadians: options.tiltRadians }),
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
    },
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
        width: 2.6,
        sillY: SHELF_HEIGHT + 0.24,
        height: shell.height - SHELF_HEIGHT - 0.52,
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
  ];

  return {
    shelves,
    salchang,
    blocks: options.blocks ?? [],
    corridor,
    sealColour: options.sealColour ?? "red",
    openBox: options.openBox ?? null,
    sign: options.sign ?? null,
  };
}
