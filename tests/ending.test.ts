import { describe, expect, it } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { PLAYER_RADIUS, STEP_HEIGHT } from "../src/sim/constants";
import { solidsFor } from "../src/sim/mechanisms";
import type { Brush, RoomDefinition } from "../src/sim/types";
import type { Chamber } from "../src/world/chamber";
import { DIORAMAS, ENDING_CORRIDOR } from "../src/world/ending";
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
