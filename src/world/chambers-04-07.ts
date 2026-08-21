import type { Brush, RoomDefinition } from "../sim/types";
import type { Chamber, DressBlockSpec, RoomShell } from "./chamber";
import { route, standardDressing } from "./dressing";
import { box } from "./shell";

const TAPE_TICKS = 450;
const GRACE_TICKS = 150;
const WALL = 0.6;
const CEILING = 4;

/**
 * One description, two consumers: the brush the player collides with and the
 * block the renderer draws.
 *
 * 03 shipped a partition that existed only as collision, so the room stopped you
 * in the middle of an empty hall. Structure declared here cannot do that.
 */
interface Solid {
  brush: Brush;
  block: DressBlockSpec;
}

function solid(
  id: string,
  min: { x: number; y: number; z: number },
  max: { x: number; y: number; z: number },
  finish: DressBlockSpec["finish"] = "plaster",
): Solid {
  return { brush: box(id, min, max), block: { id, min, max, finish } };
}

const brushesOf = (solids: Solid[]): Brush[] => solids.map((piece) => piece.brush);
const blocksOf = (solids: Solid[]): DressBlockSpec[] => solids.map((piece) => piece.block);

/** The sealed box a hall lives in: floor, ceiling and four walls. */
function shellOf(halfWidth: number, depth: number, height: number): Solid[] {
  const outer = halfWidth + WALL;
  return [
    solid("floor", { x: -outer, y: -WALL, z: -WALL }, { x: outer, y: 0, z: depth + WALL }),
    solid("ceiling", { x: -outer, y: height, z: -WALL }, { x: outer, y: height + WALL, z: depth + WALL }),
    solid("wall-west", { x: -outer, y: 0, z: -WALL }, { x: -halfWidth, y: height, z: depth + WALL }),
    solid("wall-east", { x: halfWidth, y: 0, z: -WALL }, { x: outer, y: height, z: depth + WALL }),
    solid("wall-back", { x: -outer, y: 0, z: -WALL }, { x: outer, y: height, z: 0 }),
    solid("wall-far", { x: -outer, y: 0, z: depth }, { x: outer, y: height, z: depth + WALL }),
  ];
}

/**
 * A partition across the middle of a hall, with a doorway in it, standing clear
 * of both side walls so the player can walk around what the echo cannot.
 */
function partition(z: number, halfDoor: number, reach: number, height: number): Solid[] {
  return [
    solid("partition-left", { x: -reach, y: 0, z }, { x: -halfDoor, y: height, z: z + WALL }),
    solid("partition-right", { x: halfDoor, y: 0, z }, { x: reach, y: height, z: z + WALL }),
    solid("partition-lintel", { x: -halfDoor, y: 2.6, z }, { x: halfDoor, y: height, z: z + WALL }),
  ];
}

/** A straight dead end behind a doorway. Straight, because a tape only holds one heading. */
function deadEnd(fromZ: number, toZ: number, halfWidth: number, height: number): Solid[] {
  return [
    solid("slot-west", { x: -halfWidth - 0.3, y: 0, z: fromZ }, { x: -halfWidth, y: height, z: toZ + 0.3 }),
    solid("slot-east", { x: halfWidth, y: 0, z: fromZ }, { x: halfWidth + 0.3, y: height, z: toZ + 0.3 }),
    solid("slot-end", { x: -halfWidth - 0.3, y: 0, z: toZ }, { x: halfWidth + 0.3, y: height, z: toZ + 0.3 }),
  ];
}

// ---------------------------------------------------------------- 04

const FOUR_HALF = 7;
const FOUR_DEPTH = 16;
const FOUR_HEIGHT = 7;
const DECK_Y = 3.4;
const STAIR_RISE = DECK_Y / 10;
const STAIR_FROM_Z = 5;

/** Ten treads to one storey, at a rise the body walks up without jumping. */
const stairs: Solid[] = Array.from({ length: 10 }, (_, index) =>
  solid(
    `tread-${index}`,
    { x: 3, y: -WALL, z: STAIR_FROM_Z + index * 0.6 },
    { x: 6.5, y: STAIR_RISE * (index + 1), z: STAIR_FROM_Z + (index + 1) * 0.6 },
    // Timber, not plaster. Plaster stairs and a plaster gallery floor put the
    // brightest value in the room under the player's feet, and the storey read
    // as a lit slab rather than as a floor you are standing on. Timber went
    // black on vertical faces in 03, but a tread and a deck face up: they take
    // the key light and the hemispheric directly.
    "timber",
  ),
);

