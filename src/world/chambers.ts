import type { Brush, RoomDefinition } from "../sim/types";
import type { Chamber, RoomShell } from "./chamber";
import { route, standardDressing } from "./dressing";
import { box, corridorExit, doorwayBrush, hallBrushes } from "./shell";
import { ROOM_SHELL } from "./room";

const TAPE_TICKS = 450;
const GRACE_TICKS = 150;

// ---------------------------------------------------------------- 01

/**
 * 01 — Second Self. The plate only answers to the echo, so the door cannot be
 * opened by the person standing in the room. You record yourself standing on it,
 * and then you walk through a door someone else is holding.
 *
 * The door does not latch. It stays open because he is still standing there, and
 * he is still standing there because the recording ended with him standing
 * there. Walk through and look back: he is not looking at you.
 */
export const SECOND_SELF: RoomDefinition = {
  id: "second-self",
  version: 2,
  name: "두 번째 나",
  subtitle: "Second Self",
  tapeDurationTicks: TAPE_TICKS,
  // Eight seconds of grace, like 00: this room's lesson is whose plate it is,
  // not how fast you can cross a corridor, and the judge who learned the
  // lesson still failed five times a doorway short on the standard five.
  replayGraceTicks: 240,
  spawn: { x: 0, y: 0, z: ROOM_SHELL.spawnZ, yawUnits: 0 },
  brushes: hallBrushes(ROOM_SHELL),
  plates: [
    {
      id: "echo-plate",
      centre: { x: 0, z: ROOM_SHELL.plateCentreZ },
      half: { x: 0.95, z: 0.95 },
      reach: 0.35,
      // Only the recording can press it. This is the whole room.
      requiredActor: "past",
    },
  ],
  holds: [],
  doors: [
    {
      id: "inner-door",
      brush: doorwayBrush("inner-door", ROOM_SHELL),
      gatedBy: { kind: "plate", id: "echo-plate" },
      latchOnOpen: false,
    },
  ],
  exit: corridorExit(ROOM_SHELL),
};

export const SECOND_SELF_CHAMBER: Chamber = {
  sim: SECOND_SELF,
  shell: ROOM_SHELL,
  number: "01",
  subtitleOnEntry: "기록은 폐기되지 않습니다. 다시 재생될 뿐입니다. 보관소는 이것을 메아리라 부릅니다.",
  dressing: standardDressing(ROOM_SHELL, { seedBase: 1700 }),
};

// ---------------------------------------------------------------- 02

/** Where the grip stands, and where the one open memory box is left. */
export const PILLAR = { x: 0, y: 1.15, z: 3.4 };
export const OPEN_BOX = { x: -ROOM_SHELL.halfWidth + 0.46, y: 1.72, z: 8.4 };

/**
 * 02 — The Hand That Holds. A brass grip near the entrance, and the way out at
 * the far end of the building.
 *
 * You hold it, you end the recording still holding it, and then you walk the
 * whole length of the hall away from someone whose hand you left there. Neither
 * the door nor the exit latches: both are open for exactly as long as he holds
 * on, which is for as long as you need, because that is what you recorded.
 *
 * The geometry of this room is the finale's, at a smaller scale. So is the one
 * memory box left standing open on the west wall.
 */
export const HOLDING_HAND: RoomDefinition = {
  id: "holding-hand",
  version: 1,
  name: "붙드는 손",
  subtitle: "The Hand That Holds",
  tapeDurationTicks: TAPE_TICKS,
  replayGraceTicks: GRACE_TICKS,
  spawn: { x: 0, y: 0, z: ROOM_SHELL.spawnZ, yawUnits: 0 },
  brushes: hallBrushes(ROOM_SHELL),
  plates: [],
  holds: [{ id: "grip-pillar", at: PILLAR, releaseRadius: 2.6 }],
  doors: [
    {
      id: "inner-door",
      brush: doorwayBrush("inner-door", ROOM_SHELL),
      gatedBy: { kind: "hold", id: "grip-pillar" },
      latchOnOpen: false,
    },
  ],
  exitGatedBy: { kind: "hold", id: "grip-pillar" },
  exit: corridorExit(ROOM_SHELL),
};

