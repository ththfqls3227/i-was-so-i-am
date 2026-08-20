import { describe, expect, it } from "vitest";
import { encodeInput, NEUTRAL_INPUT, type InputFrame } from "../src/core/input";
import { Simulation } from "../src/core/simulation";
import type { ChamberDefinition, Tape } from "../src/core/types";
import { HANDOFF_CHAMBER, LAST_HOLD_CHAMBER, TRACE_WEIGHT_CHAMBER } from "../src/content/chambers";
import { handoffGolden, lastHoldGolden, recordFoldedTape, traceWeightGolden } from "../src/content/golden";

const right = encodeInput({ right: true });
const down = encodeInput({ down: true });
const holdStill = encodeInput({ actionHeld: true });
const pushLeft = encodeInput({ left: true, actionHeld: true });

function repeat(frame: InputFrame, count: number): InputFrame[] {
  return Array.from({ length: count }, () => frame);
}

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

function runToTimeout(chamber: ChamberDefinition, tape: Tape, present: InputFrame[]): Simulation {
  const simulation = new Simulation(chamber);
  const error = simulation.loadTape(tape);
  if (error) throw new Error(error);
  let index = 0;
  while (simulation.state.phase === "replay") {
    simulation.step(present[index] ?? NEUTRAL_INPUT);
    index += 1;
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

describe("LastHold two-stage past", () => {
  const golden = lastHoldGolden();

  it("bridges the gap, keeps the past at the handle, and frees only the present", () => {
    const simulation = run(LAST_HOLD_CHAMBER, golden.past, golden.present);
    const past = simulation.state.actors.find((actor) => actor.id === "past");
    const present = simulation.state.actors.find((actor) => actor.id === "present");
    expect(simulation.state.success).toBe(true);
    expect(simulation.state.forceObject?.x).toBe(LAST_HOLD_CHAMBER.forceObject?.minX);
    expect(simulation.state.hold?.creditedActors).toContain("past");
    expect(past?.x).toBeLessThan(LAST_HOLD_CHAMBER.door?.rect.x ?? Number.NEGATIVE_INFINITY);
    expect(present?.x).toBeGreaterThan(LAST_HOLD_CHAMBER.door?.rect.x ?? Number.POSITIVE_INFINITY);
    const checksum = simulation.checksum();
    simulation.step(NEUTRAL_INPUT);
    expect(simulation.checksum()).toBe(checksum);
  });

  it("fails with block-not-bridged when the past holds the handle without seating the stone", () => {
    const handleOnly = recordFoldedTape(LAST_HOLD_CHAMBER, [...repeat(right, 47), ...repeat(holdStill, 20)]);
    const simulation = runToTimeout(LAST_HOLD_CHAMBER, handleOnly, golden.present);
    expect(simulation.state.success).toBe(false);
    expect(simulation.state.phase).toBe("rerecord");
    expect(simulation.state.lastError).toBe("block-not-bridged");
  });

  it("fails with hold-released-early when the stone is seated but the handle is never held", () => {
    const bridgeOnly = recordFoldedTape(LAST_HOLD_CHAMBER, [
      ...repeat(right, 50),
      ...repeat(down, 18),
      ...repeat(pushLeft, 45),
      right,
    ]);
    const simulation = runToTimeout(LAST_HOLD_CHAMBER, bridgeOnly, golden.present);
    const present = simulation.state.actors.find((actor) => actor.id === "present");
    expect(simulation.state.forceObject?.x).toBe(LAST_HOLD_CHAMBER.forceObject?.minX);
    expect(present?.x).toBeLessThan(LAST_HOLD_CHAMBER.door?.rect.x ?? Number.NEGATIVE_INFINITY);
    expect(simulation.state.success).toBe(false);
    expect(simulation.state.lastError).toBe("hold-released-early");
  });

  it("never opens the final door for the present's own hand (requiredActor past)", () => {
    const simulation = new Simulation(LAST_HOLD_CHAMBER);
    expect(simulation.loadTape(idleTape(LAST_HOLD_CHAMBER))).toBeNull();
    const presentFrames = [...repeat(right, 47), ...repeat(holdStill, LAST_HOLD_CHAMBER.tapeDurationTicks - 47)];
    let sawPresentCredited = false;
    let sawDoorOpen = false;
    for (const frame of presentFrames) {
      if (simulation.state.phase !== "replay") break;
      simulation.step(frame);
      sawPresentCredited ||= simulation.state.hold?.creditedActors.includes("present") === true;
      sawDoorOpen ||= simulation.state.door?.open === true;
    }
    expect(sawPresentCredited).toBe(true);
    expect(sawDoorOpen).toBe(false);
    expect(simulation.state.success).toBe(false);
  });
});

describe("Handoff delivery gate", () => {
  const golden = handoffGolden();

  it("opens the gate from the past's switch and lets the present carry the box through it", () => {
    const simulation = new Simulation(HANDOFF_CHAMBER);
    expect(simulation.loadTape(golden.past)).toBeNull();
    let sawGateOpenByPast = false;
    let sawPresentCarrying = false;
    for (const frame of golden.present) {
      if (simulation.state.phase !== "replay") break;
      simulation.step(frame);
      sawGateOpenByPast ||= simulation.state.door?.open === true && simulation.state.hold?.creditedActors.includes("past") === true;
      sawPresentCarrying ||= simulation.state.handoff?.holder === "present";
    }
    expect({ sawGateOpenByPast, sawPresentCarrying }).toEqual({ sawGateOpenByPast: true, sawPresentCarrying: true });
    expect(simulation.state.handoff?.delivered).toBe(true);
    expect(simulation.state.success).toBe(true);
  });

  it("keeps the carrier out of the past's hands — only the living self lifts it", () => {
    // The past walks onto the pedestal holding the action key the whole way.
    const grabbyPast = recordFoldedTape(HANDOFF_CHAMBER, [
      ...repeat(encodeInput({ down: true, right: true, actionHeld: true }), 26),
      ...repeat(holdStill, 20),
    ]);
    const simulation = new Simulation(HANDOFF_CHAMBER);
    expect(simulation.loadTape(grabbyPast)).toBeNull();
    const carrierId = HANDOFF_CHAMBER.handoff?.id;
    const held: Array<string | null> = [];
    while (simulation.state.phase === "replay") {
      simulation.step(NEUTRAL_INPUT);
      if (simulation.state.handoff?.holder !== null) held.push(simulation.state.handoff?.holder ?? null);
      const past = simulation.state.actors.find((actor) => actor.id === "past");
      expect(past?.targetId).not.toBe(carrierId);
    }
    expect(held).toEqual([]);
  });

  it("fails with delivery-gate-closed when the past never grips the switch", () => {
    const simulation = runToTimeout(HANDOFF_CHAMBER, idleTape(HANDOFF_CHAMBER), golden.present);
    expect(simulation.state.door?.open).toBe(false);
    expect(simulation.state.handoff?.delivered).toBe(false);
    expect(simulation.state.lastError).toBe("delivery-gate-closed");
  });

  it("fails with carrier-not-carried when the gate is open but the box stays on its pedestal", () => {
    const simulation = runToTimeout(HANDOFF_CHAMBER, golden.past, []);
    expect(simulation.state.door?.open).toBe(true);
    expect(simulation.state.handoff?.carriedByPresent).toBe(false);
    expect(simulation.state.lastError).toBe("carrier-not-carried");
  });

  // A working tape plus a slow second pass is not a broken recording, and must
  // not be reported as one: the replay window is fixed by the chamber, so "press
  // R and record again" would send the player to fix what already works.
  it("fails with delivery-too-slow when the present lifts the box but dawdles", () => {
    const simulation = new Simulation(HANDOFF_CHAMBER);
    expect(simulation.loadTape(golden.past)).toBeNull();
    // Follow the golden hand only until the box is lifted, then stop.
    for (const frame of golden.present) {
      if (simulation.state.phase !== "replay" || simulation.state.handoff?.carriedByPresent === true) break;
      simulation.step(frame);
    }
    expect(simulation.state.handoff?.carriedByPresent).toBe(true);
    while (simulation.state.phase === "replay") simulation.step(NEUTRAL_INPUT);
    expect(simulation.state.door?.open).toBe(true);
    expect(simulation.state.handoff?.delivered).toBe(false);
    expect(simulation.state.success).toBe(false);
    expect(simulation.state.lastError).toBe("delivery-too-slow");
  });
});