const fourSolids: Solid[] = [
  ...shellOf(FOUR_HALF, FOUR_DEPTH, FOUR_HEIGHT),
  ...stairs,
  // The gallery the stairs arrive on, and the rail you lean over to see him.
  solid("deck", { x: 1.6, y: DECK_Y - 0.4, z: 11 }, { x: 7, y: DECK_Y, z: FOUR_DEPTH }, "timber"),
  solid("deck-rail", { x: 1.6, y: DECK_Y, z: 11 }, { x: 1.8, y: DECK_Y + 1, z: FOUR_DEPTH }, "timber"),
];

/**
 * 04 — Two People's Worth. The first chamber with an upstairs, and the first
 * time you are grateful.
 *
 * He holds a grip on the ground floor; that is the only thing that opens the way
 * up. You climb, and from the gallery you look back down at the man who put you
 * there. The light in the window band he is standing in warms for a moment. No
 * subtitle says why.
 *
 * The gallery grip latches the way out rather than gating it, because a hold you
 * must keep holding is a hold you cannot walk away from — the same reason the
 * receptacle it replaces was a thing you put down and left.
 */
export const TWO_OF_US: RoomDefinition = {
  id: "two-of-us",
  version: 1,
  name: "두 사람 몫",
  subtitle: "Two People's Worth",
  tapeDurationTicks: TAPE_TICKS,
  replayGraceTicks: GRACE_TICKS,
  spawn: { x: 0, y: 0, z: 1.6, yawUnits: 0 },
  brushes: brushesOf(fourSolids),
  plates: [],
  holds: [
    { id: "ground-grip", at: { x: 0, y: 1.15, z: 6 }, releaseRadius: 2.6 },
    { id: "gallery-grip", at: { x: 3, y: DECK_Y + 1.15, z: 14.9 }, releaseRadius: 2.6 },
  ],
  doors: [
    {
      id: "upper-door",
      brush: box("upper-door", { x: 3, y: DECK_Y, z: 11 }, { x: 6.5, y: DECK_Y + 2.6, z: 11.5 }),
      gatedBy: { kind: "hold", id: "ground-grip" },
      latchOnOpen: false,
    },
    {
      id: "way-out",
      brush: box("way-out", { x: 1.8, y: DECK_Y, z: 15 }, { x: 7, y: DECK_Y + 2.6, z: 15.5 }),
      gatedBy: { kind: "hold", id: "gallery-grip" },
      // Latching is what makes this a receptacle rather than a second errand.
      latchOnOpen: true,
    },
  ],
  exit: { id: "exit", min: { x: 1.8, y: DECK_Y, z: 15.5 }, max: { x: 7, y: FOUR_HEIGHT, z: FOUR_DEPTH } },
};