export const HOLDING_HAND_CHAMBER: Chamber = {
  sim: HOLDING_HAND,
  shell: ROOM_SHELL,
  number: "02",
  subtitleOnEntry: "메아리의 손은 성실합니다. 기록이 끝날 때까지, 잡은 것을 놓지 않습니다.",
  // Four windows rather than the standard three, evenly spaced. 01 and 02 were
  // running the same window row, which put the same three bands on the same
  // three patches of floor in both rooms — and 02 is the one room whose subject
  // is the length of the walk. Four bands at an even pitch give it a metronome:
  // the distance to the far gate is countable underfoot.
  dressing: standardDressing(ROOM_SHELL, { seedBase: 2600, openBox: OPEN_BOX, windows: [2.2, 5, 7.8, 10.6] }),
};

// ---------------------------------------------------------------- 03

/**
 * 03 — Hand, Not Body. The one chamber whose shape is its own.
 *
 * A partition stands across the middle of the hall with a doorway in it and a
 * dead-end alcove behind. The doorway answers to an amber plate only the living
 * player can press; the alcove floor answers only to the echo.
 *
 * Recording: the doorway is shut and nobody can open it, so you walk into it and
 * keep walking, and end the recording pressed against it still walking. What is
 * recorded is not where you got to. It is what you were doing.
 *
 * Replay: you stand on the amber plate, the doorway opens, and he walks through
 * it — because he never stopped walking — into the alcove, where the floor opens
 * the way out for you. Then you step off the plate to leave, and the doorway
 * closes behind him. The room does not do that. Your feet do.
 */
const HAND_SHELL: RoomShell = {
  ...ROOM_SHELL,
  depth: 14,
  plateCentreZ: 6.5,
};

const PARTITION_Z = 9;
const PARTITION_THICK = 0.6;
const ALCOVE_HALF = 1.2;
const ALCOVE_END_Z = 11.6;
/** Dead centre of the alcove, which is where the plate is and where the line stops. */
const ALCOVE_PLATE_Z = (PARTITION_Z + PARTITION_THICK + ALCOVE_END_Z) / 2;
const WALL = 0.6;

const handBrushes: Brush[] = [
  box("floor", { x: -6.6, y: -WALL, z: -WALL }, { x: 6.6, y: 0, z: 14.6 }),
  box("ceiling", { x: -6.6, y: 4, z: -WALL }, { x: 6.6, y: 4 + WALL, z: 14.6 }),
  box("wall-west", { x: -6.6, y: 0, z: -WALL }, { x: -6, y: 4, z: 14.6 }),
  box("wall-east", { x: 6, y: 0, z: -WALL }, { x: 6.6, y: 4, z: 14.6 }),
  box("wall-back", { x: -6.6, y: 0, z: -WALL }, { x: 6.6, y: 4, z: 0 }),
  box("wall-far", { x: -6.6, y: 0, z: 14 }, { x: 6.6, y: 4, z: 14.6 }),

  // The partition only spans the middle of the hall, so the player can walk
  // around it. The echo cannot: it is walking in a straight line.
  box("partition-left", { x: -3, y: 0, z: PARTITION_Z }, { x: -ALCOVE_HALF, y: 4, z: PARTITION_Z + PARTITION_THICK }),
  box("partition-right", { x: ALCOVE_HALF, y: 0, z: PARTITION_Z }, { x: 3, y: 4, z: PARTITION_Z + PARTITION_THICK }),
  box("partition-lintel", { x: -ALCOVE_HALF, y: 2.6, z: PARTITION_Z }, { x: ALCOVE_HALF, y: 4, z: PARTITION_Z + PARTITION_THICK }),

  // A straight dead end. Straight because a bent one would mean authoring a turn
  // into a tape that is only ever holding one direction.
  box("alcove-west", { x: -1.5, y: 0, z: PARTITION_Z + PARTITION_THICK }, { x: -ALCOVE_HALF, y: 4, z: ALCOVE_END_Z + 0.3 }),
  box("alcove-east", { x: ALCOVE_HALF, y: 0, z: PARTITION_Z + PARTITION_THICK }, { x: 1.5, y: 4, z: ALCOVE_END_Z + 0.3 }),
  box("alcove-end", { x: -1.5, y: 0, z: ALCOVE_END_Z }, { x: 1.5, y: 4, z: ALCOVE_END_Z + 0.3 }),
];

