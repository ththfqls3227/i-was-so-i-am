import { describe, expect, it } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { PLAYER_RADIUS, STEP_HEIGHT } from "../src/sim/constants";
import { solidsFor } from "../src/sim/mechanisms";
import type { Brush, RoomDefinition } from "../src/sim/types";
import type { Chamber } from "../src/world/chamber";
import { TapeArchive } from "../src/sim/archive";
import { resolveDioramas } from "../src/world/dioramas";
import { DIORAMAS, ENDING_CORRIDOR } from "../src/world/ending";
import { GOLDEN_RECORDINGS, goldenTape } from "../src/world/goldens";
import { ROSTER } from "../src/world/roster";
import { drive, framesFor } from "./support/fp-drive";

/** Standing here would put the player inside something solid. */
function blocked(point: { x: number; z: number }, solids: readonly Brush[]): Brush | null {
  const feetY = STEP_HEIGHT + 0.01;
  for (const brush of solids) {
    const overlapsFloorPlan =
      point.x + PLAYER_RADIUS > brush.min.x
      && point.x - PLAYER_RADIUS < brush.max.x
      && point.z + PLAYER_RADIUS > brush.min.z
      && point.z - PLAYER_RADIUS < brush.max.z;
    if (overlapsFloorPlan && brush.max.y > feetY && brush.min.y <= feetY) return brush;
  }
  return null;
}

/**
 * Every point along the route, a hand's width apart.
 *
 * Testing only the corners would pass a line that runs from one legal end of a
 * partition to the other straight through the middle of it.
 */
function walk(points: readonly { x: number; z: number }[]): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let leg = 0; leg < points.length - 1; leg += 1) {
    const from = points[leg] as { x: number; z: number };
    const to = points[leg + 1] as { x: number; z: number };
    const span = Math.hypot(to.x - from.x, to.z - from.z);
    const steps = Math.max(1, Math.ceil(span / 0.2));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      out.push({ x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t });
    }
  }
  return out;
}

/**
 * The room with every door open — which is to say, only what is permanently
 * solid. A line through a doorway is exactly right: that is where the wear
 * came from. A line through a wall is the bug this is looking for.
 */
function permanentSolids(room: RoomDefinition): Brush[] {
  return solidsFor(room, room.doors.map((door) => ({ id: door.id, open: true, latched: false, heldTicks: 0 })));
}

describe("the ending corridor", () => {
  it("asks for nothing and cannot be failed", () => {
    const simulation = new Simulation(ENDING_CORRIDOR);
    expect(simulation.recordingEnabled).toBe(false);
    expect(simulation.canFold).toBe(false);
    expect(ENDING_CORRIDOR.plates).toEqual([]);
    expect(ENDING_CORRIDOR.holds).toEqual([]);
    expect(ENDING_CORRIDOR.doors).toEqual([]);
    drive(simulation, framesFor([{ ticks: 600 }]));
    expect(simulation.state.phase).toBe("replay");
    expect(simulation.state.lastError).toBeNull();
  });

  it("can be walked from the door to the end of it", () => {
    const simulation = new Simulation(ENDING_CORRIDOR);
    drive(simulation, framesFor([{ forward: true, ticks: 700 }]));
    expect(simulation.state.phase).toBe("success");
  });

  it("has nothing after it", () => {
    expect(ROSTER.after(ENDING_CORRIDOR.id)).toBeNull();
  });

  it("ends on the fold key, and it is the only room that does", () => {
    // The last door. Every recording ended with this key and so does the game,
    // which only works because nothing else in the corridor answers to it.
    const withBeats = ROSTER.all.filter((chamber) => chamber.finalBeat).map((chamber) => chamber.sim.id);
    expect(withBeats).toEqual(["ending-corridor"]);
    const beat = ROSTER.byIdOrNull(ENDING_CORRIDOR.id)?.finalBeat;
    expect(beat?.prompt.length).toBeGreaterThan(0);
    // The corridor's closing lines live on finalApproach, said at the last
    // window rather than handed to the ending card — the card is typography.
    const approach = ROSTER.byIdOrNull(ENDING_CORRIDOR.id)?.finalApproach;
    expect(approach?.lines).toHaveLength(3);
    expect(approach?.atZ).toBeGreaterThan(0);
    // And the simulation never hears about it: this is flow, not a recording.
    expect(new Simulation(ENDING_CORRIDOR).canFold).toBe(false);
  });

  it("gives every room you walked a window, in the order you leave them behind", () => {
    const played = ROSTER.all
      .filter((chamber: Chamber) => chamber.sim.id !== ENDING_CORRIDOR.id)
      .map((chamber: Chamber) => chamber.sim.id);
    expect(DIORAMAS.map((diorama) => diorama.chamberId)).toEqual([...played].reverse());
  });

  it("names a window that the corridor actually has", () => {
    const corridor = ROSTER.byIdOrNull(ENDING_CORRIDOR.id);
    const lattices = new Set((corridor?.dressing.salchang ?? []).map((pane) => pane.id));
    for (const diorama of DIORAMAS) {
      expect({ id: diorama.chamberId, has: lattices.has(diorama.windowId) })
        .toEqual({ id: diorama.chamberId, has: true });
    }
  });

  it("leaves exactly one window empty, and it is 08's", () => {
    // The room that took no recording is the room with nobody left in it. If a
    // later edit fills this in, the corridor stops saying the one thing it says.
    expect(DIORAMAS.filter((diorama) => diorama.empty).map((diorama) => diorama.chamberId)).toEqual(["silence"]);
  });

  it("leaves exactly one window still moving, and it is the first room", () => {
    expect(DIORAMAS.filter((diorama) => diorama.loop).map((diorama) => diorama.chamberId)).toEqual(["awakening"]);
    // And it is the last one you pass before the way out.
    expect(DIORAMAS[DIORAMAS.length - 1]?.chamberId).toBe("awakening");
  });

  it("spaces the windows so no two share a lattice", () => {
    const centres = DIORAMAS.map((diorama) => diorama.centreZ);
    expect(new Set(centres).size).toBe(centres.length);
    expect(Math.max(...centres)).toBeLessThan(ENDING_CORRIDOR.exit.min.z);
  });
});

