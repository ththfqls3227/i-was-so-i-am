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
}

/** A run of turned balusters between a bottom and a top rail, along z. */
export interface BalustradeSpec {
  id: string;
  x: number;
  fromZ: number;
  toZ: number;
  baseY: number;
  height: number;
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
