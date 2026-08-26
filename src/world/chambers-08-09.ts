import type { RoomDefinition } from "../sim/types";
import type { Chamber, RoomShell } from "./chamber";
import { standardDressing } from "./dressing";
import { corridorExit, doorwayBrush, hallBrushes } from "./shell";
import { HOLDING_HAND, OPEN_BOX, PILLAR } from "./chambers";
import { ROOM_SHELL } from "./room";

const TAPE_TICKS = 450;
const GRACE_TICKS = 150;

// ---------------------------------------------------------------- 08

/** Where the older self is standing when you arrive. Nobody mentions it. */
export const OLD_ECHO_PLATE = { x: -3.4, z: 7.2 };
const YOUR_PLATE = { x: 3.4, z: 7.2 };

/**
 * 08 — Silence. The easiest room in the game, and that is the point.
 *
 * No recording is taken here: the tape bar, the pass badge and both key prompts
 * are gone, because none of them would do anything. Two plates, and this room
 * needs both — which alone is impossible.
 *
 * Someone is already standing on the first one. The name board under his feet
 * reads 01, and the seal on it is yours, because he is the record you left
 * there. You step onto the other plate. That is the whole room.
 *
 * The facility says nothing about him.
 */
export const SILENCE: RoomDefinition = {
  id: "silence",
  version: 1,
  name: "침묵",
  subtitle: "Silence",
  tapeDurationTicks: TAPE_TICKS,
  replayGraceTicks: GRACE_TICKS,
  recordingDisabled: true,
  spawn: { x: 0, y: 0, z: ROOM_SHELL.spawnZ, yawUnits: 0 },
  brushes: hallBrushes(ROOM_SHELL),
  plates: [
    {
      id: "old-plate",
      centre: OLD_ECHO_PLATE,
      half: { x: 0.95, z: 0.95 },
      reach: 0.35,
      // Held down by a record the archive is replaying. Not an actor, not a tape.
      forcedActive: true,
    },
    { id: "your-plate", centre: YOUR_PLATE, half: { x: 0.95, z: 0.95 }, reach: 0.35 },
  ],
  holds: [],
  doors: [
    {
      id: "inner-door",
      brush: doorwayBrush("inner-door", ROOM_SHELL),
      gatedBy: {
        kind: "all",
        of: [
          { kind: "plate", id: "old-plate" },
          { kind: "plate", id: "your-plate" },
        ],
      },
      latchOnOpen: true,
    },
  ],
  exit: corridorExit(ROOM_SHELL),
};

export const SILENCE_CHAMBER: Chamber = {
  sim: SILENCE,
  shell: ROOM_SHELL,
  number: "08",
  // The rule, not the move: the door wants both plates down at once, and this
  // is the one room that will not let you record anything to help with that.
  subtitleOnEntry: "이 구역은 기록이 허가되지 않습니다. 저 문은 두 발판이 동시에 눌려 있어야 열립니다.",
  coached: false,
  hints: [
    { after: 2, line: "발판 하나는 이미 눌려 있습니다. 누가 눌러 두었는지 보세요." },
    { after: 4, line: "남은 발판은 하나뿐이고, 여기서 움직일 수 있는 사람도 당신 하나뿐입니다." },
  ],
  // The same plate the room forces down, so the man and the reason the plate is
  // down cannot drift apart.
  archivalFigure: { fromChamberId: "second-self", at: OLD_ECHO_PLATE },
  dressing: standardDressing(ROOM_SHELL, { seedBase: 8800 }),
};

// ---------------------------------------------------------------- 09

/**
 * The finale is 02 at a longer walk. Same grip, same doorway, same building —
 * a copy rather than a homage, so that what changed is only the latch.
 */
const FINALE_SHELL: RoomShell = { ...ROOM_SHELL, depth: 20, corridorEnd: 30.6 };

/**
 * 09 — The Last Hold. No new rules at all.
 *
 * Every door in this game has latched. Each one stayed open once it opened, and
 * that is why you were always able to leave. This one does not, and the only way
 * to hold a door open is the thing 02 taught you on your third minute: take hold
 * of it and end the recording still holding.
 *
 * Nothing explains that. It does not need to, because you already know it, and
 * the game has never once lied to you about what a held posture does.
 *
 * The gauge runs out while you are still walking. The door stays open anyway.
 */
export const LAST_HOLD: RoomDefinition = {
  id: "last-hold",
  version: 1,
  name: "마지막 붙듦",
  subtitle: "The Last Hold",
  tapeDurationTicks: TAPE_TICKS,
  replayGraceTicks: GRACE_TICKS,
  spawn: { x: 0, y: 0, z: FINALE_SHELL.spawnZ, yawUnits: 0 },
  brushes: hallBrushes(FINALE_SHELL),
  plates: [],
  // The same grip, in the same place, as the room that taught it.
  holds: [{ id: "grip-pillar", at: PILLAR, releaseRadius: 2.6 }],
  doors: [
    {
      id: "inner-door",
      brush: doorwayBrush("inner-door", FINALE_SHELL),
      gatedBy: { kind: "hold", id: "grip-pillar" },
      // The absence that is the whole ending.
      latchOnOpen: false,
    },
  ],
  exitGatedBy: { kind: "hold", id: "grip-pillar" },
  // The second pass never expires, so he is still holding it when you look back.
  echoPersists: true,
  exit: corridorExit(FINALE_SHELL),
};

export const LAST_HOLD_CHAMBER: Chamber = {
  sim: LAST_HOLD,
  shell: FINALE_SHELL,
  number: "09",
  subtitleOnEntry: "이 방의 기록은 회수되지 않습니다.",
  sealHoldSeconds: 0.8,
  // R still works — nothing here is taken away from the player. Only the
  // sentence changes, and it is the one the whole game has been building to.
  rerecordNotice: "이 방의 기록은 회수되지 않습니다.",
  dressing: standardDressing(FINALE_SHELL, {
    seedBase: 9900,
    windows: [3, 7, 11, 15],
    // Red in every chamber but this one. What is being sealed here is not a record.
    sealColour: "cyan",
    // The same open memory box 02 left, with the seal you stamped in it.
    openBox: OPEN_BOX,
  }),
};

/** What 02 and 09 must keep in common. Read by the test that checks the copy. */
export const FINALE_INHERITS_FROM = HOLDING_HAND;
