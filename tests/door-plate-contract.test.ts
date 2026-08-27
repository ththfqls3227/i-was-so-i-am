import { describe, expect, it } from "vitest";
import { encodeFrame } from "../src/sim/input";
import { Simulation } from "../src/sim/simulation";
import { AWAKENING } from "../src/world/room";
import { SECOND_SELF } from "../src/world/chambers";
import { goldenTape } from "../src/world/goldens";

/**
 * What a plate means, everywhere in the building.
 *
 * Down while something stands on it, up when nothing does. No clocks: no wait
 * before a door moves, no grace before it shuts, and no latch that leaves it
 * open after the foot has gone. 00 was the only room that ever broke this, and
 * it broke it in all three ways at once so that the first room could be walked
 * out of alone.
 *
 * The cost of the rule is that 00 can no longer be left alone, and the file
 * this replaces spent its length defending the timings that made it possible.
 * The last test here is the one that matters: the room is still solvable, by
 * the thing the game is actually about.
 */

const FORWARD = encodeFrame({ forward: true });
const NEUTRAL = encodeFrame({});

/** Step the room until the predicate holds, or give up and say so. */
function until(simulation: Simulation, frame: number, done: () => boolean, limit = 400): number {
  for (let tick = 0; tick < limit; tick += 1) {
    simulation.step(frame);
    if (done()) return tick;
  }
  return -1;
}

const plateDown = (simulation: Simulation): boolean => simulation.state.plates[0]?.active === true;
const doorOpen = (simulation: Simulation): boolean => simulation.state.doors[0]?.open === true;

describe("a plate and the door it drives", () => {
  it("opens on the tick the plate goes down, with nothing in between", () => {
    const simulation = new Simulation(AWAKENING);
    const pressed = until(simulation, FORWARD, () => plateDown(simulation));
    expect(pressed, "the walk reached the plate").toBeGreaterThanOrEqual(0);
    // Same tick. A door that waits is a door on a clock, and nothing in this
    // building is on a clock any more.
    expect(doorOpen(simulation)).toBe(true);
  });

  it("shuts on the tick the plate comes up, with nothing in between", () => {
    const simulation = new Simulation(AWAKENING);
    expect(until(simulation, FORWARD, () => plateDown(simulation))).toBeGreaterThanOrEqual(0);
    expect(doorOpen(simulation)).toBe(true);
    // Keep walking, straight off the far edge of the disc.
    const released = until(simulation, FORWARD, () => !plateDown(simulation));
    expect(released, "the walk crossed the plate and left it").toBeGreaterThanOrEqual(0);
    expect(doorOpen(simulation)).toBe(false);
    expect(simulation.state.doors[0]?.latched).toBe(false);
  });

  it("cannot be walked out of alone, which is the price of the rule", () => {
    const simulation = new Simulation(AWAKENING);
    // Walk the whole room. The plate is 4.4 m short of the doorway, so by the
    // time the doorway is reachable the plate is behind you and the way is shut.
    for (let tick = 0; tick < 400; tick += 1) simulation.step(FORWARD);
    expect(simulation.state.success, "no solo walk-through").toBe(false);
    expect(doorOpen(simulation)).toBe(false);
  });

  it("is solvable with the recording, which is what the room is for", () => {
    const tape = goldenTape(AWAKENING);
    expect(tape, "00 has a golden recording").not.toBeNull();
    if (!tape) return;

    const simulation = new Simulation(AWAKENING);
    expect(simulation.loadTape(tape)).toBe(true);
    // He walks to the plate and stands on it. The door is open because he is
    // standing there, and it stays open for exactly as long as he does.
    const opened = until(simulation, NEUTRAL, () => doorOpen(simulation));
    expect(opened, "the echo reached the plate and the door answered").toBeGreaterThanOrEqual(0);
    expect(simulation.state.plates[0]?.pressedBy).toContain("past");

    const left = until(simulation, FORWARD, () => simulation.state.success);
    expect(left, "and the living player walked out past him").toBeGreaterThanOrEqual(0);
  });
});

describe("01, which never had the exception", () => {
  it("still opens only for the echo, and shuts the moment he stops standing", () => {
    const spec = SECOND_SELF.doors[0];
    expect(spec?.latchOnOpen).toBe(false);

    const simulation = new Simulation(SECOND_SELF);
    // Stand on it as the living player, at length. It is not your plate.
    for (let tick = 0; tick < 80; tick += 1) simulation.step(FORWARD);
    expect(doorOpen(simulation)).toBe(false);
    expect(simulation.state.doors[0]?.latched).toBe(false);
  });
});
