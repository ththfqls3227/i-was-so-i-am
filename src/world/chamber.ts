import type { RoomDefinition } from "../sim/types";

/**
 * The dimensions the renderer dresses. Deliberately separate from
 * `RoomDefinition`: the simulation collides with brushes and knows nothing about
 * where a shelf wall or a light band goes, and keeping the two apart is what
 * stops render data drifting into the checksum.
 *
 * Every number here also appears in the room's brushes. They are authored
 * together in one file per chamber so the wall you walk into and the wall you
 * see are the same wall.
 */
export interface RoomShell {
  halfWidth: number;
  depth: number;
  height: number;
  corridorHalfWidth: number;
  corridorEnd: number;
  corridorHeight: number;
  doorwayHalfWidth: number;
  doorwayHeight: number;
  wallThickness: number;
  plateCentreZ: number;
  plateRadius: number;
  spawnZ: number;
}

/**
 * A run of memory-box shelving along one wall.
 *
 * `tiltRadians` leans the whole run about its own centre. It exists because 07
 * is the chamber where the archive stops being maintained, and a leaning shelf
 * has to be one rotation on one node — which is only possible because the boxes
 * are placed in coordinates local to the run rather than to the world.
 */
export interface ShelfRunSpec {
  id: string;
  /** The wall plane this run stands against. */
  x: number;
  /** Which way the boxes face: +1 for a wall on the left, -1 on the right. */
  facing: 1 | -1;
  fromZ: number;
  toZ: number;
  height: number;
  /** Drives the per-box jitter. Same seed, same wall, every time. */
  seed: number;
  depth?: number;
  tiltRadians?: number;
  /** Which floor the run stands on. Ground unless a room has a gallery. */
  baseY?: number;
  /** Fraction of cases missing. Only 07, the room nobody keeps. */
  decay?: number;
}

/**
 * A slatted window. The sun side casts the floor bands, and each window owns its
 * bands — 04 warms the one band its echo is standing in, which is impossible
 * while every band on every wall shares one material.
 */
export interface SalchangSpec {
  id: string;
  x: number;
  facing: 1 | -1;
  centreZ: number;
  width: number;
  sillY: number;
  height: number;
  /** Shared by the lattice and the bands it throws, so both jitter together. */
  seed: number;
  /** Only the sun side throws bands onto the floor. */
  castsBands: boolean;
  /** Lattice with no pane, for a window that has a room behind it. */
  open?: boolean;
  /**
   * Bar spacing. Light windows want a fine pitch; a window you look at a
   * person through wants a coarse one, or the body arrives in slices.
   */
  slatPitch?: number;
}

/**
 * A piece of the room's own structure that is not one of the four hall walls:
 * a partition across the floor, the lining of a dead end. Authored beside the
 * brush it stands in, from the same constants, so the wall you walk into and
 * the wall you see cannot drift apart.
 */
export interface DressBlockSpec {
  id: string;
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  /** Timber reads as built-in joinery; plaster as part of the shell. */
  finish: "timber" | "plaster";
}