export const HAND_NOT_BODY: RoomDefinition = {
  id: "hand-not-body",
  version: 1,
  name: "몸이 아니라 손",
  subtitle: "Hand, Not Body",
  tapeDurationTicks: TAPE_TICKS,
  replayGraceTicks: GRACE_TICKS,
  spawn: { x: 0, y: 0, z: 1.6, yawUnits: 0 },
  brushes: handBrushes,
  plates: [
    {
      id: "amber-plate",
      centre: { x: 3.6, z: 6.5 },
      half: { x: 0.95, z: 0.95 },
      reach: 0.35,
      // Off the straight line the echo walks, or he would open his own door.
      requiredActor: "present",
    },
    {
      id: "alcove-plate",
      centre: { x: 0, z: ALCOVE_PLATE_Z },
      half: { x: ALCOVE_HALF, z: (ALCOVE_END_Z - PARTITION_Z - PARTITION_THICK) / 2 },
      reach: 0.35,
      requiredActor: "past",
    },
  ],
  holds: [],
  doors: [
    {
      id: "partition-door",
      brush: box(
        "partition-door",
        { x: -ALCOVE_HALF, y: 0, z: PARTITION_Z + 0.05 },
        { x: ALCOVE_HALF, y: 2.6, z: PARTITION_Z + PARTITION_THICK - 0.05 },
      ),
      gatedBy: { kind: "plate", id: "amber-plate" },
      latchOnOpen: false,
    },
  ],
  exitGatedBy: { kind: "plate", id: "alcove-plate" },
  exit: { id: "exit", min: { x: 3.4, y: 0, z: 12.4 }, max: { x: 6, y: 4, z: 14 } },
};

/**
 * The partition and the dead end, drawn from the same constants the brushes are
 * built from. Until this existed the room collided with a wall nobody could
 * see: you walked into the middle of an empty hall and stopped.
 */
const HAND_BLOCKS = [
  // Plastered, like the shell. Timber wings went black: nothing in the room
  // lights a face that points back down the hall, and dark timber has no albedo
  // to survive on. Plaster catches the door's own paper light.
  { id: "partition-left", min: { x: -3, y: 0, z: PARTITION_Z }, max: { x: -ALCOVE_HALF, y: 4, z: PARTITION_Z + PARTITION_THICK }, finish: "plaster" as const },
  { id: "partition-right", min: { x: ALCOVE_HALF, y: 0, z: PARTITION_Z }, max: { x: 3, y: 4, z: PARTITION_Z + PARTITION_THICK }, finish: "plaster" as const },
  { id: "partition-lintel", min: { x: -ALCOVE_HALF, y: 2.6, z: PARTITION_Z }, max: { x: ALCOVE_HALF, y: 4, z: PARTITION_Z + PARTITION_THICK }, finish: "plaster" as const },
  { id: "alcove-west", min: { x: -1.5, y: 0, z: PARTITION_Z + PARTITION_THICK }, max: { x: -ALCOVE_HALF, y: 4, z: ALCOVE_END_Z + 0.3 }, finish: "plaster" as const },
  { id: "alcove-east", min: { x: ALCOVE_HALF, y: 0, z: PARTITION_Z + PARTITION_THICK }, max: { x: 1.5, y: 4, z: ALCOVE_END_Z + 0.3 }, finish: "plaster" as const },
  { id: "alcove-end", min: { x: -1.5, y: 0, z: ALCOVE_END_Z }, max: { x: 1.5, y: 4, z: ALCOVE_END_Z + 0.3 }, finish: "plaster" as const },
];