export const TWO_OF_US_CHAMBER: Chamber = {
  sim: TWO_OF_US,
  shell: {
    halfWidth: FOUR_HALF,
    depth: FOUR_DEPTH,
    height: FOUR_HEIGHT,
    corridorHalfWidth: 2,
    corridorEnd: FOUR_DEPTH,
    corridorHeight: 3,
    doorwayHalfWidth: 1.75,
    doorwayHeight: 2.6,
    wallThickness: WALL,
    plateCentreZ: 8,
    plateRadius: 1.05,
    spawnZ: 1.6,
  } satisfies RoomShell,
  number: "04",
  subtitleOnEntry: "일부 설비는 두 사람 몫의 힘을 요구합니다. 보관소에는 당신이 두 명 있습니다.",
  dressing: standardDressing(
    {
      halfWidth: FOUR_HALF,
      depth: FOUR_DEPTH,
      height: FOUR_HEIGHT,
      corridorHalfWidth: 2,
      corridorEnd: FOUR_DEPTH,
      corridorHeight: 3,
      doorwayHalfWidth: 1.75,
      doorwayHeight: 2.6,
      wallThickness: WALL,
      plateCentreZ: 8,
      plateRadius: 1.05,
      spawnZ: 1.6,
    },
    {
      seedBase: 4400,
      corridor: false,
      windows: [3.5, 8, 12.5],
      // A band, not a wall of glass: the default fills everything above the
      // shelving, which in a seven-metre room is nearly four metres of window.
      salchangHeight: 1.15,
      // The gallery is a floor, so it gets what a floor gets — cases along the
      // wall it runs against, and its own light above them. Without this the
      // upper half of the room is bare plaster and the storey the room is about
      // looks like a ledge in a warehouse.
      extraShelves: [
        {
          id: "gallery-east",
          x: FOUR_HALF,
          facing: -1,
          fromZ: 11.3,
          // Stops short of the view: the deck's own wall carries cases up to
          // the lattice and then gives way to it.
          toZ: 12.1,
          height: 2.3,
          seed: 4400 + 771,
          baseY: DECK_Y,
        },
        {
          id: "gallery-far",
          x: FOUR_HALF - 0.44,
          facing: -1,
          fromZ: 11.4,
          toZ: 11.5,
          height: 2.3,
          seed: 4400 + 772,
          baseY: DECK_Y,
          depth: 0.3,
        },
      ],
      extraSalchang: [
        {
          id: "gallery-east-band",
          x: FOUR_HALF,
          facing: -1,
          centreZ: 11.7,
          width: 2.8,
          sillY: DECK_Y + 2.54,
          height: 0.78,
          seed: 4400 + 880,
          castsBands: false,
        },
        // The one you walk up to on the gallery and look through: 01 is on the
        // other side of it. On the deck's own wall, because a window across the
        // room is a window nobody reaches — the first placement put it on the
        // west wall nine metres from the only floor you can stand on up here.
        {
          id: "gallery-view",
          x: FOUR_HALF,
          facing: -1,
          centreZ: 13.9,
          width: 3.0,
          sillY: DECK_Y + 0.5,
          height: 1.7,
          seed: 4400 + 881,
          castsBands: false,
          // No pane: there is a room behind this one, not daylight.
          open: true,
        },
      ],
      blocks: blocksOf(fourSolids).filter(
        (block) =>
          !block.id.startsWith("floor")
          && !block.id.startsWith("ceiling")
          // The long walls are the shell builder's, which cuts them into bands
          // around the openings. Drawn as solid blocks too, they board over the
          // gallery's view from behind — the same way they boarded over the
          // corridor's ten windows.
          && block.id !== "wall-east"
          && block.id !== "wall-west"
          // The rail is drawn as a balustrade rather than a slab. Its brush
          // stays exactly as authored; only the picture of it changes.
          && block.id !== "deck-rail",
      ),
      balustrades: [
        { id: "deck", x: 1.7, fromZ: 11, toZ: FOUR_DEPTH, baseY: DECK_Y, height: 1 },
      ],
      // The band he stands in, and the height you have to be at to be looking
      // down rather than across. Both authored rather than guessed: the room
      // knows which window is over its own grip.
      warmBand: { windowId: "west-8", aboveY: DECK_Y - 0.4 },
      // Lean on the rail, look left, and 01 is through the lattice: the first
      // room you ever left someone standing in, with him still on the plate.
      // The same object as a corridor window, one entry instead of ten.
      views: [{ chamberId: "second-self", windowId: "gallery-view" }],
      // Two legs: the grip on the floor, then the stair the second pass frees.
      // The upper leg is fainter — you only walk it once you have understood
      // the room, and a bright line to it would answer the room's own question.
      routes: [
        route("to-grip", [{ x: 0, z: 2.4 }, { x: 0, z: 6 }]),
        route("to-stair", [{ x: 0, z: 6 }, { x: -3.4, z: STAIR_FROM_Z }], 0.5),
      ],
    },
  ),
};

// ---------------------------------------------------------------- 05

const FIVE_HALF = 6;
const FIVE_DEPTH = 18;
const PASSAGE_FROM = 10;
const PASSAGE_TO = 14;
const PASSAGE_HALF = 1.5;

