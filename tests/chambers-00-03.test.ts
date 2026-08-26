import { describe, expect, it } from "vitest";
import { Simulation } from "../src/sim/simulation";
import { AWAKENING } from "../src/world/room";
import { HAND_NOT_BODY, HOLDING_HAND, SECOND_SELF } from "../src/world/chambers";
import { ROSTER } from "../src/world/roster";
import { GOLDEN_RECORDINGS } from "../src/world/goldens";
import type { RoomDefinition } from "../src/sim/types";
import { actorOf, doorOpen, drive, framesFor, type Hold } from "./support/fp-drive";

/**
 * A golden tape per chamber: the recording the room is designed around, written
 * as intent rather than as a frame dump, plus the second pass that it makes
 * possible. Each one asserts the room can be finished, and — the part that
 * matters — that it cannot be finished without the echo doing its half.
 */
interface Golden {
  room: RoomDefinition;
  /** First pass: what gets recorded. */
  record: Hold[];
  /** Second pass: what the living player does with it. */
  replay: Hold[];
}

/** The first pass is the shipped recording; only the second pass is test data. */
function golden(room: RoomDefinition, replay: Hold[]): Golden {
  const record = GOLDEN_RECORDINGS[room.id];
  if (!record) throw new Error(`No shipped recording for ${room.id}`);
  return { room, record: [...record], replay };
}

const GOLDENS: Record<string, Golden> = {
  awakening: golden(AWAKENING, [{ ticks: 20 }, { forward: true, ticks: 150 }]),
  "second-self": golden(SECOND_SELF, [{ ticks: 60 }, { forward: true, ticks: 150 }]),
  "holding-hand": golden(HOLDING_HAND, [{ ticks: 30 }, { forward: true, ticks: 190 }]),
  // Step onto the amber plate, wait for him to walk through and reach the
  // alcove floor, then leave — which shuts the doorway behind him.
  "hand-not-body": golden(HAND_NOT_BODY, [
    { forward: true, right: true, ticks: 34 },
    { forward: true, ticks: 12 },
    { ticks: 90 },
    { forward: true, ticks: 120 },
  ]),
};

function play(golden: Golden): Simulation {
  const simulation = new Simulation(golden.room);
  drive(simulation, framesFor(golden.record));
  expect(simulation.canFold).toBe(true);
  expect(simulation.fold()).toBe(true);
  drive(simulation, framesFor(golden.replay));
  return simulation;
}

describe("the golden path through 00 to 03", () => {
  for (const [id, golden] of Object.entries(GOLDENS)) {
    it(`${id} can be finished`, () => {
      const simulation = play(golden);
      expect(simulation.state.phase).toBe("success");
      expect(simulation.state.success).toBe(true);
    });

    it(`${id} replays identically every time`, () => {
      const first = play(golden);
      const second = play(golden);
      expect(first.checksum()).toBe(second.checksum());
    });
  }
});

describe("each chamber needs the echo to do its half", () => {
  it("01: the plate will not answer the person standing on it", () => {
    const simulation = new Simulation(SECOND_SELF);
    drive(simulation, framesFor([{ forward: true, ticks: 38 }, { ticks: 30 }]));
    // Standing squarely on it during the recording, and it stays shut.
    expect(simulation.state.plates[0]?.pressedBy).toContain("present");
    expect(simulation.state.plates[0]?.active).toBe(false);
    expect(doorOpen(simulation.state, "inner-door")).toBe(false);
  });

  it("01: a recording that walks over the plate does not hold the door", () => {
    // Folding mid-stride is the failure this room is shaped to teach.
    const simulation = new Simulation(SECOND_SELF);
    drive(simulation, framesFor([{ forward: true, ticks: 40 }]));
    simulation.fold();
    drive(simulation, framesFor([{ ticks: 120 }]));
    // He walked on past it, so there is nothing standing on the plate.
    expect(actorOf(simulation.state, "past").z).toBeGreaterThan(10);
    expect(doorOpen(simulation.state, "inner-door")).toBe(false);
  });

  it("02: the way out is shut the moment the grip is let go", () => {
    const simulation = new Simulation(HOLDING_HAND);
    drive(simulation, framesFor([{ forward: true, ticks: 8 }, { act: true, ticks: 40 }]));
    expect(simulation.state.holds[0]?.active).toBe(true);
    expect(simulation.state.exitOpen).toBe(true);
    drive(simulation, framesFor([{ ticks: 4 }]));
    expect(simulation.state.exitOpen).toBe(false);
  });

  it("02: a recording that lets go early cannot be walked out of", () => {
    const simulation = new Simulation(HOLDING_HAND);
    drive(simulation, framesFor([{ forward: true, ticks: 8 }, { act: true, ticks: 34 }, { ticks: 6 }]));
    simulation.fold();
    drive(simulation, framesFor([{ ticks: 30 }, { forward: true, ticks: 190 }]));
    expect(simulation.state.success).toBe(false);
    expect(simulation.state.exitOpen).toBe(false);
  });

  it("03: the doorway cannot be opened by the recording", () => {
    const simulation = new Simulation(HAND_NOT_BODY);
    drive(simulation, framesFor([{ forward: true, right: true, ticks: 40 }, { ticks: 20 }]));
    // The living player is standing on the amber plate, which is what opens it —
    // but during the recording there is no one on the other side to walk through.
    expect(simulation.state.plates.find((plate) => plate.id === "amber-plate")?.active).toBe(true);
    expect(doorOpen(simulation.state, "partition-door")).toBe(true);
    expect(simulation.state.exitOpen).toBe(false);
  });

  it("03: his arrival in the alcove ends the room by itself", () => {
    const simulation = play(GOLDENS["hand-not-body"] as Golden);
    // He is in the alcove, on his light — and that IS the solve now. The sim
    // freezes on success, so the golden's old walk-out tail never runs: the
    // player is still on their plate, the doorway still held open for him.
    const echo = actorOf(simulation.state, "past");
    expect(echo.z).toBeGreaterThan(9.6);
    expect(simulation.state.phase).toBe("success");
    expect(simulation.state.success).toBe(true);
  });
});

describe("the roster", () => {
  it("gives every chamber a spawn that is inside its own room", () => {
    for (const chamber of ROSTER.all) {
      const simulation = new Simulation(chamber.sim);
      const actor = actorOf(simulation.state, "present");
      // A spawn buried in a wall would be pushed somewhere else on tick one.
      drive(simulation, framesFor([{ ticks: 3 }]));
      const settled = actorOf(simulation.state, "present");
      expect(Math.abs(settled.x - actor.x)).toBeLessThan(0.05);
      expect(Math.abs(settled.z - actor.z)).toBeLessThan(0.05);
      expect(settled.y).toBeCloseTo(0, 3);
    }
  });
});
