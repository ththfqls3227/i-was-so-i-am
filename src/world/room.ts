import type { Brush, RoomDefinition, Vec3 } from "../sim/types";
import type { Chamber, ChamberDressing, RoomShell } from "./chamber";

const WALL = 0.6;

/** Room shell, in metres. 12 wide, 4 high, with a 6.6 m corridor past the door. */
const ROOM_HALF_WIDTH = 6;
const ROOM_DEPTH = 12;
const ROOM_HEIGHT = 4;
const CORRIDOR_HALF_WIDTH = 2;
const CORRIDOR_END = 18.6;
const CORRIDOR_HEIGHT = 3;
const DOORWAY_HALF_WIDTH = 1.5;
const DOORWAY_HEIGHT = 2.6;

function box(id: string, min: Vec3, max: Vec3): Brush {
  return { id, min, max };
}

const brushes: Brush[] = [
  box("floor-room", { x: -ROOM_HALF_WIDTH - WALL, y: -WALL, z: -WALL }, { x: ROOM_HALF_WIDTH + WALL, y: 0, z: ROOM_DEPTH + WALL }),
  box("floor-corridor", { x: -CORRIDOR_HALF_WIDTH - WALL, y: -WALL, z: ROOM_DEPTH }, { x: CORRIDOR_HALF_WIDTH + WALL, y: 0, z: CORRIDOR_END + WALL }),
  box("ceiling-room", { x: -ROOM_HALF_WIDTH - WALL, y: ROOM_HEIGHT, z: -WALL }, { x: ROOM_HALF_WIDTH + WALL, y: ROOM_HEIGHT + WALL, z: ROOM_DEPTH + WALL }),
  box("ceiling-corridor", { x: -CORRIDOR_HALF_WIDTH - WALL, y: CORRIDOR_HEIGHT, z: ROOM_DEPTH }, { x: CORRIDOR_HALF_WIDTH + WALL, y: CORRIDOR_HEIGHT + WALL, z: CORRIDOR_END + WALL }),

  box("wall-west", { x: -ROOM_HALF_WIDTH - WALL, y: 0, z: -WALL }, { x: -ROOM_HALF_WIDTH, y: ROOM_HEIGHT, z: ROOM_DEPTH + WALL }),
  box("wall-east", { x: ROOM_HALF_WIDTH, y: 0, z: -WALL }, { x: ROOM_HALF_WIDTH + WALL, y: ROOM_HEIGHT, z: ROOM_DEPTH + WALL }),
  box("wall-back", { x: -ROOM_HALF_WIDTH - WALL, y: 0, z: -WALL }, { x: ROOM_HALF_WIDTH + WALL, y: ROOM_HEIGHT, z: 0 }),

  // Far wall, split around the doorway.
  box("wall-far-left", { x: -ROOM_HALF_WIDTH - WALL, y: 0, z: ROOM_DEPTH }, { x: -DOORWAY_HALF_WIDTH, y: ROOM_HEIGHT, z: ROOM_DEPTH + WALL }),
  box("wall-far-right", { x: DOORWAY_HALF_WIDTH, y: 0, z: ROOM_DEPTH }, { x: ROOM_HALF_WIDTH + WALL, y: ROOM_HEIGHT, z: ROOM_DEPTH + WALL }),
  box("wall-far-lintel", { x: -DOORWAY_HALF_WIDTH, y: DOORWAY_HEIGHT, z: ROOM_DEPTH }, { x: DOORWAY_HALF_WIDTH, y: ROOM_HEIGHT, z: ROOM_DEPTH + WALL }),

  box("corridor-west", { x: -CORRIDOR_HALF_WIDTH - WALL, y: 0, z: ROOM_DEPTH }, { x: -CORRIDOR_HALF_WIDTH, y: CORRIDOR_HEIGHT, z: CORRIDOR_END + WALL }),
  box("corridor-east", { x: CORRIDOR_HALF_WIDTH, y: 0, z: ROOM_DEPTH }, { x: CORRIDOR_HALF_WIDTH + WALL, y: CORRIDOR_HEIGHT, z: CORRIDOR_END + WALL }),
  box("corridor-end", { x: -CORRIDOR_HALF_WIDTH - WALL, y: 0, z: CORRIDOR_END }, { x: CORRIDOR_HALF_WIDTH + WALL, y: CORRIDOR_HEIGHT, z: CORRIDOR_END + WALL }),
];

const PLATE_CENTRE_Z = 7.6;
const SPAWN_Z = 1.6;

/**
 * 00 — Awakening. Walk to the plate, the door opens and stays open, walk out.
 * No cooperation is required: the living player can press the plate themselves,
 * so the first room can only teach the loop, never fail you for misreading it.
 */
