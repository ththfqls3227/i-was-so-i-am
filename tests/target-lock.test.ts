import { describe, expect, it } from "vitest";
import { encodeInput, NEUTRAL_INPUT, type InputFrame } from "../src/core/input";
import { Simulation } from "../src/core/simulation";
import type { ChamberDefinition, Tape } from "../src/core/types";
import { HANDOFF_CHAMBER, TRACE_WEIGHT_CHAMBER } from "../src/content/chambers";
import { handoffGolden, recordFoldedTape, traceWeightGolden } from "../src/content/golden";
import { recordTraceWeightByCard } from "./support/trace-card";

function repeat(frame: InputFrame, count: number): InputFrame[] {
  return Array.from({ length: count }, () => frame);
}

const up = encodeInput({ up: true });
const left = encodeInput({ left: true });
const holdStill = encodeInput({ actionHeld: true });
const pushRight = encodeInput({ right: true, actionHeld: true });

/** Replays the tape and, if the present route runs out, waits the window out so a
 * failure reports the structured code instead of a half-finished replay. */
function run(chamber: ChamberDefinition, tape: Tape, presentFrames: InputFrame[]): Simulation {
  const simulation = new Simulation(chamber);
  const error = simulation.loadTape(tape);
  if (error) throw new Error(error);
  for (const frame of presentFrames) {
    if (simulation.state.phase !== "replay") break;
    simulation.step(frame);
  }
  while (simulation.state.phase === "replay") simulation.step(NEUTRAL_INPUT);
  return simulation;
}

describe("target lock releases the target it just lost, not every target", () => {
  it("completes Trace Weight from a tutorial-verbatim recording (winch, release, right + action, fold)", () => {
    const verbatim = recordTraceWeightByCard({ reactionTicks: 0 }).tape;
    if (!verbatim) throw new Error("The tutorial-verbatim recording produced no tape");
    const simulation = run(TRACE_WEIGHT_CHAMBER, verbatim, traceWeightGolden().present);
    const past = simulation.state.actors.find((actorState) => actorState.id === "past");
    expect(past?.targetId).toBe(TRACE_WEIGHT_CHAMBER.forceObject?.id);
    expect(simulation.state.forceObject?.x).toBe(TRACE_WEIGHT_CHAMBER.forceObject?.maxX);
    expect(simulation.state.lastError).toBeNull();
    expect(simulation.state.success).toBe(true);
  });

  it("still refuses to instantly regrab the same affordance it walked out of", () => {
    const chamber = TRACE_WEIGHT_CHAMBER;
    const hold = chamber.hold;
    if (!hold) throw new Error("Trace Weight hold is missing");
    const simulation = new Simulation(chamber);
    for (let tick = 0; tick < 25; tick += 1) simulation.step(pushRight);
    expect(simulation.state.actors[0]?.targetId).toBe(hold.id);
    const pushLeft = encodeInput({ left: true, actionHeld: true });
    for (let tick = 0; tick < 16; tick += 1) simulation.step(pushLeft);
    expect(simulation.state.actors[0]).toMatchObject({ targetId: null, lockedOutTargetId: hold.id });
    for (let tick = 0; tick < 16; tick += 1) simulation.step(pushRight);
    expect(simulation.state.actors[0]).toMatchObject({ targetId: null, lockedOutTargetId: hold.id });
  });
});

describe("handoff carrier exclusivity", () => {
  /**
   * The past waits one step below the gate switch and presses action while the
   * present walks the carrier up past it. The press tick is swept across the
   * whole pass-by window: whichever tick the player happened to press on, the
   * past must grip the switch and open the delivery gate.
   */
  function waitingPastTape(pressDelay: number): Tape {
    return recordFoldedTape(HANDOFF_CHAMBER, [
      ...repeat(pushRight, 48), // lift the carrier and stage it at the junction
      ...repeat(up, 18), // climb to the gate switch
      ...repeat(NEUTRAL_INPUT, pressDelay), // wait beside it while the present catches up
      ...repeat(holdStill, 20), // grip the switch, then fold
    ]);
  }

  it("delivers no matter when the past presses action while the present carries the box past it", () => {
    const present = handoffGolden().present;
    const failures: Array<{ pressDelay: number; lastError: string | null }> = [];
    for (let pressDelay = 0; pressDelay <= 24; pressDelay += 1) {
      const simulation = run(HANDOFF_CHAMBER, waitingPastTape(pressDelay), present);
      if (!simulation.state.success) {
        failures.push({ pressDelay, lastError: simulation.state.lastError });
      }
    }
    expect(failures).toEqual([]);
  });

  it("never lets an actor target a carrier another actor is holding", () => {
    const past = recordFoldedTape(HANDOFF_CHAMBER, [
      ...repeat(pushRight, 48), // stage the carrier at the junction
      left,
      left, // turn back toward it
      ...repeat(holdStill, 24), // keep reaching for the box the present is about to take
    ]);
    const carrierId = HANDOFF_CHAMBER.handoff?.id;
    const simulation = new Simulation(HANDOFF_CHAMBER);
    expect(simulation.loadTape(past)).toBeNull();
    let sawPresentHolding = false;
    const stolen: number[] = [];
    for (const frame of handoffGolden().present) {
      if (simulation.state.phase !== "replay") break;
      simulation.step(frame);
      const state = simulation.state;
      if (state.handoff?.holder !== "present") continue;
      sawPresentHolding = true;
      if (state.actors.find((actorState) => actorState.id === "past")?.targetId === carrierId) {
        stolen.push(state.tapeTick);
      }
    }
    expect(sawPresentHolding).toBe(true);
    expect(stolen).toEqual([]);
  });
});
