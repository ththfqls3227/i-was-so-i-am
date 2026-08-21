import type { RoomDefinition } from "../sim/types";
import type { Chamber, DressBlockSpec, RoomShell, SalchangSpec } from "./chamber";
import { standardDressing } from "./dressing";
import { box } from "./shell";

const WALL = 0.6;
const HALF = 3.2;
const HEIGHT = 3.4;
/** One bay per chamber walked, in reverse, plus the room at the end. */
const BAY_DEPTH = 4.5;

/**
 * The corridor at the end, and what stands behind each window in it.
 *
 * You walk back along everything you did, in reverse. Behind each lattice is a
 * shallow diorama a metre and a half deep: a dark backing board, the one part
 * that room was about, and a single figure standing in the posture the fold
 * froze him in. Nothing animates. They are not replays — they are what is left.
 *
 * 08's window is empty, and its place on the scroll opposite is blank. That is
 * deliberate and must survive every later edit: it is the only room you were
 * not asked to leave anyone in.
 */
export interface DioramaSpec {
  /** Which chamber's record stands here. */
  chamberId: string;
  /** Where the window is along the corridor. */
  centreZ: number;
  /**
   * The lattice this diorama stands behind. West, because west is the sun side
   * and these are the brightest things on the wall. The east window opposite is
   * an ordinary one, so the corridor still reads as a corridor.
   */
  windowId: string;
  /**
   * Empty on purpose. 08 took no recording, so there is nobody to stand here,
   * and the gap is the point rather than an omission to be tidied up.
   */
  empty?: boolean;
  /**
   * Loop the tape instead of freezing it. Only the first room does — the last
   * window before the door is 00, replaying the clumsiest recording you ever
   * made, the one that stops at the door and glances back.
   */
  loop?: boolean;
}

/** Reverse order: the last thing you did is the first thing you pass. */
export const DIORAMAS: readonly DioramaSpec[] = [
  "last-hold",
  "silence",
  "unkept",
  "giving-back",
  "long-standing",
  "two-of-us",
  "hand-not-body",
  "holding-hand",
  "second-self",
  "awakening",
].map((chamberId, index): DioramaSpec => {
  const centreZ = BAY_DEPTH * (index + 1);
  return {
    chamberId,
    centreZ,
    windowId: `west-${centreZ}`,
    // 08 took no recording, so there is nobody standing here.
    ...(chamberId === "silence" ? { empty: true } : {}),
    // 00 is the last window before the door, and the only one still moving.
    ...(chamberId === "awakening" ? { loop: true } : {}),
  };
});

const CORRIDOR_END = BAY_DEPTH * 10 + 6;

const ENDING_SHELL: RoomShell = {
  halfWidth: HALF,
  depth: CORRIDOR_END,
  height: HEIGHT,
  corridorHalfWidth: HALF,
  corridorEnd: CORRIDOR_END,
  corridorHeight: HEIGHT,
  doorwayHalfWidth: 1.2,
  doorwayHeight: 2.4,
  wallThickness: WALL,
  plateCentreZ: 0,
  plateRadius: 1.05,
  spawnZ: 1.6,
};

const shellSolids = [
  box("floor", { x: -HALF - WALL, y: -WALL, z: -WALL }, { x: HALF + WALL, y: 0, z: CORRIDOR_END + WALL }),
  box("ceiling", { x: -HALF - WALL, y: HEIGHT, z: -WALL }, { x: HALF + WALL, y: HEIGHT + WALL, z: CORRIDOR_END + WALL }),
  box("wall-west", { x: -HALF - WALL, y: 0, z: -WALL }, { x: -HALF, y: HEIGHT, z: CORRIDOR_END + WALL }),
  box("wall-east", { x: HALF, y: 0, z: -WALL }, { x: HALF + WALL, y: HEIGHT, z: CORRIDOR_END + WALL }),
  box("wall-back", { x: -HALF - WALL, y: 0, z: -WALL }, { x: HALF + WALL, y: HEIGHT, z: 0 }),
  box("wall-far", { x: -HALF - WALL, y: 0, z: CORRIDOR_END }, { x: HALF + WALL, y: HEIGHT, z: CORRIDOR_END + WALL }),
];

