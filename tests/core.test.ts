import { describe, expect, it } from "vitest";
import { encodeInput, InputBit, movementIntent, NEUTRAL_INPUT } from "../src/core/input";
import { createInitialState, Simulation, simulationConstants } from "../src/core/simulation";
import { CROSSING_CHAMBER, TRACE_WEIGHT_CHAMBER } from "../src/content/chambers";
import { crossingGolden } from "../src/content/golden";

describe("InputFrame", () => {
  it("stores only quantized intent and resolves opposing directions to neutral", () => {
    const frame = encodeInput({ up: true, down: true, left: true, right: true, actionHeld: true });
    expect(frame & InputBit.ActionHeld).toBeTruthy();
    expect(movementIntent(frame)).toEqual({ x: 0, y: 0 });
  });
});

describe("record/reset/replay lifecycle", () => {
  it("records the full authored duration, then restores canonical state with exactly two non-colliding selves", () => {
    const simulation = new Simulation(CROSSING_CHAMBER);
    const initial = createInitialState(CROSSING_CHAMBER);
    for (let tick = 0; tick < CROSSING_CHAMBER.tapeDurationTicks; tick += 1) {
      simulation.step(encodeInput({ right: true }));
    }
    expect(simulation.state.phase).toBe("replay");
    expect(simulation.state.actors).toHaveLength(2);
    expect(simulation.state.actors.map((actor) => actor.id)).toEqual(["past", "present"]);
    expect(simulation.state.actors[0]?.x).toBe(initial.actors[0]?.x);
    expect(simulation.state.door).toEqual(initial.door);
    expect(simulation.tape?.frames).toHaveLength(CROSSING_CHAMBER.tapeDurationTicks);
  });

  it("rejects a corrupt tape into recoverable recording state", () => {
    const golden = crossingGolden();
    const corrupt = { ...golden.past, checksum: "00000000" };
    const simulation = new Simulation(CROSSING_CHAMBER);
    expect(simulation.loadTape(corrupt)).toMatch(/checksum/i);
    expect(simulation.state.phase).toBe("recording");
    expect(simulation.state.lastError).toMatch(/checksum/i);
    simulation.step(NEUTRAL_INPUT);
    expect(simulation.state.tick).toBe(1);
  });

  it("replaces the tape immediately when rerecording", () => {
    const simulation = new Simulation(CROSSING_CHAMBER);
    expect(simulation.loadTape(crossingGolden().past)).toBeNull();
    simulation.step(NEUTRAL_INPUT);
    simulation.rerecord();
    expect(simulation.tape).toBeNull();
    expect(simulation.state.phase).toBe("recording");
    expect(simulation.state.actors).toHaveLength(1);
    expect(simulation.state.tick).toBe(0);
  });

  it("uses a 250 ms grace expressed in fixed ticks", () => {
    expect(simulationConstants.graceTicks).toBe(8);
  });
});

describe("fold recording", () => {
  it("refuses to fold before one second has been recorded", () => {
    const simulation = new Simulation(CROSSING_CHAMBER);
    for (let tick = 0; tick < simulationConstants.minTapeTicks - 1; tick += 1) {
      simulation.step(encodeInput({ right: true }));
    }
    expect(simulation.foldRecording()).toBe(false);
    expect(simulation.state.phase).toBe("recording");
    expect(simulation.tape).toBeNull();
  });

  it("folds mid-recording into a full-length tape keeping only ActionHeld", () => {
    const simulation = new Simulation(CROSSING_CHAMBER);
    for (let tick = 0; tick < 24; tick += 1) simulation.step(encodeInput({ right: true }));
    for (let tick = 0; tick < 30; tick += 1) simulation.step(encodeInput({ right: true, actionHeld: true }));
    expect(simulation.foldRecording()).toBe(true);
    expect(simulation.state.phase).toBe("replay");
    expect(simulation.state.foldedAtTick).toBe(54);
    const tape = simulation.tape;
    expect(tape?.frames).toHaveLength(CROSSING_CHAMBER.tapeDurationTicks);
    for (let tick = 54; tick < CROSSING_CHAMBER.tapeDurationTicks; tick += 1) {
      expect(tape?.frames[tick]).toBe(InputBit.ActionHeld);
    }
  });

  it("does not fold outside the recording phase", () => {
    const simulation = new Simulation(CROSSING_CHAMBER);
    expect(simulation.loadTape(crossingGolden().past)).toBeNull();
    expect(simulation.foldRecording()).toBe(false);
    expect(simulation.state.phase).toBe("replay");
  });

  it("keeps the cooperative replay window at the authored duration after a fold", () => {
    const simulation = new Simulation(CROSSING_CHAMBER);
    for (let tick = 0; tick < simulationConstants.minTapeTicks; tick += 1) simulation.step(NEUTRAL_INPUT);
    expect(simulation.foldRecording()).toBe(true);
    let steps = 0;
    while (simulation.state.phase === "replay") {
      simulation.step(NEUTRAL_INPUT);
      steps += 1;
    }
    expect(steps).toBe(CROSSING_CHAMBER.tapeDurationTicks + simulationConstants.graceTicks);
  });

  it("completes the crossing after an early fold while holding the winch", () => {
    const simulation = new Simulation(CROSSING_CHAMBER);
    for (let tick = 0; tick < 24; tick += 1) simulation.step(encodeInput({ right: true }));
    for (let tick = 0; tick < 32; tick += 1) simulation.step(encodeInput({ actionHeld: true }));
    expect(simulation.foldRecording()).toBe(true);
    const cross = encodeInput({ right: true });
    for (let tick = 0; tick < 120 && simulation.state.phase === "replay"; tick += 1) {
      simulation.step(cross);
    }
    expect(simulation.state.success).toBe(true);
  });
});

