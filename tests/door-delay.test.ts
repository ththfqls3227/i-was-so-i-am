import { describe, expect, it } from "vitest";
import { encodeFrame } from "../src/sim/input";
import { Simulation } from "../src/sim/simulation";
import { AWAKENING, DOOR_OPEN_DELAY_TICKS } from "../src/world/room";
import { SECOND_SELF } from "../src/world/chambers";
import { TICK_RATE, WALK_SPEED } from "../src/sim/constants";

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

describe("00's door, which opens on a walk-over and shuts on a delay", () => {
  it("opens after a walk-over, without anyone standing on the plate", () => {
    const simulation = new Simulation(AWAKENING);
    // Walk on and keep walking. Never stop, never come back.
    let pressedOn: number | null = null;
    let leftAgain: number | null = null;
    // Whether it opened at all, not whether it is open at the end: without a
    // latch it also shuts again, and 200 ticks is well past the closing grace.
    let everOpened = false;
    for (let tick = 0; tick < 200; tick += 1) {
      simulation.step(FORWARD);
      const pressed = simulation.state.plates[0]?.active ?? false;
      if (pressed && pressedOn === null) pressedOn = tick;
      if (!pressed && pressedOn !== null && leftAgain === null) leftAgain = tick;
      if (simulation.state.doors[0]?.open === true) everOpened = true;
    }
    expect(pressedOn, "the walk did cross the plate").not.toBeNull();
    expect(leftAgain, "and did not stop on it").not.toBeNull();
    // The crossing is shorter than the delay — that is the whole difficulty.
    expect((leftAgain ?? 0) - (pressedOn ?? 0)).toBeLessThan(DOOR_OPEN_DELAY_TICKS);
    expect(everOpened, "the door opened anyway").toBe(true);
    // It no longer latches. Surviving the foot leaving is a property of the
    // opening delay; staying open forever was a separate promise, and the one
    // the owner reported three times as a bug — step off 00's plate and the
    // door simply never shut, which is not what a plate means anywhere else in
    // the game.
    expect(simulation.state.doors[0]?.latched).toBe(false);
  });

  it("shuts again once the grace runs out, and the room is still leavable", () => {
    const spec = AWAKENING.doors[0];
    const grace = spec?.closeDelayTicks ?? 0;
    expect(grace, "00 buys the walk to the doorway with a closing delay").toBeGreaterThan(0);

    const simulation = new Simulation(AWAKENING);
    // Walk on, walk off, then stand still well past the grace.
    let openedAt: number | null = null;
    for (let tick = 0; tick < 200; tick += 1) {
      simulation.step(FORWARD);
      if (openedAt === null && simulation.state.doors[0]?.open === true) openedAt = tick;
    }
    expect(openedAt, "the walk-over opened it").not.toBeNull();
    expect(simulation.state.plates[0]?.active, "and nobody stayed on the plate").toBe(false);

    for (let tick = 0; tick < grace + 5; tick += 1) simulation.step(NEUTRAL);
    expect(simulation.state.doors[0]?.open, "it closed").toBe(false);

    // And the grace is long enough to matter: 4.4 m at walking speed is about
    // a second, so a player who keeps going is through before it shuts.
    const walked = (grace / TICK_RATE) * WALK_SPEED;
    expect(walked, "the grace covers the plate-to-doorway walk").toBeGreaterThan(4.4);
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
