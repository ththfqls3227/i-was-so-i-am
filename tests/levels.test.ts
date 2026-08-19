import { describe, expect, it } from "vitest";
import { NEUTRAL_INPUT } from "../src/core/input";
import { Simulation } from "../src/core/simulation";
import type { ChamberDefinition, Tape } from "../src/core/types";
import { CROSSING_CHAMBER, TRACE_WEIGHT_CHAMBER } from "../src/content/chambers";
import { crossingGolden, traceWeightGolden } from "../src/content/golden";

function run(chamber: ChamberDefinition, tape: Tape, presentFrames: number[]): Simulation {
  const simulation = new Simulation(chamber);
  expect(simulation.loadTape(tape)).toBeNull();
  for (const frame of presentFrames) {
    if (simulation.state.phase !== "replay") break;
    simulation.step(frame);
  }
  return simulation;
}

describe("Crossing cooperation gate", () => {
  const golden = crossingGolden();

  it("opens only while the past holds and lets the present complete", () => {
    const simulation = run(CROSSING_CHAMBER, golden.past, golden.present);
    expect(simulation.state.success).toBe(true);
    expect(simulation.state.phase).toBe("success");
    expect(simulation.state.actors).toHaveLength(2);
  });

  it("cannot complete with the past role alone", () => {
    const simulation = run(CROSSING_CHAMBER, golden.past, Array(CROSSING_CHAMBER.tapeDurationTicks).fill(NEUTRAL_INPUT));
    expect(simulation.state.success).toBe(false);
  });

  it("cannot complete with the present route and an idle past", () => {
    const idleTape = { ...golden.past, frames: Array(CROSSING_CHAMBER.tapeDurationTicks).fill(NEUTRAL_INPUT) };
    const source = new Simulation(CROSSING_CHAMBER);
    for (let tick = 0; tick < CROSSING_CHAMBER.tapeDurationTicks; tick += 1) source.step(NEUTRAL_INPUT);
    const validIdleTape = source.tape;
    expect(validIdleTape).not.toBeNull();
    if (!validIdleTape) throw new Error("Idle tape was not created");
    const simulation = run(CROSSING_CHAMBER, validIdleTape, golden.present);
    expect(simulation.state.success).toBe(false);
    expect(idleTape.frames).toHaveLength(CROSSING_CHAMBER.tapeDurationTicks);
  });
});

describe("Trace Weight shared-force gate", () => {
  const golden = traceWeightGolden();

  it("requires two aligned live contributions to move the boulder and complete", () => {
    const simulation = run(TRACE_WEIGHT_CHAMBER, golden.past, golden.present);
    expect(simulation.state.success).toBe(true);
    expect(simulation.state.forceObject?.x).toBe(simulation.state.forceObject?.maxX);
    expect(simulation.state.tick).toBeLessThan(TRACE_WEIGHT_CHAMBER.tapeDurationTicks - 30);
  });

  it("does not move with the past contribution alone", () => {
    const simulation = run(TRACE_WEIGHT_CHAMBER, golden.past, Array(TRACE_WEIGHT_CHAMBER.tapeDurationTicks).fill(NEUTRAL_INPUT));
    expect(simulation.state.success).toBe(false);
    expect(simulation.state.forceObject?.x).toBe(TRACE_WEIGHT_CHAMBER.forceObject?.x);
  });

  it("does not move with the present contribution alone", () => {
    const source = new Simulation(TRACE_WEIGHT_CHAMBER);
    for (let tick = 0; tick < TRACE_WEIGHT_CHAMBER.tapeDurationTicks; tick += 1) source.step(NEUTRAL_INPUT);
    const idleTape = source.tape;
    if (!idleTape) throw new Error("Idle tape was not created");
    const simulation = run(TRACE_WEIGHT_CHAMBER, idleTape, golden.present);
    expect(simulation.state.success).toBe(false);
    expect(simulation.state.forceObject?.x).toBe(TRACE_WEIGHT_CHAMBER.forceObject?.x);
  });
});