/** Everything the renderer needs that the simulation has no opinion about. */
export interface ChamberDressing {
  shelves: ShelfRunSpec[];
  salchang: SalchangSpec[];
  /** Structure beyond the shell: partitions, alcove linings. */
  blocks: DressBlockSpec[];
  /**
   * Whether the way out is down a corridor past the far wall. 03 leaves through
   * a doorway in its own east wall, and drawing it a corridor it does not have
   * puts a walkable-looking passage behind a solid wall.
   */
  corridor: boolean;
  /**
   * The colour the fold stamps its seal in. Red everywhere; cyan in the finale,
   * where what is being sealed is not the record.
   */
  sealColour: "red" | "cyan";
  /**
   * The one memory box left standing open. 02 authors it and 09 inherits the
   * same coordinates, so the anchor lands in the same place without either room
   * having to remember a number the other one chose.
   */
  openBox: { x: number; y: number; z: number } | null;
  /**
   * Where the hyeonpan hangs, when the far wall is the wrong place for it.
   *
   * Every room so far has put its name board on the far wall beside the way
   * out, which works while the far wall is what you see from the door. 03 has a
   * partition across the middle, so the board ended up behind it on the side
   * the player has no reason to walk to — the room's own name was unreachable.
   * Null keeps the far-wall default.
   */
  sign: { x: number; z: number } | null;
  /**
   * Open timber railings. A gallery edge authored as a solid brush is a metre
   * of blank parapet in the one frame the room exists for — you lean on it to
   * look down at him, and a slab is exactly what you cannot see over.
   */
  balustrades: BalustradeSpec[];
  /**
   * The sync beat: the window band he is standing in warms for a moment, once,
   * the first time you look down on him from above. Render-only and latched —
   * it says thank you without a subtitle, and saying it twice would make it a
   * mechanic.
   */
  warmBand: { windowId: string; aboveY: number } | null;
  /**
   * Build the sets behind the corridor's west windows. What stands in them is
   * not dressing data — it is what the player left in each room, resolved from
   * the archive at build time — so the flag says only that this chamber is the
   * one with windows worth looking through.
   */
  dioramas: boolean;
  /**
   * Windows that look into another room rather than out of this one.
   *
   * The corridor's ten are resolved from its own roster; these are one-offs a
   * room asks for by name — 04's gallery looks through at 01, the first room
   * you ever left someone standing in.
   */
  views: { chamberId: string; windowId: string }[];
  /**
   * Paper with holes in it. Only 07, where the door you are shut out by is one
   * nobody has repaired — and where the room wants you to see through the gap
   * while it closes.
   */
  tornPaper: boolean;
  /**
   * Brass inlay worn into the floor. Empty in the early rooms, which are one
   * space with one thing in it and need no help being read.
   */
  routes: RouteSpec[];
}

/** A run of turned balusters between a bottom and a top rail, along z. */
export interface BalustradeSpec {
  id: string;
  x: number;
  fromZ: number;
  toZ: number;
  baseY: number;
  height: number;
  /**
   * A stretch with no balusters, for a rail that stands in the one sightline
   * the room exists for. The rails still run across it and the brush behind is
   * untouched — you can lean on it, you just can no longer be looked at
   * through a picket fence.
   */
  openFromZ?: number;
  openToZ?: number;
}

/**
 * A worn line in the floor, from somewhere to somewhere.
 *
 * The rooms with two things to do in them read as one undifferentiated hall
 * from the door — 05 and 06 in particular, where the thing you must reach is
 * around a corner you cannot see. A brass strip set into the boards, rubbed
 * bright by everyone who walked it before you, points without saying anything.
 * It is inlay, not signage: no arrows, no glow, nothing that turns on.
 */
export interface RouteSpec {
  id: string;
  /** Floor points in order. Two is a straight run; more is a route with a turn. */
  points: { x: number; z: number }[];
  /**
   * Faint enough to miss. The second route in a room is fainter than the first,
   * because it is the leg you walk once you already know the room.
   */
  wear: number;
  /**
   * Whose leg this is. The echo's routes are the straight ones he is recorded
   * walking; everything else is yours. Defaults to yours, because most of the
   * wear in a room is.
   */
  actor?: "past" | "present";
  /**
   * Joins the bloom, the way the shell rooms' own route lines do. Off by
   * default: worn lines are memory, not signage. 03's plate line is the one
   * exception — it is the leg the whole replay hangs on, it runs through the
   * room's darkest corner, and two rounds of judges never found it matte.
   */
  glows?: boolean;
}