export const HAND_NOT_BODY_CHAMBER: Chamber = {
  sim: HAND_NOT_BODY,
  shell: HAND_SHELL,
  number: "03",
  // Both playtest judges quit here: the sign teaches the twist but not the
  // move, and nothing else in the room does either. The hints carry the move,
  // from the very first failure — two more rounds of judges ran out of
  // patience one hint short of the answer, so the ladder starts at one and
  // the first rung points at the golden floor line the room already draws.
  hints: [
    { after: 1, line: "재생 중에는 당신의 발이 자유롭습니다. 바닥의 금색 선을 따라가, 오른쪽의 발판을 직접 밟으세요." },
    { after: 2, line: "발판을 밟은 채 기다리면, 메아리가 열린 문을 지나 막다른 방까지 걸어갑니다. 출구가 열리면 당신도 나가야 합니다." },
  ],
  // The rule up front, not four failure cards deep: a judge who met it only
  // as escalating hints spent five tries re-deriving it and quit one short.
  subtitleOnEntry: "안내: 이 방의 발판은 재생 중의 당신 몫입니다. 기록에는 — 닫힌 문을 향한 걸음을 담으세요.",
  // The echo treading against the shut partition is the room's whole idea —
  // and it reads as a bug until this sentence lands.
  echoAtDoorLine: "메아리가 닫힌 문 앞에서 걷고 있습니다 — 오른쪽 발판이 그 문을 엽니다.",
  plateDutyInReplay: true,
  dressing: standardDressing(HAND_SHELL, {
    seedBase: 3300,
    windows: [3, 7, 11],
    blocks: HAND_BLOCKS,
    // On the partition's west wing, not the far wall. The far wall in this room
    // is behind the partition on the side away from the exit, so the board hung
    // there was never once in frame; here it is beside the lit door, which is
    // what the player is looking at from the moment they walk in.
    sign: { x: -2.1, z: PARTITION_Z },
    // The plate is off to one side and the alcove is through a gap in a wall.
    // From the door, neither is where the room looks like it goes.
    routes: [
      // The one glowing route in the game: this is the line the replay hangs
      // on, it lives in the room's darkest corner, and two rounds of judges
      // never saw it matte. Wear stays within the faint-lines rule.
      route("to-plate", [{ x: 0, z: 2.2 }, { x: 3.6, z: 4.4 }, { x: 3.6, z: 6.5 }], 1, "present", true),
      route("through-partition", [{ x: 0, z: 2.2 }, { x: 0, z: ALCOVE_PLATE_Z }], 0.55, "past"),
    ],
    // This room leaves through a doorway in its own east wall. It has no
    // corridor, and drawing one puts a passage behind a solid wall.
    corridor: false,
    // The dead end is lined like an aisle: cases either side, and the plain
    // plaster he ends up walking at.
    extraShelves: [
      {
        id: "alcove-west-run",
        x: -ALCOVE_HALF,
        facing: 1,
        fromZ: PARTITION_Z + PARTITION_THICK + 0.1,
        toZ: ALCOVE_END_Z - 0.1,
        height: 1.94,
        seed: 3300 + 771,
        depth: 0.26,
      },
      {
        id: "alcove-east-run",
        x: ALCOVE_HALF,
        facing: -1,
        fromZ: PARTITION_Z + PARTITION_THICK + 0.1,
        toZ: ALCOVE_END_Z - 0.1,
        height: 1.94,
        seed: 3300 + 772,
        depth: 0.26,
      },
    ],
  }),
};
