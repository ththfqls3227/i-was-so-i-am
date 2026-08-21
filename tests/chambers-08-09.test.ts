import { describe, expect, it } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { TapeArchive, finalPose, replayPath } from "../src/sim/archive";
import { MIN_TAPE_TICKS } from "../src/sim/constants";
import { createTape } from "../src/sim/tape";
import { HOLDING_HAND, SECOND_SELF } from "../src/world/chambers";
import { LAST_HOLD, SILENCE } from "../src/world/chambers-08-09";
import { ROSTER } from "../src/world/roster";
import { GOLDEN_RECORDINGS } from "../src/world/goldens";
import { actorOf, doorOpen, drive, framesFor } from "./support/fp-drive";

const holdActive = (simulation: Simulation, id = "grip-pillar"): boolean =>
  simulation.state.holds.find((hold) => hold.id === id)?.active ?? false;

/** The recording 02 and 09 both ask for: walk to the grip, take it, end there. */
const HOLD_THE_GRIP = [...(GOLDEN_RECORDINGS["last-hold"] ?? [])];

describe("08 — silence", () => {
  it("takes no recording and offers no key that would do nothing", () => {
    const simulation = new Simulation(SILENCE);
    expect(simulation.recordingEnabled).toBe(false);
    expect(simulation.state.phase).toBe("replay");
    expect(simulation.state.actors.map((actor) => actor.id)).toEqual(["present"]);
    drive(simulation, framesFor([{ ticks: MIN_TAPE_TICKS + 40 }]));
    expect(simulation.canFold).toBe(false);
    expect(simulation.fold()).toBe(false);
  });

  it("is impossible alone and possible because he is already standing there", () => {
    const simulation = new Simulation(SILENCE);
    // His plate is down before anyone does anything.
    expect(simulation.state.plates.find((plate) => plate.id === "old-plate")?.active).toBe(true);
    expect(simulation.state.plates.find((plate) => plate.id === "your-plate")?.active).toBe(false);
    expect(doorOpen(simulation.state, "inner-door")).toBe(false);
    // And the whole room is stepping onto the other one.
    drive(simulation, framesFor([{ forward: true, right: true, ticks: 34 }, { forward: true, ticks: 16 }, { ticks: 8 }]));
    expect(simulation.state.plates.find((plate) => plate.id === "your-plate")?.active).toBe(true);
    expect(doorOpen(simulation.state, "inner-door")).toBe(true);
  });

  it("cannot be failed, because it has no clock", () => {
    const simulation = new Simulation(SILENCE);
    drive(simulation, framesFor([{ ticks: SILENCE.tapeDurationTicks + SILENCE.replayGraceTicks + 200 }]));
    expect(simulation.state.phase).toBe("replay");
    expect(simulation.state.lastError).toBeNull();
  });

  it("puts him where the plate is, from the tape you left in 01", () => {
    // 01 is solved by standing still on a plate, so the pose is the plate.
    const first = new Simulation(SECOND_SELF);
    drive(first, framesFor([{ forward: true, ticks: 38 }, { ticks: 24 }]));
    first.fold();
    const tape = first.currentTape;
    expect(tape).not.toBeNull();

    const pose = tape ? finalPose(SECOND_SELF, tape) : null;
    expect(pose).not.toBeNull();
    // Standing, not walking, and on the plate he was left on.
    expect(Math.abs((pose?.x ?? 9) - 0)).toBeLessThan(1);
    expect(pose?.y).toBeCloseTo(0, 2);
    const plateZ = SECOND_SELF.plates[0]?.centre.z ?? 0;
    expect(Math.abs((pose?.z ?? 0) - plateZ)).toBeLessThan(1.2);
  });
});

