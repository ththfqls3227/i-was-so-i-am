import type { RoomDefinition } from "../sim/types";
import { corridorExit, doorwayBrush, hallBrushes } from "./shell";
import type { Chamber, ChamberDressing, RoomShell } from "./chamber";


const PLATE_CENTRE_Z = 7.6;
const SPAWN_Z = 1.6;

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
 * 00 — Awakening. Stand on the plate, record it, and walk out past the man
 * holding it down.
 *
 * It used to be leavable alone: the door latched, so pressing the plate once
 * opened the way for good. That made the first room the one exception to the
 * game's premise, and it made a plate mean something here that it means
 * nowhere else. Now every plate in the building reads the same — down while
 * something stands on it, up when nothing does — and the first room teaches
 * the loop by needing it rather than by describing it.
 */
export const AWAKENING: RoomDefinition = {
  id: "awakening",
  version: 2,
  name: "깨어남",
  subtitle: "Awakening",
  // Fifteen seconds of recording, twenty-three of replay. Ten was enough to
  // walk the route and not enough for a player who stops to look at the room,
  // and having the tape end on its own is a confusing way to meet the second
  // pass. Folding early does not shorten it: the span is the room's, not the
  // tape's. The grace is eight seconds, not five: a judge who fumbled the
  // mount lost five attempts one to three seconds short of the doorway, and a
  // teaching room has nothing to gain from a fail that close.
  tapeDurationTicks: 450,
  replayGraceTicks: 240,
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
      // No latch and no timers. Every other room in the building already works
      // this way, and the owner's rule is the simpler physics: a plate is down
      // while something stands on it and up when nothing does, everywhere, with
      // nothing in the building on a clock.
      //
      // What that costs is the walk-through. 00 could be left alone because the
      // door stayed open behind you; now the plate is 4.4 m from the doorway
      // and closes the instant you step off, so the way out is the recording —
      // stand on it, fold, and walk out past the man holding it down. The first
      // room stops being the exception to the game's own premise.
      latchOnOpen: false,
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
  // The first room is one space with one thing in it. A line pointing at the
  // only object in the room would be the game explaining a room it has not
  // finished showing you.
  routes: [],
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
  dioramas: false,
  views: [],
  tornPaper: false,
};

export const AWAKENING_CHAMBER: Chamber = {
  sim: AWAKENING,
  shell: ROOM_SHELL,
  number: "00",
  // The first line is the core rule, and it comes with the first failure: a
  // judge in a hurry skips the title card, and this card is the only other
  // place the loop is ever explained.
  hints: [
    { after: 1, line: "잔상이 발판에 도착해야 문이 열립니다." },
    { after: 2, line: "발판 위에 멈춰 서서 ⏎." },
  ],
  // The whole loop, before the first tape rolls: judges kept meeting the
  // second half of the contract on a failure card. One breath longer than the
  // old welcome, and the only room that gets the full sentence.
  subtitleOnEntry: "기억 보관소에 오신 것을 환영합니다. 이곳에서의 행동은 기록되고, 기록이 끝나면 조금 전의 당신, 곧 잔상이 같은 길을 다시 걷습니다. 잔상이 발판을 밟는 동안 빛으로 나가세요.",
  // The loop's causality, said the moment it starts mattering. Three rounds of
  // judges pieced it together from failure cards instead — after the failing.
  subtitleOnReplay: "잔상이 당신의 길을 되밟는 중입니다. 발판에 닿으면 문이 열리니, 그때 빛으로 나가세요.",
  dressing: AWAKENING_DRESSING,
};
