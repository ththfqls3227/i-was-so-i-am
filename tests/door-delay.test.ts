import { describe, expect, it } from "vitest";
import { encodeFrame } from "../src/sim/input";
import { Simulation } from "../src/sim/simulation";
import { AWAKENING, DOOR_OPEN_DELAY_TICKS } from "../src/world/room";
import { SECOND_SELF } from "../src/world/chambers";

/**
 * What a door's opening delay means.
 *
 * For a door that latches it is a wait: the gate is satisfied once, and a beat
 * later the door moves whether or not anything is still standing there. For a
 * door that does not latch it is unchanged — those are open exactly while the
 * gate is satisfied, and that is the whole of what 01 teaches.
 *
 * The distinction is not decoration. The delay used to mean *consecutive* ticks
 * of pressure, so walking across 00's plate — about thirteen ticks against a
 * threshold of eighteen — never opened anything. The room could only be solved
 * by stopping on the plate, which nothing in the room says, and two judges
 * failed it eight to ten times each before giving up.
 */

const FORWARD = encodeFrame({ forward: true });
const NEUTRAL = encodeFrame({});

describe("00's door, which latches", () => {
  it("opens after a walk-over, without anyone standing on the plate", () => {
    const simulation = new Simulation(AWAKENING);
    // Walk on and keep walking. Never stop, never come back.
    let pressedOn: number | null = null;
    let leftAgain: number | null = null;
    for (let tick = 0; tick < 200; tick += 1) {
      simulation.step(FORWARD);
      const pressed = simulation.state.plates[0]?.active ?? false;
      if (pressed && pressedOn === null) pressedOn = tick;
      if (!pressed && pressedOn !== null && leftAgain === null) leftAgain = tick;
    }
    expect(pressedOn, "the walk did cross the plate").not.toBeNull();
    expect(leftAgain, "and did not stop on it").not.toBeNull();
    // The crossing is shorter than the delay — that is the whole difficulty.
    expect((leftAgain ?? 0) - (pressedOn ?? 0)).toBeLessThan(DOOR_OPEN_DELAY_TICKS);
    expect(simulation.state.doors[0]?.open, "the door opened anyway").toBe(true);
    expect(simulation.state.doors[0]?.latched).toBe(true);
  });

  it("still waits the beat it always waited", () => {
    // The pause is what a player glances back into, and the ending gives that
    // glance back to them. It must not become instant.
    const simulation = new Simulation(AWAKENING);
    let pressedOn: number | null = null;
    let openedOn: number | null = null;
    for (let tick = 0; tick < 200; tick += 1) {
      simulation.step(FORWARD);
      if (pressedOn === null && (simulation.state.plates[0]?.active ?? false)) pressedOn = tick;
      if (openedOn === null && (simulation.state.doors[0]?.open ?? false)) openedOn = tick;
    }
    expect(pressedOn).not.toBeNull();
    expect(openedOn).not.toBeNull();
    // One tick fewer than the constant: the count reaches 1 on the very tick
    // the plate is first pressed, so the door moves on the eighteenth tick of
    // counting rather than eighteen ticks after it started.
    expect((openedOn ?? 0) - (pressedOn ?? 0)).toBe(DOOR_OPEN_DELAY_TICKS - 1);
  });
});

describe("01's door, which does not latch", () => {
  it("shuts again the moment the plate is released", () => {
    // Unchanged by the above, and it must stay unchanged: this room is the one
    // that teaches that a posture has to be held.
    const spec = SECOND_SELF.doors[0];
    expect(spec?.latchOnOpen, "01's door is the non-latching kind").not.toBe(true);

    const simulation = new Simulation(SECOND_SELF);
    // Stand on the plate long enough for a latching door to have opened twice.
    for (let tick = 0; tick < 60; tick += 1) simulation.step(FORWARD);
    const standing = simulation.state.plates[0]?.active ?? false;
    // The living player is not what this plate answers to, so it stays shut —
    // and that is exactly the point of the room.
    expect(simulation.state.doors[0]?.open).toBe(standing);
    expect(simulation.state.doors[0]?.latched).toBe(false);

    for (let tick = 0; tick < 60; tick += 1) simulation.step(NEUTRAL);
    expect(simulation.state.doors[0]?.open, "nothing was left holding it").toBe(false);
  });
});