/** One chamber: what the simulation runs, what the renderer builds, what the sign says. */
export interface Chamber {
  sim: RoomDefinition;
  shell: RoomShell;
  /** The number on the entrance board — "00" through "09". */
  number: string;
  /**
   * The one line the facility says on the way in. One per chamber and no more:
   * the whole campaign has a budget of six, and a room that needs two lines to
   * be understood is a room that has not been built yet.
   */
  subtitleOnEntry: string;
  /**
   * Said each time this room's replay begins. The entry budget above stands —
   * this is 00's one exception, because three rounds of judges learned the
   * loop's causality (echo reaches plate → door opens → you leave) only from
   * failure cards, after the failing.
   */
  subtitleOnReplay?: string;
  /**
   * Said once per replay when the echo is walking at this room's first door
   * while it is still shut. 03 sets it: a judge watched the echo tread against
   * the closed partition, read it as a desync bug, and quit — when it is the
   * room's whole idea, one sentence short of being understood.
   */
  echoAtDoorLine?: string;
  /**
   * This room's plate is the second pass's job: during recording, standing on
   * it achieves nothing the tape can keep. The HUD's plate coaching follows a
   * room's shape — in 03 "walk to the plate" steered a judge onto it with the
   * recording running, which is exactly the move the room is built to refuse.
   */
  plateDutyInReplay?: boolean;
  /**
   * Said once per room visit, the first time the named grip is taken by the
   * named actor in the named phase. 04 sets both of its lines: the grab there
   * opens a door behind and above the player, so a grab that worked is
   * indistinguishable from one that did nothing until somebody says which.
   */
  gripCues?: readonly {
    holdId: string;
    phase: "recording" | "replay";
    holder: "present" | "past";
    line: string;
  }[];
  /**
   * Said once per room visit, a beat after the player first stands above this
   * height during replay. The beat is load-bearing: 04's warm band fires the
   * moment you arrive upstairs and works by not being explained — a caption
   * landing on top of it would turn the room's one answer into UI.
   */
  upstairsCue?: { aboveY: number; line: string };
  /**
   * What the replay chip says in this room instead of the generic "wait for
   * the door", split at a position. 04 splits on height (below the deck you
   * climb while he holds; above it you take the second grip yourself) and 05
   * splits on depth (outside the passage you dive in while his standing holds
   * the door; inside it you wait for his second stand). Both registers steer.
   */
  replayWait?: { axis: "y" | "z"; at: number; before: string; after: string };
  /**
   * Recording-phase coaching for a room whose tape is a schedule of standing.
   * 05 is why: both plates only answer the echo, so the recording pass has
   * nothing to press and nothing to see — the one thing being made is time,
   * and no generic plate copy can say whose time or where to spend it.
   */
  recordingScript?: { toFirst: string; onFirst: string; toSecond: string; onSecond: string };
  /**
   * One standing line for the whole recording pass. 07 is why: its answer is
   * the tape's tail — fold while still walking with E held, so the last frame
   * keeps him walking down the opened slot — and no generic copy can teach a
   * move whose whole point is that stopping to think records the stop.
   */
  recordingCue?: string;
  /**
   * The echo's own light, and a window on it. A cyan shaft marks the spot his
   * replay ends at, and during the second pass a small observer view frames
   * it. 03, 06 and 07 send him behind a partition — the room's payoff happens
   * off screen, and an owner playtest read the far warm light as the player's
   * own and went hunting for it.
   */
  echoDestination?: {
    at: { x: number; z: number };
    camera: { at: { x: number; y: number; z: number }; lookAt: { x: number; y: number; z: number } };
  };
  /**
   * Multiplier on the room's fill light — hemispheric sky and scene ambient.
   * 04 sets it: a two-storey room on a one-storey room's fill reads as a
   * basement upstairs. The key light is never lifted with it, because the sun
   * is what draws the slat bands and brightening it changes the drawing.
   */
  lightLift?: number;
  /**
   * Whether the interface talks the player through the move, or only names the
   * goal and lets them find it.
   *
   * True everywhere by default, and that is right for the teaching rooms: they
   * exist to make a rule legible, and a rule you had to guess is a rule you are
   * not sure you learned. The back half sets it false. Those rooms had the same
   * running commentary, which meant the game explained its own answer in every
   * chamber and never once asked a question — five hours of tutorial with no
   * game after it.
   *
   * Uncoached does not mean silent. The room still says what counts as solved,
   * the colours still say whose a thing is, and the hint ladder still hands
   * over the method once someone has spent real tries on it.
   */
  coached?: boolean;
  /**
   * Seconds the fold is held before it takes, with everything frozen.
   *
   * Only the finale sets it. You watch your own hand stop being yours before
   * the seal lands, and the recording is unchanged by the wait — the tail is the
   * last sampled frame, so holding the same posture longer holds the same
   * posture.
   */
  sealHoldSeconds?: number;
  /**
   * Somebody from an earlier room, standing here, not replaying.
   *
   * Only 08 has one. He is the record you left in 01, and the room says nothing
   * about him — the plate under him is already down when you arrive, and the
   * only way to open the door is to go and stand on the other one.
   *
   * The place is the room's, not the tape's: 01's plate is not where 08's plate
   * is, so the coordinates cannot simply carry over. What the tape supplies is
   * the posture, which is the part that means something — he is standing, and
   * he is standing because that is how you left him.
   */
  archivalFigure?: {
    /** Whose recording this is. Falls back to that room's golden, silently. */
    fromChamberId: string;
    at: { x: number; z: number };
  };
  /**
   * What pressing rerecord says here. Everywhere else it warns that the current
   * record will be taken back; in the finale it says the opposite, and means it.
   */
  rerecordNotice?: string;
  /**
   * What to add to the failure card once someone has failed the same way
   * several times over.
   *
   * Nothing is offered on the first two attempts: failing twice is how the
   * rooms are learned, and a game that explains itself the moment you are
   * wrong has taken the room away from you. By the third identical failure the
   * player is not learning any more, and by the fifth they are about to leave.
   *
   * `after` is the failure count this line starts appearing at. Rooms with no
   * approved line for this simply say nothing, which is the honest default.
   */
  hints?: readonly { after: number; line: string }[];
  /**
   * The last door, and what the fold key does at it.
   *
   * Only the corridor has one. Every recording you have ever made ended with
   * this key, and the game ends with it too — not with a menu, and not with the
   * room simply stopping. The corridor takes no recording, so nothing in the
   * simulation changes: this is a flow hook, and the sim never hears about it.
   */
  finalBeat?: { prompt: string };
  /**
   * The three lines at the end of the corridor, and where you have to be
   * standing to hear the first.
   *
   * Not subtitleOnEntry: said on the way in they land forty seconds before the
   * thing they are about, over a player who is still walking. They belong at
   * the last window, which is 00 — the first tape you ever made, still running.
   */
  finalApproach?: { atZ: number; lines: string[] };
  dressing: ChamberDressing;
}

/**
 * The roster, in the order they are played. The registry exists so the scene can
 * be handed a chamber rather than importing one, which is the whole reason a
 * second room is now possible.
 */
export class ChamberRegistry {
  private readonly byId = new Map<string, Chamber>();

  constructor(private readonly order: Chamber[]) {
    for (const chamber of order) {
      if (this.byId.has(chamber.sim.id)) {
        throw new Error(`Two chambers claim the id ${chamber.sim.id}`);
      }
      this.byId.set(chamber.sim.id, chamber);
    }
  }

  get all(): readonly Chamber[] {
    return this.order;
  }

  get first(): Chamber {
    const first = this.order[0];
    if (!first) throw new Error("The chamber roster is empty");
    return first;
  }

  byIdOrNull(id: string): Chamber | null {
    return this.byId.get(id) ?? null;
  }

  /** The next chamber in play order, or null at the end of the roster. */
  after(id: string): Chamber | null {
    const index = this.order.findIndex((chamber) => chamber.sim.id === id);
    if (index < 0) return null;
    return this.order[index + 1] ?? null;
  }
}
