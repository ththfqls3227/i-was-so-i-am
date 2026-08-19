import { describe, expect, it } from "vitest";
import { encodeInput, NEUTRAL_INPUT, type InputFrame } from "../src/core/input";
import { Simulation } from "../src/core/simulation";
import type { ChamberDefinition, Tape } from "../src/core/types";
import { HANDOFF_CHAMBER, LAST_HOLD_CHAMBER, TRACE_WEIGHT_CHAMBER } from "../src/content/chambers";
import { handoffGolden, lastHoldGolden, traceWeightGolden } from "../src/content/golden";

function run(chamber: ChamberDefinition, tape: Tape, present: InputFrame[]): Simulation {
  const simulation = new Simulation(chamber);
  const error = simulation.loadTape(tape);
  if (error) throw new Error(error);
  for (const frame of present) {
    if (simulation.state.phase !== "replay") break;
    simulation.step(frame);
  }
  return simulation;
}

function idleTape(chamber: ChamberDefinition): Tape {
  const simulation = new Simulation(chamber);
  for (let tick = 0; tick < chamber.tapeDurationTicks; tick += 1) simulation.step(NEUTRAL_INPUT);
  if (!simulation.tape) throw new Error("Idle tape was not recorded");
  return simulation.tape;
}

describe("TraceWeight connected beats", () => {
  const golden = traceWeightGolden();

  it("requires the past winch before the present can cross and reach the weight", () => {
    const simulation = run(TRACE_WEIGHT_CHAMBER, idleTape(TRACE_WEIGHT_CHAMBER), golden.present);
    const present = simulation.state.actors.find((actor) => actor.id === "present");
    expect(present?.x).toBeLessThan(TRACE_WEIGHT_CHAMBER.door?.rect.x ?? Infinity);
    expect(simulation.state.door?.latched).toBe(false);
    expect(simulation.state.forceObject?.x).toBe(TRACE_WEIGHT_CHAMBER.forceObject?.x);
    expect(simulation.state.success).toBe(false);
  });

  it("lets the past open the route but cannot finish without the present", () => {
    const simulation = run(TRACE_WEIGHT_CHAMBER, golden.past, Array(TRACE_WEIGHT_CHAMBER.tapeDurationTicks).fill(NEUTRAL_INPUT));
    expect(simulation.state.forceObject?.x).toBe(TRACE_WEIGHT_CHAMBER.forceObject?.x);
    expect(simulation.state.success).toBe(false);
  });

  it("latches the crossed bridge, then moves the final weight only under two aligned forces", () => {
    const simulation = new Simulation(TRACE_WEIGHT_CHAMBER);
    expect(simulation.loadTape(golden.past)).toBeNull();
    let sawLatchedBridge = false;
    let sawSingleForceAtWeight = false;
    for (const frame of golden.present) {
      if (simulation.state.phase !== "replay") break;
      simulation.step(frame);
      sawLatchedBridge ||= simulation.state.door?.latched === true;
      sawSingleForceAtWeight ||= simulation.state.forceObject?.force === 1;
    }
    expect(sawLatchedBridge).toBe(true);
    expect(sawSingleForceAtWeight).toBe(true);
    expect(simulation.state.forceObject?.x).toBe(simulation.state.forceObject?.maxX);
    expect(simulation.state.success).toBe(true);
  });
});

describe("LastHold ending state", () => {
  it("freezes success with the past still credited behind the final exit", () => {
    const golden = lastHoldGolden();
    const simulation = run(LAST_HOLD_CHAMBER, golden.past, golden.present);
    const past = simulation.state.actors.find((actor) => actor.id === "past");
    expect(simulation.state.success).toBe(true);
    expect(simulation.state.hold?.creditedActors).toContain("past");
    expect(past?.x).toBeLessThan(LAST_HOLD_CHAMBER.exit.x);
    const checksum = simulation.checksum();
    simulation.step(NEUTRAL_INPUT);
    expect(simulation.checksum()).toBe(checksum);
  });

  it("keeps the past behind the final threshold even when the present holds it open", () => {
    const approach = encodeInput({ right: true });
    const holdRight = encodeInput({ right: true, actionHeld: true });
    const source = new Simulation(LAST_HOLD_CHAMBER);
    for (let tick = 0; tick < 28; tick += 1) source.step(approach);
    for (let tick = 28; tick < LAST_HOLD_CHAMBER.tapeDurationTicks; tick += 1) source.step(holdRight);
    if (!source.tape) throw new Error("LastHold threshold tape missing");
    const presentFrames = [
      ...Array(28).fill(approach),
      ...Array(LAST_HOLD_CHAMBER.tapeDurationTicks - 28).fill(encodeInput({ actionHeld: true })),
    ];
    const simulation = run(LAST_HOLD_CHAMBER, source.tape, presentFrames);
    const past = simulation.state.actors.find((actor) => actor.id === "past");
    expect(past?.x).toBeLessThan(LAST_HOLD_CHAMBER.door?.rect.x ?? Number.NEGATIVE_INFINITY);
    expect(simulation.state.success).toBe(false);
  });
});

describe("Handoff live route change", () => {
  it("stages with the past, then requires the present to turn onto the upper delivery route", () => {
    const golden = handoffGolden();
    const simulation = new Simulation(HANDOFF_CHAMBER);
    expect(simulation.loadTape(golden.past)).toBeNull();
    let sawStaged = false;
    let sawReceived = false;
    let sawRedirected = false;
    for (const frame of golden.present) {
      if (simulation.state.phase !== "replay") break;
      simulation.step(frame);
      sawStaged ||= simulation.state.handoff?.stagedByPast === true;
      sawReceived ||= simulation.state.handoff?.receivedByPresent === true;
      sawRedirected ||= simulation.state.handoff?.redirectedByPresent === true;
    }
    expect({ sawStaged, sawReceived, sawRedirected }).toEqual({ sawStaged: true, sawReceived: true, sawRedirected: true });
    expect(simulation.state.handoff?.delivered).toBe(true);
    expect(simulation.state.success).toBe(true);
  });
});