/**
 * The corridor takes no recording and cannot be failed. There is nothing here
 * to solve: it is a walk past ten windows, and the only key that does anything
 * is the one that has been ending recordings all game — at the last door, where
 * it ends the game instead. See finalBeat on the chamber; the simulation has no
 * part in it, which is why canFold stays false the whole way down.
 */
export const ENDING_CORRIDOR: RoomDefinition = {
  id: "ending-corridor",
  version: 1,
  name: "회랑",
  subtitle: "The Long Gallery",
  tapeDurationTicks: 450,
  replayGraceTicks: 150,
  recordingDisabled: true,
  spawn: { x: 0, y: 0, z: ENDING_SHELL.spawnZ, yawUnits: 0 },
  brushes: shellSolids,
  plates: [],
  holds: [],
  doors: [],
  exit: {
    id: "exit",
    min: { x: -HALF, y: 0, z: CORRIDOR_END - 2 },
    max: { x: HALF, y: HEIGHT, z: CORRIDOR_END },
  },
};

export const ENDING_CHAMBER: Chamber = {
  sim: ENDING_CORRIDOR,
  shell: ENDING_SHELL,
  number: "—",
  // Nothing on the way in. The corridor is a walk, and what it has to say it
  // says at the far end, in front of the first tape you ever made.
  subtitleOnEntry: "",
  // The same key, one last time.
  finalBeat: { prompt: "⏎ · 기록을 닫습니다" },
  // Read at the last window, in order, with room between them. The last one is
  // the game's sentence; nothing after it is in Korean, because the title says
  // the same thing and saying it twice makes the second one a translation.
  finalApproach: {
    atZ: 42.5,
    lines: [
      "모든 기록의 서명이 동일합니다. — 기록자: 나",
      "과거는 문을 붙들고 남았다.",
      "그 흔적이 사라진 것은 아니다. 나는 그것을 지나왔기에, 지금 여기에 있다.",
    ],
  },
  dressing: standardDressing(ENDING_SHELL, {
    seedBase: 10000,
    corridor: false,
    dioramas: true,
    // A gallery, not a stack room. The west wall is the ten windows and nothing
    // else; the standard pair of full-length runs would board them over, and the
    // standard window slot — everything left between the shelving and a 3.4 m
    // ceiling — is sixteen centimetres, which is a vent rather than a view.
    longShelves: false,
    windows: [],
    extraShelves: [
      {
        id: "east-run",
        x: HALF,
        facing: -1,
        fromZ: 1,
        toZ: CORRIDOR_END - 1,
        height: 1.9,
        seed: 10000 + 8123,
        depth: 0.34,
      },
    ],
    extraSalchang: [
      // The ten. Sill low and opening tall, because you are meant to look
      // through these at something standing on the other side, not up at them.
      ...DIORAMAS.map((diorama): SalchangSpec => ({
        id: diorama.windowId,
        x: -HALF,
        facing: 1,
        centreZ: diorama.centreZ,
        width: 2.9,
        sillY: 0.75,
        height: 2.2,
        seed: 10000 + Math.round(diorama.centreZ),
        castsBands: false,
        open: true,
      })),
      // The ordinary ones opposite, so the corridor still reads as a corridor
      // rather than as a row of vitrines.
      ...DIORAMAS.map((diorama): SalchangSpec => ({
        id: `east-${diorama.centreZ}`,
        x: HALF,
        facing: -1,
        centreZ: diorama.centreZ,
        width: 1.8,
        sillY: 2.16,
        height: 0.92,
        seed: 10000 + 500 + Math.round(diorama.centreZ),
        castsBands: false,
      })),
    ],
    // The long walls are left to the shell builder, which cuts them into bands
    // around the openings. Drawn as solid blocks as well, they board over the
    // ten windows from the inside — which is exactly what they did.
    blocks: shellSolids
      .filter((brush) => !brush.id.startsWith("floor") && !brush.id.startsWith("ceiling")
        && brush.id !== "wall-west" && brush.id !== "wall-east")
      .map((brush): DressBlockSpec => ({ id: brush.id, min: brush.min, max: brush.max, finish: "plaster" })),
  }),
};