describe("the tape archive", () => {
  it("keeps what a chamber recorded and hands it back", () => {
    const archive = new TapeArchive();
    const simulation = new Simulation(SECOND_SELF);
    drive(simulation, framesFor([{ forward: true, ticks: 38 }, { ticks: 24 }]));
    simulation.fold();
    archive.keep(simulation.currentTape);
    expect(archive.has(SECOND_SELF.id)).toBe(true);
    expect(archive.tapeFor(SECOND_SELF)).toEqual(simulation.currentTape);
    expect(archive.isPlayers(SECOND_SELF)).toBe(true);
  });

  it("falls back to the golden without saying so, when the player never played it", () => {
    const archive = new TapeArchive();
    const golden = createTape(SECOND_SELF, framesFor([{ ticks: SECOND_SELF.tapeDurationTicks }]));
    expect(archive.isPlayers(SECOND_SELF)).toBe(false);
    expect(archive.tapeFor(SECOND_SELF, golden)).toEqual(golden);
  });

  it("falls back when a kept tape no longer fits the room it came from", () => {
    const archive = new TapeArchive();
    const simulation = new Simulation(SECOND_SELF);
    drive(simulation, framesFor([{ forward: true, ticks: 38 }, { ticks: 24 }]));
    simulation.fold();
    archive.keep(simulation.currentTape);
    // The room moves on; the old tape is no longer about this room.
    const reissued = { ...SECOND_SELF, version: SECOND_SELF.version + 1 };
    const golden = createTape(reissued, framesFor([{ ticks: reissued.tapeDurationTicks }]));
    expect(archive.isPlayers(reissued)).toBe(false);
    expect(archive.tapeFor(reissued, golden)).toEqual(golden);
    expect(archive.tapeFor(reissued)).toBeNull();
  });

  it("replays a path without anyone living in the room", () => {
    const simulation = new Simulation(SECOND_SELF);
    drive(simulation, framesFor([{ forward: true, ticks: 38 }, { ticks: 24 }]));
    simulation.fold();
    const tape = simulation.currentTape;
    const path = tape ? replayPath(SECOND_SELF, tape) : [];
    expect(path.length).toBe(SECOND_SELF.tapeDurationTicks);
    // He walks away from the spawn and stops.
    expect(path[0]?.z).toBeCloseTo(SECOND_SELF.spawn.z, 1);
    expect((path[path.length - 1]?.z ?? 0)).toBeGreaterThan(6);
  });
});

describe("09 — the last hold", () => {
  it("is 02's room, copied rather than reimagined", () => {
    // Same grip in the same place, same gate, same way of being opened.
    expect(LAST_HOLD.holds).toEqual(HOLDING_HAND.holds);
    expect(LAST_HOLD.doors[0]?.gatedBy).toEqual(HOLDING_HAND.doors[0]?.gatedBy);
    expect(LAST_HOLD.exitGatedBy).toEqual(HOLDING_HAND.exitGatedBy);
    expect(LAST_HOLD.spawn.x).toBe(HOLDING_HAND.spawn.x);
    expect(LAST_HOLD.spawn.z).toBe(HOLDING_HAND.spawn.z);
    // The walk to the grip is identical; only the walk away from it grew.
    expect(LAST_HOLD.exit.min.z).toBeGreaterThan(HOLDING_HAND.exit.min.z + 8);
  });

  it("does not latch, and is the only room he is never taken back from", () => {
    // Non-latching doors are common — five earlier rooms hold a door open with
    // him too. What no other room does is refuse to end the second pass: the
    // window expires everywhere else and he goes with it.
    expect(LAST_HOLD.doors.every((door) => door.latchOnOpen === false)).toBe(true);
    const persists = ROSTER.all.filter((chamber) => chamber.sim.echoPersists).map((chamber) => chamber.sim.id);
    expect(persists).toEqual(["last-hold"]);
  });

  it("can be finished, and the gauge runs out before you get there", () => {
    const simulation = new Simulation(LAST_HOLD);
    drive(simulation, framesFor(HOLD_THE_GRIP));
    expect(holdActive(simulation)).toBe(true);
    expect(simulation.fold()).toBe(true);

    // Walk the whole way. The tape ends somewhere in the middle of this.
    drive(simulation, framesFor([{ ticks: 20 }, { forward: true, ticks: 320 }]));
    expect(simulation.state.phase).toBe("success");
  });

  it("keeps the door open and him holding it long after the window has expired", () => {
    const simulation = new Simulation(LAST_HOLD);
    drive(simulation, framesFor(HOLD_THE_GRIP));
    simulation.fold();
    const beyond = LAST_HOLD.tapeDurationTicks + LAST_HOLD.replayGraceTicks + 300;
    drive(simulation, framesFor([{ ticks: beyond }]));
    // Not failed, not despawned, not let go.
    expect(simulation.state.phase).toBe("replay");
    expect(holdActive(simulation)).toBe(true);
    expect(doorOpen(simulation.state, "inner-door")).toBe(true);
    expect(simulation.state.exitOpen).toBe(true);
    expect(actorOf(simulation.state, "past").targetId).toBe("grip-pillar");
  });

  it("leaves him there after you have gone", () => {
    const simulation = new Simulation(LAST_HOLD);
    drive(simulation, framesFor(HOLD_THE_GRIP));
    simulation.fold();
    drive(simulation, framesFor([{ ticks: 20 }, { forward: true, ticks: 320 }]));
    expect(simulation.state.phase).toBe("success");
    expect(simulation.state.actors.map((actor) => actor.id).sort()).toEqual(["past", "present"]);
    expect(holdActive(simulation)).toBe(true);
  });

  it("seals in cyan, and it is the only room that does", () => {
    for (const chamber of ROSTER.all) {
      const expected = chamber.sim.id === "last-hold" ? "cyan" : "red";
      expect({ id: chamber.sim.id, seal: chamber.dressing.sealColour }).toEqual({ id: chamber.sim.id, seal: expected });
    }
  });
});
