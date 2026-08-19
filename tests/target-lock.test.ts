import { describe, expect, it } from "vitest";
import { distanceBetween } from "../src/core/geometry";
import { encodeInput, InputBit, NEUTRAL_INPUT, type InputFrame } from "../src/core/input";
import { Simulation } from "../src/core/simulation";
import type { ChamberDefinition, Tape } from "../src/core/types";
import { HANDOFF_CHAMBER, TRACE_WEIGHT_CHAMBER } from "../src/content/chambers";
import { handoffGolden, recordFoldedTape, traceWeightGolden } from "../src/content/golden";
import { traceRequiredHoldTicks, traceRequiredTravelTicks } from "../src/content/tutorial-timing";

function repeat(frame: InputFrame, count: number): InputFrame[] {
  return Array.from({ length: count }, () => frame);
}

const up = encodeInput({ up: true });
const left = encodeInput({ left: true });
const holdStill = encodeInput({ actionHeld: true });
const pushRight = encodeInput({ right: true, actionHeld: true });

/**
 * Encodes frames the way the render layer samples the keyboard, so recordings
 * carry the same ActionPressed/ActionReleased edges a real player produces.
 */
function keyboardEncoder(): (keys: { right?: boolean; action?: boolean }) => InputFrame {
  let previousAction = false;
  return (keys) => {
    const action = keys.action === true;
    let frame = encodeInput({ right: keys.right === true, actionHeld: action });
    if (action && !previousAction) frame |= InputBit.ActionPressed;
    if (!action && previousAction) frame |= InputBit.ActionReleased;
    previousAction = action;
    return frame;
  };
}

type TraceStage = "approach" | "grip" | "release" | "travel";

/**
 * Plays the Trace Weight recording card by card, exactly as the tutorial words
 * it: walk to the winch, grip it until the card says to let go, let go, then
 * hold right + action for the travel it asks for, then fold. Cards are obeyed
 * once each, the way a player reads them — the release is a single beat and the
 * push that follows starts while still standing inside the winch radius. Stage
 * thresholds come from the module the tutorial UI reads, never from tuned frame
 * counts: the point of the test is that following the words works.
 */
function traceWeightTutorialVerbatimTape(): Tape {
  const chamber = TRACE_WEIGHT_CHAMBER;
  const hold = chamber.hold;
  if (!hold) throw new Error("Trace Weight hold is missing");
  const requiredHold = traceRequiredHoldTicks();
  const requiredTravel = traceRequiredTravelTicks();
  const simulation = new Simulation(chamber);
  const encode = keyboardEncoder();
  let stage: TraceStage = "approach";
  let holdActiveSince: number | null = null;
  let travelledTicks = 0;

  for (let guard = 0; guard < chamber.tapeDurationTicks; guard += 1) {
    const state = simulation.state;
    if (state.phase !== "recording") break;
    const pilot = state.actors[0];
    if (!pilot) throw new Error("Recording actor is missing");
    if (stage === "approach" && distanceBetween(pilot.x, pilot.y, hold.x, hold.y) <= hold.radius) stage = "grip";
    if (stage === "travel" && travelledTicks >= requiredTravel) break; // the card now says: fold
    const frame = stage === "approach"
      ? encode({ right: true })
      : stage === "grip"
        ? encode({ action: true })
        : stage === "release"
          ? encode({}) // "let go and walk toward the weight"
          : encode({ right: true, action: true }); // "keep moving right and hold action too"
    simulation.step(frame);
    const next = simulation.state;
    if (next.phase !== "recording") break;
    if (stage === "travel") travelledTicks += 1;
    if (stage === "release") stage = "travel";
    if (stage === "grip") {
      if (next.hold?.active === true) {
        if (holdActiveSince === null) holdActiveSince = next.tapeTick;
        if (next.tapeTick - holdActiveSince >= requiredHold) stage = "release";
      } else {
        holdActiveSince = null;
      }
    }
  }

  if (!simulation.foldRecording() || !simulation.tape) {
    throw new Error("The tutorial-verbatim Trace Weight recording could not fold");
  }
  return simulation.tape;
}

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
    const simulation = run(TRACE_WEIGHT_CHAMBER, traceWeightTutorialVerbatimTape(), traceWeightGolden().present);
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