const fiveSolids: Solid[] = [
  ...shellOf(FIVE_HALF, FIVE_DEPTH, CEILING),
  // A passage with a door at each end. Not a storeroom — there is nothing to
  // fetch, and being slow means being left outside rather than shut in.
  solid("passage-west", { x: -PASSAGE_HALF - 0.3, y: 0, z: PASSAGE_FROM }, { x: -PASSAGE_HALF, y: CEILING, z: PASSAGE_TO + 0.5 }),
  solid("passage-east", { x: PASSAGE_HALF, y: 0, z: PASSAGE_FROM }, { x: PASSAGE_HALF + 0.3, y: CEILING, z: PASSAGE_TO + 0.5 }),
  solid("passage-face-left", { x: -FIVE_HALF - WALL, y: 0, z: PASSAGE_FROM }, { x: -PASSAGE_HALF - 0.3, y: CEILING, z: PASSAGE_FROM + WALL }),
  solid("passage-face-right", { x: PASSAGE_HALF + 0.3, y: 0, z: PASSAGE_FROM }, { x: FIVE_HALF + WALL, y: CEILING, z: PASSAGE_FROM + WALL }),
  solid("passage-back-left", { x: -FIVE_HALF - WALL, y: 0, z: PASSAGE_TO }, { x: -PASSAGE_HALF - 0.3, y: CEILING, z: PASSAGE_TO + 0.5 }),
  solid("passage-back-right", { x: PASSAGE_HALF + 0.3, y: 0, z: PASSAGE_TO }, { x: FIVE_HALF + WALL, y: CEILING, z: PASSAGE_TO + 0.5 }),
];

/**
 * 05 — The One Who Stood a Long Time. The first time you are sorry.
 *
 * Two plates, both his. The first opens the way into the passage and the second
 * opens the way out of it, and he cannot be on both. So the recording is mostly
 * standing still: every second he spends on the first plate is a second of your
 * own you are giving away, and the answer to being locked out is never cleverness.
 * It is to go back and stand there longer.
 */
export const LONG_STANDING: RoomDefinition = {
  id: "long-standing",
  version: 1,
  name: "오래 선 사람",
  subtitle: "The One Who Stood a Long Time",
  tapeDurationTicks: TAPE_TICKS,
  replayGraceTicks: GRACE_TICKS,
  spawn: { x: 0, y: 0, z: 1.6, yawUnits: 0 },
  brushes: brushesOf(fiveSolids),
  plates: [
    { id: "plate-a", centre: { x: -4, z: 6 }, half: { x: 0.95, z: 0.95 }, reach: 0.35, requiredActor: "past" },
    { id: "plate-b", centre: { x: 4, z: 6 }, half: { x: 0.95, z: 0.95 }, reach: 0.35, requiredActor: "past" },
  ],
  holds: [],
  doors: [
    {
      id: "way-in",
      brush: box("way-in", { x: -PASSAGE_HALF, y: 0, z: PASSAGE_FROM + 0.05 }, { x: PASSAGE_HALF, y: 2.6, z: PASSAGE_FROM + WALL - 0.05 }),
      gatedBy: { kind: "plate", id: "plate-a" },
      latchOnOpen: false,
    },
    {
      id: "way-on",
      brush: box("way-on", { x: -PASSAGE_HALF, y: 0, z: PASSAGE_TO + 0.05 }, { x: PASSAGE_HALF, y: 2.6, z: PASSAGE_TO + 0.45 }),
      gatedBy: { kind: "plate", id: "plate-b" },
      latchOnOpen: false,
    },
  ],
  exit: { id: "exit", min: { x: -FIVE_HALF, y: 0, z: 16 }, max: { x: FIVE_HALF, y: CEILING, z: FIVE_DEPTH } },
};

const fiveShell: RoomShell = {
  halfWidth: FIVE_HALF,
  depth: FIVE_DEPTH,
  height: CEILING,
  corridorHalfWidth: PASSAGE_HALF,
  corridorEnd: FIVE_DEPTH,
  corridorHeight: 2.6,
  doorwayHalfWidth: PASSAGE_HALF,
  doorwayHeight: 2.6,
  wallThickness: WALL,
  plateCentreZ: 6,
  plateRadius: 1.05,
  spawnZ: 1.6,
};

export const LONG_STANDING_CHAMBER: Chamber = {
  sim: LONG_STANDING,
  shell: fiveShell,
  number: "05",
  subtitleOnEntry: "기록을 서두르지 마십시오. 그가 서 있는 만큼만, 문은 열려 있습니다.",
  dressing: standardDressing(fiveShell, {
    seedBase: 5500,
    corridor: false,
    windows: [3, 7.5, 16],
    blocks: blocksOf(fiveSolids).filter((block) => !block.id.startsWith("floor") && !block.id.startsWith("ceiling")),
    // Both plates are worn the same amount, because the room is the same walk
    // twice and neither leg is the clever one.
    routes: [
      route("to-west-plate", [{ x: 0, z: 2.4 }, { x: -4, z: 6 }], 0.7, "past"),
      route("to-east-plate", [{ x: 0, z: 2.4 }, { x: 4, z: 6 }], 0.7, "past"),
      route("through", [{ x: 0, z: 2.4 }, { x: 0, z: PASSAGE_TO + 1.6 }]),
    ],
  }),
};

