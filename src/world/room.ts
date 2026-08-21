import type { RoomDefinition } from "../sim/types";
import { corridorExit, doorwayBrush, hallBrushes } from "./shell";
import type { Chamber, ChamberDressing, RoomShell } from "./chamber";


const PLATE_CENTRE_Z = 7.6;
const SPAWN_Z = 1.6;

/**
 * Six tenths of a second between standing on the plate and the door moving.
 *
 * Long enough that a player looks back at what they just did, and that glance
 * lands on the first tape anyone records. The ending replays that tape and the
 * same idle movement reads as someone saying goodbye.
 */
export const DOOR_OPEN_DELAY_TICKS = 18;

/**
 * The hall, in metres: 12 wide, 4 high, with a 6.6 m corridor past the door.
 * These numbers are the single source for both the brushes the player collides
 * with and the surfaces the renderer dresses.
 */
export const ROOM_SHELL: RoomShell = {
  halfWidth: 6,
  depth: 12,
  height: 4,
  corridorHalfWidth: 2,
  corridorEnd: 18.6,
  corridorHeight: 3,
  doorwayHalfWidth: 1.5,
  doorwayHeight: 2.6,
  wallThickness: 0.6,
  plateCentreZ: PLATE_CENTRE_Z,
  plateRadius: 1.05,
  spawnZ: SPAWN_Z,
};

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
  brushes: hallBrushes(ROOM_SHELL),
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
      brush: doorwayBrush("inner-door", ROOM_SHELL),
      gatedBy: { kind: "plate", id: "entry-plate" },
      latchOnOpen: true,
      openDelayTicks: DOOR_OPEN_DELAY_TICKS,
    },
  ],
  holds: [],
  exit: corridorExit(ROOM_SHELL),
};


/** Shelving stops here; salchang and plaster carry the wall above it. */
const SHELF_HEIGHT = 2.72;
const SALCHANG_SILL = SHELF_HEIGHT + 0.24;
const SALCHANG_HEIGHT = ROOM_SHELL.height - SHELF_HEIGHT - 0.52;
/** Where the three windows sit along each long wall. */
const WINDOW_ROW = [2.6, 6, 9.4];

const AWAKENING_DRESSING: ChamberDressing = {
  blocks: [],
  corridor: true,
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
  sign: null,
  balustrades: [],
  warmBand: null,
};

export const AWAKENING_CHAMBER: Chamber = {
  sim: AWAKENING,
  shell: ROOM_SHELL,
  number: "00",
  subtitleOnEntry: "기억 보관소에 오신 것을 환영합니다. 이 방에서의 모든 행동은 기록됩니다.",
  dressing: AWAKENING_DRESSING,
};
