import { describe, expect, it } from "vitest";
import { encodeFrame, NEUTRAL_FRAME } from "../src/sim/input";
import { Simulation } from "../src/sim/simulation";
import { ROSTER } from "../src/world/roster";

/**
 * The tape does not start until the first act — and the world it waits in had
 * better be a world nothing is happening in.
 *
 * The second half is the invariant the parking quietly leans on: while the
 * player stands at spawn pressing nothing, no gate in the room may be
 * satisfied. If a spawn ever moves onto a plate, or a forcedActive plate lands
 * in a room that records, the first pass would open a door during the parked
 * ticks that the second pass has to count for from zero — and the echo walks
 * into a door the recording swore was open. Today every room holds this by
 * geometry; this test is what makes it a rule instead of a coincidence.
 */
describe("the parked tape", () => {
  const recordable = ROSTER.all.filter((chamber) => chamber.sim.recordingDisabled !== true);

  it("stays parked through a minute of standing still, in a room where nothing has started", () => {
    expect(recordable.length).toBeGreaterThan(0);
    for (const chamber of recordable) {
      const sim = new Simulation(chamber.sim);
      for (let tick = 0; tick < 60; tick += 1) sim.step(NEUTRAL_FRAME);
      const state = sim.state;
      expect(state.phase, chamber.sim.id).toBe("recording");
      expect(state.tapeTick, chamber.sim.id).toBe(0);
      expect(sim.recordedFrames.length, chamber.sim.id).toBe(0);
      for (const door of state.doors) {
        expect(door.open, `${chamber.sim.id} · ${door.id}`).toBe(false);
      }
      for (const plate of state.plates) {
        expect(plate.active, `${chamber.sim.id} · ${plate.id}`).toBe(false);
      }
    }
  });

  it("stays parked while the player only looks around", () => {
    // Reading the room is free, and reading it includes turning your head. A
    // judge reported the clock starting under a look-only drag; the contract
    // says buttons arm the tape and yaw alone never does.
    const sim = new Simulation(ROSTER.first.sim);
    for (const yawUnits of [256, 1024, 3072, 512]) {
      for (let tick = 0; tick < 15; tick += 1) {
        sim.step(encodeFrame({ yawUnits }));
      }
    }
    expect(sim.state.phase).toBe("recording");
    expect(sim.state.tapeTick).toBe(0);
    expect(sim.recordedFrames.length).toBe(0);
  });

  it("arms on the first button and only then lets the clock move", () => {
    const sim = new Simulation(ROSTER.first.sim);
    for (let tick = 0; tick < 30; tick += 1) sim.step(NEUTRAL_FRAME);
    expect(sim.state.tapeTick).toBe(0);
    sim.step(0b000001 /* forward */);
    expect(sim.recordedFrames.length).toBe(1);
    expect(sim.state.tapeTick).toBe(1);
  });
});