// ---------------------------------------------------------------- 06

const SIX_HALF = 6;
const SIX_DEPTH = 34;
const SIX_PARTITION_Z = 29;
const SIX_SLOT_TO = 32.6;

const sixSolids: Solid[] = [
  ...shellOf(SIX_HALF, SIX_DEPTH, CEILING),
  ...partition(SIX_PARTITION_Z, 1.2, 3, CEILING),
  ...deadEnd(SIX_PARTITION_Z + WALL, SIX_SLOT_TO, 1.2, CEILING),
];

/**
 * 06 — The Hand That Gives Back. 03's parts, and nothing new at all.
 *
 * The same recording, the same doorway, the same dead end. What changes is who
 * is standing on the plate: this time it is you, for six seconds, with nothing
 * to do but watch the length of the hall while he walks it. You only find out
 * what that place was like to stand in by standing in it.
 *
 * The hall is long on purpose. The six seconds are the room.
 */
export const GIVING_BACK: RoomDefinition = {
  id: "giving-back",
  version: 1,
  name: "돌려주는 손",
  subtitle: "The Hand That Gives Back",
  tapeDurationTicks: TAPE_TICKS,
  replayGraceTicks: GRACE_TICKS,
  spawn: { x: 0, y: 0, z: 1.6, yawUnits: 0 },
  brushes: brushesOf(sixSolids),
  plates: [
    // Close to the door, so the wait starts early and lasts.
    { id: "amber-plate", centre: { x: 3, z: 4 }, half: { x: 0.95, z: 0.95 }, reach: 0.35, requiredActor: "present" },
    {
      id: "slot-plate",
      centre: { x: 0, z: (SIX_PARTITION_Z + WALL + SIX_SLOT_TO) / 2 },
      half: { x: 1.2, z: (SIX_SLOT_TO - SIX_PARTITION_Z - WALL) / 2 },
      reach: 0.35,
      requiredActor: "past",
    },
  ],
  holds: [],
  doors: [
    {
      id: "slot-door",
      brush: box("slot-door", { x: -1.2, y: 0, z: SIX_PARTITION_Z + 0.05 }, { x: 1.2, y: 2.6, z: SIX_PARTITION_Z + WALL - 0.05 }),
      gatedBy: { kind: "plate", id: "amber-plate" },
      latchOnOpen: false,
    },
  ],
  exitGatedBy: { kind: "plate", id: "slot-plate" },
  exit: { id: "exit", min: { x: 3.4, y: 0, z: 32.8 }, max: { x: SIX_HALF, y: CEILING, z: SIX_DEPTH } },
};

const sixShell: RoomShell = {
  halfWidth: SIX_HALF,
  depth: SIX_DEPTH,
  height: CEILING,
  corridorHalfWidth: 1.2,
  corridorEnd: SIX_DEPTH,
  corridorHeight: 2.6,
  doorwayHalfWidth: 1.2,
  doorwayHeight: 2.6,
  wallThickness: WALL,
  plateCentreZ: 4,
  plateRadius: 1.05,
  spawnZ: 1.6,
};

export const GIVING_BACK_CHAMBER: Chamber = {
  sim: GIVING_BACK,
  shell: sixShell,
  number: "06",
  subtitleOnEntry: "그 편이 빠릅니다.",
  dressing: standardDressing(sixShell, {
    seedBase: 6600,
    corridor: false,
    windows: [4, 10, 16, 22, 27],
    blocks: blocksOf(sixSolids).filter((block) => !block.id.startsWith("floor") && !block.id.startsWith("ceiling")),
    // Thirty-four metres of identical shelving. Without a line on the floor the
    // far end is not a destination, it is just where the room stops being
    // visible — and the whole room is the walk to it and back.
    routes: [
      route("the-long-walk", [{ x: 0, z: 2.4 }, { x: 0, z: SIX_PARTITION_Z - 1.4 }], 1, "past"),
      route("to-plate", [{ x: 0, z: 2.4 }, { x: 3, z: 4 }], 0.55),
      // Around the east wing, not through the doorway. The partition only spans
      // the middle of the hall, and the way out is past the end of it — which
      // is the fact the room is built on and the one you cannot see from here.
      route("around", [
        { x: 0, z: SIX_PARTITION_Z - 1.4 },
        { x: 4.2, z: SIX_PARTITION_Z - 1.4 },
        { x: 4.2, z: SIX_DEPTH - 1 },
      ], 0.5),
    ],
  }),
};