describe("movement normalization", () => {
  it("moves at the same speed diagonally as on a single axis", () => {
    const simulation = new Simulation(CROSSING_CHAMBER);
    const start = { x: CROSSING_CHAMBER.spawn.x, y: CROSSING_CHAMBER.spawn.y };
    for (let tick = 0; tick < 10; tick += 1) simulation.step(encodeInput({ right: true, down: true }));
    const past = simulation.state.actors[0];
    if (!past) throw new Error("Recording actor is missing");
    const dx = past.x - start.x;
    const dy = past.y - start.y;
    expect(Math.sqrt(dx * dx + dy * dy)).toBeCloseTo(10 * simulationConstants.movePerTick, 6);
    expect(dx).toBeCloseTo(dy, 6);
  });
});

describe("context action target lock", () => {
  it("cannot reacquire after leaving hysteresis until action is released", () => {
    const simulation = new Simulation(CROSSING_CHAMBER);
    const rightHeld = encodeInput({ right: true, actionHeld: true });
    const leftHeld = encodeInput({ left: true, actionHeld: true });
    for (let tick = 0; tick < 25; tick += 1) simulation.step(rightHeld);
    expect(simulation.state.actors[0]?.targetId).toBe(CROSSING_CHAMBER.hold?.id);
    for (let tick = 0; tick < 16; tick += 1) simulation.step(leftHeld);
    expect(simulation.state.actors[0]).toMatchObject({ targetId: null, targetLockout: true });
    for (let tick = 0; tick < 16; tick += 1) simulation.step(rightHeld);
    expect(simulation.state.actors[0]).toMatchObject({ targetId: null, targetLockout: true });
    simulation.step(encodeInput({ actionReleased: true }));
    simulation.step(encodeInput({ actionHeld: true, actionPressed: true }));
    expect(simulation.state.actors[0]).toMatchObject({ targetId: CROSSING_CHAMBER.hold?.id, targetLockout: false });
  });

  it("does not acquire a nearby affordance behind the actor", () => {
    const chamber = structuredClone(CROSSING_CHAMBER);
    if (!chamber.hold) throw new Error("Trace hold missing");
    chamber.spawn = { x: chamber.hold.x + 20, y: chamber.hold.y };
    const simulation = new Simulation(chamber);
    simulation.step(encodeInput({ right: true, actionHeld: true }));
    expect(simulation.state.actors[0]?.targetId).toBeNull();
    simulation.step(encodeInput({ actionReleased: true }));
    simulation.step(encodeInput({ left: true, actionHeld: true, actionPressed: true }));
    expect(simulation.state.actors[0]?.targetId).toBe(chamber.hold.id);
  });
});

describe("canonical definitions", () => {
  it("keep production prototype tapes within the Phase-1 limit", () => {
    expect(CROSSING_CHAMBER.tapeDurationTicks).toBeLessThanOrEqual(14 * 30);
    expect(TRACE_WEIGHT_CHAMBER.tapeDurationTicks).toBeLessThanOrEqual(14 * 30);
  });
});
