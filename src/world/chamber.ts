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

/** One chamber: what the simulation runs, what the renderer builds, what the sign says. */
export interface Chamber {
  sim: RoomDefinition;
  shell: RoomShell;
  /** The number on the entrance board — "00" through "09". */
  number: string;
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