// ---------------------------------------------------------------- 07

const SEVEN_HALF = 6;
const SEVEN_DEPTH = 18;
const SEVEN_PARTITION_Z = 9;
const SEVEN_SLOT_TO = 13.6;

const sevenSolids: Solid[] = [
  ...shellOf(SEVEN_HALF, SEVEN_DEPTH, CEILING),
  ...partition(SEVEN_PARTITION_Z, 1.2, 3, CEILING),
  ...deadEnd(SEVEN_PARTITION_Z + WALL, SEVEN_SLOT_TO, 1.2, CEILING),
];

/**
 * 07 — The Stacks Nobody Keeps. The turn, built from nothing new.
 *
 * The shelving leans, the paper is torn, the windows are wrong. The tail that
 * causes accidents everywhere else — walking forward and gripping at the same
 * time — is the only thing that works here, because the grip is at the end of a
 * straight slot and he has to still be walking when he arrives.
 *
 * The pillar sits in the end wall rather than short of it. He stops a body's
 * radius from that wall, and a grip behind where he stops is a grip outside his
 * gaze, which he would walk up to and never take.
 */
export const UNKEPT: RoomDefinition = {
  id: "unkept",
  version: 1,
  name: "관리 밖의 서고",
  subtitle: "The Stacks Nobody Keeps",
  tapeDurationTicks: TAPE_TICKS,
  replayGraceTicks: GRACE_TICKS,
  spawn: { x: 0, y: 0, z: 1.6, yawUnits: 0 },
  brushes: brushesOf(sevenSolids),
  plates: [
    { id: "amber-plate", centre: { x: 3.6, z: 5 }, half: { x: 0.95, z: 0.95 }, reach: 0.35, requiredActor: "present" },
  ],
  holds: [{ id: "slot-grip", at: { x: 0, y: 1.15, z: SEVEN_SLOT_TO - 0.1 }, releaseRadius: 2.6, requiredActor: "past" }],
  doors: [
    {
      id: "slot-door",
      brush: box("slot-door", { x: -1.2, y: 0, z: SEVEN_PARTITION_Z + 0.05 }, { x: 1.2, y: 2.6, z: SEVEN_PARTITION_Z + WALL - 0.05 }),
      gatedBy: { kind: "plate", id: "amber-plate" },
      latchOnOpen: false,
    },
  ],
  exitGatedBy: { kind: "hold", id: "slot-grip" },
  exit: { id: "exit", min: { x: 3.4, y: 0, z: 15.4 }, max: { x: SEVEN_HALF, y: CEILING, z: SEVEN_DEPTH } },
};

const sevenShell: RoomShell = {
  halfWidth: SEVEN_HALF,
  depth: SEVEN_DEPTH,
  height: CEILING,
  corridorHalfWidth: 1.2,
  corridorEnd: SEVEN_DEPTH,
  corridorHeight: 2.6,
  doorwayHalfWidth: 1.2,
  doorwayHeight: 2.6,
  wallThickness: WALL,
  plateCentreZ: 5,
  plateRadius: 1.05,
  spawnZ: 1.6,
};

export const UNKEPT_CHAMBER: Chamber = {
  sim: UNKEPT,
  shell: sevenShell,
  number: "07",
  subtitleOnEntry: "이 구역은 관리 대상에서 제외되었습니다. …그는 아무것도 묻지 않는군요.",
  dressing: standardDressing(sevenShell, {
    seedBase: 7700,
    corridor: false,
    // Wrong on purpose: the spacing nobody maintained.
    windows: [2.2, 5.1, 6.4, 12.9],
    tiltRadians: 0.06,
    // Nearly a fifth of the shelf is gone, and some of it is on the floor.
    decay: 0.18,
    blocks: blocksOf(sevenSolids).filter((block) => !block.id.startsWith("floor") && !block.id.startsWith("ceiling")),
    // Barely there. This is the wing that was taken off the maintenance roster,
    // and the brass went unpolished with everything else — you can follow it,
    // but you have to want to.
    routes: [
      route("to-plate", [{ x: 0, z: 2.4 }, { x: 3.6, z: 5 }], 0.3),
      route("to-slot", [{ x: 0, z: 2.4 }, { x: 0, z: SEVEN_SLOT_TO - 1.2 }], 0.24, "past"),
    ],
  }),
};