describe("the worn lines in the floor", () => {
  it("never draws a route through a wall", () => {
    // Inlay is set into the boards. A point inside a partition is a line that
    // walks through it, which is worse than no line at all.
    for (const chamber of ROSTER.all) {
      const solids = permanentSolids(chamber.sim);
      for (const path of chamber.dressing.routes) {
        for (const point of walk(path.points)) {
          const hit = blocked(point, solids);
          expect({ room: chamber.sim.id, route: path.id, hit: hit?.id ?? null })
            .toEqual({ room: chamber.sim.id, route: path.id, hit: null });
        }
      }
    }
  });

  it("gives a route to every room whose way on is not straight ahead", () => {
    // 00 to 02 are one space with one thing in it. Everything from 03 has either
    // a partition, a second storey or thirty metres of identical shelving.
    const withRoutes = ROSTER.all.filter((chamber) => chamber.dressing.routes.length > 0).map((c) => c.sim.id);
    expect(withRoutes).toEqual([
      "hand-not-body",
      "two-of-us",
      "long-standing",
      "giving-back",
      "unkept",
    ]);
  });

  it("keeps every line faint, and every id its room's own", () => {
    for (const chamber of ROSTER.all) {
      const ids = chamber.dressing.routes.map((path) => path.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const path of chamber.dressing.routes) {
        expect(path.points.length).toBeGreaterThanOrEqual(2);
        expect(path.wear).toBeGreaterThan(0);
        expect(path.wear).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("the recordings the game ships with", () => {
  it("has one for every room that takes a recording, and none for the rooms that do not", () => {
    const recording = ROSTER.all
      .filter((chamber) => chamber.sim.recordingDisabled !== true)
      .map((chamber) => chamber.sim.id);
    expect(Object.keys(GOLDEN_RECORDINGS).sort()).toEqual([...recording].sort());
  });

  it("folds each one into a tape its own room accepts", () => {
    // Built by playing the room, so a recording that stopped solving its room
    // is a recording that fails to build rather than one that quietly rots.
    for (const chamber of ROSTER.all) {
      if (chamber.sim.recordingDisabled === true) continue;
      const tape = goldenTape(chamber.sim);
      expect({ room: chamber.sim.id, folded: tape !== null }).toEqual({ room: chamber.sim.id, folded: true });
      expect(tape?.roomId).toBe(chamber.sim.id);
      expect(tape?.duration).toBe(chamber.sim.tapeDurationTicks);
    }
  });
});

describe("what stands behind each window", () => {
  it("puts somebody in every window but 08's, having played nothing", () => {
    // The corridor is reachable without having played a single room. Every
    // window still has to have someone in it.
    const resolved = resolveDioramas(new TapeArchive());
    const empty = resolved.filter((diorama) => diorama.pose === null).map((diorama) => diorama.spec.chamberId);
    expect(empty).toEqual(["silence"]);
  });

  it("prefers the player's own recording, and does not say that it did", () => {
    const archive = new TapeArchive();
    const room = ROSTER.byIdOrNull("second-self")?.sim;
    expect(room).toBeDefined();
    if (!room) return;

    // A recording that ends somewhere the golden does not.
    const simulation = new Simulation(room);
    drive(simulation, framesFor([{ forward: true, ticks: 20 }, { ticks: 30 }]));
    simulation.fold();
    archive.keep(simulation.currentTape);

    const mine = resolveDioramas(archive).find((diorama) => diorama.spec.chamberId === "second-self");
    const theirs = resolveDioramas(new TapeArchive()).find((diorama) => diorama.spec.chamberId === "second-self");
    expect(mine?.isPlayers).toBe(true);
    expect(theirs?.isPlayers).toBe(false);
    expect(mine?.pose?.z).not.toBeCloseTo(theirs?.pose?.z ?? 0, 1);
    // Same shape either way. Nothing downstream can tell them apart by looking.
    expect(Object.keys(mine ?? {}).sort()).toEqual(Object.keys(theirs ?? {}).sort());
  });

  it("leaves only the first room still walking", () => {
    const resolved = resolveDioramas(new TapeArchive());
    const moving = resolved.filter((diorama) => diorama.loop.length > 0).map((diorama) => diorama.spec.chamberId);
    expect(moving).toEqual(["awakening"]);
    const awakening = resolved.find((diorama) => diorama.spec.chamberId === "awakening");
    expect(awakening?.loop.length).toBe(awakening?.room?.tapeDurationTicks);
  });

  it("stands each of them still, in the posture the fold froze", () => {
    for (const diorama of resolveDioramas(new TapeArchive())) {
      if (!diorama.pose || !diorama.room) continue;
      // On the floor of its own room, not falling and not out of bounds.
      expect(diorama.pose.y).toBeGreaterThanOrEqual(0);
      expect(Math.abs(diorama.pose.x)).toBeLessThan(20);
      expect(diorama.pose.z).toBeGreaterThan(0);
      expect(diorama.pose.z).toBeLessThan(40);
    }
  });
});