export const AWAKENING: RoomDefinition = {
  id: "awakening",
  version: 1,
  name: "깨어남",
  subtitle: "Awakening",
  // Fifteen seconds of recording, twenty of replay. Ten was enough to walk the
  // route and not enough for a player who stops to look at the room, and having
  // the tape end on its own is a confusing way to meet the second pass.
  // Folding early does not shorten it: the span is the room's, not the tape's.
  tapeDurationTicks: 450,
  replayGraceTicks: 150,
  spawn: { x: 0, y: 0, z: SPAWN_Z, yawUnits: 0 },
  brushes,
  plates: [
    {
      id: "entry-plate",
      centre: { x: 0, z: PLATE_CENTRE_Z },
      half: { x: 0.95, z: 0.95 },
      reach: 0.35,
    },
  ],
  doors: [
    {
      id: "inner-door",
      brush: box(
        "inner-door",
        { x: -DOORWAY_HALF_WIDTH, y: 0, z: ROOM_DEPTH + 0.05 },
        { x: DOORWAY_HALF_WIDTH, y: DOORWAY_HEIGHT, z: ROOM_DEPTH + WALL - 0.05 },
      ),
      gatedBy: { kind: "plate", id: "entry-plate" },
      latchOnOpen: true,
    },
  ],
  holds: [],
  exit: {
    id: "exit",
    min: { x: -CORRIDOR_HALF_WIDTH, y: 0, z: 17.2 },
    max: { x: CORRIDOR_HALF_WIDTH, y: CORRIDOR_HEIGHT, z: CORRIDOR_END },
  },
};

/** Numbers the renderer needs to dress the same geometry the simulation collides with. */
export const ROOM_SHELL: RoomShell = {
  halfWidth: ROOM_HALF_WIDTH,
  depth: ROOM_DEPTH,
  height: ROOM_HEIGHT,
  corridorHalfWidth: CORRIDOR_HALF_WIDTH,
  corridorEnd: CORRIDOR_END,
  corridorHeight: CORRIDOR_HEIGHT,
  doorwayHalfWidth: DOORWAY_HALF_WIDTH,
  doorwayHeight: DOORWAY_HEIGHT,
  wallThickness: WALL,
  plateCentreZ: PLATE_CENTRE_Z,
  plateRadius: 1.05,
  spawnZ: SPAWN_Z,
};

/** Shelving stops here; salchang and plaster carry the wall above it. */
const SHELF_HEIGHT = 2.72;
const SALCHANG_SILL = SHELF_HEIGHT + 0.24;
const SALCHANG_HEIGHT = ROOM_SHELL.height - SHELF_HEIGHT - 0.52;
/** Where the three windows sit along each long wall. */
const WINDOW_ROW = [2.6, 6, 9.4];

const AWAKENING_DRESSING: ChamberDressing = {
  shelves: [
    { id: "west", x: -ROOM_SHELL.halfWidth, facing: 1, fromZ: 0.55, toZ: ROOM_SHELL.depth - 0.55, height: SHELF_HEIGHT, seed: 4211 },
    { id: "east", x: ROOM_SHELL.halfWidth, facing: -1, fromZ: 0.55, toZ: ROOM_SHELL.depth - 0.55, height: SHELF_HEIGHT, seed: 8123 },
    {
      id: "corridor",
      x: -ROOM_SHELL.corridorHalfWidth,
      facing: 1,
      fromZ: ROOM_SHELL.depth + 0.6,
      toZ: ROOM_SHELL.corridorEnd - 1.4,
      height: 1.94,
      seed: 5309,
      depth: 0.3,
    },
  ],
  salchang: [
    ...WINDOW_ROW.flatMap((centreZ): ChamberDressing["salchang"] =>
      ([-1, 1] as const).map((side) => ({
        id: `${side < 0 ? "west" : "east"}-${centreZ}`,
        x: side * ROOM_SHELL.halfWidth,
        facing: (side < 0 ? 1 : -1) as 1 | -1,
        centreZ,
        width: 2.6,
        sillY: SALCHANG_SILL,
        height: SALCHANG_HEIGHT,
        seed: 100 + centreZ,
        // West is the sun side.
        castsBands: side < 0,
      })),
    ),
    {
      id: "corridor",
      x: ROOM_SHELL.corridorHalfWidth,
      facing: -1,
      centreZ: 14.4,
      width: 2.2,
      sillY: 1.62,
      height: 0.86,
      seed: 611,
      castsBands: false,
    },
  ],
  sealColour: "red",
  openBox: null,
};

export const AWAKENING_CHAMBER: Chamber = {
  sim: AWAKENING,
  shell: ROOM_SHELL,
  number: "00",
  dressing: AWAKENING_DRESSING,
};
