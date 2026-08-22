import { describe, expect, it } from "vitest";
import { encodeFrame } from "../src/sim/input";
import { Simulation } from "../src/sim/simulation";
import { HOLDING_HAND, SECOND_SELF } from "../src/world/chambers";
import { LAST_HOLD } from "../src/world/chambers-08-09";
import { framesFor, GOLDEN_RECORDINGS } from "../src/world/goldens";
import type { RoomDefinition } from "../src/sim/types";

/**
 * What a tick settles before it ends.
 *
 * A tick evaluates plates, then holds, then doors, then the exit — so anything
 * gated on a hold is answered in the same tick the hold is taken, not the tick
 * after. If that order were ever shuffled, a gate would lag by one tick: the
 * grip would read as taken while the way out still read as shut, and the only
 * thing that would notice is a player wondering why the door did not move.
 *
 * These lock the order by its consequence rather than by reading the source,
 * so a refactor that reorders the calls fails here rather than in a browser.
 */

const NEUTRAL = encodeFrame({});

/** Play a room's own recording, fold it, and hand back the running simulation. */
function intoReplay(room: RoomDefinition): Simulation {
  const simulation = new Simulation(room);
  const recording = GOLDEN_RECORDINGS[room.id];
  if (!recording) throw new Error(`No shipped recording for ${room.id}`);
  for (const frame of framesFor([...recording])) simulation.step(frame);
  if (!simulation.fold()) throw new Error(`${room.id} refused to fold`);
  return simulation;
}

describe("a tick settles the whole chain before it ends", () => {
  for (const room of [HOLDING_HAND, LAST_HOLD]) {
    it(`${room.id}: the way out is never shut while the grip that opens it is held`, () => {
      const simulation = intoReplay(room);
      let sawTheGripTaken = false;
      for (let tick = 0; tick < 240; tick += 1) {
        simulation.step(NEUTRAL);
        const held = simulation.state.holds[0]?.active ?? false;
        if (held) sawTheGripTaken = true;
        // Not "eventually agrees" — agrees on every single tick, including the
        // one the grip is taken on.
        expect({ tick, held, exitOpen: simulation.state.exitOpen })
          .toEqual({ tick, held, exitOpen: held });
      }
      expect(sawTheGripTaken, "the echo did take the grip during the window").toBe(true);
    });
  }

  it("01: the door is never shut while the plate that opens it is pressed", () => {
    // A plate rather than a hold, so the first link in the chain is covered too.
    const simulation = intoReplay(SECOND_SELF);
    let sawThePlatePressed = false;
    for (let tick = 0; tick < 240; tick += 1) {
      simulation.step(NEUTRAL);
      const pressed = simulation.state.plates[0]?.active ?? false;
      if (pressed) sawThePlatePressed = true;
      const door = simulation.state.doors[0];
      if (!door || door.latched) continue;
      // The door has an opening delay, so it may lag a pressed plate. What it
      // must never do is be open while the plate is not.
      if (door.open) {
        expect({ tick, open: door.open, pressed })
          .toEqual({ tick, open: door.open, pressed: true });
      }
    }
    expect(sawThePlatePressed, "the echo did stand on the plate").toBe(true);
  });
});
